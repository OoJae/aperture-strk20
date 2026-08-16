/**
 * Aggregation is the one place a bug would silently misreport an election, so
 * it is tested harder than its size suggests.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aggregateNotes, willPass } from "../src/tally.ts";
import type { BallotNote, NotesByChoice } from "../src/tally.ts";

const note = (id: string, amount: bigint): BallotNote => ({ id, amount });

describe("aggregateNotes", () => {
  it("returns zeroes for a proposal nobody voted on", () => {
    const tally = aggregateNotes(1n, {});
    assert.equal(tally.forWeight, 0n);
    assert.equal(tally.againstWeight, 0n);
    assert.equal(tally.abstainWeight, 0n);
    assert.deepEqual(tally.ballotCounts, { for: 0, against: 0, abstain: 0 });
  });

  it("sums a single choice", () => {
    const tally = aggregateNotes(1n, {
      for: [note("a", 100n), note("b", 250n)],
    });
    assert.equal(tally.forWeight, 350n);
    assert.equal(tally.ballotCounts.for, 2);
  });

  it("keeps choices separate in a contested vote", () => {
    const tally = aggregateNotes(1n, {
      for: [note("a", 900n)],
      against: [note("b", 100n), note("c", 50n)],
      abstain: [note("d", 5n)],
    });
    assert.equal(tally.forWeight, 900n);
    assert.equal(tally.againstWeight, 150n);
    assert.equal(tally.abstainWeight, 5n);
    assert.deepEqual(tally.ballotCounts, { for: 1, against: 2, abstain: 1 });
  });

  /**
   * Paginated reads can legitimately return the same note twice, so dedupe is
   * required rather than defensive — without it a vote counts double.
   */
  it("collapses duplicate note ids", () => {
    const tally = aggregateNotes(1n, {
      for: [note("a", 100n), note("a", 100n), note("b", 1n)],
    });
    assert.equal(tally.forWeight, 101n);
    assert.equal(tally.ballotCounts.for, 2);
  });

  it("handles weights far beyond Number.MAX_SAFE_INTEGER", () => {
    const huge = 10n ** 30n;
    const tally = aggregateNotes(1n, { for: [note("a", huge), note("b", huge)] });
    assert.equal(tally.forWeight, huge * 2n);
  });

  it("rejects a negative amount rather than silently subtracting", () => {
    assert.throws(
      () => aggregateNotes(1n, { for: [note("a", -1n)] }),
      /negative amount/,
    );
  });

  it("carries the proposal id through", () => {
    assert.equal(aggregateNotes(42n, {}).proposalId, 42n);
  });

  it("treats an explicitly empty choice the same as an absent one", () => {
    const absent = aggregateNotes(1n, { for: [note("a", 5n)] });
    const empty = aggregateNotes(1n, {
      for: [note("a", 5n)],
      against: [] as BallotNote[],
    } satisfies NotesByChoice);
    assert.deepEqual(empty, absent);
  });
});

describe("willPass", () => {
  it("passes when for outweighs against", () => {
    assert.equal(willPass(aggregateNotes(1n, { for: [note("a", 2n)] })), true);
  });

  it("fails when against outweighs for", () => {
    assert.equal(
      willPass(aggregateNotes(1n, { against: [note("a", 2n)] })),
      false,
    );
  });

  /** Mirrors `has_passed` in Cairo, where a tie is not a pass. */
  it("treats a tie as a failure, matching the contract", () => {
    const tally = aggregateNotes(1n, {
      for: [note("a", 500n)],
      against: [note("b", 500n)],
    });
    assert.equal(willPass(tally), false);
  });

  it("ignores abstentions", () => {
    const tally = aggregateNotes(1n, {
      for: [note("a", 1n)],
      abstain: [note("b", 10n ** 9n)],
    });
    assert.equal(willPass(tally), true);
  });
});
