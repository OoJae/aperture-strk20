/**
 * Tally worker configuration.
 *
 * The network is chosen explicitly and everything chain-shaped is derived from
 * it. An earlier version read the RPC URL from one variable while the registry
 * and pool addresses came from others, so nothing stopped the worker from
 * reading a Sepolia registry over a mainnet RPC — it would simply report that a
 * proposal did not exist. Selecting by network makes that combination
 * unrepresentable rather than merely unlikely.
 *
 * Two changes here matter more than the rest:
 *
 * 1. **The master secret is gone as a single value.** It used to do four jobs —
 *    seed every ballot viewing key, sign for every ballot account, and act as
 *    the pool viewing key on two separate paths — and two of those jobs hand it
 *    to a third-party indexer in cleartext. One scalar with that blast radius is
 *    not a key, it is an incident waiting for a reason. The four roles are now
 *    four variables, and the loader refuses to start if any two are equal.
 * 2. **Nothing secret reaches an error message.** The old parser interpolated
 *    the raw value into a TypeError, so a stray newline in the master secret
 *    printed it to stderr.
 */

import { ec } from "starknet";
import { assertValidViewingKey } from "@aperture/strk20-governance";
import { ENV_SPEC, requiredFor, type EnvVarSpec } from "./env-spec.ts";

export type Network = "mainnet" | "sepolia";

export interface TallyConfig {
  network: Network;
  rpcUrl: string;
  poolAddress: string;
  registryAddress: string;
  anonymizerAddress?: string;
  strkTokenAddress: string;
  /** Discovery service. Validated as an absolute URL, https on mainnet. */
  indexerUrl: string;
  provingServiceUrl: string;
  ballotAccountClassHash: string;
  daoMasterPublicKey: string;

  /** Seeds every per-ballot viewing key. Never sent anywhere. */
  ballotViewingSeed: bigint;
  /** Signs for every ballot identity account. The private half of daoMasterPublicKey. */
  ballotAccountPrivateKey: string;
  /** The voter's own pool viewing key. Disclosed to the indexer in cleartext. */
  voterViewingKey?: bigint;
  /** The operator's pool viewing key. Disclosed to the indexer in cleartext. */
  operatorViewingKey?: bigint;

  operatorAddress: string;
  operatorPrivateKey: string;
}

export class MissingConfigError extends Error {
  constructor(missing: readonly EnvVarSpec[], network: Network) {
    const lines = missing.map((v) => `  ${v.name.padEnd(34)} ${v.description}`);
    super(
      `Missing required environment variables for network "${network}":\n\n` +
        `${lines.join("\n")}\n\n` +
        `All of these appear in .env.example with descriptions. If it looks ` +
        `out of date, regenerate it:\n  node scripts/sync-env-example.ts`,
    );
    this.name = "MissingConfigError";
  }
}

const NETWORK_VARS: Record<Network, { rpc: readonly string[]; pool: string }> = {
  mainnet: {
    rpc: ["STARKNET_RPC_URL_SNCAST", "STARKNET_RPC_URL"],
    pool: "STRK20_POOL_ADDRESS",
  },
  sepolia: {
    rpc: ["STARKNET_RPC_URL_SEPOLIA_SNCAST", "STARKNET_RPC_URL_SEPOLIA"],
    pool: "STRK20_POOL_ADDRESS_SEPOLIA",
  },
};

/** Never interpolates the value: this parses secrets. */
function toBigInt(name: string, raw: string): bigint {
  try {
    const value = BigInt(raw);
    if (value <= 0n) throw new RangeError(`${name} must be positive`);
    return value;
  } catch (error) {
    if (error instanceof RangeError) throw error;
    throw new TypeError(
      `${name} must parse as a BigInt. Its value is not shown here because it is a secret.`,
    );
  }
}

function parseNetwork(raw: string | undefined): Network {
  if (!raw) {
    throw new TypeError(
      'APERTURE_NETWORK is required and has no default. Set it to "mainnet" or "sepolia".',
    );
  }
  const value = raw.toLowerCase();
  if (value !== "mainnet" && value !== "sepolia") {
    throw new TypeError(`APERTURE_NETWORK must be "mainnet" or "sepolia" (got "${raw}")`);
  }
  return value;
}

/**
 * A service URL, checked at load rather than at the first request.
 *
 * The indexer receives a viewing key in the request body, so http on mainnet is
 * not a style preference. A base path is rejected because `new URL(path, base)`
 * silently discards it — `https://host/api` would become `https://host/v1/...`
 * and the operator would be debugging an endpoint they never configured.
 */
function parseServiceUrl(name: string, raw: string, network: Network): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new TypeError(`${name} must be an absolute URL including a scheme (got "${raw}")`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new TypeError(`${name} must be http: or https: (got "${url.protocol}")`);
  }
  if (url.protocol === "http:" && network === "mainnet") {
    throw new TypeError(
      `${name} must be https: on mainnet — it receives a viewing key in cleartext.`,
    );
  }
  if (url.search || url.hash) {
    throw new TypeError(`${name} must not carry a query string or fragment`);
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new TypeError(
      `${name} must not carry a base path (got "${url.pathname}"); it would be silently dropped.`,
    );
  }
  return url.origin;
}

/**
 * The ballot accounts are deployed at addresses derived from
 * DAO_MASTER_PUBLIC_KEY. If the signing key is not its private half they cannot
 * sign, and the symptom is a rejected transaction rather than anything naming
 * the cause.
 */
function assertKeyPair(privateKey: string, publicKey: string): void {
  let derived: string;
  try {
    derived = ec.starkCurve.getStarkKey(privateKey);
  } catch {
    throw new TypeError(
      "DAO_BALLOT_ACCOUNT_PRIVATE_KEY is not a valid STARK private key. " +
        "Its value is not shown here because it is a secret.",
    );
  }
  if (BigInt(derived) !== BigInt(publicKey)) {
    throw new TypeError(
      "DAO_BALLOT_ACCOUNT_PRIVATE_KEY is not the private half of " +
        "DAO_MASTER_PUBLIC_KEY. Ballot identities derive their addresses from " +
        "the public key, so with this pair they could never sign.",
    );
  }
}

/**
 * Four roles must be four keys.
 *
 * Pasting one value into every field reproduces exactly the blast radius this
 * split exists to remove, and it would do so silently.
 */
function assertDistinct(roles: Record<string, bigint | undefined>): void {
  const seen = new Map<bigint, string>();
  for (const [name, value] of Object.entries(roles)) {
    if (value === undefined) continue;
    const prior = seen.get(value);
    if (prior) {
      throw new TypeError(
        `${name} and ${prior} must be different keys. They do different jobs, ` +
          `and two of those jobs disclose the key to the indexer in cleartext.`,
      );
    }
    seen.set(value, name);
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): TallyConfig {
  const network = parseNetwork(env.APERTURE_NETWORK);
  const vars = NETWORK_VARS[network];

  const rpcVar = vars.rpc.find((name) => env[name]);

  // Derived from the spec so there is exactly one list of required names.
  const missing = requiredFor(network).filter((spec) => {
    if (vars.rpc.includes(spec.name)) return false;
    if (spec.name === vars.pool) return !env[spec.name];
    if (spec.name.startsWith("STRK20_POOL_ADDRESS")) return false;
    return !env[spec.name];
  });
  if (!rpcVar) {
    missing.push({
      name: vars.rpc.join(" or "),
      requirement: network,
      secret: false,
      group: "RPC",
      description: `RPC endpoint for ${network}.`,
    });
  }
  if (missing.length > 0) throw new MissingConfigError(missing, network);

  const ballotViewingSeed = toBigInt("DAO_BALLOT_VIEWING_SEED", env.DAO_BALLOT_VIEWING_SEED!);
  assertValidViewingKey(ballotViewingSeed);

  const ballotAccountPrivateKey = env.DAO_BALLOT_ACCOUNT_PRIVATE_KEY!;
  const daoMasterPublicKey = env.DAO_MASTER_PUBLIC_KEY!;
  assertKeyPair(ballotAccountPrivateKey, daoMasterPublicKey);

  const voterViewingKey = env.VOTER_VIEWING_KEY
    ? toBigInt("VOTER_VIEWING_KEY", env.VOTER_VIEWING_KEY)
    : undefined;
  const operatorViewingKey = env.TALLY_OPERATOR_VIEWING_KEY
    ? toBigInt("TALLY_OPERATOR_VIEWING_KEY", env.TALLY_OPERATOR_VIEWING_KEY)
    : undefined;
  if (voterViewingKey !== undefined) assertValidViewingKey(voterViewingKey);
  if (operatorViewingKey !== undefined) assertValidViewingKey(operatorViewingKey);

  assertDistinct({
    DAO_BALLOT_VIEWING_SEED: ballotViewingSeed,
    VOTER_VIEWING_KEY: voterViewingKey,
    TALLY_OPERATOR_VIEWING_KEY: operatorViewingKey,
  });

  return {
    network,
    rpcUrl: env[rpcVar!]!,
    poolAddress: env[vars.pool]!,
    registryAddress: env.APERTURE_REGISTRY_ADDRESS!,
    anonymizerAddress: env.APERTURE_ANONYMIZER_ADDRESS,
    strkTokenAddress: env.STRK_TOKEN_ADDRESS!,
    indexerUrl: parseServiceUrl("INDEXER_URL", env.INDEXER_URL!, network),
    provingServiceUrl: parseServiceUrl("PROVING_SERVICE_URL", env.PROVING_SERVICE_URL!, network),
    ballotAccountClassHash: env.BALLOT_ACCOUNT_CLASS_HASH!,
    daoMasterPublicKey,
    ballotViewingSeed,
    ballotAccountPrivateKey,
    voterViewingKey,
    operatorViewingKey,
    operatorAddress: env.TALLY_OPERATOR_ADDRESS!,
    operatorPrivateKey: env.TALLY_OPERATOR_PRIVATE_KEY!,
  };
}

export { ENV_SPEC } from "./env-spec.ts";
