/**
 * `@oojae/strk20-governance` — sealed-ballot governance on the STRK20
 * shielded pool.
 *
 * A vote is a private transfer into a per-choice receiving identity. Nobody can
 * see who voted, for what, or with how much — not even mid-vote — and only the
 * aggregate is ever published.
 *
 * The two halves you are most likely to want:
 *
 * - `deriveBallotIdentity` tells a voter where to send. It reproduces the
 *   registry's on-chain derivation exactly, so a voter can verify the address
 *   an interface offered them rather than trusting it.
 * - `aggregateNotes` turns discovered notes into the published aggregate. It is
 *   pure, so a tally can be reproduced and checked by anyone.
 */

export {
  BALLOT_TAG,
  CHOICES,
  ballotDomain,
  ballotSalt,
  choiceIndex,
  deriveBallotIdentities,
  deriveBallotIdentity,
} from "./ballot.ts";
export type { BallotConfig, BallotIdentity, Choice } from "./ballot.ts";

export { aggregateNotes, willPass } from "./tally.ts";
export type { BallotNote, NotesByChoice, TallyResult } from "./tally.ts";

export {
  MAX_VIEWING_KEY,
  VIEWING_KEY_TAG,
  assertValidViewingKey,
  deriveBallotViewingKey,
} from "./viewing-key.ts";

export {
  ACTIVE,
  DEMO_URL,
  DEMO_VIDEO,
  DEPLOYMENTS,
  LEDGER,
  contractUrl,
  nonScoring,
  scoring,
  txUrl,
} from "./deployments.ts";
export type {
  LedgerEntry,
  NetworkDeployment,
  NetworkName,
  SupersededContract,
  TxKind,
} from "./deployments.ts";

export { classifyReceipt, describeVerdict } from "./receipt.ts";
export type { RawReceipt, ReceiptContext, ReceiptVerdict } from "./receipt.ts";

export { AmountParseError, U128_MAX, U64_MAX, assertFits, parseTokenAmount } from "./amount.ts";

export {
  BALLOT_SET_TAG,
  EMPTY_BALLOT_SET,
  computeBallotSetCommitment,
} from "./ballot-set.ts";
export type { CountedBallot } from "./ballot-set.ts";

export {
  PAYOUT_TAG,
  computePayoutCommitment,
  generatePayoutSecret,
  mintPayout,
} from "./payout.ts";
export type { PayoutTicket } from "./payout.ts";
