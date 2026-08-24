/**
 * What each voter is owed back. A pure computation over an already-pinned count.
 *
 * Paying it lives in `refund-lifecycle.ts`, because a refund is a private
 * transfer and needs the network, a proving service and a signing key. Keeping
 * the arithmetic here and pure is what lets the queue be checked without
 * spending anything.
 *
 * This module used to end in `executeRefunds`, which threw unconditionally, and
 * the comment blamed a missing prover. That was half the story and the less
 * important half: the queue was undeliverable by construction because
 * discovery parsed each note's sender and threw it away, so nothing recorded
 * who to pay. Both are fixed, and refunds now run.
 */

import type { Choice } from "@oojae/strk20-governance";
import type { DiscoveredForIdentity } from "./dedupe.ts";

/** One ballot owed back to its sender. */
export interface RefundEntry {
  choice: Choice;
  /** The note that carried the vote. */
  noteId: string;
  amount: bigint;
  /** Ballot identity the stake currently sits with. */
  from: string;
  /**
   * Who to pay.
   *
   * This field did not exist until 2026-08-23, which meant the queue was
   * undeliverable by construction rather than merely blocked on a prover:
   * discovery parsed each note's `sender_addr` and threw it away, so the only
   * record of who staked a note was discarded at the single pinned read, and a
   * spent private note's sender is not recoverable from the chain afterwards.
   * Both README and TRUST_MODEL attributed the blockage solely to the missing
   * prover.
   *
   * Note what it is: the pool channel identity that sent the note, not a public
   * address. A refund can therefore only be a private transfer back into the
   * pool, which is exactly what `refund-lifecycle.ts` sends.
   */
  payee: string;
}

export interface RefundQueue {
  proposalId: bigint;
  entries: RefundEntry[];
  totalAmount: bigint;
}

/**
 * Work out what every voter is owed.
 *
 * Takes already-deduplicated input. It used to dedupe here with a Set scoped
 * across all three identities while the aggregator used one per choice, so the
 * queue and the tally could disagree about the same set of ballots. One pass
 * upstream now feeds both.
 */
export function buildRefundQueue(
  proposalId: bigint,
  notesByIdentity: readonly DiscoveredForIdentity[],
): RefundQueue {
  const entries: RefundEntry[] = [];
  let totalAmount = 0n;

  for (const { identity, notes } of notesByIdentity) {
    for (const note of notes) {
      entries.push({
        choice: identity.choice,
        noteId: note.id,
        amount: note.amount,
        from: identity.address,
        payee: note.payee,
      });
      totalAmount += note.amount;
    }
  }

  return { proposalId, entries, totalAmount };
}
