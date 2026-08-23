/**
 * Publishing the aggregate.
 *
 * An ordinary contract call — the registry is public and needs no proof. The
 * only thing that reaches the chain is three numbers; every ballot behind them
 * stays inside the tally process.
 *
 * The registry enforces the rules independently (operator only, window closed,
 * once). Nothing here is load-bearing for correctness.
 */

import { Account, CallData, RpcProvider } from "starknet";
import { U128_MAX, U64_MAX, assertFits } from "@aperture/strk20-governance";
import type { TallyResult } from "@aperture/strk20-governance";
import type { TallyConfig } from "./config.ts";
import type { ProposalWindow } from "./registry.ts";
import type { TallyRun } from "./tally.ts";

export interface FinalizeReceipt {
  transactionHash: string;
}

/**
 * How a published tally was produced. The discriminants are the Cairo enum's
 * variant indices and reordering them is a consensus change.
 */
export const PROVENANCE = {
  /** Variant 0. What an unwritten slot reads as; `finalize` rejects it. */
  unset: 0,
  /** Summed from notes actually discovered at the ballot identities. */
  ballotDerived: 1,
  /** Entered by the operator. No ballot produced it. */
  operatorAsserted: 2,
} as const;

export type Provenance = "ballot-derived" | "operator-asserted";

export class PinMismatchError extends Error {
  constructor(counted: number, endBlock: number) {
    super(
      `This count was pinned to block ${counted}, but the proposal closes at ` +
        `${endBlock}. v2 requires them to be equal — it is the only height at ` +
        `which every in-window ballot exists and no later one does. Refusing to ` +
        `submit: the contract would reject this, after gas.`,
    );
    this.name = "PinMismatchError";
  }
}

/**
 * Publish the aggregate.
 *
 * Takes the whole `TallyRun` rather than a bare `TallyResult` so that calling
 * this without the pin the run actually used is unrepresentable. The Cairo
 * asserts the pin equals `end_block`; checking it here first turns a paid
 * revert into a free error.
 */
export async function finalizeProposal(
  run: TallyRun,
  proposal: ProposalWindow,
  provenance: Provenance,
  config: TallyConfig,
): Promise<FinalizeReceipt> {
  const tally = run.tally;
  if (run.blockNumber !== proposal.endBlock) {
    throw new PinMismatchError(run.blockNumber, proposal.endBlock);
  }
  const provider = new RpcProvider({ nodeUrl: config.rpcUrl });
  const account = new Account({
    provider,
    address: config.operatorAddress,
    signer: config.operatorPrivateKey,
    cairoVersion: "1",
  });

  // Tally is a struct of three u128s; serialized in declaration order.
  // Bound before compiling. The Cairo struct is three u128 and the id is u64;
  // a value past those becomes a felt the deserializer rejects on-chain, after
  // gas, with a message that names nothing.
  assertFits("proposalId", tally.proposalId, U64_MAX);
  assertFits("forWeight", tally.forWeight, U128_MAX);
  assertFits("againstWeight", tally.againstWeight, U128_MAX);
  assertFits("abstainWeight", tally.abstainWeight, U128_MAX);

  const calldata = CallData.compile([
    tally.proposalId.toString(),
    tally.forWeight.toString(),
    tally.againstWeight.toString(),
    tally.abstainWeight.toString(),
    // The block this count was pinned to. Asserted equal to end_block on chain.
    run.blockNumber.toString(),
    // Stated, never defaulted: `Unset` is rejected, so a caller that forgot
    // this cannot quietly publish the weaker claim as the stronger one.
    String(
      provenance === "ballot-derived"
        ? PROVENANCE.ballotDerived
        : PROVENANCE.operatorAsserted,
    ),
  ]);

  const { transaction_hash } = await account.execute({
    contractAddress: config.registryAddress,
    entrypoint: "finalize",
    calldata,
  });

  await provider.waitForTransaction(transaction_hash);
  return { transactionHash: transaction_hash };
}
