/**
 * The commitment has to mean the same thing tomorrow.
 *
 * No Cairo function computes this — the contract cannot see notes, so it stores
 * what it is handed. That removes the usual cross-language pin and replaces it
 * with a different obligation: if the algorithm changes, every commitment
 * already published on chain becomes unverifiable, silently, because the old
 * felt is still there and no client can reproduce it. The pinned vector below is
 * what makes that change loud.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BALLOT_SET_TAG,
  EMPTY_BALLOT_SET,
  computeBallotSetCommitment,
  type CountedBallot,
} from "../src/ballot-set.ts";

const BALLOTS: CountedBallot[] = [
  { noteId: "0x2", amount: 3n, choice: "against" },
  { noteId: "0x1", amount: 5n, choice: "for" },
];

test("the commitment is pinned", () => {
  // Change this only when the preimage is deliberately changed, and understand
  // that doing so orphans every commitment already on chain.
  assert.equal(
    computeBallotSetCommitment(BALLOTS),
    "0xf9d9ca4b65fa4697c9d05b901ddfc816e25265d481ca23dff9b229483c2ec8",
  );
  assert.equal(BALLOT_SET_TAG, "APERTURE_BALLOTS:V3");
});

test("discovery order is not an input", () => {
  // Notes come back per identity in the indexer's order, not ours. Two honest
  // parties counting the same ballots must reach the same felt.
  assert.equal(
    computeBallotSetCommitment(BALLOTS),
    computeBallotSetCommitment([...BALLOTS].reverse()),
  );
});

test("moving one ballot to another choice changes it", () => {
  // The note ids and amounts are identical; only the choice moved, and that
  // changes the result completely.
  const moved = BALLOTS.map((b) =>
    b.noteId === "0x1" ? { ...b, choice: "against" as const } : b,
  );
  assert.notEqual(computeBallotSetCommitment(BALLOTS), computeBallotSetCommitment(moved));
});

test("changing an amount changes it", () => {
  const tweaked = BALLOTS.map((b) =>
    b.noteId === "0x1" ? { ...b, amount: b.amount + 1n } : b,
  );
  assert.notEqual(computeBallotSetCommitment(BALLOTS), computeBallotSetCommitment(tweaked));
});

test("dropping a ballot changes it", () => {
  assert.notEqual(
    computeBallotSetCommitment(BALLOTS),
    computeBallotSetCommitment(BALLOTS.slice(1)),
  );
});

test("adding a ballot with zero weight still changes it", () => {
  // A zero-weight note contributes nothing to any total, so a commitment that
  // ignored it would let one be added or removed without trace.
  assert.notEqual(
    computeBallotSetCommitment(BALLOTS),
    computeBallotSetCommitment([...BALLOTS, { noteId: "0x9", amount: 0n, choice: "abstain" }]),
  );
});

test("an empty ballot box has a commitment, and it is not zero", () => {
  // finalize rejects zero, so "nobody voted" must still produce something —
  // otherwise it would be indistinguishable from "the operator forgot".
  assert.equal(computeBallotSetCommitment([]), EMPTY_BALLOT_SET);
  assert.notEqual(BigInt(EMPTY_BALLOT_SET), 0n);
});

test("note ids are compared numerically, not as strings", () => {
  // "0x10" sorts before "0x9" as a string and after it as a number. An indexer
  // is free to pad or not pad, and the felt must not depend on which.
  const padded: CountedBallot[] = [
    { noteId: "0x0000000000000009", amount: 1n, choice: "for" },
    { noteId: "0x10", amount: 2n, choice: "for" },
  ];
  const bare: CountedBallot[] = [
    { noteId: "0x10", amount: 2n, choice: "for" },
    { noteId: "0x9", amount: 1n, choice: "for" },
  ];
  assert.equal(computeBallotSetCommitment(padded), computeBallotSetCommitment(bare));
});
