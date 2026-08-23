/**
 * Every environment variable this repository reads, in one list.
 *
 * `.env.example` is generated from this, and a test fails the build if the two
 * disagree. That check exists because the previous `.env.example` declared four
 * variables nothing read and omitted thirteen the worker required — including
 * the one secret without which nothing runs — while `MissingConfigError` told
 * the operator to copy exactly that file to fix it.
 *
 * This module imports nothing, so a clean clone with no GitHub Packages token
 * can still read it and check the example file.
 */

export type Requirement = "always" | "mainnet" | "sepolia" | "optional";

export interface EnvVarSpec {
  readonly name: string;
  readonly requirement: Requirement;
  /** Never rendered with a value, never printed in an error. */
  readonly secret: boolean;
  readonly group: string;
  readonly description: string;
  /** A safe, non-secret default that can be committed. */
  readonly example?: string;
}

export const ENV_SPEC: readonly EnvVarSpec[] = [
  {
    name: "APERTURE_NETWORK",
    requirement: "always",
    secret: false,
    group: "Network",
    description:
      "mainnet or sepolia. Deliberately has no default: it used to fall back " +
      "to mainnet, which contradicted the service's own README and meant a " +
      "missing value pointed real transactions at the live pool.",
    example: "sepolia",
  },

  {
    name: "STARKNET_RPC_URL",
    requirement: "mainnet",
    secret: false,
    group: "RPC",
    description: "Mainnet RPC. Used when the _SNCAST variant is unset.",
  },
  {
    name: "STARKNET_RPC_URL_SNCAST",
    requirement: "optional",
    secret: false,
    group: "RPC",
    description:
      "Mainnet RPC on an explicitly versioned path. sncast rejects anything " +
      "below RPC spec 0.10 and several providers still serve 0.8.1 on their " +
      "bare host, failing with a misleading \"Invalid block id\". Preferred " +
      "when present.",
  },
  {
    name: "STARKNET_RPC_URL_SEPOLIA",
    requirement: "sepolia",
    secret: false,
    group: "RPC",
    description: "Sepolia RPC. Used when the _SNCAST variant is unset.",
    example: "https://starknet-sepolia-rpc.publicnode.com",
  },
  {
    name: "STARKNET_RPC_URL_SEPOLIA_SNCAST",
    requirement: "optional",
    secret: false,
    group: "RPC",
    description:
      "Sepolia RPC on an explicitly versioned path. Required by " +
      "scripts/deploy-sepolia.sh, which aborts without it.",
  },
  {
    name: "STRK20_VERIFY_RPC",
    requirement: "optional",
    secret: false,
    group: "RPC",
    description:
      "Overrides the endpoint scripts/verify-tx.ts and record-tx.ts read " +
      "receipts from. Defaults to the one the organisers' checker uses.",
  },

  {
    name: "INDEXER_URL",
    requirement: "always",
    secret: false,
    group: "STRK20 infrastructure",
    description:
      "Discovery service. Public alpha infrastructure, not a secret. Verified " +
      "answering a real sync request on 2026-08-23 — see " +
      "docs/evidence/2026-08-23-indexer-probe.md. Must be https on mainnet: it " +
      "receives a viewing key in cleartext.",
    example: "https://discovery-service.alpha-sepolia.sw-dev.io",
  },
  {
    name: "PROVING_SERVICE_URL",
    requirement: "always",
    secret: false,
    group: "STRK20 infrastructure",
    description:
      "Proving service. Answers /health on both networks; that is not the same " +
      "as having produced a proof.",
    example: "https://transaction-prover.alpha-sepolia.sw-dev.io",
  },

  {
    name: "STRK20_POOL_ADDRESS",
    requirement: "mainnet",
    secret: false,
    group: "Pool and token",
    description: "STRK20 shielded pool on mainnet.",
    example: "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a",
  },
  {
    name: "STRK20_POOL_ADDRESS_SEPOLIA",
    requirement: "sepolia",
    secret: false,
    group: "Pool and token",
    description: "STRK20 shielded pool on Sepolia.",
    example: "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91",
  },
  {
    name: "STRK_TOKEN_ADDRESS",
    requirement: "always",
    secret: false,
    group: "Pool and token",
    description: "STRK. The same address on both networks.",
    example: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
  },

  {
    name: "APERTURE_REGISTRY_ADDRESS",
    requirement: "always",
    secret: false,
    group: "Aperture contracts",
    description: "ProposalRegistry on the selected network. See docs/DEPLOYMENTS.md.",
  },
  {
    name: "APERTURE_PAYOUT_DIR",
    requirement: "optional",
    secret: false,
    group: "Aperture contracts",
    description:
      "Where payout preimages are written before a register transaction is " +
      "submitted. Defaults to .payouts/, which is gitignored. A preimage is " +
      "the only thing that can ever open an escrowed payout, and the " +
      "anonymizer has no sweep, so losing one strands the value permanently.",
  },
  {
    name: "APERTURE_ANONYMIZER_ADDRESS",
    requirement: "optional",
    secret: false,
    group: "Aperture contracts",
    description: "GovernanceAnonymizer. Required only by the payout lifecycle.",
  },

  {
    name: "BALLOT_ACCOUNT_CLASS_HASH",
    requirement: "always",
    secret: false,
    group: "Ballot identity derivation",
    description:
      "Account class the ballot identities are deployed from. Public. Getting " +
      "it wrong yields addresses no account can be deployed at, which is what " +
      "superseded an entire Sepolia registry.",
    example: "0x5b4b537eaa2399e3aa99c4e2e0208ebd6c71bc1467938cd52c798c601e43564",
  },
  {
    name: "DAO_MASTER_PUBLIC_KEY",
    requirement: "always",
    secret: false,
    group: "Ballot identity derivation",
    description: "Public half of the DAO master key. Ballot addresses derive from it.",
    example: "0x660a41ee3edd08bd84276775ea1bed419f38ed8fe7bf4c07b522c3513a73e42",
  },

  {
    name: "DAO_BALLOT_VIEWING_SEED",
    requirement: "always",
    secret: true,
    group: "Secrets",
    description:
      "Seeds every per-ballot viewing key. Never leaves this process — only " +
      "its derived children are sent anywhere. Changing it rotates every " +
      "ballot viewing key, making already-registered ballots unreadable.",
  },
  {
    name: "DAO_BALLOT_ACCOUNT_PRIVATE_KEY",
    requirement: "always",
    secret: true,
    group: "Secrets",
    description:
      "Signs for every ballot identity account. Must be the private half of " +
      "DAO_MASTER_PUBLIC_KEY, and the loader checks that it is.",
  },
  {
    name: "VOTER_VIEWING_KEY",
    requirement: "optional",
    secret: true,
    group: "Secrets",
    description:
      "The voter's own pool viewing key, used by cast-vote. SENT TO THE " +
      "INDEXER IN CLEARTEXT.",
  },
  {
    name: "TALLY_OPERATOR_VIEWING_KEY",
    requirement: "optional",
    secret: true,
    group: "Secrets",
    description:
      "The operator's pool viewing key, used by the payout lifecycle. SENT TO " +
      "THE INDEXER IN CLEARTEXT.",
  },
  {
    name: "TALLY_OPERATOR_ADDRESS",
    requirement: "always",
    secret: false,
    group: "Secrets",
    description: "Account that publishes tallies on-chain.",
  },
  {
    name: "TALLY_OPERATOR_PRIVATE_KEY",
    requirement: "always",
    secret: true,
    group: "Secrets",
    description: "Signs the finalize transaction.",
  },
];

export const byName = (name: string): EnvVarSpec | undefined =>
  ENV_SPEC.find((v) => v.name === name);

export const requiredFor = (network: "mainnet" | "sepolia"): readonly EnvVarSpec[] =>
  ENV_SPEC.filter((v) => v.requirement === "always" || v.requirement === network);
