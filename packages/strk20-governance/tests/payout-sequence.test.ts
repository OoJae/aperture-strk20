/**
 * The test that would have caught a wrong number on the live demo.
 *
 * `/app` renders the treasury payout leg by leg, and the legs used to be typed
 * into the component as literal hashes. Deriving them from the ledger removed
 * that drift but introduced a subtler bug: filtering on `kind` alone spans every
 * contract generation. Mainnet carries thirteen `payout-*` entries across v1, v2
 * and v3, so taking the first two and subtracting produced "Wait 7,984 blocks" —
 * the distance between two unrelated v1 payouts, presented on a live page as
 * this payout's timelock.
 *
 * Nothing failed. `snforge` was green, all 86 TypeScript tests were green, the
 * claims test was satisfied because no address was hardcoded any more, and the
 * page built and deployed. The only way to see it was to read the rendered
 * output. Hence this file.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ACTIVE,
  LEDGER,
  latestPayoutSequence,
} from "../src/deployments.ts";

/**
 * The registry's mainnet `payout_timelock_blocks`, fixed at construction and
 * immutable. `deployments/params.json` is where it is set; it is repeated here
 * because a test that reads its expectation from the thing under test proves
 * nothing.
 */
const MAINNET_TIMELOCK_BLOCKS = 1800;

describe("latestPayoutSequence", () => {
  const seq = latestPayoutSequence("mainnet");

  it("resolves all four legs on mainnet", () => {
    assert.ok(seq.announced, "no announce leg");
    assert.ok(seq.licensed, "no authorize leg");
    assert.ok(seq.registered, "no register leg");
    assert.ok(seq.claimed, "no claim leg");
  });

  it("returns the legs in the order the protocol requires", () => {
    // announce -> timelock -> authorize -> register -> claim. Any other
    // ordering means the walk-back picked legs from different payouts.
    assert.ok(seq.announced!.block < seq.licensed!.block);
    assert.ok(seq.licensed!.block < seq.registered!.block);
    assert.ok(seq.registered!.block < seq.claimed!.block);
  });

  it("picks four distinct transactions", () => {
    const hashes = [seq.announced!, seq.licensed!, seq.registered!, seq.claimed!]
      .map((e) => e.hash);
    assert.equal(new Set(hashes).size, 4, "a leg was selected twice");
  });

  it("spans at least the timelock, and not wildly more", () => {
    // The actual failure. 1800 is the floor the contract enforces; the observed
    // gap was 1820. The upper bound is what fails loudly if the walk-back ever
    // straddles two payouts again — 7,984 sailed through every other check.
    const waited = seq.licensed!.block - seq.announced!.block;
    assert.ok(
      waited >= MAINNET_TIMELOCK_BLOCKS,
      `licensed ${waited} blocks after announce, below the ${MAINNET_TIMELOCK_BLOCKS}-block timelock`,
    );
    assert.ok(
      waited < MAINNET_TIMELOCK_BLOCKS * 2,
      `${waited} blocks between announce and authorize — far past the timelock, ` +
        `so these two legs are probably from different payouts`,
    );
  });

  it("does not just take the earliest entries", () => {
    // The exact shape of the bug: the first draft sorted ascending and read off
    // the front, landing on v1.
    const earliest = LEDGER.filter(
      (e) => e.network === "mainnet" && e.kind.startsWith("payout-"),
    ).sort((a, b) => a.block - b.block)[0]!;
    assert.notEqual(
      seq.announced!.hash,
      earliest.hash,
      "the announce leg is the oldest payout entry on the ledger, which means " +
        "the sequence is being read from the front rather than walked back",
    );
  });

  it("selects the newest claim, so a later payout supersedes this one", () => {
    const claims = LEDGER.filter(
      (e) => e.network === "mainnet" && e.kind === "payout-claim",
    ).sort((a, b) => a.block - b.block);
    assert.ok(claims.length > 1, "fixture too weak: only one claim to choose from");
    assert.equal(seq.claimed!.hash, claims.at(-1)!.hash);
  });

  it("every selected leg is one of ours", () => {
    // A leg that scores nothing did not route through our contracts, so it has
    // no business being presented as a step of Aperture's payout.
    for (const leg of [seq.announced!, seq.licensed!, seq.registered!, seq.claimed!]) {
      assert.equal(leg.scores, true, `${leg.hash} does not run through our contracts`);
      assert.notEqual(leg.through, null);
    }
  });

  it("defaults to the active network", () => {
    assert.deepEqual(latestPayoutSequence(), latestPayoutSequence(ACTIVE));
  });

  it("returns empty legs rather than throwing on a network with no payouts", () => {
    // Sepolia has no ledger entries at all. A consumer should get undefined
    // legs and render nothing, not a crash on the live site.
    const empty = latestPayoutSequence("sepolia");
    assert.equal(empty.claimed, undefined);
    assert.equal(empty.announced, undefined);
  });
});
