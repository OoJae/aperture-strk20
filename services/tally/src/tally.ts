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
} from "@aperture/strk20-governance";
import type {
  BallotIdentity,
  BallotNote,
  TallyResult,
} from "@aperture/strk20-governance";
import type { TallyConfig } from "./config.ts";
import { discoverReceivedNotes } from "./discovery.ts";
import type { DiscoveryOptions } from "./discovery.ts";
import { buildRefundQueue } from "./refunds.ts";
import type { RefundQueue } from "./refunds.ts";

export interface TallyRun {
  tally: TallyResult;
  refunds: RefundQueue;
  /** Block every read was pinned to, so the count can be reproduced. */
  blockHash: string;
  perIdentity: Array<{ identity: BallotIdentity; noteCount: number }>;
}

export async function runTally(
  proposalId: bigint,
  blockHash: string,
  config: TallyConfig,
): Promise<TallyRun> {
  const identities = deriveBallotIdentities(proposalId, {
    ballotAccountClassHash: config.ballotAccountClassHash,
    daoMasterPublicKey: config.daoMasterPublicKey,
  });

  const options: DiscoveryOptions = {
    indexerUrl: config.indexerUrl,
    poolAddress: config.poolAddress,
    blockHash,
  };

  // Concurrent because the reads are independent and pinned to one block, so
  // ordering cannot change the result.
  const discovered = await Promise.all(
    identities.map(async (identity) => {
      const viewingKey = deriveBallotViewingKey(
        config.daoMasterSecret,
        proposalId,
        identity.choice,
      );
      const notes = await discoverReceivedNotes(identity, viewingKey, options);
      return { identity, notes };
    }),
  );

  const notesByChoice: Partial<Record<string, readonly BallotNote[]>> = {};
  for (const { identity, notes } of discovered) {
    notesByChoice[identity.choice] = notes;
  }

  return {
    tally: aggregateNotes(proposalId, notesByChoice as never),
    refunds: buildRefundQueue(proposalId, discovered),
    blockHash,
    perIdentity: discovered.map(({ identity, notes }) => ({
      identity,
      noteCount: notes.length,
    })),
  };
}
