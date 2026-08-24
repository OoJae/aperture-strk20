/**
 * Load a tally run pinned to the one block that makes it reproducible.
 *
 * Three commands need this now — counting, refunding, and verifying a published
 * commitment — and the rule they share is not obvious enough to retype:
 *
 *   - The pin is the proposal's `end_block`, not the head, and not head minus a
 *     lag. `finalize` asserts the published `counted_through` equals `end_block`,
 *     so that is the only pin whose result the contract will accept, and the
 *     only one a third party can reproduce from public inputs alone.
 *   - The settled head must already be past it. Counting earlier misses ballots
 *     still to arrive, which is how a published Sepolia tally once counted a
 *     ballot that landed 945 blocks after voting closed.
 *   - The pin is a block HASH, not a number. Against a moving tag the note set
 *     can shift between pages of a paginated read.
 *
 * Extracted from index.ts, which had the only copy.
 */

import { RpcProvider } from "starknet";

import type { TallyConfig } from "./config.ts";
import { readBallotDomain, readProposal, type ProposalWindow } from "./registry.ts";
import { runTally, type TallyRun } from "./tally.ts";

/** Blocks behind the head that the pool and the indexer both consider settled. */
export const FINALITY_LAG = 10;

export class WindowStillOpenError extends Error {
  constructor(proposalId: bigint, endBlock: number, settled: number) {
    super(
      `Proposal ${proposalId} closes at block ${endBlock}; the settled head is ` +
        `${settled}. Counting now would miss ballots still to arrive. Wait ` +
        `${endBlock - settled} block(s).`,
    );
    this.name = "WindowStillOpenError";
  }
}

export interface PinnedRun {
  proposal: ProposalWindow;
  run: TallyRun;
  /** Always the proposal's `end_block`. */
  pinned: number;
  blockHash: string;
  domain: string;
}

export async function loadPinnedRun(
  proposalId: bigint,
  config: TallyConfig,
  provider: RpcProvider,
): Promise<PinnedRun> {
  const proposal = await readProposal(provider, config.registryAddress, proposalId);
  const settled = (await provider.getBlockNumber()) - FINALITY_LAG;
  if (settled < proposal.endBlock) {
    throw new WindowStillOpenError(proposalId, proposal.endBlock, settled);
  }

  const pinned = proposal.endBlock;
  const block = await provider.getBlockWithTxHashes(pinned);
  const blockHash = (block as { block_hash?: unknown }).block_hash;
  if (typeof blockHash !== "string") {
    throw new Error(
      `Block ${pinned} has no block_hash (pending?), so the count cannot be ` +
        `pinned. Without a pin the indexer serves its own moving head and the ` +
        `result is not reproducible.`,
    );
  }

  const domain = await readBallotDomain(provider, config.registryAddress);
  const run = await runTally(proposalId, blockHash, pinned, proposal, domain, config);
  return { proposal, run, pinned, blockHash, domain };
}
