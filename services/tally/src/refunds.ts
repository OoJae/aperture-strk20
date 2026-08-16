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

import type { BallotIdentity, BallotNote, Choice } from "@aperture/strk20-governance";

/** One ballot owed back to its sender. */
export interface RefundEntry {
  choice: Choice;
  /** The note that carried the vote. */
  noteId: string;
  amount: bigint;
  /** Ballot identity the stake currently sits with. */
  from: string;
}

export interface RefundQueue {
  proposalId: bigint;
  entries: RefundEntry[];
  totalAmount: bigint;
}

export class RefundsUnavailableError extends Error {
  constructor() {
    super(
      "Refunds cannot be executed: issuing them requires a private transfer, " +
        "which requires a proving service, and no proving endpoint is " +
        "published for either network. The queue below is what would be paid. " +
        "See docs/TRUST_MODEL.md.",
    );
    this.name = "RefundsUnavailableError";
  }
}

/**
 * Work out what every voter is owed.
 *
 * Deduplicates by note id for the same reason the tally does: a note seen twice
 * across paginated reads is one ballot, and refunding it twice would drain the
 * treasury rather than merely miscount.
 */
export function buildRefundQueue(
  proposalId: bigint,
  notesByIdentity: ReadonlyArray<{
    identity: BallotIdentity;
    notes: readonly BallotNote[];
  }>,
): RefundQueue {
  const entries: RefundEntry[] = [];
  const seen = new Set<string>();
  let totalAmount = 0n;

  for (const { identity, notes } of notesByIdentity) {
    for (const note of notes) {
      if (seen.has(note.id)) continue;
      seen.add(note.id);
      entries.push({
        choice: identity.choice,
        noteId: note.id,
        amount: note.amount,
        from: identity.address,
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
