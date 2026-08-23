/**
 * Vote aggregation.
 *
 * Deliberately a pure function over note records with no network and no SDK:
 * counting votes is the one part of the system that must be reviewable and
 * reproducible by anyone, and it is the only part a bug would silently
 * misreport. Fetching the notes is `services/tally`'s job.
 */

import type { Choice } from "./ballot.ts";
import { CHOICES } from "./ballot.ts";

/**
 * One received note, reduced to what a tally needs.
 *
 * `id` matters because the same note can legitimately appear twice across
 * paginated reads; aggregation dedupes on it rather than trusting the caller.
 */
export interface BallotNote {
  id: string;
  amount: bigint;
}

/** The aggregate posted on-chain. Nothing else about a vote becomes public. */
export interface TallyResult {
  proposalId: bigint;
  forWeight: bigint;
  againstWeight: bigint;
  abstainWeight: bigint;
  /** Ballots counted per choice, for the operator's own reporting. */
  ballotCounts: Record<Choice, number>;
}

/** Notes discovered for each choice's identity. */
export type NotesByChoice = Partial<Record<Choice, readonly BallotNote[]>>;

function sumUnique(notes: readonly BallotNote[]): { weight: bigint; count: number } {
  const seen = new Set<string>();
  let weight = 0n;
  for (const note of notes) {
    if (seen.has(note.id)) continue;
    if (note.amount < 0n) {
      throw new Error(`Note ${note.id} has a negative amount`);
    }
    seen.add(note.id);
    weight += note.amount;
  }
  return { weight, count: seen.size };
}

/**
 * Sum each choice's notes into the aggregate that gets published.
 *
 * Duplicates are collapsed by note id. A choice with no notes contributes zero
 * rather than being absent, so a proposal nobody voted on still finalizes.
 */
export function aggregateNotes(
  proposalId: bigint,
  notesByChoice: NotesByChoice,
): TallyResult {
  const totals = {} as Record<Choice, { weight: bigint; count: number }>;
  for (const choice of CHOICES) {
    totals[choice] = sumUnique(notesByChoice[choice] ?? []);
  }

  return {
    proposalId,
    forWeight: totals.for.weight,
    againstWeight: totals.against.weight,
    abstainWeight: totals.abstain.weight,
    ballotCounts: {
      for: totals.for.count,
      against: totals.against.count,
      abstain: totals.abstain.count,
    },
  };
}

/**
 * Whether the registry will treat this tally as passing.
 *
 * Mirrors `has_passed` in Cairo, where a tie does not pass. Kept in sync
 * deliberately: an operator that predicts "passed" differently from the
 * contract would publish a misleading result.
 */
export function willPass(tally: TallyResult, quorum: bigint): boolean {
  // A pure mirror of `payout_terms` in the registry. If these two ever
  // disagree, the operator publishes a prediction the contract rejects.
  const turnout = tally.forWeight + tally.againstWeight + tally.abstainWeight;
  return turnout >= quorum && tally.forWeight > tally.againstWeight;
}
