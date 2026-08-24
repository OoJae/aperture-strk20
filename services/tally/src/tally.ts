/**
 * Counting a sealed vote.
 *
 * Derive each choice's identity, read the notes it received, sum them, and hand
 * back the aggregate. There is no batch discovery API — one viewing key sees
 * one identity's inbox — so this fans out one read per choice.
 *
 * Individual ballots exist only inside this process. What leaves it is the
 * aggregate and nothing else.
 */

import {
  aggregateNotes,
  deriveBallotIdentities,
  deriveBallotViewingKey,
  computeBallotSetCommitment,
} from "@oojae/strk20-governance";
import type {
  BallotIdentity,
  BallotNote,
  TallyResult,
} from "@oojae/strk20-governance";
import type { TallyConfig } from "./config.ts";
import { dedupeAcrossIdentities } from "./dedupe.ts";
import { discoverReceivedNotes } from "./discovery.ts";
import type { DiscoveredNote, DiscoveryOptions } from "./discovery.ts";
import { buildRefundQueue } from "./refunds.ts";
import type { RefundQueue } from "./refunds.ts";
import type { ProposalWindow } from "./registry.ts";

export interface TallyRun {
  tally: TallyResult;
  refunds: RefundQueue;
  /** Block every read was pinned to, so the count can be reproduced. */
  blockHash: string;
  blockNumber: number;
  /** The window the count was scoped to, so a re-run can use the same one. */
  window: { startBlock: number; endBlock: number };
  perIdentity: Array<{ identity: BallotIdentity; noteCount: number }>;
  /**
   * Binds this aggregate to the exact ballots behind it.
   *
   * Computed from the same deduped set the tally sums, so the two cannot
   * describe different ballots — which is the whole point of publishing it.
   */
  ballotCommitment: string;
}

export async function runTally(
  proposalId: bigint,
  blockHash: string,
  blockNumber: number,
  proposal: ProposalWindow,
  /** Read from the registry, not recomputed: it must match the contract. */
  domain: string,
  config: TallyConfig,
): Promise<TallyRun> {
  const identities = deriveBallotIdentities(proposalId, {
    ballotAccountClassHash: config.ballotAccountClassHash,
    daoMasterPublicKey: config.daoMasterPublicKey,
    domain,
  });

  const options: DiscoveryOptions = {
    indexerUrl: config.indexerUrl,
    poolAddress: config.poolAddress,
    blockHash,
    token: config.strkTokenAddress,
    startBlock: proposal.startBlock,
    endBlock: proposal.endBlock,
  };

  // Concurrent because the reads are independent and pinned to one block, so
  // ordering cannot change the result.
  const discovered = await Promise.all(
    identities.map(async (identity) => {
      const viewingKey = deriveBallotViewingKey({
        masterSecret: config.ballotViewingSeed,
        domain,
        proposalId,
        choice: identity.choice,
      });
      const notes = await discoverReceivedNotes(identity, viewingKey, options);
      return { identity, notes };
    }),
  );

  // One dedupe pass feeding both the tally and the refund queue. They used to
  // dedupe separately with differently-scoped Sets — one per choice, one across
  // all three — so a note id seen under two identities was counted twice and
  // refunded once.
  const deduped = dedupeAcrossIdentities(discovered);

  const notesByChoice: Partial<Record<string, readonly BallotNote[]>> = {};
  for (const { identity, notes } of deduped) {
    notesByChoice[identity.choice] = notes;
  }

  // From the deduped set, so the commitment and the sum describe the same
  // ballots by construction rather than by two callers agreeing to be careful.
  const counted = deduped.flatMap(({ identity, notes }) =>
    notes.map((note) => ({
      noteId: note.id,
      amount: note.amount,
      choice: identity.choice,
    })),
  );

  return {
    tally: aggregateNotes(proposalId, notesByChoice as never),
    refunds: buildRefundQueue(proposalId, deduped),
    ballotCommitment: computeBallotSetCommitment(counted),
    blockHash,
    blockNumber,
    window: { startBlock: proposal.startBlock, endBlock: proposal.endBlock },
    perIdentity: deduped.map(({ identity, notes }) => ({
      identity,
      noteCount: notes.length,
    })),
  };
}
