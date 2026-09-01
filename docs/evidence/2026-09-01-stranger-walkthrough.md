# The README, followed by someone who is not us

2026-09-01, Sepolia.

`CLAUDE.md`'s definition of done ends with "a stranger who can go from the README
to a cast ballot without help". That had been argued from inspection: every
command resolved to a real script, so the walkthrough looked sound. It was not.
This is the record of running it.

## Method

A `git clone` of the repository at `9b10776` into a scratch directory, a `.env`
copied verbatim from `.env.example`, and a **fresh** account created with
`sncast --accounts-file` so nothing touched the maintainer's keyring. The only
deviation from a true stranger: the account was funded with 130 STRK from the
project's own Sepolia operator rather than from `faucet.starknet.io`, because a
faucet is a web form. Everything else is the README, in order, unedited.

## What broke

Six failures, each of which a reader hits before the one below it, and none of
which naming its own cause. Two cost money before appearing.

1. **A verbatim `.env.example` could not deploy.** The file ships the `_SNCAST`
   RPC variants blank and says the plain one is used when they are unset. It was
   not: `loadEnv` stored `""` and `??` returns an empty string rather than
   falling through, so `deploy.ts` failed with "No RPC configured for sepolia"
   while a working default sat two lines above it in the same file. `config.ts`
   had skipped blanks for exactly this reason since August; the five copies of
   `loadEnv` never got the fix.

2. **The committed state file resumed across contract generations.**
   `deployments/sepolia.json` records this project's v2 deployment, and a
   recorded registry means "skip the deploy". The run therefore compared a v2
   registry's `ballot_domain` against a v3-epoch derivation and threw — *after*
   declaring and deploying a `TreasuryMultisig`. Nothing in any document
   mentioned the file.

3. **`deployments/params.json` made the registry unusable by its deployer.**
   `owner` and `multisigSigners` are fixed at construction and both named this
   project's maintainer. A stranger got a registry whose `create_proposal`
   reverts `NOT_ALLOWED_PROPOSER` for them, with an owner-only escape hatch they
   do not hold, and a multisig they can never reach quorum on. The file is
   referenced in no README and no doc.

4. **`import-sncast-account.ts` could not see the account.** It only ever read
   `~/.starknet_accounts`, so an account created with sncast's own
   `--accounts-file` was invisible to it.

5. **The documented two-command pool-actor sequence generated two actors.** The
   README says to run `new-pool-account.ts` once to preview and again with
   `--deploy`. `envValue` returned the *first* match in `.env`, and `.env` begins
   as a copy of `.env.example` where every name is declared blank — so the
   placeholder shadowed the value the first run had appended below it. The second
   run could not see the actor the first had made, generated another, and died on
   "POOL_ACTOR_SALT_SEPOLIA is missing".

6. **"Wait 2015 blocks" was a stack trace.** `WindowStillOpenError` carries a
   precise, actionable message and was caught nowhere, so the most ordinary thing
   a first run does — counting before the window closes — printed a Node crash
   dump over it.

Two more surfaced that were not the walkthrough's fault but ended runs anyway:
the Sepolia discovery service returned unhealthy for about a minute mid-run, and
the public RPC endpoint dropped connections twice. The worker had no retry
anywhere, while `apps/web` had always fallen back across endpoints.

**One of the fixes was itself wrong.** Making `envValue` prefer the *last*
non-blank assignment repaired the duplicate but disagreed with `config.ts`, which
takes the first — so a ballot went to an orphaned address that had never
registered a viewing key. The pool binds an address to a viewing key
**write-once**, so a reader and a writer disagreeing about which line is
authoritative is precisely how an account is stranded forever. Corrected to first
non-blank, matching the one rule the repository already had.

## What then worked, end to end

| Step | Hash |
|---|---|
| Account deployed | `0x707d866f…` |
| `TreasuryMultisig` | `0x017409487652e6f44c65dd4bef6d064eb23ea16269efe2462e01f6c3e18df9a9` |
| `ProposalRegistry` | `0x03d32cf83ae815d12f02cca55ed0236366d559ac63f85fd00bdeee52428b8691` |
| `GovernanceAnonymizer` | `0x03a98ab61ec6fc65d02a5c14e37c5d72a5be56debfc2aab0bffeaba8ba6a8e49` |
| Ballot domain, verified against an independent derivation | `0x3f6f4335ec5baff20d48329617fe22fd2941cf5166b1433b5c7728511e4212b` |
| Proposal 1, window 14381406–14384107 | `0x6ee27511…` |
| Three ballot identities deployed | `0x31fa97fc…`, `0x73d52876…`, `0x7450fdc0…` |
| Their viewing keys registered | `0x1b110f2b…`, `0x1b77eedf…`, `0x149dfd16…` |
| Pool actor deployed and registered | `0x69e36569…`, `0xc0eb9b03…` |
| Ballot 1 — shield, then private transfer | `0x7c9b56ae…`, `0x56c3a48d…` |
| Ballot 2 — shield, then private transfer | `0x75a1acc2…`, `0x70ba8394…` |
| Tally finalized **through the multisig** | `0xccc3c8fe95da9e884a01ebf6f19507516c1c8a763cd0f4da253f36182418f8` |
| **Both ballots refunded in one transaction** | `0x3b2f3c43596badb3138505f4e47e6c1dee5c23d91ba42bdce65ea960524e8fc` |
| Ballot accounts swept | `0x32c553b2…`, `0x2dc6d7e2…`, `0x75d9cf7d…` |

Counted: 10 STRK FOR, 0 against, 0 abstain, turnout 10 against a 5 STRK quorum,
provenance `BallotDerived`, ballot-set commitment
`0x55f9ae081298a9048de027d61dd991c1c31c1c8033a043b4d845a3580a64ac8`.
`counted_through` equals `end_block`, which the contract asserts.

## The batching result

Two ballots at one identity settled in **one** pool transaction rather than two,
for one flat fee instead of two — 2 STRK saved on Sepolia, and the same shape
saves 6 on mainnet. This is the floor: a pool transaction is scoped to one
signing account and one viewing key, and the three choices hold their stakes at
different addresses, so a proposal costs at most three transactions to settle and
never one. Six places in this repository claimed one; they were wrong and have
been corrected.

Re-running `verify-tally` *after* the refund returned the same totals and the
same commitment. That is the property that makes refunding safe rather than a
thing that quietly rewrites the result: discovery reads received-transfer
history, not the unspent-note set, so spending a ballot note cannot move the
count. It is now checked rather than asserted.

## Cost

130 STRK in, 23.8 recovered by `sweep-ballot-accounts.ts`, and 0.5 STRK left in
each identity by design — the account signs its own transfer, so the transaction
that empties it is the one it cannot afford. The README said "a mistake costs
nothing"; it now states the real figure.

## What this deployment is not

The contracts above are owned by a throwaway key and exist only as evidence that
the walkthrough works. They are not the project's Sepolia deployment, are not in
`strk20.json`, and should not be treated as live infrastructure.
