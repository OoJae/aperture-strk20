/**
 * Ballot identity derivation.
 *
 * This is the client half of `contracts/src/ballot.cairo`. A voter derives
 * their destination here, in the browser; the registry derives it on-chain in
 * Cairo. The two agreeing is what puts a vote somewhere the DAO can read it, so
 * `tests/ballot.test.ts` pins this against both the Cairo vectors and the
 * output of the deployed contract.
 *
 * Address derivation goes through starknet.js rather than being hand-rolled —
 * the formula is a single hash-on-elements over five inputs, and an earlier
 * hand-rolled attempt using a nested pedersen chain produced plausible but
 * wrong addresses.
 */

import { hash, num, shortString } from "starknet";

/** Ballot choices, in the order their discriminants are assigned. */
export type Choice = "for" | "against" | "abstain";

/**
 * Discriminants matching the Cairo `Choice` enum. These are consensus-critical:
 * appending a choice is safe, reordering silently moves every ballot address.
 */
const CHOICE_INDEX: Record<Choice, number> = {
  for: 0,
  against: 1,
  abstain: 2,
};

export const CHOICES: readonly Choice[] = ["for", "against", "abstain"];

/**
 * Domain separator, so a ballot salt can never collide with a hash computed for
 * some other purpose over the same numbers. Matches `BALLOT_TAG` in Cairo.
 */
export const BALLOT_TAG = "APERTURE_BALLOT:V2";

/** Everything needed to place a proposal's ballot identities. */
export interface BallotConfig {
  /** Account class the DAO's ballot identities are deployed from. */
  ballotAccountClassHash: string;
  /** Public half of the DAO master key. */
  daoMasterPublicKey: string;
  /**
   * The registry's domain separator.
   *
   * A voter should not be handed this: they should compute it from facts they
   * can check — which chain, which registry, which epoch — which is what
   * `ballotDomain` is for.
   */
  domain: string;
}

/** A per-proposal, per-choice receiving identity. */
export interface BallotIdentity {
  proposalId: bigint;
  choice: Choice;
  /** Address the voter privately transfers their vote weight to. */
  address: string;
}

/**
 * `'APERTURE_BALLOT:V1'` as a felt, matching Cairo's short-string literal.
 *
 * Uses starknet.js rather than `Buffer` so this runs unchanged in a browser —
 * voters derive their own ballot address client-side, which is the whole point
 * of deriving it rather than being told it.
 */
function ballotTagFelt(): string {
  return num.toHex(BigInt(shortString.encodeShortString(BALLOT_TAG)));
}

export function choiceIndex(choice: Choice): number {
  const index = CHOICE_INDEX[choice];
  if (index === undefined) throw new Error(`Unknown choice: ${choice}`);
  return index;
}

/**
 * The separator every ballot address and viewing key hangs off.
 *
 * Mirrors `ballot_domain` in contracts/src/ballot.cairo. Binding the chain id
 * is not hygiene: the v1 registries on mainnet and Sepolia shared a class hash
 * and a master key, and the v1 salt bound neither chain nor registry, so both
 * published the same address for the same proposal — verified against both live
 * contracts.
 */
export function ballotDomain(
  chainId: string,
  registryAddress: string,
  epoch: string,
): string {
  return hash.computePoseidonHashOnElements([
    ballotTagFelt(),
    num.toHex(BigInt(chainId)),
    num.toHex(BigInt(registryAddress)),
    num.toHex(BigInt(epoch)),
  ]);
}

/** Deterministic salt for one proposal/choice pair inside one domain. */
export function ballotSalt(domain: string, proposalId: bigint, choice: Choice): string {
  // BALLOT_TAG is absent here because the domain already carries it.
  return hash.computePoseidonHashOnElements([
    domain,
    num.toHex(proposalId),
    num.toHex(BigInt(choiceIndex(choice))),
  ]);
}

/** Where a vote for this choice on this proposal should be sent. */
export function deriveBallotIdentity(
  proposalId: bigint,
  choice: Choice,
  config: BallotConfig,
): BallotIdentity {
  const address = hash.calculateContractAddressFromHash(
    ballotSalt(config.domain, proposalId, choice),
    config.ballotAccountClassHash,
    [config.daoMasterPublicKey],
    0,
  );
  return { proposalId, choice, address };
}

/** All three identities for a proposal, in choice order. */
export function deriveBallotIdentities(
  proposalId: bigint,
  config: BallotConfig,
): BallotIdentity[] {
  return CHOICES.map((choice) => deriveBallotIdentity(proposalId, choice, config));
}
