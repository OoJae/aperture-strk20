/**
 * Tally worker configuration.
 *
 * The indexer URL is configuration rather than a constant on purpose. No
 * discovery endpoint has been published for either network, and the ones that
 * work today are undocumented infrastructure — so the operator chooses, and
 * nothing about that choice is baked into this repository.
 */

import { assertValidViewingKey } from "@aperture/strk20-governance";

export interface TallyConfig {
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

const REQUIRED = [
  "STARKNET_RPC_URL",
  "STRK20_POOL_ADDRESS",
  "APERTURE_REGISTRY_ADDRESS",
  "INDEXER_URL",
  "BALLOT_ACCOUNT_CLASS_HASH",
  "DAO_MASTER_PUBLIC_KEY",
  "DAO_MASTER_SECRET",
  "TALLY_OPERATOR_ADDRESS",
  "TALLY_OPERATOR_PRIVATE_KEY",
] as const;

function toBigInt(name: string, raw: string): bigint {
  try {
    return BigInt(raw);
  } catch {
    throw new TypeError(`${name} must parse as a BigInt (got "${raw}")`);
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): TallyConfig {
  const missing = REQUIRED.filter((name) => !env[name]);
  if (missing.length > 0) throw new MissingConfigError(missing);

  const daoMasterSecret = toBigInt("DAO_MASTER_SECRET", env.DAO_MASTER_SECRET!);
  // Fail here rather than after a scan silently returns nothing.
  assertValidViewingKey(daoMasterSecret);

  return {
    rpcUrl: env.STARKNET_RPC_URL!,
    poolAddress: env.STRK20_POOL_ADDRESS!,
    registryAddress: env.APERTURE_REGISTRY_ADDRESS!,
    indexerUrl: env.INDEXER_URL!,
    ballotAccountClassHash: env.BALLOT_ACCOUNT_CLASS_HASH!,
    daoMasterPublicKey: env.DAO_MASTER_PUBLIC_KEY!,
    daoMasterSecret,
    operatorAddress: env.TALLY_OPERATOR_ADDRESS!,
    operatorPrivateKey: env.TALLY_OPERATOR_PRIVATE_KEY!,
  };
}
