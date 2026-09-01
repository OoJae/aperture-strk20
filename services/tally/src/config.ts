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
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertValidViewingKey, DEPLOYMENTS } from "@oojae/strk20-governance";
import { ENV_SPEC, requiredFor, type EnvVarSpec } from "./env-spec.ts";

/**
 * Fill `process.env` from the repo-root `.env`, for anything not already set.
 *
 * Nothing did this. Node does not read `.env` on its own, no entry point passed
 * `--env-file`, and no loader was imported — so every command in the README
 * ("node services/tally/src/index.ts 1") died on the first required variable.
 * Configuration that only works if you already know an undocumented flag is
 * configuration that does not work.
 *
 * It belongs here rather than in each script because this is the one module
 * every entry point already imports, so there is no entry point that can forget
 * it — and it runs on import rather than inside `loadConfig`, because
 * `cast-vote`, `register-ballots` and `payout-lifecycle` read `process.env`
 * directly for the proving and indexer URLs, before any config is loaded.
 *
 * Already-set variables win, so an explicit `export`, a `--env-file`, or CI
 * secrets all override the file rather than being overridden by it. A missing
 * file is silent: that is the normal case in CI.
 */
let dotEnvLoaded = false;
export function loadDotEnv(): void {
  if (dotEnvLoaded) return;
  dotEnvLoaded = true;
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const path = resolve(root, ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match || line.trimStart().startsWith("#")) continue;
    const [, key, rawValue] = match;
    if (key === undefined || key in process.env) continue;
    const value = rawValue!.trim().replace(/^(['"])(.*)\1$/, "$2");
    // A blank assignment is not a value, and setting one would shadow a real
    // assignment further down the file — which is exactly what happened when a
    // generator appended keys after the blank placeholders shipped in
    // .env.example. Skipping keeps "declared but empty" and "absent" the same
    // thing, which is how every caller already treats it.
    if (value === "") continue;
    process.env[key] = value;
  }
}

loadDotEnv();

export type Network = "mainnet" | "sepolia";

export interface TallyConfig {
  network: Network;
  rpcUrl: string;
  /**
   * Public endpoints to fall back to when `rpcUrl` is unreachable.
   *
   * Taken from the shared deployment record rather than the environment: a
   * transport failure on one provider should not end a run that spends money,
   * and the worker had no fallback at all until a public Sepolia endpoint
   * dropped twice inside one rehearsal.
   */
  rpcFallbacks: readonly string[];
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

  /**
   * The account that touches the POOL, which is not always the one that writes
   * to the registry.
   *
   * On Sepolia they are the same account and these fall back to the operator's
   * values. On mainnet they cannot be: the registry's `tally_operator` is fixed
   * at construction and can never change, while the pool binds an account to a
   * viewing key WRITE-ONCE. Our mainnet operator was registered with the pool
   * under a key that is not in any env file, so that account can never spend or
   * read a shielded note again — and no amount of configuration fixes it,
   * because the slot cannot be rewritten.
   *
   * Splitting the roles is the only way out, and it is also the more honest
   * model: writing a tally is an identity the contract names, while touching
   * the pool is whoever holds a registered viewing key.
   */
  poolActorAddress: string;
  poolActorPrivateKey: string;
  poolActorViewingKey?: bigint;
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

/**
 * Every variable whose correct value depends on the network.
 *
 * The accounts belong here for the same reason the RPC and pool addresses
 * always did. They were not, and switching to mainnet therefore meant
 * hand-editing key material — which produced exactly the failure you would
 * expect: a mainnet proposal signed by the Sepolia operator, refused with
 * "contract address is not deployed". A variable that means something different
 * per network needs the network in its name.
 */
const NETWORK_VARS: Record<
  Network,
  {
    rpc: readonly string[];
    pool: string;
    operatorAddress: string;
    operatorKey: string;
    poolActorAddress: string;
    poolActorKey: string;
    poolActorViewingKey: string;
    operatorViewingKey: string;
    /**
     * Per network, because these are the endpoints that decide which chain the
     * SDK is talking about. Pointing a mainnet pool address at Sepolia's
     * discovery service fails with "Contract not found at the configured
     * address", which reads like a wrong pool rather than a wrong indexer.
     */
    indexer: string;
    proving: string;
    /**
     * Our own contracts, per network — the third pair of variables to need this
     * after the accounts and the service URLs. Pointing a Sepolia network at a
     * mainnet registry fails with "Contract not found", which reads like a
     * broken RPC.
     */
    registry: string;
    anonymizer: string;
  }
> = {
  mainnet: {
    rpc: ["STARKNET_RPC_URL_SNCAST", "STARKNET_RPC_URL"],
    pool: "STRK20_POOL_ADDRESS",
    operatorAddress: "TALLY_OPERATOR_ADDRESS",
    operatorKey: "TALLY_OPERATOR_PRIVATE_KEY",
    poolActorAddress: "POOL_ACTOR_ADDRESS",
    poolActorKey: "POOL_ACTOR_PRIVATE_KEY",
    poolActorViewingKey: "POOL_ACTOR_VIEWING_KEY",
    operatorViewingKey: "TALLY_OPERATOR_VIEWING_KEY",
    indexer: "INDEXER_URL",
    proving: "PROVING_SERVICE_URL",
    registry: "APERTURE_REGISTRY_ADDRESS",
    anonymizer: "APERTURE_ANONYMIZER_ADDRESS",
  },
  sepolia: {
    rpc: ["STARKNET_RPC_URL_SEPOLIA_SNCAST", "STARKNET_RPC_URL_SEPOLIA"],
    pool: "STRK20_POOL_ADDRESS_SEPOLIA",
    operatorAddress: "TALLY_OPERATOR_ADDRESS_SEPOLIA",
    operatorKey: "TALLY_OPERATOR_PRIVATE_KEY_SEPOLIA",
    poolActorAddress: "POOL_ACTOR_ADDRESS_SEPOLIA",
    poolActorKey: "POOL_ACTOR_PRIVATE_KEY_SEPOLIA",
    poolActorViewingKey: "POOL_ACTOR_VIEWING_KEY_SEPOLIA",
    operatorViewingKey: "TALLY_OPERATOR_VIEWING_KEY_SEPOLIA",
    indexer: "INDEXER_URL_SEPOLIA",
    proving: "PROVING_SERVICE_URL_SEPOLIA",
    registry: "APERTURE_REGISTRY_ADDRESS_SEPOLIA",
    anonymizer: "APERTURE_ANONYMIZER_ADDRESS_SEPOLIA",
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
 * Report where the key roles are still sharing a value.
 *
 * This started life as a hard assert requiring all four roles to differ, which
 * was wrong in a way worth recording: a viewing key belongs to a pool *account*,
 * not to a job. `cast-vote` and `payout-lifecycle` both act as
 * `operatorAddress`, and the pool stores one key per address, so VOTER_ and
 * TALLY_OPERATOR_VIEWING_KEY are two names for one account's key and must be
 * equal until the voter is a separate account. The assert would have refused the
 * only configuration that works.
 *
 * What is genuinely dangerous is narrower: the seed that derives every ballot
 * viewing key should not also be a key handed to a third-party indexer. On this
 * deployment it is, unavoidably — the operator's registered pool key *is* that
 * scalar, and re-registering would strand the notes encrypted to it. v2
 * re-derives every ballot address and re-registers every viewing key, and that
 * is where the roles genuinely separate.
 *
 * So: warn, precisely, and say when it stops being true. Silence would let a
 * real future coupling pass unnoticed; a hard failure would be a lie about what
 * this deployment can express.
 */
function reportKeyCoupling(roles: Record<string, bigint | undefined>): void {
  const byValue = new Map<bigint, string[]>();
  for (const [name, value] of Object.entries(roles)) {
    if (value === undefined) continue;
    byValue.set(value, [...(byValue.get(value) ?? []), name]);
  }

  for (const names of byValue.values()) {
    if (names.length < 2) continue;

    // Two names for one pool account's key is correct, not a finding.
    const isSameAccountViewingKey =
      names.length === 2 &&
      names.includes("VOTER_VIEWING_KEY") &&
      names.includes("TALLY_OPERATOR_VIEWING_KEY");
    if (isSameAccountViewingKey) continue;

    console.warn(
      `[config] ${names.join(" and ")} hold the same value.\n` +
        `         Expected on this deployment: the ballot identities and the\n` +
        `         operator's pool registration were both created from one\n` +
        `         scalar, and changing either now would make existing notes\n` +
        `         unreadable. It does mean a key derived from the seed is also\n` +
        `         disclosed to the indexer.\n` +
        `         v2 re-derives and re-registers everything, which is where\n` +
        `         these separate for real. See docs/TRUST_MODEL.md.`,
    );
  }
}

export function loadConfig(explicitEnv?: NodeJS.ProcessEnv): TallyConfig {
  // A caller passing an explicit environment — every test does — gets exactly
  // what it passed, so a `.env` sitting on a developer's disk cannot change what
  // a test asserts.
  const env = explicitEnv ?? process.env;
  const network = parseNetwork(env.APERTURE_NETWORK);
  const vars = NETWORK_VARS[network];

  const rpcVar = vars.rpc.find((name) => env[name]);

  // Derived from the spec so there is exactly one list of required names.
  const missing = requiredFor(network).filter((spec) => {
    if (vars.rpc.includes(spec.name)) return false;
    if (spec.name === vars.pool) return !env[spec.name];
    if (spec.name.startsWith("STRK20_POOL_ADDRESS")) return false;
    if (spec.name === vars.indexer || spec.name === vars.proving) return !env[spec.name];
    if (/^(INDEXER_URL|PROVING_SERVICE_URL)/.test(spec.name)) return false;
    if (spec.name === vars.registry) return !env[spec.name];
    if (/^APERTURE_(REGISTRY|ANONYMIZER)_ADDRESS/.test(spec.name)) return false;
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
  const operatorViewingKey = env[vars.operatorViewingKey]
    ? toBigInt(vars.operatorViewingKey, env[vars.operatorViewingKey]!)
    : undefined;
  const poolActorViewingKey = env[vars.poolActorViewingKey]
    ? toBigInt(vars.poolActorViewingKey, env[vars.poolActorViewingKey]!)
    : operatorViewingKey;
  if (poolActorViewingKey !== undefined) assertValidViewingKey(poolActorViewingKey);
  if (voterViewingKey !== undefined) assertValidViewingKey(voterViewingKey);
  if (operatorViewingKey !== undefined) assertValidViewingKey(operatorViewingKey);

  reportKeyCoupling({
    DAO_BALLOT_VIEWING_SEED: ballotViewingSeed,
    DAO_BALLOT_ACCOUNT_PRIVATE_KEY: (() => {
      try {
        return BigInt(ballotAccountPrivateKey);
      } catch {
        return undefined;
      }
    })(),
    VOTER_VIEWING_KEY: voterViewingKey,
    [vars.operatorViewingKey]: operatorViewingKey,
    [vars.poolActorViewingKey]: poolActorViewingKey,
  });

  return {
    network,
    rpcUrl: env[rpcVar!]!,
    rpcFallbacks: DEPLOYMENTS[network].rpcUrls,
    poolAddress: env[vars.pool]!,
    registryAddress: env[vars.registry]!,
    anonymizerAddress: env[vars.anonymizer],
    strkTokenAddress: env.STRK_TOKEN_ADDRESS!,
    indexerUrl: parseServiceUrl(vars.indexer, env[vars.indexer]!, network),
    provingServiceUrl: parseServiceUrl(vars.proving, env[vars.proving]!, network),
    ballotAccountClassHash: env.BALLOT_ACCOUNT_CLASS_HASH!,
    daoMasterPublicKey,
    ballotViewingSeed,
    ballotAccountPrivateKey,
    voterViewingKey,
    operatorViewingKey,
    operatorAddress: env[vars.operatorAddress]!,
    operatorPrivateKey: env[vars.operatorKey]!,
    // Falls back to the operator, which is exactly right on a network where one
    // account does both jobs.
    poolActorAddress: env[vars.poolActorAddress] ?? env[vars.operatorAddress]!,
    poolActorPrivateKey: env[vars.poolActorKey] ?? env[vars.operatorKey]!,
    poolActorViewingKey,
  };
}

export { ENV_SPEC } from "./env-spec.ts";
