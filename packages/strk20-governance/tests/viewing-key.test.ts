import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_VIEWING_KEY,
  assertValidViewingKey,
  deriveBallotViewingKey,
} from "../src/viewing-key.ts";

const TEST_DOMAIN = "0x1234";

const MASTER = 0x1a2b3c4d5e6fn;

describe("deriveBallotViewingKey", () => {
  it("is deterministic", () => {
    assert.equal(
      deriveBallotViewingKey({ masterSecret: MASTER, domain: TEST_DOMAIN, proposalId: 1n, choice: "for" }),
      deriveBallotViewingKey({ masterSecret: MASTER, domain: TEST_DOMAIN, proposalId: 1n, choice: "for" }),
    );
  });

  it("gives each choice its own key", () => {
    const keys = new Set([
      deriveBallotViewingKey({ masterSecret: MASTER, domain: TEST_DOMAIN, proposalId: 1n, choice: "for" }),
      deriveBallotViewingKey({ masterSecret: MASTER, domain: TEST_DOMAIN, proposalId: 1n, choice: "against" }),
      deriveBallotViewingKey({ masterSecret: MASTER, domain: TEST_DOMAIN, proposalId: 1n, choice: "abstain" }),
    ]);
    assert.equal(keys.size, 3);
  });

  it("gives each proposal its own keys", () => {
    assert.notEqual(
      deriveBallotViewingKey({ masterSecret: MASTER, domain: TEST_DOMAIN, proposalId: 1n, choice: "for" }),
      deriveBallotViewingKey({ masterSecret: MASTER, domain: TEST_DOMAIN, proposalId: 2n, choice: "for" }),
    );
  });

  it("separates DAOs with different master secrets", () => {
    assert.notEqual(
      deriveBallotViewingKey({ masterSecret: MASTER, domain: TEST_DOMAIN, proposalId: 1n, choice: "for" }),
      deriveBallotViewingKey({ masterSecret: MASTER + 1n, domain: TEST_DOMAIN, proposalId: 1n, choice: "for" }),
    );
  });

  it("always lands in the protocol's valid range", () => {
    for (let proposal = 1n; proposal <= 25n; proposal++) {
      for (const choice of ["for", "against", "abstain"] as const) {
        const key = deriveBallotViewingKey({ masterSecret: MASTER, domain: TEST_DOMAIN, proposalId: proposal, choice: choice });
        assert.ok(key > 0n, "key must be non-zero");
        assert.ok(key <= MAX_VIEWING_KEY, "key must be within MAX_VIEWING_KEY");
      }
    }
  });

  it("returns a BigInt, never a string", () => {
    // A hex string compiles fine and then silently derives wrong channel keys,
    // so notes never decrypt — the failure looks like an empty ballot box.
    assert.equal(typeof deriveBallotViewingKey({ masterSecret: MASTER, domain: TEST_DOMAIN, proposalId: 1n, choice: "for" }), "bigint");
  });

  it("rejects a non-positive master secret", () => {
    assert.throws(() => deriveBallotViewingKey({ masterSecret: 0n, domain: TEST_DOMAIN, proposalId: 1n, choice: "for" }), /positive BigInt/);
  });
});

describe("assertValidViewingKey", () => {
  it("accepts a derived key", () => {
    assert.doesNotThrow(() =>
      assertValidViewingKey(deriveBallotViewingKey({ masterSecret: MASTER, domain: TEST_DOMAIN, proposalId: 1n, choice: "for" })),
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
