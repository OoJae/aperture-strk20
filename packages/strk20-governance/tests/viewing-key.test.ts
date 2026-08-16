import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_VIEWING_KEY,
  assertValidViewingKey,
  deriveBallotViewingKey,
} from "../src/viewing-key.ts";

const MASTER = 0x1a2b3c4d5e6fn;

describe("deriveBallotViewingKey", () => {
  it("is deterministic", () => {
    assert.equal(
      deriveBallotViewingKey(MASTER, 1n, "for"),
      deriveBallotViewingKey(MASTER, 1n, "for"),
    );
  });

  it("gives each choice its own key", () => {
    const keys = new Set([
      deriveBallotViewingKey(MASTER, 1n, "for"),
      deriveBallotViewingKey(MASTER, 1n, "against"),
      deriveBallotViewingKey(MASTER, 1n, "abstain"),
    ]);
    assert.equal(keys.size, 3);
  });

  it("gives each proposal its own keys", () => {
    assert.notEqual(
      deriveBallotViewingKey(MASTER, 1n, "for"),
      deriveBallotViewingKey(MASTER, 2n, "for"),
    );
  });

  it("separates DAOs with different master secrets", () => {
    assert.notEqual(
      deriveBallotViewingKey(MASTER, 1n, "for"),
      deriveBallotViewingKey(MASTER + 1n, 1n, "for"),
    );
  });

  it("always lands in the protocol's valid range", () => {
    for (let proposal = 1n; proposal <= 25n; proposal++) {
      for (const choice of ["for", "against", "abstain"] as const) {
        const key = deriveBallotViewingKey(MASTER, proposal, choice);
        assert.ok(key > 0n, "key must be non-zero");
        assert.ok(key <= MAX_VIEWING_KEY, "key must be within MAX_VIEWING_KEY");
      }
    }
  });

  it("returns a BigInt, never a string", () => {
    // A hex string compiles fine and then silently derives wrong channel keys,
    // so notes never decrypt — the failure looks like an empty ballot box.
    assert.equal(typeof deriveBallotViewingKey(MASTER, 1n, "for"), "bigint");
  });

  it("rejects a non-positive master secret", () => {
    assert.throws(() => deriveBallotViewingKey(0n, 1n, "for"), /positive BigInt/);
  });
});

describe("assertValidViewingKey", () => {
  it("accepts a derived key", () => {
    assert.doesNotThrow(() =>
      assertValidViewingKey(deriveBallotViewingKey(MASTER, 1n, "for")),
    );
  });

  it("rejects a hex string from configuration", () => {
    assert.throws(() => assertValidViewingKey("0x1234" as never), TypeError);
  });

  it("rejects zero and out-of-range keys", () => {
    assert.throws(() => assertValidViewingKey(0n), RangeError);
    assert.throws(() => assertValidViewingKey(MAX_VIEWING_KEY + 1n), RangeError);
  });
});
