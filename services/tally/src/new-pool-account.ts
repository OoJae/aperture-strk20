/**
 * Create the account that touches the pool, and store its keys before anything
 * else happens.
 *
 *   node src/new-pool-account.ts            derive and record (no spend)
 *   node src/new-pool-account.ts --deploy   fund, deploy, register
 *
 * Why this exists: the pool binds an address to a viewing key **write-once**.
 * Our mainnet operator is registered under a key that is in none of our env
 * files, so that account can never spend or read a shielded note again — and
 * nothing can undo it, because the slot cannot be rewritten. This creates a
 * replacement whose keys are written to disk in the first step, before a single
 * transaction is sent.
 *
 * That ordering is the whole point. This project has now lost value three times
 * the same way: 14 STRK on mainnet and 20.5 on Sepolia to payout preimages that
 * were displayed and never saved, and a mainnet pool identity to a viewing key
 * nobody wrote down. Generate, persist, then act.
 */

import { Account, RpcProvider, ec, hash, num } from "starknet";
import { Buffer } from "node:buffer";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { MAX_VIEWING_KEY, assertValidViewingKey } from "@oojae/strk20-governance";
import { createPrivateTransfers } from "@starkware-libs/starknet-privacy-sdk";
import { loadConfig } from "./config.ts";
import { ensurePoolAllowance } from "./pool-allowance.ts";
import { describeError } from "./report-error.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const ENV = resolve(ROOT, ".env");

/** Enough for the pool registration fee plus its gas ceiling, with headroom. */
const FUNDING = { mainnet: 15n * 10n ** 18n, sepolia: 15n * 10n ** 18n } as const;

/** `randomPrivateKey()` returns bytes, and passing those to a felt helper throws. */
const randomFelt = (): string => `0x${Buffer.from(ec.starkCurve.utils.randomPrivateKey()).toString("hex")}`;

const strk = (v: bigint): string =>
  `${v / 10n ** 18n}.${(v % 10n ** 18n).toString().padStart(18, "0").slice(0, 3)}`;

/**
 * Set a variable in .env, replacing an existing assignment rather than adding a
 * second one. Same shape as scripts/new-dao-keys.ts and new-signer.ts.
 */
function upsert(name: string, value: string): void {
  const env = existsSync(ENV) ? readFileSync(ENV, "utf8") : "";
  const pattern = new RegExp(`^${name}=.*$`);

  // Collapse to exactly one assignment, keeping the first position.
  //
  // A plain first-match replace would disagree with envValue(), which takes the
  // last non-blank — so on a .env already carrying duplicates from the old
  // append behaviour, the writer and the reader would point at different lines.
  // For a viewing key that is not a cosmetic bug: the pool binds an address to
  // one permanently, and acting on the wrong one strands the account.
  let seen = false;
  const kept: string[] = [];
  for (const line of env.split("\n")) {
    if (!pattern.test(line)) {
      kept.push(line);
      continue;
    }
    if (!seen) {
      kept.push(`${name}=${value}`);
      seen = true;
    }
    // Later duplicates are dropped.
  }
  let next = kept.join("\n");
  if (!seen) next += `${next.endsWith("\n") || next === "" ? "" : "\n"}${name}=${value}\n`;
  writeFileSync(ENV, next, { mode: 0o600 });
}

function envValue(name: string): string | undefined {
  // Last non-blank wins, and blanks are not values.
  //
  // This used to append its keys and return the FIRST match. .env starts life as
  // a copy of .env.example, which declares every name blank, so the placeholder
  // shadowed the real value written below it: a second run could not see the
  // actor the first run generated, made another one, and then failed with
  // "POOL_ACTOR_SALT is missing" — on the exact two-command sequence the README
  // prescribes. Writing in place fixes the cause; reading last-non-blank also
  // repairs any .env already polluted by the old behaviour.
  let found: string | undefined;
  for (const line of readFileSync(ENV, "utf8").split("\n")) {
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (m && m[1] === name) {
      const v = m[2]!.trim().replace(/^["']|["']$/g, "");
      if (v !== "") found = v;
    }
  }
  return found;
}

/** A viewing key must land in [1, MAX_VIEWING_KEY], which is half the curve order. */
function randomViewingKey(): bigint {
  for (;;) {
    const candidate = BigInt(randomFelt());
    if (candidate > 0n && candidate <= MAX_VIEWING_KEY) return candidate;
  }
}

async function main(): Promise<number> {
  const config = loadConfig();
  const suffix = config.network === "sepolia" ? "_SEPOLIA" : "";
  const names = {
    address: `POOL_ACTOR_ADDRESS${suffix}`,
    key: `POOL_ACTOR_PRIVATE_KEY${suffix}`,
    viewing: `POOL_ACTOR_VIEWING_KEY${suffix}`,
  };

  if (config.network === "mainnet" && process.env.APERTURE_CONFIRM !== "mainnet") {
    console.error("Refusing to write mainnet key material without APERTURE_CONFIRM=mainnet.");
    return 2;
  }

  const provider = new RpcProvider({ nodeUrl: config.rpcUrl });
  let address = envValue(names.address);
  let privateKey = envValue(names.key);
  let viewingKey = envValue(names.viewing);

  if (!address || !privateKey || !viewingKey) {
    if (address || privateKey || viewingKey) {
      console.error(
        `${names.address}/${names.key}/${names.viewing} are partly set. Refusing to ` +
          `overwrite: half a keypair is how an account becomes unreachable.`,
      );
      return 1;
    }

    privateKey = randomFelt();
    const publicKey = ec.starkCurve.getStarkKey(privateKey);
    const salt = randomFelt();
    const vk = randomViewingKey();
    assertValidViewingKey(vk);
    viewingKey = num.toHex(vk);

    address = hash.calculateContractAddressFromHash(
      salt,
      config.ballotAccountClassHash,
      [publicKey],
      0,
    );

    // Persisted BEFORE anything is sent. Nothing below this line can lose them.
    //
    // Written in place rather than appended. .env begins as a copy of
    // .env.example, which declares each of these blank, and appending left the
    // blank above the real value — so the next run read the placeholder, decided
    // no actor existed, and generated a second one. Every other key-writing
    // script in this repo upserts for exactly this reason.
    upsert(names.address, address);
    upsert(names.key, privateKey);
    upsert(names.viewing, viewingKey);
    upsert(`POOL_ACTOR_SALT${suffix}`, salt);
    console.log(`Generated a ${config.network} pool actor and wrote its keys to .env.`);
    console.log(`  address ${address}`);
    console.log(`  salt, signing key and viewing key are in .env (gitignored)\n`);
  } else {
    console.log(`Using the ${config.network} pool actor already in .env.`);
    console.log(`  address ${address}\n`);
  }

  if (!process.argv.includes("--deploy")) {
    console.log("Nothing spent. Re-run with --deploy to fund, deploy and register.");
    return 0;
  }

  const salt = envValue(`POOL_ACTOR_SALT${suffix}`);
  if (!salt) {
    console.error(`POOL_ACTOR_SALT${suffix} is missing; the address cannot be re-derived.`);
    return 1;
  }

  const funding = FUNDING[config.network];
  const balanceOf = async (a: string): Promise<bigint> => {
    const r = await provider.callContract({
      contractAddress: config.strkTokenAddress,
      entrypoint: "balanceOf",
      calldata: [a],
    });
    const x = (Array.isArray(r) ? r : (r as { result: string[] }).result) as string[];
    return BigInt(x[0]!) + (BigInt(x[1] ?? "0x0") << 128n);
  };

  // 1 — fund from the operator.
  const held = await balanceOf(address);
  if (held < funding) {
    const top = funding - held;
    console.log(`1. Funding with ${strk(top)} STRK`);
    const funder = new Account({
      provider,
      address: config.operatorAddress,
      signer: config.operatorPrivateKey,
      cairoVersion: "1",
    });
    const tx = await funder.execute({
      contractAddress: config.strkTokenAddress,
      entrypoint: "transfer",
      calldata: [address, top.toString(), "0"],
    });
    await provider.waitForTransaction(tx.transaction_hash);
    console.log(`   ${tx.transaction_hash}\n`);
  } else {
    console.log(`1. Already funded (${strk(held)} STRK)\n`);
  }

  const account = new Account({ provider, address, signer: privateKey, cairoVersion: "1" });

  // 2 — self-deploy.
  let deployed = true;
  try {
    await provider.getClassHashAt(address, "latest");
  } catch {
    deployed = false;
  }
  if (!deployed) {
    console.log("2. Deploying the account");
    const { transaction_hash, contract_address } = await account.deployAccount({
      classHash: config.ballotAccountClassHash,
      constructorCalldata: [ec.starkCurve.getStarkKey(privateKey)],
      addressSalt: salt,
      contractAddress: address,
    });
    await provider.waitForTransaction(transaction_hash);
    if (BigInt(contract_address) !== BigInt(address)) {
      throw new Error(`Deployed to ${contract_address}, expected ${address}.`);
    }
    console.log(`   ${transaction_hash}\n`);
  } else {
    console.log("2. Already deployed\n");
  }

  // 3 — register the viewing key with the pool. Write-once, and the fee is real.
  const [registered] = (await provider.callContract({
    contractAddress: config.poolAddress,
    entrypoint: "get_public_key",
    calldata: [address],
  })) as unknown as string[];
  if (BigInt(registered ?? "0x0") !== 0n) {
    console.log(`3. Already registered with the pool (${registered!.slice(0, 16)}…)`);
    return 0;
  }

  console.log("3. Registering with the pool — WRITE-ONCE, and it costs the flat fee");
  try {
    await ensurePoolAllowance({
      provider,
      account,
      pool: config.poolAddress,
      token: config.strkTokenAddress,
    });
    const chainId = await provider.getChainId();
    const transfers = createPrivateTransfers({
      account,
      viewingKeyProvider: { getViewingKey: async () => BigInt(viewingKey!) },
      provingProvider: { url: config.provingServiceUrl, chainId },
      discoveryProvider: { url: config.indexerUrl },
      poolContractAddress: config.poolAddress,
    } as never);

    const { callAndProof } = await (transfers as never as {
      build: (o: unknown) => {
        register: () => { execute: (o: unknown) => Promise<{ callAndProof: unknown }> };
      };
    })
      .build({ autoSetup: true })
      .register()
      .execute({ provingBlockId: (await provider.getBlockNumber()) - 10 });

    const p = callAndProof as {
      call: Parameters<Account["execute"]>[0];
      proof: { proofFacts?: unknown[]; data?: unknown };
    };
    const details = p.proof?.proofFacts?.length
      ? { proofFacts: p.proof.proofFacts, proof: p.proof.data }
      : {};
    const tx = await account.execute(p.call, { tip: 0n, ...details } as never);
    const receipt = await provider.waitForTransaction(tx.transaction_hash);
    if ((receipt as { execution_status?: string }).execution_status === "REVERTED") {
      throw new Error(
        `REVERTED: ${(receipt as { revert_reason?: string }).revert_reason ?? "(no reason)"}`,
      );
    }
    console.log(`   ${tx.transaction_hash}`);
  } catch (error) {
    console.error(`   FAILED\n   ${describeError(error)}`);
    return 1;
  }

  console.log(`\nPool actor live on ${config.network}.`);
  return 0;
}

process.exit(await main());
