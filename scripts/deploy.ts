/**
 * Deploy the v2 contracts.
 *
 *   node scripts/deploy.ts sepolia
 *   APERTURE_CONFIRM=mainnet node scripts/deploy.ts mainnet
 *
 * The script this replaces stopped after `declare` and printed a heredoc for a
 * human to paste — with the v1 constructor arity, which would have reverted.
 *
 * Three properties matter here, because none of this can be undone:
 *
 *   Idempotent. Every step records its result to deployments/<network>.json and
 *   is skipped if already done, so a crash mid-run resumes instead of deploying
 *   a second registry nobody is pointing at.
 *
 *   Ordered, and checked. The anonymizer's constructor calls
 *   `registry.ballot_domain()`, so the registry must exist first — and a wrong
 *   registry address reverts the deploy rather than being written into a
 *   write-once field and discovered months later.
 *
 *   Verified before the point of no return. The registry's domain is compared
 *   against an independent local derivation BEFORE the anonymizer goes out. If
 *   they disagree, every ballot address this deployment publishes is wrong, and
 *   this is the last moment that costs nothing.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ballotDomain } from "../packages/strk20-governance/src/ballot.ts";
import { num, shortString } from "starknet";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

type Network = "sepolia" | "mainnet";

interface Params {
  chainId: string;
  epoch: string;
  owner: string;
  tallyOperator: string;
  ballotAccountClassHash: string;
  minQuorum: string;
  assertedPayoutCap: string;
  payoutTimelockBlocks: string;
  pool: string;
  account: string;
}

interface State {
  network: Network;
  registryClassHash?: string;
  anonymizerClassHash?: string;
  registry?: string;
  anonymizer?: string;
  ballotDomain?: string;
  daoMasterPublicKey?: string;
  deployedAt?: string;
}

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(resolve(ROOT, ".env"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]!] = m[2]!.trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const statePath = (network: Network) => resolve(ROOT, "deployments", `${network}.json`);

function readState(network: Network): State {
  const p = statePath(network);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as State) : { network };
}

function writeState(state: State): void {
  mkdirSync(resolve(ROOT, "deployments"), { recursive: true });
  writeFileSync(statePath(state.network), `${JSON.stringify(state, null, 2)}\n`);
}

/**
 * Run one sncast command.
 *
 * `--wait` is not optional here. Without it the next command is signed against
 * a nonce the chain has not seen advance yet and fails with "Invalid
 * transaction nonce" — which is exactly what happened on the first Sepolia run,
 * between the two declares.
 *
 * `--json` because scraping `key: value` out of human-facing output is a
 * parser that breaks silently on a formatting change, in a script whose job is
 * to be right about addresses.
 */
function sncast(args: string[], rpc: string, account: string): Record<string, unknown> {
  const full = ["--json", "--wait", "--account", account, ...args, "--url", rpc];
  process.stdout.write(`  sncast ${args[0]} …\n`);

  let text: string;
  try {
    text = execFileSync("sncast", full, { cwd: resolve(ROOT, "contracts"), encoding: "utf8" });
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    text = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    // A class already on chain is success for our purposes: the point of a
    // declare is that the class exists, not that we were the ones to put it
    // there.
    if (!/already declared/i.test(text)) throw new Error(text || String(error));
  }

  // sncast --json emits one JSON object per line; the last complete one wins.
  const objects = text
    .split("\n")
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return undefined;
      }
    })
    .filter((v): v is Record<string, unknown> => v !== undefined);

  if (objects.length === 0) throw new Error(`sncast produced no JSON output:\n${text}`);
  // Merge rather than taking the last: sncast emits progress lines, then the
  // result, then a "notification" object of Voyager links. Taking the last one
  // found the notification and missed the address — after the contract had
  // already deployed, which is the worst possible place to lose a value.
  return Object.assign({}, ...objects) as Record<string, unknown>;
}

function field(output: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = output[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  // Last resort: sncast's notification object carries the address only inside
  // an explorer URL. Better to read it from there than to deploy a second
  // contract because the first one's address was not captured.
  const links = output.links;
  if (typeof links === "string") {
    const m = links.match(/\/contract\/(0x[0-9a-fA-F]+)/);
    if (m && keys.some((k) => k.includes("ontract"))) return m[1];
  }
  return undefined;
}

function call(rpc: string, account: string, address: string, fn: string): string[] {
  const out = sncast(["call", "--contract-address", address, "--function", fn], rpc, account);
  const response = out.response ?? out.result;
  if (Array.isArray(response)) return response.map(String);
  if (typeof response === "string") return [response];
  throw new Error(`Could not read a response from ${fn}:\n${JSON.stringify(out)}`);
}

async function main(): Promise<number> {
  const network = process.argv[2] as Network | undefined;
  if (network !== "sepolia" && network !== "mainnet") {
    console.error("usage: node scripts/deploy.ts <sepolia|mainnet>");
    return 2;
  }

  // Ground rule: mainnet needs an explicit, in-session go-ahead. A typo in the
  // network argument must not be able to spend real money.
  if (network === "mainnet" && process.env.APERTURE_CONFIRM !== "mainnet") {
    console.error(
      "Refusing to touch mainnet without APERTURE_CONFIRM=mainnet.\n" +
        "These contracts cannot be upgraded, paused or swept. Read " +
        "deployments/params.json first — every value in it is final.",
    );
    return 2;
  }

  const params = (JSON.parse(readFileSync(resolve(ROOT, "deployments/params.json"), "utf8")) as
    Record<string, Params>)[network]!;
  const env = loadEnv();
  const rpc =
    network === "mainnet"
      ? (env.STARKNET_RPC_URL_SNCAST ?? env.STARKNET_RPC_URL)
      : (env.STARKNET_RPC_URL_SEPOLIA_SNCAST ?? env.STARKNET_RPC_URL_SEPOLIA);
  if (!rpc) throw new Error(`No RPC configured for ${network}.`);

  // The canonical name, deliberately — not a _V2 alias.
  //
  // The first Sepolia deploy read DAO_MASTER_PUBLIC_KEY_V2 and burned it into an
  // immutable constructor slot, while every client in the repo derives ballot
  // addresses from DAO_MASTER_PUBLIC_KEY. Those were different values, so the
  // registry published addresses no client could reproduce. Two names for one
  // role is how that happens; there is one name now, and cutting over means
  // changing its value.
  const masterPublicKey = env.DAO_MASTER_PUBLIC_KEY;
  if (!masterPublicKey) throw new Error("DAO_MASTER_PUBLIC_KEY is not set.");

  const state = readState(network);
  const felt = (v: string) => num.toHex(BigInt(v));
  const short = (v: string) => num.toHex(BigInt(shortString.encodeShortString(v)));

  console.log(`\nAperture v2 -> ${network}`);
  console.log(`  account   ${params.account}`);
  console.log(`  owner     ${params.owner}`);
  console.log(`  operator  ${params.tallyOperator}`);
  console.log(`  epoch     ${params.epoch}`);
  console.log(`  quorum    ${BigInt(params.minQuorum) / 10n ** 18n} STRK floor`);
  console.log(`  asserted  ${BigInt(params.assertedPayoutCap) / 10n ** 18n} STRK cap`);
  console.log(
    `  timelock  ${params.payoutTimelockBlocks} blocks between announcing a ` +
      `payout and being able to use it\n`,
  );

  // 1 — build
  console.log("1. Building");
  execFileSync("scarb", ["build"], { cwd: resolve(ROOT, "contracts"), stdio: "inherit" });

  // 2 — declare both classes
  for (const [name, key] of [
    ["ProposalRegistry", "registryClassHash"],
    ["GovernanceAnonymizer", "anonymizerClassHash"],
  ] as const) {
    if (state[key]) {
      console.log(`2. ${name} already declared: ${state[key]}`);
      continue;
    }
    console.log(`2. Declaring ${name}`);
    const out = sncast(
      ["declare", "--contract-name", name, "--package", "aperture"],
      rpc,
      params.account,
    );
    // Two shapes to handle: a fresh declare returns the class hash as a field,
    // and an already-declared class returns it inside the error text. The
    // second is not a failure — the point of a declare is that the class is on
    // chain, not that this run put it there.
    const classHash =
      field(out, "class_hash", "classHash") ??
      String(out.error ?? "").match(/class hash (0x[0-9a-fA-F]+)/)?.[1];
    if (!classHash) {
      throw new Error(`Could not read a class hash from:\n${JSON.stringify(out, null, 2)}`);
    }
    state[key] = classHash;
    writeState(state);
    console.log(`   ${classHash}`);
  }

  // 3 — registry
  if (!state.registry) {
    console.log("3. Deploying ProposalRegistry");
    const out = sncast(
      [
        "deploy",
        "--class-hash", state.registryClassHash!,
        "--constructor-calldata",
        felt(params.owner),
        felt(params.tallyOperator),
        felt(params.ballotAccountClassHash),
        felt(masterPublicKey),
        short(params.chainId),
        short(params.epoch),
        felt(params.minQuorum),
        felt(params.payoutTimelockBlocks),
      ],
      rpc,
      params.account,
    );
    const address = field(out, "contract_address", "contractAddress");
    if (!address) {
      throw new Error(`Could not read the deployed address from:\n${JSON.stringify(out, null, 2)}`);
    }
    state.registry = address;
    state.daoMasterPublicKey = masterPublicKey;
    writeState(state);
    console.log(`   ${address}`);
  } else {
    console.log(`3. Registry already deployed: ${state.registry}`);
  }

  // 4 — verify the domain BEFORE the anonymizer, which is the point of no return
  console.log("4. Verifying the ballot domain against an independent derivation");
  const [onChain] = call(rpc, params.account, state.registry!, "ballot_domain");
  const local = ballotDomain(short(params.chainId), state.registry!, short(params.epoch));
  console.log(`   on chain ${onChain}`);
  console.log(`   local    ${local}`);
  if (!onChain || BigInt(onChain) !== BigInt(local)) {
    throw new Error(
      "The registry's ballot domain does not match the local derivation.\n" +
        "Every ballot address this deployment publishes would be one the client " +
        "cannot reproduce. Stopping before the anonymizer, which is the last " +
        "moment this costs nothing.",
    );
  }
  state.ballotDomain = onChain;
  writeState(state);
  console.log("   match\n");

  // 5 — anonymizer
  if (!state.anonymizer) {
    console.log("5. Deploying GovernanceAnonymizer");
    const out = sncast(
      [
        "deploy",
        "--class-hash", state.anonymizerClassHash!,
        "--constructor-calldata",
        felt(params.pool),
        felt(state.registry!),
        felt(params.assertedPayoutCap),
      ],
      rpc,
      params.account,
    );
    const address = field(out, "contract_address", "contractAddress");
    if (!address) {
      throw new Error(`Could not read the deployed address from:\n${JSON.stringify(out, null, 2)}`);
    }
    state.anonymizer = address;
    state.deployedAt = new Date().toISOString().slice(0, 10);
    writeState(state);
    console.log(`   ${address}`);
  } else {
    console.log(`5. Anonymizer already deployed: ${state.anonymizer}`);
  }

  console.log(`\nRecorded in deployments/${network}.json:`);
  console.log(`  registry    ${state.registry}`);
  console.log(`  anonymizer  ${state.anonymizer}`);
  console.log(`  domain      ${state.ballotDomain}`);
  console.log(
    `\nNext: copy these into packages/strk20-governance/src/deployments.ts, ` +
      `then \`pnpm sync\`.`,
  );
  return 0;
}

process.exit(await main());
