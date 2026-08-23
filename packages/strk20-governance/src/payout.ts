/**
 * Payout commitments, in one place.
 *
 * There were four independent implementations of this hash — the tally worker,
 * the web app's lib, the web app's component, and the Cairo — and no test
 * compared any of them. When v2 changed the preimage, three of the four kept
 * computing the old one and kept compiling.
 *
 * That combination is worse than a crash. `privacy_invoke`'s arity did not
 * change, so a stale client still *registers* successfully: the contract stores
 * whatever commitment hash it is handed, and the pool has already moved the
 * money in. Only the claim recomputes the hash from the preimage — and it can
 * never match, on any parameterisation, forever. The anonymizer has no sweep.
 *
 * That is not hypothetical. It is how 14 STRK became unrecoverable on mainnet
 * and another 20.5 on Sepolia. One implementation, pinned against Cairo by a
 * vector test, is the fix.
 */

import { hash, num, shortString } from "starknet";

/** Mirrors `PAYOUT_COMMITMENT_TAG` in contracts/src/governance_anonymizer.cairo. */
export const PAYOUT_TAG = "APERTURE_PAYOUT:V2";

/**
 * Everything a claim must reproduce.
 *
 * v1's preimage was the secret alone, so one leaked secret opened whichever
 * entry happened to match — any amount, any token, any proposal, on any chain.
 * Binding the terms means a preimage is worth exactly the payout it was minted
 * for.
 */
export interface PayoutTicket {
  /** The anonymizer's payout domain, from `get_payout_domain()`. */
  domain: string;
  proposalId: bigint;
  token: string;
  amount: bigint;
  secret: string;
}

export function computePayoutCommitment(ticket: PayoutTicket): string {
  return hash.computePoseidonHashOnElements([
    num.toHex(BigInt(shortString.encodeShortString(PAYOUT_TAG))),
    ticket.domain,
    num.toHex(ticket.proposalId),
    num.toHex(BigInt(ticket.token)),
    num.toHex(ticket.amount),
    ticket.secret,
  ]);
}

/** 240 bits of CSPRNG. The only thing that can ever open a payout. */
export function generatePayoutSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(30));
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Mint a payout: the ticket and its commitment, together.
 *
 * Returning both from one call is load-bearing rather than convenient. A caller
 * that computes the commitment from one set of terms and then registers with a
 * different set stores an entry keyed by a hash no claim can reproduce — and
 * nothing on chain can catch it, because the contract never sees the preimage
 * at registration. Producing them together makes that unrepresentable.
 */
export function mintPayout(terms: Omit<PayoutTicket, "secret">): {
  ticket: PayoutTicket;
  commitment: string;
} {
  const ticket: PayoutTicket = { ...terms, secret: generatePayoutSecret() };
  return { ticket, commitment: computePayoutCommitment(ticket) };
}
