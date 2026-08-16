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
  ballotAccountClassHash:
    "0x036078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f",
  daoMasterPublicKey:
    "0x1818d42721b097dd91b7495207bc12bd38c73bd66cdb7bcf38c4e41902c1d4b",
};

/** Read back from ProposalRegistry at 0x045c7c6d…900e1cf9 on Sepolia. */
const DEPLOYED_PROPOSAL_1_FOR =
  "0x40fccba34a49389e3a9ccd6f11000833df7011d2825753eab823d9afb64e9bc";

describe("ballot address derivation", () => {
  it("matches the address the deployed registry returns", () => {
    const identity = deriveBallotIdentity(1n, "for", CONFIG);
    assert.equal(
      BigInt(identity.address),
      BigInt(DEPLOYED_PROPOSAL_1_FOR),
      "TypeScript must agree with the deployed Cairo contract",
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
