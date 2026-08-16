/**
 * Tally worker CLI.
 *
 *   node src/index.ts <proposal-id>            # read and report, write nothing
 *   node src/index.ts <proposal-id> --finalize # also publish the aggregate
 *
 * Reads the notes each ballot identity received, sums them, and — only when
 * asked — posts the aggregate on-chain. Individual ballots never leave this
 * process, and the default is dry-run because publishing a tally is a one-shot
 * action the registry will not let you take back.
 */

import { RpcProvider } from "starknet";
import { willPass } from "@aperture/strk20-governance";
import { loadConfig } from "./config.ts";
import { checkIndexerHealth } from "./discovery.ts";
import { finalizeProposal } from "./finalize.ts";
import { runTally } from "./tally.ts";

export { loadConfig } from "./config.ts";
export { runTally } from "./tally.ts";
export { buildRefundQueue, executeRefunds } from "./refunds.ts";

/** Blocks behind the head to pin to, so the count sits on settled state. */
const FINALITY_LAG = 10;

function formatStrk(amount: bigint): string {
  const whole = amount / 10n ** 18n;
  const frac = (amount % 10n ** 18n).toString().padStart(18, "0").slice(0, 4);
  return `${whole}.${frac}`;
}

async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  const idArg = args.find((a) => !a.startsWith("--"));
  const shouldFinalize = args.includes("--finalize");

  if (!idArg) {
    console.error("Usage: node src/index.ts <proposal-id> [--finalize]");
    return 1;
  }
  const proposalId = BigInt(idArg);
  const config = loadConfig();

  const health = await checkIndexerHealth(config.indexerUrl);
  if (!health.healthy) {
    console.error(`Indexer at ${config.indexerUrl} is not healthy; aborting.`);
    return 1;
  }
  console.log(
    `Indexer healthy — head ${health.head}, ${health.lagSeconds}s behind.`,
  );

  // Pin every read to one settled block so the count is reproducible by anyone
  // re-running it against the same hash.
  const provider = new RpcProvider({ nodeUrl: config.rpcUrl });
  const head = await provider.getBlockNumber();
  const block = await provider.getBlockWithTxHashes(head - FINALITY_LAG);
  const blockHash = (block as { block_hash: string }).block_hash;
  console.log(`Counting proposal ${proposalId} at block ${head - FINALITY_LAG}.\n`);

  const run = await runTally(proposalId, blockHash, config);

  for (const { identity, noteCount } of run.perIdentity) {
    console.log(
      `  ${identity.choice.padEnd(8)} ${identity.address}  ${noteCount} ballot(s)`,
    );
  }

  const { tally } = run;
  console.log(`\n  FOR      ${formatStrk(tally.forWeight)} STRK`);
  console.log(`  AGAINST  ${formatStrk(tally.againstWeight)} STRK`);
  console.log(`  ABSTAIN  ${formatStrk(tally.abstainWeight)} STRK`);
  console.log(`  result   ${willPass(tally) ? "PASSES" : "does not pass"}`);
  console.log(
    `\n  ${run.refunds.entries.length} ballot(s) owed ` +
      `${formatStrk(run.refunds.totalAmount)} STRK in refunds ` +
      `(execution blocked — see docs/TRUST_MODEL.md)`,
  );

  if (!shouldFinalize) {
    console.log("\nDry run. Pass --finalize to publish this aggregate on-chain.");
    return 0;
  }

  console.log("\nPublishing the aggregate…");
  const receipt = await finalizeProposal(tally, config);
  console.log(`Finalized in ${receipt.transactionHash}`);
  return 0;
}

// Only run when invoked directly, so the module stays importable for tests.
if (process.argv[1]?.endsWith("index.ts")) {
  process.exit(await main(process.argv));
}
