/**
 * Ballot derivation must agree with Cairo and with the deployed contract.
 *
 * The expected addresses here are not invented for this test: they are the same
 * vectors pinned in `contracts/tests/test_ballot.cairo`, and the proposal-1 FOR
 * address was read back from the registry deployed on Sepolia. Three
 * independent implementations agreeing is what makes it safe for a voter to
 * derive their own destination.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHOICES,
  ballotSalt,
  choiceIndex,
  deriveBallotIdentities,
  deriveBallotIdentity,
} from "../src/ballot.ts";
import type { BallotConfig } from "../src/ballot.ts";

const CONFIG: BallotConfig = {
  /**
   * The OpenZeppelin account class, whose constructor takes exactly
   * `[public_key]` — the calldata this derivation hashes. A class with a
   * different constructor (Argent's takes `[0, pubkey, 1]`) produces addresses
   * that look fine and correspond to no deployable account, so a vote sent to
   * one could never be read.
   */
  ballotAccountClassHash:
    "0x5b4b537eaa2399e3aa99c4e2e0208ebd6c71bc1467938cd52c798c601e43564",
  daoMasterPublicKey:
    "0x1818d42721b097dd91b7495207bc12bd38c73bd66cdb7bcf38c4e41902c1d4b",
};

/** Same inputs asserted in contracts/tests/test_ballot.cairo. */
const SHARED_VECTOR_PROPOSAL_1_FOR =
  "0x4aeed2e767949f18d459243efb6060bf1256019dbd30e336451687fa7089510";

describe("ballot address derivation", () => {
  it("agrees with the Cairo implementation on the shared vector", () => {
    const identity = deriveBallotIdentity(1n, "for", CONFIG);
    assert.equal(
      BigInt(identity.address),
      BigInt(SHARED_VECTOR_PROPOSAL_1_FOR),
      "TypeScript must agree with Cairo for identical inputs",
    );
  });

  it("is deterministic", () => {
    const a = deriveBallotIdentity(3n, "for", CONFIG);
    const b = deriveBallotIdentity(3n, "for", CONFIG);
    assert.equal(a.address, b.address);
  });

  it("gives each choice its own identity", () => {
    const [f, a, b] = deriveBallotIdentities(1n, CONFIG);
    const addresses = new Set([f!.address, a!.address, b!.address]);
    assert.equal(addresses.size, 3, "choices must not share an address");
  });

  it("gives each proposal its own identities", () => {
    const one = deriveBallotIdentity(1n, "for", CONFIG);
    const two = deriveBallotIdentity(2n, "for", CONFIG);
    assert.notEqual(one.address, two.address);
  });

  it("carries the proposal and choice it was derived for", () => {
    const identity = deriveBallotIdentity(7n, "abstain", CONFIG);
    assert.equal(identity.proposalId, 7n);
    assert.equal(identity.choice, "abstain");
  });

  it("returns identities in choice order", () => {
    const identities = deriveBallotIdentities(1n, CONFIG);
    assert.deepEqual(
      identities.map((i) => i.choice),
      [...CHOICES],
    );
  });
});

describe("choice discriminants", () => {
  it("matches the Cairo enum order", () => {
    // Reordering these silently moves every ballot address ever derived.
    assert.equal(choiceIndex("for"), 0);
    assert.equal(choiceIndex("against"), 1);
    assert.equal(choiceIndex("abstain"), 2);
  });

  it("rejects an unknown choice", () => {
    assert.throws(() => choiceIndex("maybe" as never), /Unknown choice/);
  });
});

describe("ballot salt", () => {
  it("differs per choice and per proposal", () => {
    const salts = new Set([
      ballotSalt(1n, "for"),
      ballotSalt(1n, "against"),
      ballotSalt(1n, "abstain"),
      ballotSalt(2n, "for"),
    ]);
    assert.equal(salts.size, 4);
  });
});
