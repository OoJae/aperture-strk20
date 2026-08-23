/**
 * Viewing keys for ballot identities.
 *
 * Each ballot identity needs its own viewing key so the tally service can read
 * the notes sent to it. Deriving them from one DAO master secret means the
 * operator holds a single secret rather than one per proposal per choice, and
 * can re-derive any of them at any time.
 *
 * A viewing key must be a BigInt in `[1, MAX_VIEWING_KEY]`. Passing a hex
 * string instead compiles fine and then silently derives the wrong channel
 * keys, so notes sent to the identity never decrypt — which looks like an empty
 * ballot box rather than an error. The bound is enforced here for that reason.
 */

import { hash, num, shortString } from "starknet";
import type { Choice } from "./ballot.ts";
import { choiceIndex } from "./ballot.ts";

/**
 * Half the STARK curve order, per the SDK's own `MAX_VIEWING_KEY`. Reproduced
 * rather than imported so this package stays dependency-light; the SDK exports
 * the same value if you prefer to assert against it.
 */
export const MAX_VIEWING_KEY =
  0x0400000000000010ffffffffffffffffb781126dcae7b2321e66a241adc64d2fn / 2n;

export const VIEWING_KEY_TAG = "APERTURE_VIEWING_KEY:V2";

function viewingKeyTagFelt(): string {
  return num.toHex(BigInt(shortString.encodeShortString(VIEWING_KEY_TAG)));
}

/**
 * Takes an options object rather than positional arguments on purpose. Adding
 * `domain` positionally would let every existing call site keep compiling while
 * silently deriving the wrong key — and a wrong viewing key does not error, it
 * returns an empty ballot box.
 *
 * Derive the viewing key for one ballot identity.
 *
 * Domain-separated from ballot-address derivation so the same master secret
 * cannot produce a value that is meaningful in both contexts.
 */
export function deriveBallotViewingKey(args: {
  masterSecret: bigint;
  /** The registry's domain. Without it, two chains derive the same key. */
  domain: string;
  proposalId: bigint;
  choice: Choice;
}): bigint {
  const { masterSecret, domain, proposalId, choice } = args;
  if (masterSecret <= 0n) {
    throw new Error("masterSecret must be a positive BigInt");
  }
  const raw = BigInt(
    hash.computePoseidonHashOnElements([
      viewingKeyTagFelt(),
      domain,
      num.toHex(masterSecret),
      num.toHex(proposalId),
      num.toHex(BigInt(choiceIndex(choice))),
    ]),
  );
  const key = raw % MAX_VIEWING_KEY;
  return key === 0n ? 1n : key;
}

/** Guard for keys arriving from configuration rather than derivation. */
export function assertValidViewingKey(key: bigint): void {
  if (typeof key !== "bigint") {
    throw new TypeError("viewing key must be a BigInt, not a hex string");
  }
  if (key <= 0n || key > MAX_VIEWING_KEY) {
    throw new RangeError(`viewing key out of range [1, MAX_VIEWING_KEY]`);
  }
}
