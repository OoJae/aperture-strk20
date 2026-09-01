/**
 * Create a proposal on the v2 registry.
 *
 *   node scripts/create-proposal.ts "<metadata-uri>" [options]
 *
 *     --lead   <minutes> how far ahead the window opens   (default 10)
 *     --span   <minutes> how long it stays open           (default 60)
 *     --quorum <strk>    turnout floor for this proposal  (default: the registry's)
 *     --cap    <strk>    most this proposal may pay out   (default 0)
 *
 * v1's entrypoint took three arguments and the deploy script passed
 * `0x1 0x0 0x1` — a window that had already closed, which let a proposal be
 * created and finalized in the same block and made `counted_through` a pin to a
 * block predating the proposal. v2 rejects that outright, so nothing that
 * creates a proposal can be a stray `sncast invoke` any more.
 *
 * The lead time is the part worth caring about. `start_block` is compared
 * against the block this transaction actually lands in, not the one it was
 * built against, so a window opening at head+1 is a coin flip that costs a fee
 * to lose.
 *
 * Both are minutes, converted using the chain's measured block time, because
 * blocks are the wrong unit for a human to reason in and the rate is not a
 * constant. The first attempt at this asked for a 45-BLOCK window on a Sepolia
 * running 1.67 s/block: 75 seconds, against a single private transaction that
 * needs about 30 of them to prove. The window closed unused and its three
 * ballot identities were stranded. Sizing in minutes and printing the block
 * count makes that mistake visible before it is paid for.
 */

import { Account, RpcProvider, shortString } from "starknet";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "../services/tally/src/config.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const strk = (v: bigint): string =>
  `${v / 10n ** 18n}.${(v % 10n ** 18n).toString().padStart(18, "0").slice(0, 3)}`;

function flag(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(resolve(ROOT, ".env"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    const value = m[2]!.trim().replace(/^["']|["']$/g, "");
    // A blank assignment is not a value. `.env.example` ships the _SNCAST
    // variants empty and says the plain one is used when they are unset, but
    // storing "" made `??` return the empty string instead of falling through —
    // so a verbatim .env.example failed with "No RPC configured" while a
    // perfectly good default sat two lines above. config.ts already skips
    // blanks for exactly this reason; these copies never got the fix.
    if (value === "") continue;
    out[m[1]!] = value;
  }
  return out;
}

async function callFelt(
  provider: RpcProvider,
  contractAddress: string,
  entrypoint: string,
  calldata: string[] = [],
): Promise<string[]> {
  const result = await provider.callContract({ contractAddress, entrypoint, calldata });
  return (Array.isArray(result) ? result : (result as { result: string[] }).result) as string[];
}

async function main(): Promise<number> {
  const metadataUri = process.argv[2];
  if (!metadataUri || metadataUri.startsWith("--")) {
    console.error('usage: node scripts/create-proposal.ts "<metadata-uri>" [--lead N] [--span N] [--quorum STRK] [--cap STRK]');
    return 2;
  }
  // A felt252 holds 31 bytes. Silently truncating a URI would publish a
  // proposal pointing at nothing.
  if (new TextEncoder().encode(metadataUri).length > 31) {
    console.error(`metadata URI is ${metadataUri.length} chars; a felt252 short string holds 31.`);
    return 2;
  }

  const config = loadConfig();
  const env = loadEnv();
  const provider = new RpcProvider({ nodeUrl: config.rpcUrl });

  // Read from the process environment, not from the .env file.
  //
  // A confirmation that has to be written into .env to work is a confirmation
  // that gets written once and then protects nothing — every run afterwards is
  // pre-approved by a file nobody re-reads. As a per-command variable it has to
  // be typed again each time, which is the entire point of it.
  if (config.network === "mainnet" && process.env.APERTURE_CONFIRM !== "mainnet") {
    console.error("Refusing to write to mainnet without APERTURE_CONFIRM=mainnet.");
    return 2;
  }

  const leadMinutes = Number(flag("lead", "10"));
  const spanMinutes = Number(flag("span", "60"));
  const head = await provider.getBlockNumber();

  // Measured, not assumed. Sepolia and mainnet run at very different rates and
  // neither is stable enough to hardcode.
  const SAMPLE = 500;
  const [older, newer] = await Promise.all([
    provider.getBlock(Math.max(head - SAMPLE, 1)),
    provider.getBlock(head),
  ]);
  const sampled = head - Math.max(head - SAMPLE, 1);
  const blockSeconds =
    sampled > 0 ? (newer.timestamp - older.timestamp) / sampled : 30;
  const toBlocks = (minutes: number): number =>
    Math.max(1, Math.round((minutes * 60) / blockSeconds));

  const lead = toBlocks(leadMinutes);
  const span = toBlocks(spanMinutes);
  const startBlock = head + lead;
  const endBlock = startBlock + span;

  // A private transaction needs roughly half a minute to prove, and a freshly
  // shielded note is not spendable for ten blocks. A window that cannot fit one
  // vote is not a window.
  const MATURITY_BLOCKS = 10;
  const minimumUsable = MATURITY_BLOCKS + Math.ceil(90 / blockSeconds);
  if (span < minimumUsable) {
    console.error(
      `A ${spanMinutes}-minute window is ${span} blocks at ${blockSeconds.toFixed(2)}s each. ` +
        `A single vote needs at least ${minimumUsable} (ten for the note to mature, ` +
        `the rest to prove and land). Widen --span.`,
    );
    return 2;
  }

  const [floorFelt] = await callFelt(provider, config.registryAddress, "min_quorum");
  const floor = BigInt(floorFelt!);
  const quorumArg = flag("quorum");
  const quorum = quorumArg === undefined
    ? floor
    : BigInt(Math.round(Number(quorumArg) * 1e18));
  if (quorum < floor) {
    console.error(`quorum ${strk(quorum)} is below the registry's floor of ${strk(floor)} STRK.`);
    return 2;
  }

  const capArg = flag("cap", "0")!;
  const cap = BigInt(Math.round(Number(capArg) * 1e18));

  console.log(`\nProposal on ${config.network}`);
  console.log(`  registry  ${config.registryAddress}`);
  console.log(`  metadata  ${metadataUri}`);
  console.log(
    `  window    ${startBlock} .. ${endBlock}  ` +
      `(${span} blocks at ${blockSeconds.toFixed(2)}s = ~${spanMinutes} min)`,
  );
  console.log(`  opens     in ${lead} blocks, ~${leadMinutes} min from block ${head}`);
  console.log(`  quorum    ${strk(quorum)} STRK${quorumArg === undefined ? " (the registry's floor)" : ""}`);
  console.log(`  token     ${config.strkTokenAddress}`);
  console.log(`  cap       ${strk(cap)} STRK\n`);

  const account = new Account({
    provider,
    address: config.operatorAddress,
    signer: config.operatorPrivateKey,
    cairoVersion: "1",
  });

  const tx = await account.execute({
    contractAddress: config.registryAddress,
    entrypoint: "create_proposal",
    // Six felts, not eight. `quorum` and `payout_cap` are u128, which is one
    // felt each — the low/high pair is u256.
    calldata: [
      shortString.encodeShortString(metadataUri),
      String(startBlock),
      String(endBlock),
      quorum.toString(),
      config.strkTokenAddress,
      cap.toString(),
    ],
  });
  const receipt = await provider.waitForTransaction(tx.transaction_hash);
  if ((receipt as { execution_status?: string }).execution_status === "REVERTED") {
    const reason = (receipt as { revert_reason?: string }).revert_reason ?? "(no reason given)";
    // WINDOW_IN_THE_PAST here means the lead time was too short for how long
    // the transaction took to land, not that the arguments were wrong.
    console.error(`REVERTED: ${reason}`);
    return 1;
  }
  console.log(`  ${tx.transaction_hash}`);

  const [countFelt] = await callFelt(provider, config.registryAddress, "proposal_count");
  const proposalId = BigInt(countFelt!);
  console.log(`  proposal ${proposalId}\n`);

  // Read it back rather than trusting what we sent: the window is the one thing
  // that cannot be corrected afterwards, and everything downstream pins to it.
  const proposal = await callFelt(provider, config.registryAddress, "get_proposal", [
    proposalId.toString(),
  ]);
  // Proposal is (proposer, metadata_uri, start_block, end_block, finalized,
  // quorum, payout_token, payout_cap) — v2 appended the last three so these
  // indices did not move.
  console.log(`  on chain: window ${Number(proposal[2])} .. ${Number(proposal[3])}`);
  console.log(`\nNext: node scripts/deploy-ballot-accounts.ts ${proposalId}`);
  return 0;
}

process.exit(await main());
