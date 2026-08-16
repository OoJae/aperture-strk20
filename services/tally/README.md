# Tally service

Reads the ballot notes for each choice of a closed proposal, sums them, and
posts **only the aggregate** to `ProposalRegistry.finalize()`. Individual
ballots never leave this process.

This service holds the DAO viewing key, so it runs server-side or as a local
CLI — never in the browser.

## Design notes

Note discovery in the STRK20 SDK is scoped to a single viewing key: one key
sees one identity's inbox, and there is no third-party enumeration API. So the
service instantiates **one SDK client per ballot identity** (proposal × choice)
and sums that identity's notes. Discovery is cursor-based rather than
block-ranged, and the resulting registry is carried forward between scans
instead of rebuilt.

## Known blocker (as of 2026-08-16)

The STRK20 mainnet indexer and proving-service URLs are not published yet — the
Day-0 walkthrough still lists both as pending. Until they exist, this service
runs against Sepolia. Wallet-route transactions (shielding, ballots cast from
the browser) are unaffected, because the wallet supplies its own infrastructure.
