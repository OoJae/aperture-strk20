/**
 * Where Aperture is deployed, and every transaction it has produced.
 *
 * This file is the only place a contract address, a class hash, an RPC
 * endpoint, or a transaction hash is written down. `strk20.json`, the demo, the
 * docs table and the verification scripts are all generated from or read from
 * here, so they cannot drift apart the way they already did once: the manifest
 * carried two Sepolia addresses that do not exist on mainnet, `/proof` filed a
 * transaction under a heading it does not belong to, and three separate files
 * disagreed about how many payouts had run.
 *
 * Repointing to a new deployment is editing this file and running `pnpm sync`.
 */

export type NetworkName = "mainnet" | "sepolia";

export interface SupersededContract {
  readonly address: string;
  /**
   * Which of the two it is, as data rather than as prose.
   *
   * `role` is written for a human and says things like "ProposalRegistry (v2,
   * first attempt)". Code needs to know that a transaction emitting an event
   * from a dead anonymizer still ran through Aperture's own code, and matching
   * that out of a sentence is how a rename quietly breaks a verifier.
   */
  readonly kind: "registry" | "anonymizer";
  readonly role: string;
  /** Why it was replaced, in a sentence a stranger can act on. */
  readonly why: string;
}

export interface NetworkDeployment {
  readonly chainId: "SN_MAIN" | "SN_SEPOLIA";
  readonly label: string;
  readonly explorer: string;
  /**
   * Keyless public endpoints, tried in order. A static bundle cannot hold a
   * key, so these are the honest options; the fallback exists because a single
   * free endpoint rate-limiting during judging is a real failure mode.
   */
  readonly rpcUrls: readonly string[];
  readonly pool: string;
  readonly strkToken: string;
  readonly registry: string;
  readonly anonymizer: string;
  readonly registryClassHash: string;
  readonly anonymizerClassHash: string;
  readonly ballotAccountClassHash: string;
  readonly daoMasterPublicKey: string;
  /**
   * Domain epoch. Part of the ballot-address derivation, so bumping it
   * separates a redeploy that somehow lands at the same address. v1 predates
   * the domain entirely and has none.
   */
  readonly epoch: string | null;
  readonly deployedAt: string;
  readonly contractVersion: "v1" | "v2";
  /**
   * A published discovery service for this network, or null. Verified by a real
   * POST to /v1/sync/incoming_state, not by a health route — see
   * docs/evidence/2026-08-23-indexer-probe.md.
   */
  readonly indexerUrl: string | null;
  readonly provingServiceUrl: string | null;
  /**
   * Whether this network's ballot identities are deployed AND registered with
   * the pool. When false, the derived ballot addresses are addresses nobody can
   * receive at, and the demo must say so rather than offering them.
   */
  readonly ballotIdentitiesLive: boolean;
  readonly superseded?: readonly SupersededContract[];
}

export type TxKind =
  | "shield"
  | "private-transfer"
  | "unshield"
  | "fund-anonymizer"
  | "payout-register"
  | "payout-claim"
  | "ballot-register"
  | "ballot-cast"
  | "finalize"
  | "deploy";

export interface LedgerEntry {
  readonly hash: string;
  readonly network: NetworkName;
  readonly kind: TxKind;
  readonly block: number;
  /**
   * Verified: the receipt SUCCEEDED and carries at least one event from one of
   * Aperture's own contracts. This is the rule docs/DEPLOYMENTS.md states, and
   * it is stricter than the organisers' checker, which looks only for a pool
   * event. Both verdicts are reported; see receipt.ts.
   */
  readonly scores: boolean;
  readonly through: "anonymizer" | "registry" | null;
  readonly what: string;
  readonly detail: string;
}

/** The network the demo reads and the manifest describes. */
export const ACTIVE: NetworkName = "mainnet";

export const DEPLOYMENTS: Readonly<Record<NetworkName, NetworkDeployment>> = {
  mainnet: {
    chainId: "SN_MAIN",
    label: "Starknet mainnet",
    explorer: "https://voyager.online",
    rpcUrls: [
      "https://starknet-rpc.publicnode.com",
      "https://rpc.starknet.lava.build",
    ],
    pool: "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a",
    strkToken:
      "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
    registry:
      "0x02994d8a2b9a78d7c6c3d49696a22ec2010ffa120da09481ed1e5065e770e989",
    anonymizer:
      "0x01379a8daf18dfbb24b6ec80feb846b6445692090ab34ba0b286d49d1c04e1c5",
    registryClassHash:
      "0x017b824cdadca3849e194f528fbc1740060210fb1f02ae7505055e56b380605a",
    anonymizerClassHash:
      "0x0659758006c9e0c8bac1ea0fe33df8a2ff5549fd5be90744184f11935471a542",
    ballotAccountClassHash:
      "0x5b4b537eaa2399e3aa99c4e2e0208ebd6c71bc1467938cd52c798c601e43564",
    daoMasterPublicKey:
      "0x19fc7bf266b468a25073da987cf4b6392346b6c2c1cbfaf19be13e1bdcd3702",
    epoch: "APERTURE:V2:2026-08",
    deployedAt: "2026-08-24",
    contractVersion: "v2",
    indexerUrl: "https://discovery-service.alpha-mainnet.sw-dev.io",
    provingServiceUrl: "https://transaction-prover.alpha-mainnet.sw-dev.io",
    // No proposal exists on the v2 registry yet, so no identity has been
    // derived, let alone deployed. This stays false until three accounts are
    // live at the addresses the registry publishes — the v1 mainnet registry
    // published three addresses with nothing at them and the demo offered them
    // to voters, which is the reason this field exists at all.
    ballotIdentitiesLive: false,
    superseded: [
      {
        address:
          "0x0371e11c7cae61bc2fd5ce6b75153d59746ecf2d88b286be6ebe9c7c001e330c",
        kind: "registry",
        role: "ProposalRegistry (v1)",
        why:
          "Superseded by v2 on 2026-08-24. No quorum, no published " +
          "counted-through block, and payouts gated on a permanent boolean " +
          "carrying no token and no amount. Holds no funds. The ten " +
          "transactions in the ledger below ran against this pairing and " +
          "remain valid history.",
      },
      {
        address:
          "0x05cc31d13d5901347d009f70f59abacb22b76e84963286004b67bf4644546890",
        kind: "anonymizer",
        role: "GovernanceAnonymizer (v1)",
        why:
          "Superseded by v2 on 2026-08-24. Holds 14 STRK that nobody can " +
          "recover — the payout preimages were displayed once and never " +
          "stored, and there is no sweep. Not a bug in this contract so much " +
          "as a process failure it cannot forgive.",
      },
    ],
  },
  sepolia: {
    chainId: "SN_SEPOLIA",
    label: "Starknet Sepolia",
    explorer: "https://sepolia.voyager.online",
    // Probed 2026-08-23. nethermind's sepolia-juno endpoint, which was here
    // first, is unreachable — it was copied in without being called.
    rpcUrls: ["https://starknet-sepolia-rpc.publicnode.com"],
    pool: "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91",
    strkToken:
      "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
    registry:
      "0x058b9e29599a1f20fd316254b965bcf7feaed7b4d48268055c1ba38d500602ff",
    anonymizer:
      "0x03986832c64ebc2e73395405d77577062021b49e749acf10ec3074ceb3e355b7",
    registryClassHash:
      "0x017b824cdadca3849e194f528fbc1740060210fb1f02ae7505055e56b380605a",
    anonymizerClassHash:
      "0x0659758006c9e0c8bac1ea0fe33df8a2ff5549fd5be90744184f11935471a542",
    ballotAccountClassHash:
      "0x5b4b537eaa2399e3aa99c4e2e0208ebd6c71bc1467938cd52c798c601e43564",
    daoMasterPublicKey:
      "0x19fc7bf266b468a25073da987cf4b6392346b6c2c1cbfaf19be13e1bdcd3702",
    epoch: "APERTURE:V2:2026-08",
    deployedAt: "2026-08-23",
    contractVersion: "v2",
    indexerUrl: "https://discovery-service.alpha-sepolia.sw-dev.io",
    provingServiceUrl: "https://transaction-prover.alpha-sepolia.sw-dev.io",
    ballotIdentitiesLive: true,
    superseded: [
      {
        address:
          "0x045c7c6d4bbea680dadd7ea248ec793d84ad55f3d381be7c5710b12c900e1cf9",
        kind: "registry",
        role: "ProposalRegistry",
        why:
          "Constructed with the Argent account class, whose constructor takes " +
          "[0, pubkey, 1] while the derivation passes [pubkey]. Every ballot " +
          "address it published was one no account could be deployed at. The " +
          "Sepolia anonymizer still points at it, because that pointer is " +
          "write-once.",
      },
      {
        address:
          "0x01432bc68815695d4be3300cb29085aa916c97c11b7eb04e27ae9b84ad82b64f",
        kind: "registry",
        role: "ProposalRegistry (v1)",
        why:
          "Superseded by v2 on 2026-08-23. v1 had no quorum, published no " +
          "counted-through block, and gated payouts on a permanent boolean " +
          "carrying no token and no amount. It holds no funds.",
      },
      {
        address:
          "0x00533fedd104a3dd4097a6ad58f9a5637553f1a83f976867866cb60c02d7466d",
        kind: "anonymizer",
        role: "GovernanceAnonymizer (v1)",
        why:
          "Superseded by v2 on 2026-08-23. Holds 20.5 STRK that nobody can " +
          "recover: the payout preimages were displayed and never saved, and " +
          "there is no sweep. The same failure as the 14 STRK on mainnet. " +
          "Tickets are now written to disk before anything is submitted.",
      },
      {
        address:
          "0x02a7fea0197b6299c1c1effd7f7ec4319b8e027298cd64a40652b6b0263aac4c",
        kind: "registry",
        role: "ProposalRegistry (v2, first attempt)",
        why:
          "Never used. Deployed against DAO_MASTER_PUBLIC_KEY_V2 while every " +
          "client derived ballot addresses from the canonical name, so it " +
          "published addresses no client could reproduce. Two names for one " +
          "role.",
      },
      {
        address:
          "0x0490ea9d4752b57eb4abafa1d1b340324ce9a3d6caba579d13cd311dcd948600",
        kind: "anonymizer",
        role: "GovernanceAnonymizer (v2, first attempt)",
        why:
          "Never used, holds nothing, and immutable — so it is dead rather " +
          "than merely old. Carries two bugs found by the pre-flight review " +
          "that ran after it was deployed: claim() trusting calldata for value " +
          "it moved, and register_payout being reachable by anyone, which let " +
          "a stranger burn a proposal's payout cap permanently.",
      },
    ],
  },
};

/**
 * Every transaction Aperture has produced, oldest first.
 *
 * `scores` is not a judgement call — each entry was checked against the chain
 * with `node scripts/record-tx.ts`, which refuses to print an entry it has not
 * verified.
 */
export const LEDGER: readonly LedgerEntry[] = [
  {
    hash: "0x05331694f88f34223c8c1a5445e449b552dfe2b28c93ae26bb6d5699e8443ec1",
    network: "mainnet",
    kind: "shield",
    block: 13395123,
    scores: false,
    through: null,
    what: "Shield",
    detail:
      "A real pool deposit, but it ran through nobody's code but the pool's, " +
      "so it is not integration depth. Kept because a record that shows only " +
      "the flattering half is not a record.",
  },
  {
    hash: "0x02e3cee5560517e9472d977fe11d4c81ddbe0087df6ce2562d4711fe8a28e947",
    network: "mainnet",
    kind: "private-transfer",
    block: 13395275,
    scores: false,
    through: null,
    what: "Private transfer",
    detail: "Pool-only, same as above.",
  },
  {
    hash: "0x020cc7f861d8c455df4b4f84c284ff3dcb96a6f1f94898e95a4a1a2ec919803b",
    network: "mainnet",
    kind: "unshield",
    block: 13395339,
    scores: false,
    through: null,
    what: "Unshield",
    detail: "Pool-only, same as above.",
  },
  {
    hash: "0x2ee291e2fc083896143f0bb063694b795aa918239cca50fe06021ac32150fb2",
    network: "mainnet",
    kind: "payout-register",
    block: 13540620,
    scores: true,
    through: "anonymizer",
    what: "Payout through the anonymizer",
    detail:
      "The pool withdrew to GovernanceAnonymizer and called its privacy_invoke, " +
      "which parked the value against a commitment only a preimage can open. " +
      "Emits PayoutRegistered.",
  },
  {
    hash: "0x716932a91cb1730fde259d98e44866be67026ff97ae311d8acc83f124c3c747",
    network: "mainnet",
    kind: "payout-register",
    block: 13548604,
    scores: true,
    through: "anonymizer",
    what: "Payout through the anonymizer",
    detail: "Same path, a second commitment.",
  },
  {
    hash: "0x39e4cdf6a3b4967e93ef83abf62170ecd4be8788b45bfcfd37fcb1e5178fae4",
    network: "mainnet",
    kind: "payout-register",
    block: 13548731,
    scores: true,
    through: "anonymizer",
    what: "Payout through the anonymizer",
    detail: "Same path, a third commitment.",
  },
  {
    hash: "0x416bece5747c6ca3b25efd3ad5c868109c4e5413b734c438b15550f33932e51",
    network: "mainnet",
    kind: "payout-register",
    block: 13598229,
    scores: true,
    through: "anonymizer",
    what: "Payout through the anonymizer",
    detail: "Same path, a fourth commitment.",
  },
  {
    hash: "0x39d820c7b45e7d1752cd7d3171b689437c045d3bd1a5526e5259e49c8faca81",
    network: "mainnet",
    kind: "fund-anonymizer",
    block: 13599878,
    scores: false,
    through: null,
    what: "Treasury funded, nothing invoked",
    detail:
      "A pool withdrawal whose recipient happened to be our anonymizer. It " +
      "emits zero events from our contracts, so it does not run through our " +
      "code by any reading, and docs/DEPLOYMENTS.md was wrong to say it " +
      "counted. This is also the transaction that stranded value in a " +
      "contract with no way to get it out.",
  },
  {
    hash: "0x31b96770b38847d43631af41813bdc54335e7628f850411e856b07f4e009326",
    network: "mainnet",
    kind: "payout-register",
    block: 13604075,
    scores: true,
    through: "anonymizer",
    what: "Payout through the anonymizer",
    detail: "Same path, a fifth commitment.",
  },
  {
    hash: "0x4ed6e16702fe98bea43e7a26bc54bf76353ab4fa49f9341dc39cf20bd4e390d",
    network: "mainnet",
    kind: "payout-register",
    block: 13604429,
    scores: true,
    through: "anonymizer",
    what: "Payout through the anonymizer",
    detail: "Same path, a sixth commitment.",
  },
];

export const DEMO_URL = "https://aperture-strk20.vercel.app";

/** Empty until one exists. Never fill this in speculatively. */
export const DEMO_VIDEO = "";

/**
 * The demo's payout parameters, in one place so the calldata and the visible
 * copy cannot disagree. They were independent literals once, which is exactly
 * how a button ends up promising something the transaction does not do.
 */
export const DEMO = {
  payoutProposalId: 2n,
  payoutAmount: 2n * 10n ** 18n,
} as const;

export const scoring = (network: NetworkName = ACTIVE): readonly LedgerEntry[] =>
  LEDGER.filter((e) => e.network === network && e.scores);

export const nonScoring = (
  network: NetworkName = ACTIVE,
): readonly LedgerEntry[] =>
  LEDGER.filter((e) => e.network === network && !e.scores);

export const txUrl = (entry: LedgerEntry): string =>
  `${DEPLOYMENTS[entry.network].explorer}/tx/${entry.hash}`;

export const contractUrl = (network: NetworkName, address: string): string =>
  `${DEPLOYMENTS[network].explorer}/contract/${address}`;
