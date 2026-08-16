# Working rules for Aperture

Read this first in any new session. It is the condensed operating manual:
ground rules, the API facts that differ from what you might assume, and where
things live.

## Ground rules

1. **Secrets.** Every key lives in `.env`, which is gitignored. `.env.example`
   carries blank values only. Never print, commit, or hardcode a key. The DAO
   viewing key is server-side only and must never reach browser code.
2. **Mainnet gate.** Any transaction that spends real funds or writes to
   Starknet mainnet needs the maintainer's explicit go-ahead in that session,
   with a one-line summary of what it does and what it costs. Sepolia is
   free-fire.
3. **Verify at build time.** Before writing code against any STRK20 symbol,
   confirm its current name and signature in the docs mirror at
   `https://strk20-by-example.org/llms-full.txt`. The docs win over any local
   note, including this file. Flag drift when you find it.
4. **Pins.** `starknet@^10.4.0` in every `package.json` — a bare install
   resolves to a version without the STRK20 API. Cairo toolchain: Scarb 2.20.0,
   Starknet Foundry 0.63.0, `snforge_std` 0.63.0. CI pins the same versions.
5. **Build in public.** Commit small, push often, conventional commits. Keep
   `strk20.json` current — append every mainnet hash the moment it lands, using
   `node scripts/record-tx.ts <hash>`. Never batch this for later.
6. **Honesty.** Never overclaim privacy. `docs/TRUST_MODEL.md` is the reference
   for what is private, what is public, and what is trusted; the README and demo
   must not claim more than it does.
7. **Testing.** Every contract path gets an `snforge` test: access control,
   double-claim, balance accounting, and a fuzzed claim preimage. Ballot-identity
   derivation and tally math get TypeScript tests. The full lifecycle must be
   green on Sepolia before anything is deployed to mainnet.

## API facts that contradict common assumptions

Verified against the docs mirror and the reference implementations on
2026-08-16. Each of these will bite if assumed otherwise.

1. **There is no `useStrk20` hook in the STRK20 API.** The name belongs to a
   third-party wrapper with no documented signatures. The reference kit uses
   plain state plus direct method calls on the wallet account object. Our own
   hooks are ours to write.
2. **On the wallet route, shielding is one call.** You send a single `deposit`
   action and the wallet performs the token approval internally, so the user
   sees two confirmations for one action. Say "two confirmations", not "two
   transactions you send". The explicit two-transaction approve-then-deposit
   sequence exists only on the SDK route, where nothing does it for you.
3. **The wire action names are `deposit`, `withdraw`, and `transfer`.** Shield
   and unshield are user-facing labels, not protocol verbs.
4. **The Privacy SDK comes from GitHub Packages — installed and working.**
   `@starkware-libs/starknet-privacy-sdk` is pinned at **`0.14.3-rc.5`** in
   `services/tally`. The registry pointer lives in the committed `.npmrc`; the
   auth token lives only in `~/.npmrc`, never in the repo. Setup needs a token
   carrying `read:packages` (`gh auth refresh -h github.com -s read:packages`).

   Both token-free routes were tested on 2026-08-16 and **neither works**:
   `pnpm add "github:starkware-libs/starknet-privacy#path:/sdk"` resolves but
   installs only `README.md` and `package.json`, because the package declares
   `files: ["dist"]` and `dist/` is built at publish time with no `prepare`
   script — importing it throws `ERR_MODULE_NOT_FOUND`. Building the SDK from a
   standalone clone of `sdk/` fails too (`Cannot find module 'hpke'`, a
   workspace sibling). Do not burn time re-deriving this.

   **Its 23 exports, verified by import:** `createPrivateTransfers`,
   `IndexerDiscoveryProvider`, `ProvingServiceProofProvider`, `ProvingService`,
   `SimplePrivateTransfersImpl`, `Open`, `All`, `AddressMap`, `Channel`,
   `Witness`, `SetupRequirement`, `MAX_VIEWING_KEY`, `createEmptyRegistry`,
   `buildHistoryCursor`, `classifyTransaction`, `OhttpClient`, `WarningCode`,
   `ShadowAccountAnonymizerABI`, and the screening errors `ScreeningRejected`,
   `ScreeningUnavailable`, `screeningErrorFromProvingError`,
   `ProvingServiceError`, `ProvingServiceHttpError`.

   **Not exported, so we write them ourselves:** `computeCommitmentHash`,
   `buildClaimInvoke`, `generateEscrowSecret`, `parseEscrowSecret`,
   `buildClaimUrl`. Those appear in the escrow POC only because it built the
   SDK from source locally.

   Treat the monorepo's own quickstart at
   `github.com/starkware-libs/starknet-privacy/blob/main/sdk/README.md` as
   authoritative over any second-hand note, including this one.
5. **`starknet@10.4.x` ships on the npm `next` tag.** The `latest` tag is still
   on 10.0.x. Our `^10.4.0` range currently resolves to 10.7.0, which does
   export `WalletAccountV6` and the `walletV6` namespace — verified at install.
   If you add get-starknet, pin `@starknet-io/get-starknet-discovery` and
   `-wallet-standard` to 6.0.3 explicitly, and `@starknet-io/types-js` to
   0.10.3.
6. **`privacy_invoke` has no fixed signature.** Only the return type,
   `Span<OpenNoteDeposit>`, is part of the contract. The parameters are ours to
   design, which is why our anonymizer can front several verbs from one entry
   point via an operation enum.
7. **Open-note amounts are public.** A treasury payout hides the recipient, not
   the amount. Do not describe it otherwise.
8. **Note discovery is cursor-based and scoped to a single viewing key.** There
   are no block-range parameters and no third-party enumeration, so the tally
   worker runs one client per ballot identity. The alternative discovery
   provider is not exported from the published package, so an indexer is
   required.
9. **No indexer or proving-service URL is published for EITHER network** — not
   mainnet, not Sepolia. The SDK repo still ships `TODO_MAINNET_INDEXER_URL`,
   and `ContractDiscoveryProvider` is confirmed absent from the package's
   exports, so an indexer is mandatory and we do not have one. This gates the
   whole SDK route. The **wallet route is unaffected**, because the wallet does
   its own proving and discovery — that is why mainnet transactions are still
   possible today. Do not guess at endpoints; a wrong proving service fails in
   ways that look like our bug. Upstream issue #31 raised exactly this and was
   never answered (self-closed after 13 hours), so do not wait on a reply.
10. **Calldata placeholders are literal strings.** `"OPEN"`, `"${poolAddress}"`,
    and `"${openNoteIds[0]}"` are substituted by the wallet. Never normalize
    them to hex; only real token and amount values get converted.

## Protocol invariants

- Notes mature ten blocks after creation, so freshly shielded funds cannot vote
  immediately. Surface the wait in the UI.
- Proving takes roughly half a minute. Every private action needs a real
  progress state, not a spinner that reads as hung.
- At most one external invoke per pool transaction.
- Deposits are screened on-chain on every route; a flagged deposit reverts.
- Sub-accounts are reachable only from the SDK route, never from a browser
  wallet — so delegation, if we build it, lives server-side.
- Private transactions are relayed, so the on-chain sender is a relayer.
  Eligibility is judged from the pool's own deposit event, not the sender.

## Constants

| Thing | Value |
|---|---|
| STRK20 pool, mainnet | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` |
| STRK20 pool, Sepolia | `0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91` |
| Chain | `SN_MAIN` / `SN_SEPOLIA` |
| RPC | From `.env` only, never inline. No-key defaults in `.env.example` |
| Sepolia faucet | `https://faucet.starknet.io` — 100 STRK per address per 24h |
| Docs mirror | `https://strk20-by-example.org/llms-full.txt` |

Starknet fees are **STRK-denominated**, not ETH — guides that say to fund a
testnet account with ETH predate v0.14 and are wrong. Accounts are contracts and
must be deployed before they can transact: `sncast account create` prints a
counterfactual address, you fund *that* address, then `sncast account deploy`.
Funding between those two steps is mandatory, not optional.

## Layout

`contracts/` Cairo (Scarb + Foundry) · `packages/strk20-governance` shared TS
package · `apps/web` demo dapp · `services/tally` server-side tally worker ·
`scripts/` tooling · `docs/` architecture, trust model, rubric map ·
`strk20.json` the scored manifest at the repo root.

## Where we are

Phase 0: scaffold, registration, validation questions. Nothing is deployed and
`strk20.json` is empty.

## Definition of done

A public MIT-licensed repo, a live demo on mainnet with no login wall, a
three-minute video, and at least three verified pool-touching mainnet
transactions in `strk20.json`. Beyond that: more recorded transactions covering
the anonymizer and claim paths, a published package, rubric-mapped docs, and a
stranger who can go from the README to a cast ballot without help.
