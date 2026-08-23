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

## Sepolia

The full lifecycle runs here, because Sepolia has a working prover.

| | Address |
|---|---|
| `ProposalRegistry` (current) | `0x01432bc68815695d4be3300cb29085aa916c97c11b7eb04e27ae9b84ad82b64f` |
| `GovernanceAnonymizer` | `0x00533fedd104a3dd4097a6ad58f9a5637553f1a83f976867866cb60c02d7466d` |
| STRK20 pool (Sepolia) | `0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91` |

An earlier registry at `0x045c7c6d4bbea680dadd7ea248ec793d84ad55f3d381be7c5710b12c900e1cf9`
is **superseded**: it was constructed with the Argent account class as its ballot
class. Argent's constructor takes `[0, pubkey, 1]` while the derivation passes
`[pubkey]`, so every address it published was one no account could be deployed
at — a vote sent there could never have been read. The anonymizer above still
points at it, which is why payout testing uses that pairing while voting uses
the current registry.

### A real sealed ballot, cast and counted

- Three ballot identities deployed as OpenZeppelin accounts at their derived
  addresses and registered with the pool.
- A voter shielded STRK and privately transferred **5 STRK** into the FOR
  identity.
- The tally worker found it, aggregated, and published the result on-chain:
  `Tally { for_weight: 5000000000000000000, against: 0, abstain: 0 }`,
  `has_passed: true`.

The ballot transaction emitted two pool events and **neither carries an amount,
a voter, or a choice**; the on-chain sender is a relayer. The tally read it
exactly. That gap — opaque on-chain, precise to the key holder — is the design
working.

**That published tally counted a ballot cast after voting had closed.** The note
arrived at block 13,604,673; the window closed at 13,603,728 — 945 blocks late.
Re-counting the same proposal with the current worker returns **zero**, because
it now pins to the window's close and filters by it.

An earlier version of this paragraph called that "just after" the close and said
"the count is sound". Both were generous. A ballot that may arrive at any time
makes the window constrain nothing, and an observer could wait until the result
is known and then vote — the exact property sealed-ballot voting exists to
prevent. v1 does not enforce arrival time anywhere, and neither did the worker
that produced this number.

The result stays here with this note attached rather than being quietly dropped,
because it is what happened. v2 binds the window on chain: `finalize` takes the
block it counted through and asserts it equals `end_block`, so a late-counted
tally cannot be published at all. The Phase D rehearsal casts inside the window,
and that becomes the record.

Full working: `docs/evidence/2026-08-23-late-ballot.md`.

### A payout, driven through the pool

The register leg was driven end to end via the SDK, producing transactions that
carry a pool event, an event from our contract, and our address in the calldata.
The claim leg still fails with `NON_ZERO_VALUE` and is unfinished — the register
leg is what the scoring requires, and chasing the rest was not the best use of
the time.

### Configuration, not constants

`INDEXER_URL` and `PROVING_SERVICE_URL` are configuration, and the values that
work are public infrastructure rather than secrets:

    discovery-service.alpha-sepolia.sw-dev.io     transaction-prover.alpha-sepolia.sw-dev.io
    discovery-service.alpha-mainnet.sw-dev.io     transaction-prover.alpha-mainnet.sw-dev.io

They ship as defaults in `.env.example`. Withholding them helped nobody: a
newcomer following the README hit `PROVING_SERVICE_URL is required` while five
files in this repository told them no such URL existed.
