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
import type { TallyResult } from "@aperture/strk20-governance";
import type { TallyConfig } from "./config.ts";

export interface FinalizeReceipt {
  transactionHash: string;
}

export async function finalizeProposal(
  tally: TallyResult,
  config: TallyConfig,
): Promise<FinalizeReceipt> {
  const provider = new RpcProvider({ nodeUrl: config.rpcUrl });
  const account = new Account({
    provider,
    address: config.operatorAddress,
    signer: config.operatorPrivateKey,
    cairoVersion: "1",
  });

  // Tally is a struct of three u128s; serialized in declaration order.
  const calldata = CallData.compile([
    tally.proposalId.toString(),
    tally.forWeight.toString(),
    tally.againstWeight.toString(),
    tally.abstainWeight.toString(),
  ]);

  const { transaction_hash } = await account.execute({
    contractAddress: config.registryAddress,
    entrypoint: "finalize",
    calldata,
  });

  await provider.waitForTransaction(transaction_hash);
  return { transactionHash: transaction_hash };
}
