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
 * The indexer URL is configuration rather than a constant on purpose. No
 * discovery endpoint has been published for either network, so the operator
 * chooses, and nothing about that choice is baked into this repository.
 */

import { assertValidViewingKey } from "@aperture/strk20-governance";

export type Network = "mainnet" | "sepolia";

export interface TallyConfig {
  network: Network;
  rpcUrl: string;
  poolAddress: string;
  registryAddress: string;
  /** Discovery service. No default: guessing an endpoint fails in ways that look like our bug. */
  indexerUrl: string;
  ballotAccountClassHash: string;
  daoMasterPublicKey: string;
  /**
   * Secret the per-ballot viewing keys derive from. Parsed as a BigInt because
   * a hex string silently derives the wrong channel keys.
   */
  daoMasterSecret: bigint;
  /** Account that posts the aggregate on-chain. */
  operatorAddress: string;
  operatorPrivateKey: string;
}

export class MissingConfigError extends Error {
  constructor(names: readonly string[]) {
    super(
      `Missing required environment variables: ${names.join(", ")}\n` +
        `Copy .env.example to .env and fill them in.`,
    );
    this.name = "MissingConfigError";
  }
}

/** Variables needed whichever network is selected. */
const REQUIRED_COMMON = [
  "APERTURE_REGISTRY_ADDRESS",
  "INDEXER_URL",
  "BALLOT_ACCOUNT_CLASS_HASH",
  "DAO_MASTER_PUBLIC_KEY",
  "DAO_MASTER_SECRET",
  "TALLY_OPERATOR_ADDRESS",
  "TALLY_OPERATOR_PRIVATE_KEY",
] as const;

/**
 * Per-network RPC and pool.
 *
 * Sepolia deliberately prefers the explicitly versioned endpoint: several
 * providers still serve RPC spec 0.8.1 on their bare host, which cannot carry
 * the proof fields a pool transaction needs and fails with errors that point
 * nowhere near the cause.
 */
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

function toBigInt(name: string, raw: string): bigint {
  try {
    return BigInt(raw);
  } catch {
    throw new TypeError(`${name} must parse as a BigInt (got "${raw}")`);
  }
}

function parseNetwork(raw: string | undefined): Network {
  const value = (raw ?? "mainnet").toLowerCase();
  if (value !== "mainnet" && value !== "sepolia") {
    throw new TypeError(`APERTURE_NETWORK must be "mainnet" or "sepolia" (got "${raw}")`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): TallyConfig {
  const network = parseNetwork(env.APERTURE_NETWORK);
  const vars = NETWORK_VARS[network];

  const rpcVar = vars.rpc.find((name) => env[name]);
  const missing = [
    ...REQUIRED_COMMON.filter((name) => !env[name]),
    ...(rpcVar ? [] : [vars.rpc.join(" or ")]),
    ...(env[vars.pool] ? [] : [vars.pool]),
  ];
  if (missing.length > 0) throw new MissingConfigError(missing);

  const daoMasterSecret = toBigInt("DAO_MASTER_SECRET", env.DAO_MASTER_SECRET!);
  // Fail here rather than after a scan silently returns nothing.
  assertValidViewingKey(daoMasterSecret);

  return {
    network,
    rpcUrl: env[rpcVar!]!,
    poolAddress: env[vars.pool]!,
    registryAddress: env.APERTURE_REGISTRY_ADDRESS!,
    indexerUrl: env.INDEXER_URL!,
    ballotAccountClassHash: env.BALLOT_ACCOUNT_CLASS_HASH!,
    daoMasterPublicKey: env.DAO_MASTER_PUBLIC_KEY!,
    daoMasterSecret,
    operatorAddress: env.TALLY_OPERATOR_ADDRESS!,
    operatorPrivateKey: env.TALLY_OPERATOR_PRIVATE_KEY!,
  };
}
