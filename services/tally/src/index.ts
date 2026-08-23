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
import { ReorgedError, checkIndexerHealth } from "./discovery.ts";
import { finalizeProposal } from "./finalize.ts";
import { readBallotDomain, readProposal } from "./registry.ts";
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

  console.log(`Network: ${config.network}`);
  const health = await checkIndexerHealth(config.indexerUrl);
  if (!health.healthy) {
    console.error(`Indexer at ${config.indexerUrl} is not healthy; aborting.`);
    return 1;
  }
  console.log(
    `Indexer healthy — head ${health.head}, ${health.lagSeconds}s behind.`,
  );

  const provider = new RpcProvider({ nodeUrl: config.rpcUrl });

  // The window is on-chain, two fields from the id we already have. Not reading
  // it meant the operator's choice of when to run this decided which notes were
  // in scope — including ones cast long after the vote closed.
  const proposal = await readProposal(provider, config.registryAddress, proposalId);
  const head = await provider.getBlockNumber();
  const settled = head - FINALITY_LAG;

  if (settled < proposal.endBlock) {
    console.error(
      `Proposal ${proposalId} closes at block ${proposal.endBlock}; the settled ` +
        `head is ${settled}. Counting now would miss ballots still to arrive. ` +
        `Wait ${proposal.endBlock - settled} block(s).`,
    );
    return 1;
  }

  // Pin to the window's close, not to whenever this happened to run. That is
  // what lets a third party re-run the same count from public inputs alone.
  const pinned = proposal.endBlock;
  const block = await provider.getBlockWithTxHashes(pinned);
  const blockHash = (block as { block_hash?: unknown }).block_hash;
  if (typeof blockHash !== "string") {
    throw new Error(
      `Block ${pinned} has no block_hash (pending?), so the count cannot be pinned. ` +
        `Without a pin the indexer serves its own moving head and the result is ` +
        `not reproducible.`,
    );
  }
  console.log(
    `Counting proposal ${proposalId} at block ${pinned} ` +
      `(window ${proposal.startBlock}-${proposal.endBlock}).\n`,
  );

  const domain = await readBallotDomain(provider, config.registryAddress);
  const run = await runTally(proposalId, blockHash, pinned, proposal, domain, config);

  for (const { identity, noteCount } of run.perIdentity) {
    console.log(
      `  ${identity.choice.padEnd(8)} ${identity.address}  ${noteCount} ballot(s)`,
    );
  }

  const { tally } = run;
  console.log(`\n  FOR      ${formatStrk(tally.forWeight)} STRK`);
  console.log(`  AGAINST  ${formatStrk(tally.againstWeight)} STRK`);
  console.log(`  ABSTAIN  ${formatStrk(tally.abstainWeight)} STRK`);
    // The proposal's own quorum, not a guess: this line is a prediction of what
  // the registry will decide, and a prediction the contract rejects is worse
  // than none.
  console.log(
    `  quorum   ${formatStrk(proposal.quorum)} STRK ` +
      `(turnout ${formatStrk(tally.forWeight + tally.againstWeight + tally.abstainWeight)})`,
  );
  console.log(
    `  result   ${willPass(tally, proposal.quorum) ? "PASSES" : "does not pass"}`,
  );
  console.log(
    `\n  ${run.refunds.entries.length} ballot(s) owed ` +
      `${formatStrk(run.refunds.totalAmount)} STRK in refunds ` +
      `(execution blocked — see docs/TRUST_MODEL.md)`,
  );

  // The pinned block used to reach no durable record at all — the trust model
  // rests on "anyone can re-run the same count and compare", and nothing
  // published which block to re-run it against.
  const countReceipt = {
    proposalId: proposalId.toString(),
    network: config.network,
    registryAddress: config.registryAddress,
    poolAddress: config.poolAddress,
    token: config.strkTokenAddress,
    pinnedBlockNumber: run.blockNumber,
    pinnedBlockHash: run.blockHash,
    window: run.window,
    tally: {
      for: tally.forWeight.toString(),
      against: tally.againstWeight.toString(),
      abstain: tally.abstainWeight.toString(),
    },
    ballots: Object.fromEntries(
      run.perIdentity.map(({ identity, noteCount }) => [identity.choice, noteCount]),
    ),
  };
  console.log(`\nreceipt ${JSON.stringify(countReceipt)}`);

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
  try {
    process.exit(await main(process.argv));
  } catch (error: unknown) {
    // ReorgedError was raised by discovery and caught nowhere, so a reorg
    // surfaced as an unhandled rejection rather than as the retryable
    // condition it is.
    if (error instanceof ReorgedError) {
      console.error(`${error.message}\nNothing was published. Re-run against a newer settled block.`);
      process.exit(75); // EX_TEMPFAIL — a retry is meaningful here
    }
    throw error;
  }
}
