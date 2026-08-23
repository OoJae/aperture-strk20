/**
 * Refunds — computed, not executed.
 *
 * After a vote closes, the stake behind each ballot should go back to whoever
 * cast it. Working out *what* is owed is a read; paying it is a private
 * transfer, which needs a proof, which needs a proving service. None is
 * published for either network, so v1 computes the queue and stops there.
 *
 * `executeRefunds` therefore refuses rather than half-working. That refusal is
 * the honest interface: an operator who cannot pay should find out here, not
 * discover it after telling voters their stake was returned. The limitation is
 * stated in docs/TRUST_MODEL.md too, because it is a real trust assumption and
 * not a footnote.
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
   * pool. The queue is now addressed; it is still not payable.
   */
  payee: string;
}

export interface RefundQueue {
  proposalId: bigint;
  entries: RefundEntry[];
  totalAmount: bigint;
}

export class RefundsUnavailableError extends Error {
  constructor() {
    super(
      "Refunds cannot be executed. Issuing one is a private transfer, which " +
        "needs a proving service; a proving endpoint answers /health on both " +
        "networks but has not been shown to produce a proof for us. The queue " +
        "records who each stake came from, so it is addressed — that is newer " +
        "than the blockage and was missing for longer. See docs/TRUST_MODEL.md.",
    );
    this.name = "RefundsUnavailableError";
  }
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

/**
 * Not implemented, and deliberately so — see the module comment.
 *
 * @throws {RefundsUnavailableError} always.
 */
export function executeRefunds(_queue: RefundQueue): never {
  throw new RefundsUnavailableError();
}
