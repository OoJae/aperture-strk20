/**
 * Reading Aperture's state from the browser.
 *
 * Everything here is a public read against keyless RPC. That is deliberate: the
 * app is a static bundle, so any key placed here would ship to every visitor.
 * It also means someone can open the demo with no wallet, no extension, and no
 * account and still see real contract state.
 *
 * Addresses come from the shared package, never from literals in this file.
 * When they lived here, four other files carried their own copies and the set
 * drifted.
 */

import { RpcProvider, num, shortString } from "starknet";
import { ACTIVE, DEPLOYMENTS, ballotDomain } from "@oojae/strk20-governance";

export const DEPLOYMENT = DEPLOYMENTS[ACTIVE];

export const REGISTRY_ADDRESS = DEPLOYMENT.registry;
export const ANONYMIZER_ADDRESS = DEPLOYMENT.anonymizer;
export const POOL_ADDRESS = DEPLOYMENT.pool;
export const STRK_TOKEN = DEPLOYMENT.strkToken;
export const VOYAGER = DEPLOYMENT.explorer;

/**
 * The domain this network's ballot addresses derive from.
 *
 * Computed here from three public facts — which chain, which registry, which
 * epoch — rather than read from the contract, because that is the check: a
 * voter who recomputes it and gets the registry's answer has verified the
 * derivation instead of being told it.
 *
 * `null` for a deployment that predates the domain. v1 bound neither chain nor
 * registry into its salt, which is why mainnet and Sepolia published the same
 * ballot address for the same proposal.
 */
export const BALLOT_DOMAIN =
  DEPLOYMENT.epoch === null
    ? null
    : ballotDomain(
        num.toHex(BigInt(shortString.encodeShortString(DEPLOYMENT.chainId))),
        DEPLOYMENT.registry,
        num.toHex(BigInt(shortString.encodeShortString(DEPLOYMENT.epoch))),
      );

export const BALLOT_CONFIG = {
  ballotAccountClassHash: DEPLOYMENT.ballotAccountClassHash,
  daoMasterPublicKey: DEPLOYMENT.daoMasterPublicKey,
  domain: BALLOT_DOMAIN ?? "0x0",
};

const RPC_TIMEOUT_MS = 12_000;

/**
 * One provider per endpoint, not one per call. The previous version constructed
 * a fresh RpcProvider inside every read, which meant roughly eight of them on a
 * single page load.
 */
const providers = new Map<string, RpcProvider>();

function providerFor(url: string): RpcProvider {
  let cached = providers.get(url);
  if (!cached) {
    cached = new RpcProvider({
      nodeUrl: url,
      // A real cancellation. Without a signal a stalled endpoint hangs the read
      // forever and the page sits on "Reading mainnet…" with no way out.
      baseFetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(RPC_TIMEOUT_MS) }),
    });
    providers.set(url, cached);
  }
  return cached;
}

/** Every endpoint failed. Carries what was tried, so the UI can say. */
export class RpcUnavailableError extends Error {
  constructor(readonly attempts: readonly { url: string; reason: string }[]) {
    super(
      `Could not reach ${DEPLOYMENT.label}. Tried ${attempts.length} endpoint(s): ` +
        attempts.map((a) => `${new URL(a.url).host} (${a.reason})`).join(", "),
    );
    this.name = "RpcUnavailableError";
  }
}

/**
 * Run a read against each endpoint in turn. A single free RPC rate-limiting
 * during judging is a real failure mode, and the app has no key to fall back on.
 */
export async function readChain<T>(fn: (p: RpcProvider) => Promise<T>): Promise<T> {
  const attempts: { url: string; reason: string }[] = [];
  for (const url of DEPLOYMENT.rpcUrls) {
    try {
      return await fn(providerFor(url));
    } catch (error) {
      attempts.push({ url, reason: error instanceof Error ? error.message : "unknown" });
    }
  }
  throw new RpcUnavailableError(attempts);
}

/** Kept for the wallet path, which needs a provider instance rather than a read. */
export function provider(): RpcProvider {
  return providerFor(DEPLOYMENT.rpcUrls[0]!);
}

function toBigInt(value: unknown): bigint {
  return BigInt(value as string);
}

async function callContract(
  contractAddress: string,
  entrypoint: string,
  calldata: string[] = [],
): Promise<string[]> {
  return readChain(async (p) => {
    const result = await p.callContract({ contractAddress, entrypoint, calldata });
    return (Array.isArray(result) ? result : (result as { result: string[] }).result) as string[];
  });
}

const callRegistry = (entrypoint: string, calldata: string[] = []) =>
  callContract(REGISTRY_ADDRESS, entrypoint, calldata);

export interface Proposal {
  id: bigint;
  proposer: string;
  metadataUri: string;
  startBlock: bigint;
  endBlock: bigint;
  finalized: boolean;
  // v2 appended these, so the indices above keep their meaning and a client
  // reading a v1 registry gets zeroes rather than misaligned fields.
  quorum: bigint;
  payoutToken: string;
  payoutCap: bigint;
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
    quorum: raw[5] === undefined ? 0n : toBigInt(raw[5]),
    payoutToken: raw[6] ?? "0x0",
    payoutCap: raw[7] === undefined ? 0n : toBigInt(raw[7]),
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

/**
 * The contract's own verdict, rather than the client's recomputation of it.
 * The page shows both: if they disagree, that is worth seeing.
 */
export async function hasPassed(id: bigint): Promise<boolean> {
  const [passed] = await callRegistry("has_passed", [id.toString()]);
  return toBigInt(passed) === 1n;
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

/**
 * Whether a contract exists at an address.
 *
 * This is the question the ballot-identity table was never asking. It compared
 * two derivations of the same address and called agreement a "match", which is
 * true and almost meaningless — both sides derive from the same public inputs,
 * so they agree on every network whether or not anything is deployed.
 */
export async function isDeployed(address: string): Promise<boolean> {
  try {
    await readChain((p) => p.getClassHashAt(address, "latest"));
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether the pool holds a viewing key for this address. Without one, a private
 * transfer to it cannot be read by anybody, including its owner.
 */
export async function isRegisteredWithPool(address: string): Promise<boolean> {
  try {
    const [key] = await callContract(POOL_ADDRESS, "get_public_key", [address]);
    return toBigInt(key) !== 0n;
  } catch {
    return false;
  }
}

export async function getBlockNumber(): Promise<number> {
  return readChain((p) => p.getBlockNumber());
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

/**
 * The anonymizer's payout domain.
 *
 * Read from the contract rather than recomputed, because a commitment built
 * against the wrong domain still *registers* — the contract stores whatever
 * hash it is handed — and then can never be claimed. Getting this from the
 * contract that will check it is the only safe direction.
 */
export async function getPayoutDomain(): Promise<string> {
  const [domain] = await callContract(ANONYMIZER_ADDRESS, "get_payout_domain", []);
  if (!domain || BigInt(domain) === 0n) {
    throw new Error(
      "The anonymizer returned an empty payout domain. Either it is not an " +
        "Aperture anonymizer, or it predates v2 and cannot be used with this app.",
    );
  }
  return domain;
}
