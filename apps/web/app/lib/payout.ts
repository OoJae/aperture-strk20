/**
 * Building the treasury-payout call the wallet submits.
 *
 * This is the transaction Aperture is really about: the pool withdraws to
 * `GovernanceAnonymizer`, calls its `privacy_invoke`, and the helper parks the
 * value against a commitment that only a preimage can open. The wallet proves
 * and submits it, which is why this works on mainnet at all — no proving
 * service is published, and the wallet has its own.
 *
 * The three quoted strings below are placeholders the wallet substitutes when
 * it assembles the transaction. They are literal text and must never be
 * hex-normalised; only real token and amount values get converted.
 */

import { num } from "starknet";
import { ANONYMIZER_ADDRESS } from "./chain.ts";

/**
 * The Wallet API validates every felt against
 * `^0x(0|[a-fA-F1-9]{1}[a-fA-F0-9]{0,62})$` — a leading zero after `0x` is
 * rejected outright. Starknet addresses are conventionally written
 * zero-padded to 64 digits, so passing one through unchanged fails the whole
 * request with `INVALID_REQUEST_PAYLOAD` and no indication of which field was
 * at fault. Normalising strips the padding.
 *
 * This must never touch the placeholder strings the wallet substitutes.
 */
const felt = (value: string | bigint): string => num.toHex(BigInt(value));

/** Mirrors GovernanceOperation in contracts/src/governance_anonymizer.cairo. */
export const OP_REGISTER_PAYOUT = "0x0";

/** Domain separator for payout commitments, matching the contract. */
export const PAYOUT_TAG = "APERTURE_PAYOUT:V1";

export interface PayoutParams {
  token: string;
  /** Base units. Kept as a bigint so nothing rounds on the way in. */
  amount: bigint;
  proposalId: bigint;
  commitment: string;
}

/**
 * `withdraw` moves the value to the helper; `invoke` then runs its
 * `privacy_invoke`. Registering returns an empty span, so — unlike a claim —
 * this leg creates no open note, and adding one would make the pool reject the
 * transaction.
 */
export function buildRegisterPayoutActions(p: PayoutParams): unknown[] {
  return [
    {
      type: "withdraw",
      token: felt(p.token),
      amount: felt(p.amount),
      recipient: felt(ANONYMIZER_ADDRESS),
    },
    {
      type: "invoke",
      contract: felt(ANONYMIZER_ADDRESS),
      calldata: [
        OP_REGISTER_PAYOUT,
        felt(p.commitment),
        felt(p.token),
        felt(p.amount),
        felt(p.proposalId),
        "0x0",
        "0x0",
      ],
    },
  ];
}
