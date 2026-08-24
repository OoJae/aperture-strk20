# Deployments

## Mainnet

Deployed 2026-08-17. **These are the addresses the demo talks to.**

| | Address |
|---|---|
| `ProposalRegistry` | `0x0371e11c7cae61bc2fd5ce6b75153d59746ecf2d88b286be6ebe9c7c001e330c` |
| `GovernanceAnonymizer` | `0x05cc31d13d5901347d009f70f59abacb22b76e84963286004b67bf4644546890` |
| STRK20 pool (mainnet) | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` |

Class hashes: registry `0x05ce106206f1ec3dfefd12dccfc3722b32fe7a0bd77b1c76c8f4947096d5ea1e`,
anonymizer `0x05c37265083181d3669f096b0a594ead9725b75ff4a413dae007c8ddab818a37` —
identical to Sepolia's, since a class hash is derived from the code itself.

Deploying these needed no prover and no indexer; they are ordinary contract
deployments, which is why mainnet was reachable while the proving endpoints
remain unpublished.

### Treasury payouts, executed on mainnet

Six transactions ran the full payout through Aperture's own anonymizer. Each
withdrew from the pool to `GovernanceAnonymizer`, called its `privacy_invoke`,
and parked the value against a commitment that only a preimage can open. Each
emits `PayoutRegistered`.

| Block | Hash |
|---|---|
| 13,540,620 | [`0x2ee291e2…32150fb2`](https://voyager.online/tx/0x2ee291e2fc083896143f0bb063694b795aa918239cca50fe06021ac32150fb2) |
| 13,548,604 | [`0x716932a9…f124c3c747`](https://voyager.online/tx/0x716932a91cb1730fde259d98e44866be67026ff97ae311d8acc83f124c3c747) |
| 13,548,731 | [`0x39e4cdf6…b1e5178fae4`](https://voyager.online/tx/0x39e4cdf6a3b4967e93ef83abf62170ecd4be8788b45bfcfd37fcb1e5178fae4) |
| 13,598,229 | [`0x416bece5…50f33932e51`](https://voyager.online/tx/0x416bece5747c6ca3b25efd3ad5c868109c4e5413b734c438b15550f33932e51) |
| 13,604,075 | [`0x31b96770…4e009326`](https://voyager.online/tx/0x31b96770b38847d43631af41813bdc54335e7628f850411e856b07f4e009326) |
| 13,604,429 | [`0x4ed6e167…bd4e390d`](https://voyager.online/tx/0x4ed6e16702fe98bea43e7a26bc54bf76353ab4fa49f9341dc39cf20bd4e390d) |

Executed from the demo through the wallet route, which is the only path that
proves without a published proving service, because the wallet proves
internally.

A seventh transaction,
[`0x39d820c7…c8faca81`](https://voyager.online/tx/0x39d820c7b45e7d1752cd7d3171b689437c045d3bd1a5526e5259e49c8faca81)
at block 13,599,878, **does not count and this document previously said it
did.** It moved treasury value into the anonymizer without invoking it, so it
emits zero events from any contract of ours — one `starknet_getTransactionReceipt`
call falsifies the old claim. It is listed here, and on `/proof`, as what it is.

That transaction is also how 14 STRK became permanently locked. See
`docs/TRUST_MODEL.md`: value arriving without a commitment registered in the
same pool transaction can never be moved again, by anyone.

A hash counts, by this project's own rule, only if it ran through one of our
contracts; merely touching the pool is not integration depth. Four of the ten
hashes in `strk20.json` fail that test — the three earliest are shield, private
transfer and unshield, and the fourth is the funding transaction above. They are
kept in the manifest because a record that shows only the flattering half is not
a record. `node scripts/verify-tx.ts --all` reports both rules separately and
never conflates them.

### The mainnet tally is not a counted result

Mainnet proposal 2 is finalized with `for_weight: 900, against_weight: 100,
abstain_weight: 0` and `has_passed: true`. **Those numbers were entered by the
tally operator.** No ballot produced them: all three of the proposal's ballot
identities are underived-but-undeployed on mainnet, `pool.get_public_key()`
returns zero for each, and no note was ever sent to one. The units give it away
— 900 is 900 *base units*, roughly 9 × 10⁻¹⁶ STRK, not 900 STRK.

It exists because `register_payout` asserts `registry.has_passed(proposal_id)`,
so a passed proposal is a precondition for demonstrating a mainnet payout at all.

The tally that *was* produced by counted ballots is on Sepolia: proposal 1,
`for_weight: 5000000000000000000`, against 0, abstain 0.

No file in this repository disclosed any of this before 2026-08-23. The demo now
states it on the page that renders the number.

### Not yet reproduced on mainnet

The sealed-vote lifecycle. Standing up a ballot identity means registering its
viewing key with the pool, which is a pool transaction needing a proof. The
wallet cannot substitute: ballot identities are contract accounts the DAO
derives and controls by key, not accounts a browser extension signs for.

This document used to say the reason was that no mainnet proving service
exists. That is not established. On 2026-08-23 a real
`POST /v1/sync/incoming_state` against
`https://discovery-service.alpha-mainnet.sw-dev.io` returned a well-formed
response echoing our pinned `block_ref`, and
`https://transaction-prover.alpha-mainnet.sw-dev.io/health` returned `ok` —
while the Sepolia discovery service was returning `503 STORAGE_ERROR` at the
same moment. The transcript is in `docs/evidence/2026-08-23-indexer-probe.md`.

So the honest statement is narrower and less flattering: discovery on mainnet
works, proving on mainnet is untested, and the lifecycle has not been run there
because nobody has tried since those endpoints were found. A `/health` route is
not a proof.

**As of 2026-08-24 the remaining obstacle is funding, not infrastructure.** The
v2 contracts exist and the full lifecycle has been run on Sepolia. What mainnet
needs is enough STRK held at once, and the binding constraint is not the flat
fee — it is resource bounds. A viewing-key registration on Sepolia was refused
at a 4.88 STRK balance because the node wanted about 5.77 STRK of l2 gas as a
ceiling; bounds are a ceiling rather than a bill and the transaction settles for
a fraction, but an account that cannot cover the ceiling never runs. Mainnet's
l2 gas price currently reads the same as Sepolia's, so the difference is the
flat fee: 6 STRK against 2.

Peak requirement for one ballot and one payout, with three ballot identities
funded at 20 STRK each:

| | STRK |
|---|---|
| deploy, proposal, finalize, authorize (gas only) | ~3 |
| three ballot identities, held simultaneously | 60 |
| shield 5 STRK of vote weight, plus one flat fee | 11 |
| cast | 6 |
| one 2 STRK payout: register and claim | 14 |
| **peak held at once** | **~94** |
| recoverable afterwards by `sweep-ballot-accounts` | ~40 |
| **net burn** | **~55** |

The deployer holds 53.4 STRK. Each additional payout adds 14.

## Sepolia

The full v2 lifecycle runs here, end to end.

| | Address |
|---|---|
| `ProposalRegistry` (v2) | `0x058b9e29599a1f20fd316254b965bcf7feaed7b4d48268055c1ba38d500602ff` |
| `GovernanceAnonymizer` (v2) | `0x03986832c64ebc2e73395405d77577062021b49e749acf10ec3074ceb3e355b7` |
| ballot domain | `0x725eaed3ac4a3056ab56c0075aaac0b62408006a46d5c3c2cc90d866e24e5cd` |
| STRK20 pool (Sepolia) | `0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91` |

Deployed 2026-08-23. The domain was verified against an independent derivation
**before** the anonymizer went out, because the anonymizer's registry pointer is
write-once and a wrong one is permanent.

Four contracts are superseded; `packages/strk20-governance/src/deployments.ts`
records each with its reason. Two are worth repeating here:

- The **v1 anonymizer** at `0x00533fed…` holds **20.5 STRK nobody can recover.**
  Its payout preimages were displayed and never saved, and it has no sweep. Same
  failure as the 14 STRK on mainnet, made twice. Tickets are now written to disk
  before anything is submitted.
- The **first v2 pair** was never used. It was deployed hours before a
  pre-flight adversarial review found two bugs in it, and the contracts are
  immutable, so they are dead rather than old. See
  `docs/evidence/2026-08-23-cap-burning.md`.

### A sealed ballot, cast inside its own window (proposal 2)

Window `13939965 .. 13942666`, about 75 minutes at Sepolia's measured 1.67s per
block.

| | |
|---|---|
| shield 5 STRK (public) | `0x20b7f722…174c59c` at block 13940005 |
| **cast (private)** | `0x1d6bf8c2…f54724e` at block **13940053** |
| finalize | `0x6876126f…34bb538` at block 13962089 |

Both inside the window. Published on-chain:

    tally             for 5 STRK, against 0, abstain 0
    counted_through   13942666      (equals end_block, which finalize asserts)
    provenance        BallotDerived
    has_passed        true

The counted-through block is the part v1 could not do. A tally's validity depends
entirely on the block it was pinned to — the same ballot box counted through two
different blocks gives two different answers — and v1 published no pin at all.
That is not hypothetical here: **the earlier Sepolia result published as 5 STRK
counted a ballot that arrived 945 blocks after voting closed**, and re-counting it
with the current worker returns zero. This document once called that "just after"
the close and said the count was sound; both were generous, and the working is in
`docs/evidence/2026-08-23-late-ballot.md`. The old result stays on the record with
that note rather than being quietly dropped.

v2 makes the valid pin unique per proposal, so anyone can re-run the count against
the same state and compare. It does not make the sum provable. It makes the claim
checkable, which it was not before.

### A payout registered **and claimed**

The first claimed payout on any network.

| | |
|---|---|
| authorize (registry, gas only) | `0x45bad365…80032b3` at block 13962124 |
| register (pool → anonymizer) | `0x55c684b0…dc26acb` at block 13962132 |
| **claim** (preimage → open note) | `0x63843f32…7867f0e` at block 13962149 |

Afterwards, read from the chain:

    registry    authorized(2)  2 STRK of a 3 STRK cap
    anonymizer  spent(2)       2 STRK          <- the two contracts agree
    anonymizer  outstanding    0
    anonymizer  unattached     0               <- nothing stranded
    anonymizer  entry.claimed  true

This document previously said the claim leg "still fails with `NON_ZERO_VALUE`
and is unfinished — the register leg is what the scoring requires, and chasing
the rest was not the best use of the time." The cause was a stale note index:
discovery and proving share one block parameter, so a pin chosen before the
transaction it depends on reads pre-transaction state, and the pool rejects the
resulting index by naming a storage slot rather than the staleness. Waiting for
the settled pin to pass the register transaction fixed it.
`docs/evidence/2026-08-23-claim-leg-diagnosis.md`.

### The cap-burn attack, attempted against the live contract

An unlicensed registration, built exactly as an outsider would build it:

    REFUSED with PAYOUT_NOT_AUTHORIZED, spent unchanged at 2000000000000000000

Refused during fee estimation, before submission, so it cost nothing. Re-runnable
with `node services/tally/src/probe-cap-burn.ts <proposal> <amount>`.

This matters because the contract tests could not have found the bug: every one
of them approached `register_payout` as the DAO, which is exactly the blind spot
that let it through. A passing suite also cannot tell you the deployed bytecode
is the code you tested. This can.

### Configuration, not constants

`INDEXER_URL` and `PROVING_SERVICE_URL` are configuration, and the values that
work are public infrastructure rather than secrets:

    discovery-service.alpha-sepolia.sw-dev.io     transaction-prover.alpha-sepolia.sw-dev.io
    discovery-service.alpha-mainnet.sw-dev.io     transaction-prover.alpha-mainnet.sw-dev.io

They ship as defaults in `.env.example`. Withholding them helped nobody: a
newcomer following the README hit `PROVING_SERVICE_URL is required` while five
files in this repository told them no such URL existed.
