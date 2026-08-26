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
  readonly kind: "registry" | "anonymizer" | "multisig";
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
  /**
   * The TreasuryMultisig that is the registry's tally_operator, when the
   * deployment has one. A transaction it emits from is ours as much as one
   * from the registry, and the scoring rule has to know that.
   */
  readonly multisig?: string;
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
  readonly contractVersion: "v1" | "v2" | "v3";
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
  | "proposal-create"
  | "payout-authorize"
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
      "0x05fe6b3b4755184eccd1efbcaac3ba647bbaf578a8ff7fbf31602aee83d0e7c5",
    anonymizer:
      "0x01d66b83171db42b8c1bfda02d30149a4888a80e7cb6f84da9837943940df156",
    multisig:
      "0x05e59931f2b0ee69617418d5053de782b0b38a5a72e5d414d65e2a67adecfee8",
    registryClassHash:
      "0x03eceb8affabdc8cf095856545d17722eecf8c2ea519b0696932490e259127e3",
    anonymizerClassHash:
      "0x0659758006c9e0c8bac1ea0fe33df8a2ff5549fd5be90744184f11935471a542",
    ballotAccountClassHash:
      "0x5b4b537eaa2399e3aa99c4e2e0208ebd6c71bc1467938cd52c798c601e43564",
    daoMasterPublicKey:
      "0x19fc7bf266b468a25073da987cf4b6392346b6c2c1cbfaf19be13e1bdcd3702",
    epoch: "APERTURE:V3:2026-08",
    deployedAt: "2026-08-25",
    contractVersion: "v3",
    indexerUrl: "https://discovery-service.alpha-mainnet.sw-dev.io",
    provingServiceUrl: "https://transaction-prover.alpha-mainnet.sw-dev.io",
    // True as of proposal 1: all three accounts are deployed at the addresses
    // the registry publishes AND registered with the pool, so each can actually
    // receive a sealed vote. Both halves are required — the v1 mainnet registry
    // published three addresses with nothing at them and the demo offered them
    // to voters, which is the reason this field exists at all.
    ballotIdentitiesLive: true,
    superseded: [
      {
        address:
          "0x02994d8a2b9a78d7c6c3d49696a22ec2010ffa120da09481ed1e5065e770e989",
        kind: "registry",
        role: "ProposalRegistry (v2)",
        why:
          "Superseded by v3 on 2026-08-25. Complete while it stood: 22 " +
          "transactions, a sealed ballot cast inside its window, and the first " +
          "claimed payout on mainnet — Sepolia's came ten hours earlier and " +
          "was the first on any network. Replaced because it could not be " +
          "extended — tally_operator has no setter and finalize had nowhere to " +
          "put a ballot-set commitment. Holds no funds.",
      },
      {
        address:
          "0x01379a8daf18dfbb24b6ec80feb846b6445692090ab34ba0b286d49d1c04e1c5",
        kind: "anonymizer",
        role: "GovernanceAnonymizer (v2)",
        why:
          "Superseded by v3 on 2026-08-25, only because the registry it points " +
          "at is write-once. Its code is unchanged — the v3 instance runs the " +
          "same class hash. Holds nothing: outstanding and unattached both read " +
          "zero after its payout was claimed.",
      },
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
  {
    hash: "0x667e23ec64fbed43048929b15b5a23e5641d491a8cd44ce00cee2052161a94",
    network: "mainnet",
    kind: "ballot-register",
    block: 13797273,
    scores: false,
    through: null,
    what: "Pool actor registers its viewing key",
    detail:
      "The mainnet account that touches the pool, registered write-once under a key we hold. The previous operator's is lost, which is why this account exists.",
  },
  {
    hash: "0x620ad986d8690feb9d8ecfa85402931b3fd39fae8de1a0b9ec94c85d305acfc",
    network: "mainnet",
    kind: "ballot-register",
    block: 13797393,
    scores: false,
    through: null,
    what: "FOR ballot identity registers its viewing key",
    detail:
      "Proposal 1. Until this lands the address the registry publishes cannot receive a sealed vote.",
  },
  {
    hash: "0x22b3a5e28af3a1fc5b8dd0c59de8595105433186d042dbc81bdab9ef5726fa0",
    network: "mainnet",
    kind: "ballot-register",
    block: 13797407,
    scores: false,
    through: null,
    what: "AGAINST ballot identity registers its viewing key",
    detail:
      "Proposal 1. All three choices are stood up, so no voter is offered an address nothing can receive at.",
  },
  {
    hash: "0x6db40fc7eb39e605272524b6e82150a21768f67c1e485f1defcaff868597be4",
    network: "mainnet",
    kind: "ballot-register",
    block: 13797423,
    scores: false,
    through: null,
    what: "ABSTAIN ballot identity registers its viewing key",
    detail:
      "Proposal 1. Completes the set.",
  },
  {
    hash: "0xd3afbc3d9ffd2a4151be0c7d75dc5bb9c37a56a96bcd4854781b719ae8fbc5",
    network: "mainnet",
    kind: "shield",
    block: 13798108,
    scores: false,
    through: null,
    what: "Shield 5 STRK of vote weight",
    detail:
      "Public by design: address, token and amount all show. Only the ballot that follows is private.",
  },
  {
    hash: "0x133b6a35341b328a1f12be900e41b6143083c07189969d9e66c8c8a1d9dddb0",
    network: "mainnet",
    kind: "ballot-cast",
    block: 13798132,
    scores: false,
    through: null,
    what: "Sealed ballot: 5 STRK FOR proposal 1",
    detail:
      "Inside the window 13798033..13799084. The pool events carry no amount, no voter and no choice, and the on-chain sender is a relayer; the tally reads it exactly. Emits nothing from our own contracts, so it counts for the organisers' checker and not for this project's stricter claim about itself.",
  },
  {
    hash: "0x4f299f25bc15386163780cb7da32a4240e73da09cd1cdbc604f91b381ac407a",
    network: "mainnet",
    kind: "proposal-create",
    block: 13797335,
    scores: true,
    through: "registry",
    what: "Proposal 1 created, with a window genuinely ahead",
    detail:
      "v2 rejects a window that has already closed. v1 could not, and the old deploy script passed 0x1 0x0 0x1 — a window that made counted_through a pin to a block predating the proposal.",
  },
  {
    hash: "0x61ae84ef59306c2d91c7933f6b55a5bba5f629cc72c7966574d22147258c5ff",
    network: "mainnet",
    kind: "finalize",
    block: 13799264,
    scores: true,
    through: "registry",
    what: "Tally published: 5 STRK FOR, counted through 13799084",
    detail:
      "counted_through equals end_block, which finalize asserts, so the pin is unique per proposal and anyone can re-run the count against the same state. Provenance BallotDerived: summed from notes the ballot identities actually received.",
  },
  {
    hash: "0x41571a3531df7a25615321fbf8e6278241c6b6e351c09d01626b0ae82b8afc6",
    network: "mainnet",
    kind: "payout-authorize",
    block: 13799320,
    scores: true,
    through: "registry",
    what: "1 STRK of the 2 STRK cap committed to one commitment",
    detail:
      "The licence the anonymizer requires before it will escrow anything. Without it anyone could burn a passed proposal's cap to zero permanently, because the anonymizer is handed value with no sender and cannot tell the DAO's spending from a stranger's.",
  },
  {
    hash: "0x713a8fd9aa1bc5362785a83a9e8c6e7ac178a3159d96672c31030734dd10ded",
    network: "mainnet",
    kind: "shield",
    block: 13802603,
    scores: false,
    through: null,
    what: "Shield 1 STRK to fund the payout",
    detail:
      "The register leg withdraws from a SHIELDED balance, and the pool actor's was zero — its previous 5 STRK had become the ballot. Shielding and spending are separate acts.",
  },
  {
    hash: "0xc64f28b2a0a19b77acd8ac4b66028836b73c6097a51ca9e6243b0652d747e9",
    network: "mainnet",
    kind: "payout-register",
    block: 13802692,
    scores: true,
    through: "anonymizer",
    what: "1 STRK escrowed against a commitment",
    detail:
      "The pool withdrew to GovernanceAnonymizer and called its privacy_invoke; the contract checked the registry's licence, checked its own escrow ledger, and parked the value against a commitment only the preimage opens. Returns an empty span, so no open note is created.",
  },
  {
    hash: "0x1174d9894bf1fc85f13d06e325e166a03ba1c36d25e4fd86a9f483b6664bd84",
    network: "mainnet",
    kind: "payout-claim",
    block: 13802714,
    scores: true,
    through: "anonymizer",
    what: "The first claimed payout on mainnet",
    detail:
      "The preimage opened the commitment and the anonymizer approved the pool to pull exactly the escrowed amount into an open note. Afterwards outstanding is 0 and unattached is 0 — nothing stranded, which is the thing 14 STRK in the v1 anonymizer could not manage.",
  },
  {
    hash: "0xfbd8378d325c2ca3e17fcfd0946fdb4eccea63d0458802e48ff9e05276588f",
    network: "mainnet",
    kind: "proposal-create",
    block: 13843203,
    scores: true,
    through: "registry",
    what: "Proposal 1 on v3",
    detail:
      "Window genuinely ahead, quorum floor 5 STRK, payout cap 2 STRK.",
  },
  {
    hash: "0x19173638ef05f8211c9cfbd7c75e25428dc6a41f417de3ab108d4cff86bc173",
    network: "mainnet",
    kind: "ballot-register",
    block: 13843257,
    scores: false,
    through: null,
    what: "FOR identity registers its viewing key",
    detail:
      "Until this lands the address the registry publishes cannot receive a sealed vote.",
  },
  {
    hash: "0x1febfd16eee351bba28045090c91b6cc18fe3e4e42517a1925cf7d12149a2d6",
    network: "mainnet",
    kind: "ballot-register",
    block: 13843268,
    scores: false,
    through: null,
    what: "AGAINST identity registers its viewing key",
    detail:
      "All three choices stood up, so no voter is offered an address nothing can receive at.",
  },
  {
    hash: "0x3b34f763fe1e5b563037b8952664c34a7d2f3684e818e3a6086fe2864c12acb",
    network: "mainnet",
    kind: "ballot-register",
    block: 13843288,
    scores: false,
    through: null,
    what: "ABSTAIN identity registers its viewing key",
    detail:
      "Completes the set.",
  },
  {
    hash: "0x73305b56bf39169cae94dad89a58f66238d104ab665db0249696998b085d63d",
    network: "mainnet",
    kind: "shield",
    block: 13843950,
    scores: false,
    through: null,
    what: "Shield 5 STRK of vote weight",
    detail:
      "Public by design: address, token and amount all show.",
  },
  {
    hash: "0x3c03b8a0cc4aeb06d55683f5d902c17e5ae26cdf761db9ff5041e1b3d4cf28e",
    network: "mainnet",
    kind: "ballot-cast",
    block: 13843979,
    scores: false,
    through: null,
    what: "Sealed ballot: 5 STRK FOR proposal 1",
    detail:
      "Inside the window 13843905..13844788. The pool events carry no amount, no voter and no choice.",
  },
  {
    hash: "0x601e2c8b963ddd1692a7a4e8720f25d70ded026feff4b7de3928dfc512bd8fb",
    network: "mainnet",
    kind: "finalize",
    block: 13844825,
    scores: true,
    through: "registry",
    what: "Tally published, and the ballot set committed to",
    detail:
      "5 STRK for, counted_through 13844788 = end_block, provenance BallotDerived, ballot_commitment 0x715fb9e7.... verify-tally recomputes that felt from an independent count and matches it. Routed through the multisig, so it carries two of our events: the registry's and the multisig's.",
  },
  {
    hash: "0x1288aa459a8a7a1f85a4a4b61eb9d7045a551f4be0f19d69d3c451669db110f",
    network: "mainnet",
    kind: "payout-authorize",
    block: 13844973,
    scores: true,
    through: "registry",
    what: "Payout announced, starting the timelock",
    detail:
      "Grants nothing. Reserves 1 STRK of the 2 STRK cap and records the block, making the payout visible 1800 blocks before it can be used.",
  },
  {
    hash: "0x7c34cb2221ed5b8a7e375615c8463b40508fbae888eed8fe67e1200ae84562a",
    network: "mainnet",
    kind: "payout-authorize",
    block: 13846793,
    scores: true,
    through: "registry",
    what: "Payout licensed, 1800 blocks later",
    detail:
      "The timelock elapsed and a quorum confirmed. A single key cannot reach this state: the registry's tally_operator is a 2-of-3 multisig.",
  },
  {
    hash: "0x144fdb94ec51ef1f462bbb185538fd852a5d2e441879841b29cf7a892710bdb",
    network: "mainnet",
    kind: "payout-register",
    block: 13846811,
    scores: true,
    through: "anonymizer",
    what: "1 STRK escrowed against a commitment",
    detail:
      "The pool withdrew to GovernanceAnonymizer and called its privacy_invoke; the contract checked the registry's licence and its own escrow ledger before parking the value.",
  },
  {
    hash: "0x500f21db7e4864ca024fd1c9febcd8b8c8c1408282b72aa0eb926a02b4d0491",
    network: "mainnet",
    kind: "payout-claim",
    block: 13846833,
    scores: true,
    through: "anonymizer",
    what: "Payout claimed",
    detail:
      "The preimage opened the commitment. Afterwards outstanding is 0 and unattached is 0.",
  },
  {
    hash: "0x66fc98d1d2d1b02ee7a3a35b115c11d6e2c3d399ccf2865708b5622497037b1",
    network: "mainnet",
    kind: "private-transfer",
    block: 13846856,
    scores: false,
    through: null,
    what: "The first refund on mainnet: 5 STRK returned to the voter",
    detail:
      "Vote weight was a one-way stake until this landed. Re-running the count afterwards returns the same total and the same ballot-set commitment, because discovery reads received-transfer history rather than the unspent set.",
  },
];

export const DEMO_URL = "https://aperture-strk20.vercel.app";

/**
 * The demo film. 2:37, public — verified reachable without an account, which is
 * the property that matters: a judge follows this link cold.
 */
export const DEMO_VIDEO = "https://youtu.be/rOHlgf17WqA";

/**
 * Whether a transaction emits an event from the STRK20 pool itself.
 *
 * This is the organisers' rule, and it is not our rule. Ours is stricter: a hash
 * counts only if it ran through one of Aperture's own contracts. The two sets
 * overlap without either containing the other — a `finalize` is ours and touches
 * no pool, a bare `shield` touches the pool and is nobody's contract.
 *
 * It is derived rather than stored because the chain makes it exact: everything
 * routed through the registry is a plain contract call that never reaches the
 * pool, and everything else — anonymizer payouts, and the raw pool operations —
 * moves value through it. Checked against all 34 mainnet receipts on 2026-08-26:
 * anonymizer 10/10 emit a pool event, registry 0/7, unrouted 17/17.
 */
export const touchesPool = (entry: LedgerEntry): boolean =>
  entry.through !== "registry";

export const scoring = (network: NetworkName = ACTIVE): readonly LedgerEntry[] =>
  LEDGER.filter((e) => e.network === network && e.scores);

export const nonScoring = (
  network: NetworkName = ACTIVE,
): readonly LedgerEntry[] =>
  LEDGER.filter((e) => e.network === network && !e.scores);

/**
 * The most recent complete treasury payout, leg by leg.
 *
 * Filtering the ledger on `kind` alone spans every contract generation — mainnet
 * carries thirteen `payout-*` entries across v1, v2 and v3 — so taking "the
 * first two" mixes unrelated payouts together. A consumer that did exactly that
 * rendered the distance between two v1 payouts as this one's timelock.
 *
 * So the sequence is walked backwards from the newest claim: each leg is the
 * latest of its kind strictly before the leg that follows it. That yields one
 * coherent payout instead of a mix, and it keeps naming the right one after the
 * next payout runs. Legs are `undefined` when the network has never had one.
 */
export interface PayoutSequence {
  readonly announced?: LedgerEntry;
  readonly licensed?: LedgerEntry;
  readonly registered?: LedgerEntry;
  readonly claimed?: LedgerEntry;
}

export const latestPayoutSequence = (
  network: NetworkName = ACTIVE,
): PayoutSequence => {
  const legs = LEDGER.filter(
    (e) => e.network === network && e.kind.startsWith("payout-"),
  ).sort((a, b) => a.block - b.block);

  const latest = (kind: string, before = Infinity) =>
    legs.filter((e) => e.kind === kind && e.block < before).at(-1);

  const claimed = latest("payout-claim");
  const registered = latest("payout-register", claimed?.block);
  const licensed = latest("payout-authorize", registered?.block);
  const announced = latest("payout-authorize", licensed?.block);
  return { announced, licensed, registered, claimed };
};

export const txUrl = (entry: LedgerEntry): string =>
  `${DEPLOYMENTS[entry.network].explorer}/tx/${entry.hash}`;

export const contractUrl = (network: NetworkName, address: string): string =>
  `${DEPLOYMENTS[network].explorer}/contract/${address}`;
