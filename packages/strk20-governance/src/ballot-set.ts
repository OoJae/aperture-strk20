/**
 * A commitment to the exact set of ballots a tally counted.
 *
 * `finalize` already pins the block a count was taken at, so two parties can
 * count the same state. What it could not do was tie the published aggregate to
 * a *set of ballots*: the operator posted three numbers, and re-running the
 * count either produced the same numbers or it did not, with nothing to point at
 * when it did not. This is that missing thing — one felt, stored on chain, that
 * anyone holding the viewing keys can recompute.
 *
 * Be precise about what it buys. It does **not** prove the sum is correct;
 * nothing on chain recomputes anything, and an operator who counts wrong and
 * commits to their wrong set still gets a consistent pair. It narrows "trust the
 * operator's number" to "re-run the count and compare a single felt", and it
 * makes a disagreement *locatable* — the commitment says which ballots were
 * counted, so a mismatch is a specific claim about a specific set rather than a
 * vague suspicion about a total.
 *
 * Unlike the payout commitment, no Cairo function computes this: the contract
 * cannot see notes, so it can only store what it is handed. The vector test
 * therefore pins the algorithm against itself over time rather than against
 * Cairo — which matters just as much, because changing the hash silently
 * orphans every commitment already published.
 */

import { hash, num, shortString } from "starknet";

import { CHOICES, type Choice } from "./ballot.ts";

export const BALLOT_SET_TAG = "APERTURE_BALLOTS:V3";

/** One counted ballot, as it appears in the commitment. */
export interface CountedBallot {
  /** The pool note that carried the vote. Unique, and the sort key. */
  noteId: string;
  amount: bigint;
  choice: Choice;
}

/**
 * Poseidon over the tag, the ballot count, and every ballot in a canonical
 * order.
 *
 * Three details are load-bearing:
 *
 * - **Sorted numerically by note id.** Discovery returns notes per identity and
 *   the order is the indexer's, not ours. Two honest parties must reach the same
 *   felt, so the order cannot be an input.
 * - **The count is hashed too.** Without it, a set and a longer set sharing a
 *   prefix could be made to collide more easily; with it, length is committed.
 * - **The choice is included.** Moving one ballot from FOR to AGAINST leaves the
 *   note ids and amounts identical and changes the result completely.
 */
export function computeBallotSetCommitment(ballots: readonly CountedBallot[]): string {
  const sorted = [...ballots].sort((a, b) => {
    const x = BigInt(a.noteId);
    const y = BigInt(b.noteId);
    return x < y ? -1 : x > y ? 1 : 0;
  });

  const elements: string[] = [
    num.toHex(BigInt(shortString.encodeShortString(BALLOT_SET_TAG))),
    num.toHex(BigInt(sorted.length)),
  ];
  for (const ballot of sorted) {
    elements.push(
      num.toHex(BigInt(ballot.noteId)),
      num.toHex(ballot.amount),
      num.toHex(BigInt(CHOICES.indexOf(ballot.choice))),
    );
  }
  return hash.computePoseidonHashOnElements(elements);
}

/**
 * The commitment for a proposal that counted nothing.
 *
 * An empty ballot box is a real outcome and still needs a commitment, because
 * `finalize` rejects zero — otherwise "nobody voted" and "the operator forgot
 * to commit" would be the same on-chain state.
 */
export const EMPTY_BALLOT_SET = computeBallotSetCommitment([]);
