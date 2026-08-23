/**
 * The vector that would have caught the most expensive bug in this repository.
 *
 * There were four implementations of the payout commitment and no test compared
 * any of them to any other. When the preimage changed for v2, three kept
 * computing the old hash and kept compiling — and because `privacy_invoke`'s
 * arity did not change, a stale client would still register successfully and
 * then be unable to claim, ever. Two balances have already been lost that way.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computePayoutCommitment, mintPayout, PAYOUT_TAG } from "../src/payout.ts";

const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const DOMAIN = "0x1234";
const SECRET = `0x${Buffer.from("a very secret preimage").toString("hex")}`;

/**
 * Pinned identically in contracts/tests/test_governance_anonymizer.cairo and
 * computed there by an independent implementation. Two implementations agreeing
 * on a fixed value is the only thing that makes either trustworthy.
 */
const SHARED_VECTOR =
  "0xe9ed710c9e38c75880ecd742a47a3dc1e7ae641537aeb4aa00eeb361176e1c";

describe("payout commitment", () => {
  it("agrees with the Cairo implementation on the shared vector", () => {
    const commitment = computePayoutCommitment({
      domain: DOMAIN,
      proposalId: 1n,
      token: STRK,
      amount: 1000n,
      secret: SECRET,
    });
    assert.equal(
      BigInt(commitment),
      BigInt(SHARED_VECTOR),
      "TypeScript must agree with Cairo, or a registered payout can never be claimed",
    );
  });

  it("uses the v2 tag", () => {
    // The whole failure was a client left on V1 while the contract moved to V2.
    assert.equal(PAYOUT_TAG, "APERTURE_PAYOUT:V2");
  });

  it("binds the amount", () => {
    const base = { domain: DOMAIN, proposalId: 1n, token: STRK, secret: SECRET };
    assert.notEqual(
      computePayoutCommitment({ ...base, amount: 1000n }),
      computePayoutCommitment({ ...base, amount: 1001n }),
      "a secret must not open a payout for a different amount",
    );
  });

  it("binds the proposal", () => {
    const base = { domain: DOMAIN, token: STRK, amount: 1000n, secret: SECRET };
    assert.notEqual(
      computePayoutCommitment({ ...base, proposalId: 1n }),
      computePayoutCommitment({ ...base, proposalId: 2n }),
    );
  });

  it("binds the token", () => {
    const base = { domain: DOMAIN, proposalId: 1n, amount: 1000n, secret: SECRET };
    assert.notEqual(
      computePayoutCommitment({ ...base, token: STRK }),
      computePayoutCommitment({ ...base, token: "0x999" }),
    );
  });

  it("binds the domain, so a preimage is worthless on another deployment", () => {
    const base = { proposalId: 1n, token: STRK, amount: 1000n, secret: SECRET };
    assert.notEqual(
      computePayoutCommitment({ ...base, domain: "0x1234" }),
      computePayoutCommitment({ ...base, domain: "0x5678" }),
    );
  });

  it("is not the identity function on the secret", () => {
    // A fuzz test over distinct secrets passes for `hash(s) = s`. A fixed
    // vector is the only thing that rules that out.
    const commitment = computePayoutCommitment({
      domain: DOMAIN,
      proposalId: 1n,
      token: STRK,
      amount: 1000n,
      secret: SECRET,
    });
    assert.notEqual(BigInt(commitment), BigInt(SECRET));
  });
});

describe("mintPayout", () => {
  it("returns a commitment that matches its own ticket", () => {
    // The point of minting both together: a caller cannot end up registering
    // terms that differ from the ones the commitment was built from, which
    // would store an entry no claim could ever reproduce.
    const { ticket, commitment } = mintPayout({
      domain: DOMAIN,
      proposalId: 7n,
      token: STRK,
      amount: 42n,
    });
    assert.equal(commitment, computePayoutCommitment(ticket));
  });

  it("generates a different secret every time", () => {
    const terms = { domain: DOMAIN, proposalId: 1n, token: STRK, amount: 1n };
    assert.notEqual(mintPayout(terms).ticket.secret, mintPayout(terms).ticket.secret);
  });
});
