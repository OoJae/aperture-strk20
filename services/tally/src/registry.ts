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
  // v2 appended these, so indices 0..4 above keep their meaning.
  quorum: bigint;
  payoutToken: string;
  payoutCap: bigint;
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
    quorum: BigInt(raw[5] ?? 0),
    payoutToken: raw[6] ?? "0x0",
    payoutCap: BigInt(raw[7] ?? 0),
  };
}

/**
 * The registry's domain separator.
 *
 * Read from the chain rather than recomputed locally, on purpose: the registry
 * derives it from its own address, so asking it is the one way to be sure the
 * value matches the contract that will publish the ballot addresses. Deriving
 * it independently is what a *voter* should do, to check the answer.
 */
export async function readBallotDomain(
  provider: RpcProvider,
  registryAddress: string,
): Promise<string> {
  const result = await provider.callContract({
    contractAddress: registryAddress,
    entrypoint: "ballot_domain",
    calldata: [],
  });
  const raw = (Array.isArray(result) ? result : (result as { result: string[] }).result) as string[];
  const domain = raw[0];
  if (!domain || BigInt(domain) === 0n) {
    throw new Error(
      `Registry ${registryAddress} returned an empty ballot domain. Either it is not ` +
        `an Aperture registry, or it predates v2 and cannot be used with this worker.`,
    );
  }
  return domain;
}
