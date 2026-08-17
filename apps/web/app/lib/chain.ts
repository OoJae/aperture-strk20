/**
 * Reading Aperture's mainnet state from the browser.
 *
 * Everything here is a public read against a keyless RPC. That is deliberate:
 * the app is a static bundle, so any key placed here would ship to every
 * visitor. It also means someone can open the demo with no wallet, no
 * extension, and no account and still see the real contract state.
 */

import { RpcProvider } from "starknet";

/** Deployed 2026-08-17. See docs/DEPLOYMENTS.md. */
export const REGISTRY_ADDRESS =
  "0x0371e11c7cae61bc2fd5ce6b75153d59746ecf2d88b286be6ebe9c7c001e330c";

export const ANONYMIZER_ADDRESS =
  "0x05cc31d13d5901347d009f70f59abacb22b76e84963286004b67bf4644546890";

export const POOL_ADDRESS =
  "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";

/** The ballot config the mainnet registry was constructed with. */
export const BALLOT_CONFIG = {
  ballotAccountClassHash:
    "0x5b4b537eaa2399e3aa99c4e2e0208ebd6c71bc1467938cd52c798c601e43564",
  daoMasterPublicKey:
    "0x660a41ee3edd08bd84276775ea1bed419f38ed8fe7bf4c07b522c3513a73e42",
};

/** Keyless public endpoint — nothing secret can be embedded in a static bundle. */
const RPC_URL = "https://starknet-rpc.publicnode.com";

export const VOYAGER = "https://voyager.online";

export function provider(): RpcProvider {
  return new RpcProvider({ nodeUrl: RPC_URL });
}

function toBigInt(value: unknown): bigint {
  return BigInt(value as string);
}

async function callRegistry(
  entrypoint: string,
  calldata: string[] = [],
): Promise<string[]> {
  const result = await provider().callContract({
    contractAddress: REGISTRY_ADDRESS,
    entrypoint,
    calldata,
  });
  return (Array.isArray(result) ? result : (result as { result: string[] }).result) as string[];
}

export interface Proposal {
  id: bigint;
  proposer: string;
  metadataUri: string;
  startBlock: bigint;
  endBlock: bigint;
  finalized: boolean;
}

export interface Tally {
  forWeight: bigint;
  againstWeight: bigint;
  abstainWeight: bigint;
}

export async function getProposalCount(): Promise<bigint> {
  const [count] = await callRegistry("proposal_count");
  return toBigInt(count);
}

export async function getProposal(id: bigint): Promise<Proposal> {
  const raw = await callRegistry("get_proposal", [id.toString()]);
  return {
    id,
    proposer: raw[0]!,
    metadataUri: raw[1]!,
    startBlock: toBigInt(raw[2]),
    endBlock: toBigInt(raw[3]),
    finalized: toBigInt(raw[4]) === 1n,
  };
}

export async function getTally(id: bigint): Promise<Tally> {
  const raw = await callRegistry("get_tally", [id.toString()]);
  return {
    forWeight: toBigInt(raw[0]),
    againstWeight: toBigInt(raw[1]),
    abstainWeight: toBigInt(raw[2]),
  };
}

/** The registry's own derivation, for comparison against the client's. */
export async function getBallotAddressOnChain(
  id: bigint,
  choiceIndex: number,
): Promise<string> {
  const [address] = await callRegistry("ballot_address", [
    id.toString(),
    choiceIndex.toString(),
  ]);
  return address!;
}

export async function getBlockNumber(): Promise<number> {
  return provider().getBlockNumber();
}

/** Short-string felt (e.g. a metadata pointer) back to text, best effort. */
export function decodeShortString(felt: string): string {
  try {
    const hex = BigInt(felt).toString(16);
    const padded = hex.length % 2 ? `0${hex}` : hex;
    const text = (padded.match(/.{2}/g) ?? [])
      .map((byte) => String.fromCharCode(parseInt(byte, 16)))
      .join("");
    return /^[\x20-\x7e]*$/.test(text) && text.length > 0 ? text : felt;
  } catch {
    return felt;
  }
}

export function shortHex(value: string, lead = 6, tail = 4): string {
  const hex = value.startsWith("0x") ? value : `0x${value}`;
  return hex.length <= lead + tail + 2
    ? hex
    : `${hex.slice(0, lead + 2)}…${hex.slice(-tail)}`;
}
