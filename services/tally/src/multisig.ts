/**
 * Drive a registry call that only the tally operator may make.
 *
 * On v3 the tally operator is a TreasuryMultisig, not an account anyone holds a
 * key for. `finalize`, `announce_payout` and `authorize_payout` all compare
 * `get_caller_address()` against it, so a signer calling the registry directly
 * gets NOT_TALLY_OPERATOR — which is the entire point, and which also means
 * every one of those paths has to go through here.
 *
 * The shape is OpenZeppelin's: submit, confirm until quorum, execute. Four
 * transactions where there used to be one, all gas-only. `salt` makes the
 * transaction id unique, so the same call can legitimately be made twice — two
 * payouts of the same amount against the same proposal are not a mistake.
 *
 * Every step is idempotent against on-chain state rather than a local flag, so
 * a rerun after a crash resumes instead of starting over or double-confirming.
 */

import { Account, CallData, RpcProvider, hash, num } from "starknet";

import type { TallyConfig } from "./config.ts";

/** Mirrors the component's TransactionState enum. */
const STATE = { NotFound: 0, Pending: 1, Confirmed: 2, Executed: 3 } as const;

export interface MultisigSigner {
  label: string;
  address: string;
  privateKey: string;
}

/**
 * Signers we hold keys for, in the order they should confirm.
 *
 * Deliberately reads them from the environment rather than deriving them from
 * the multisig: holding a key is what makes a signer usable, and the multisig
 * knows only addresses.
 */
export function availableSigners(config: TallyConfig): MultisigSigner[] {
  const suffix = config.network === "sepolia" ? "_SEPOLIA" : "";
  const candidates: MultisigSigner[] = [
    {
      label: "operator",
      address: config.operatorAddress,
      privateKey: config.operatorPrivateKey,
    },
    {
      label: "pool actor",
      address: config.poolActorAddress,
      privateKey: config.poolActorPrivateKey,
    },
  ];
  const recoveryAddress = process.env[`MULTISIG_SIGNER_RECOVERY_ADDRESS${suffix}`];
  const recoveryKey = process.env[`MULTISIG_SIGNER_RECOVERY_PRIVATE_KEY${suffix}`];
  if (recoveryAddress && recoveryKey) {
    candidates.push({ label: "recovery", address: recoveryAddress, privateKey: recoveryKey });
  }
  // Distinct addresses only: on a network where the pool actor falls back to
  // the operator they are the same account, and confirming twice from one
  // signer does not reach a quorum of two.
  const seen = new Set<string>();
  return candidates.filter((s) => {
    const key = BigInt(s.address).toString();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export class NotEnoughSignersError extends Error {
  constructor(quorum: number, available: number) {
    super(
      `The multisig needs ${quorum} confirmations and only ${available} signer key(s) ` +
        `are configured. That is the multisig working, not a bug: add the missing ` +
        `key, or have the other signer confirm.`,
    );
    this.name = "NotEnoughSignersError";
  }
}

/**
 * Submit, confirm to quorum, and execute one call on the registry.
 *
 * Returns the executing transaction's hash — the one that actually reaches the
 * registry, and the only one worth recording.
 */
export async function executeAsOperator(args: {
  provider: RpcProvider;
  config: TallyConfig;
  multisig: string;
  entrypoint: string;
  calldata: string[];
  /** Distinguishes two legitimately identical calls. */
  salt?: string;
  log?: (line: string) => void;
}): Promise<string> {
  const { provider, config, multisig, entrypoint, calldata } = args;
  const salt = args.salt ?? "0x0";
  const log = args.log ?? ((l: string) => console.log(l));

  const selector = hash.getSelectorFromName(entrypoint);
  const registry = config.registryAddress;

  const view = async (fn: string, data: string[]): Promise<string[]> => {
    const r = await provider.callContract({
      contractAddress: multisig,
      entrypoint: fn,
      calldata: data,
    });
    return (Array.isArray(r) ? r : (r as { result: string[] }).result) as string[];
  };

  // The component hashes the call into its id, so this is computable up front
  // and the same inputs always resolve to the same transaction.
  const [id] = await view(
    "hash_transaction",
    CallData.compile([registry, selector, calldata, salt]),
  );
  const transactionId = id!;

  const signers = availableSigners(config);
  const quorum = Number(BigInt((await view("get_quorum", []))[0]!));

  const state = () => view("get_transaction_state", [transactionId]).then((s) => Number(BigInt(s[0]!)));
  const accountFor = (s: MultisigSigner) =>
    new Account({ provider, address: s.address, signer: s.privateKey, cairoVersion: "1" });

  const send = async (
    signer: MultisigSigner,
    fn: string,
    data: string[],
  ): Promise<string> => {
    const tx = await accountFor(signer).execute({
      contractAddress: multisig,
      entrypoint: fn,
      calldata: data,
    });
    const receipt = await provider.waitForTransaction(tx.transaction_hash);
    if ((receipt as { execution_status?: string }).execution_status === "REVERTED") {
      throw new Error(
        `${fn} REVERTED: ${(receipt as { revert_reason?: string }).revert_reason ?? "(no reason)"}`,
      );
    }
    return tx.transaction_hash;
  };

  const eligible = signers.filter((s) => s.address);
  if (eligible.length < quorum) throw new NotEnoughSignersError(quorum, eligible.length);

  let current = await state();
  if (current === STATE.Executed) {
    log(`    ${entrypoint} already executed through the multisig`);
    return transactionId;
  }

  if (current === STATE.NotFound) {
    const submitter = eligible[0]!;
    log(`    submitting as ${submitter.label}`);
    await send(
      submitter,
      "submit_transaction",
      CallData.compile([registry, selector, calldata, salt]),
    );
    current = await state();
  } else {
    log(`    already submitted`);
  }

  // Confirm until the component says Confirmed. Each signer's own confirmation
  // is idempotent-by-refusal — the component rejects a second one — so this
  // checks before sending rather than catching after.
  for (const signer of eligible) {
    if ((await state()) >= STATE.Confirmed) break;
    const already = Number(
      BigInt((await view("is_confirmed_by", [transactionId, signer.address]))[0]!),
    );
    if (already === 1) {
      log(`    ${signer.label} already confirmed`);
      continue;
    }
    log(`    confirming as ${signer.label}`);
    await send(signer, "confirm_transaction", [transactionId]);
  }

  if ((await state()) < STATE.Confirmed) {
    throw new NotEnoughSignersError(quorum, eligible.length);
  }

  log(`    executing`);
  return send(
    eligible[0]!,
    "execute_transaction",
    CallData.compile([registry, selector, calldata, salt]),
  );
}

/** Where the multisig lives on this network, if the registry is governed by one. */
export function multisigAddress(config: TallyConfig): string | undefined {
  const suffix = config.network === "sepolia" ? "_SEPOLIA" : "";
  return process.env[`APERTURE_MULTISIG_ADDRESS${suffix}`] || undefined;
}

export { num };
