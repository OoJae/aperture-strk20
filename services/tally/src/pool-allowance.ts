/**
 * Approve the pool for what it is about to pull.
 *
 * On the wallet route the wallet does this internally, which is why shielding
 * there is "one action, two confirmations". On the SDK route nothing does it
 * for you — and the failure is not obvious, because the proof builds fine, the
 * transaction assembles fine, and the refusal arrives from fee estimation as
 * `Insufficient ERC20 allowance` buried inside a 78KB dump of the transaction
 * that was rejected.
 *
 * That is what stopped the first attempt to register a ballot identity from
 * this repository. The v1 identities were stood up by hand, so this path had
 * never actually been run.
 *
 * The allowance is consumed by the pool, so this is checked before every pool
 * transaction rather than granted once. Approving the exact amount, not an
 * unbounded allowance: these accounts hold real funds, and a standing approval
 * to any address is a strictly larger thing to be wrong about.
 */

import type { Account, RpcProvider } from "starknet";

async function readFelt(
  provider: RpcProvider,
  contractAddress: string,
  entrypoint: string,
  calldata: string[] = [],
): Promise<string[]> {
  const result = await provider.callContract({ contractAddress, entrypoint, calldata });
  return (Array.isArray(result) ? result : (result as { result: string[] }).result) as string[];
}

/** The pool's flat fee, read from the pool rather than assumed per network. */
export async function poolFee(provider: RpcProvider, pool: string): Promise<bigint> {
  const [fee] = await readFelt(provider, pool, "get_fee_amount");
  return BigInt(fee ?? "0x0");
}

/**
 * Ensure `account` has approved `pool` for the flat fee plus `plus`.
 *
 * Returns the approval's transaction hash, or null if the allowance already
 * covered it. An ordinary ERC20 call: gas only, no pool fee.
 */
export async function ensurePoolAllowance(args: {
  provider: RpcProvider;
  account: Account;
  pool: string;
  token: string;
  /** Anything the pool pulls beyond its fee — a deposit amount, say. */
  plus?: bigint;
}): Promise<string | null> {
  const { provider, account, pool, token, plus = 0n } = args;
  const needed = (await poolFee(provider, pool)) + plus;

  const [low, high] = await readFelt(provider, token, "allowance", [account.address, pool]);
  const current = BigInt(low ?? "0x0") + (BigInt(high ?? "0x0") << 128n);
  if (current >= needed) return null;

  const tx = await account.execute({
    contractAddress: token,
    entrypoint: "approve",
    calldata: [pool, needed.toString(), "0"],
  });
  const receipt = await provider.waitForTransaction(tx.transaction_hash);
  if ((receipt as { execution_status?: string }).execution_status === "REVERTED") {
    throw new Error(
      `approve REVERTED: ${(receipt as { revert_reason?: string }).revert_reason ?? "(no reason)"}`,
    );
  }
  return tx.transaction_hash;
}
