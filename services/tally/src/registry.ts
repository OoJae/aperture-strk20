/**
 * Reading the registry.
 *
 * The tally worker never did this. It counted every note a ballot identity had
 * ever received, with no reference to the proposal's voting window — which is
 * stored on-chain, two fields away from the id it was already using. So a
 * ballot cast a month early or a month late counted the same as one cast during
 * the vote, and the operator's choice of when to run the worker decided which
 * notes were in scope.
 */

import { RpcProvider } from "starknet";

export interface ProposalWindow {
  proposer: string;
  metadataUri: string;
  startBlock: number;
  endBlock: number;
  finalized: boolean;
}

export class ProposalNotFoundError extends Error {
  constructor(proposalId: bigint, registry: string) {
    super(`Proposal ${proposalId} does not exist at registry ${registry}.`);
    this.name = "ProposalNotFoundError";
  }
}

/** Field order matches `Proposal` in contracts/src/proposal_registry.cairo. */
export async function readProposal(
  provider: RpcProvider,
  registryAddress: string,
  proposalId: bigint,
): Promise<ProposalWindow> {
  const result = await provider.callContract({
    contractAddress: registryAddress,
    entrypoint: "get_proposal",
    calldata: [proposalId.toString()],
  });
  const raw = (Array.isArray(result) ? result : (result as { result: string[] }).result) as string[];

  const proposer = raw[0]!;
  // A proposal that was never created reads back as a zeroed struct rather than
  // reverting, so an absent proposer is how "not found" presents.
  if (BigInt(proposer) === 0n) throw new ProposalNotFoundError(proposalId, registryAddress);

  return {
    proposer,
    metadataUri: raw[1]!,
    startBlock: Number(BigInt(raw[2]!)),
    endBlock: Number(BigInt(raw[3]!)),
    finalized: BigInt(raw[4]!) === 1n,
  };
}
