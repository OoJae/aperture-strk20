/**
 * Tally worker.
 *
 * Runs server-side because it holds the DAO viewing key. Reads the ballot notes
 * for each choice, sums them, and posts only the aggregate on-chain.
 *
 * Phase 0 is a scaffold: it asserts its configuration and exits. The note
 * discovery and refund queue land in Phase 3.
 */

/** Configuration this worker needs before it can do anything. */
export interface TallyConfig {
  rpcUrl: string;
  poolAddress: string;
  indexerUrl: string;
  provingServiceUrl: string;
  /**
   * Parsed as a BigInt. A hex string compiles fine and then silently derives
   * the wrong channel keys, so notes never decrypt — validate, don't assume.
   */
  viewingKey: bigint;
}

class MissingConfigError extends Error {
  constructor(names: readonly string[]) {
    super(`Missing required environment variables: ${names.join(", ")}`);
    this.name = "MissingConfigError";
  }
}

const REQUIRED = [
  "STARKNET_RPC_URL",
  "STRK20_POOL_ADDRESS",
  "INDEXER_URL",
  "PROVING_SERVICE_URL",
  "DAO_VIEWING_KEY",
] as const;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): TallyConfig {
  const missing = REQUIRED.filter((name) => !env[name]);
  if (missing.length > 0) throw new MissingConfigError(missing);

  return {
    rpcUrl: env.STARKNET_RPC_URL!,
    poolAddress: env.STRK20_POOL_ADDRESS!,
    indexerUrl: env.INDEXER_URL!,
    provingServiceUrl: env.PROVING_SERVICE_URL!,
    viewingKey: BigInt(env.DAO_VIEWING_KEY!),
  };
}
