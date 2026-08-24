/**
 * Check, before building anything, that a viewing key belongs to the account
 * that is about to use it.
 *
 * The pool stores one public key per address, write-once, set when the account
 * registers. Hand the SDK a viewing key that does not derive it and the failure
 * arrives from the indexer as
 *
 *     Indexer API /v1/sync/outgoing_state failed (400):
 *     viewing_key does not match the registered public key for the given address
 *
 * which is accurate but arrives late, after a proof has been requested, and
 * names neither the key nor the account that disagreed. Worse, the same
 * mismatch on a *receiving* identity produces no error at all — the notes are
 * simply encrypted to a key nobody holds, and the tally reads as "nobody
 * voted".
 *
 * This is one `get_public_key` call. It costs nothing and it fails locally.
 */

import { ec, type RpcProvider } from "starknet";

export class ViewingKeyMismatchError extends Error {
  constructor(address: string, registered: string, derived: string) {
    super(
      `The viewing key configured for ${address} is not the one that account ` +
        `registered with the pool.\n` +
        `  pool has   ${registered}\n` +
        `  key derives ${derived}\n` +
        `The pool's public-key slot is write-once, so this cannot be corrected ` +
        `by re-registering: either the right key is somewhere else, or this ` +
        `account can no longer touch the pool and a different one is needed.`,
    );
    this.name = "ViewingKeyMismatchError";
  }
}

export class NotRegisteredError extends Error {
  constructor(address: string) {
    super(
      `${address} has not registered a viewing key with the pool, so it has no ` +
        `channel to create notes in. Register it before shielding.`,
    );
    this.name = "NotRegisteredError";
  }
}

/**
 * Throws unless `viewingKey` is the one `address` registered with `pool`.
 *
 * Returns the registered public key, so a caller can log it.
 */
export async function assertRegisteredViewingKey(
  provider: RpcProvider,
  pool: string,
  address: string,
  viewingKey: bigint,
): Promise<string> {
  const result = await provider.callContract({
    contractAddress: pool,
    entrypoint: "get_public_key",
    calldata: [address],
  });
  const raw = (Array.isArray(result) ? result : (result as { result: string[] }).result) as string[];
  const registered = raw[0] ?? "0x0";
  if (BigInt(registered) === 0n) throw new NotRegisteredError(address);

  const derived = ec.starkCurve.getStarkKey(`0x${viewingKey.toString(16)}`);
  if (BigInt(derived) !== BigInt(registered)) {
    throw new ViewingKeyMismatchError(address, registered, derived);
  }
  return registered;
}
