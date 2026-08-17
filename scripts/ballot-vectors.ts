/**
 * Regenerate the ballot-address vectors asserted in
 * `contracts/tests/test_ballot.cairo`.
 *
 *   node scripts/ballot-vectors.ts
 *
 * Voters derive their ballot destination in the browser with starknet.js; the
 * registry derives it in Cairo. Those two implementations agreeing is what puts
 * a vote somewhere the DAO can actually read it, so the Cairo test pins its
 * output against what this prints.
 *
 * The address is a single hash-on-elements over five inputs — prefix, deployer,
 * salt, class hash, and the constructor-calldata hash — each chain carrying a
 * leading zero and a trailing element count. A nested pedersen chain produces a
 * plausible but wrong address.
 */

import { hash } from "starknet";

/**
 * The OpenZeppelin account class, declared identically on mainnet and Sepolia.
 *
 * This must be a class whose constructor takes exactly `[public_key]`, because
 * that is the calldata the derivation hashes. The Argent class takes
 * `[0, pubkey, 1]`, so deriving against it yields addresses that look fine and
 * correspond to no deployable account — a vote sent to one could never be read.
 */
const CLASS_HASH =
  "0x5b4b537eaa2399e3aa99c4e2e0208ebd6c71bc1467938cd52c798c601e43564";

/** Fixed sample key. Only its arithmetic matters for the pinned vectors. */
const MASTER_PUB =
  "0x1818d42721b097dd91b7495207bc12bd38c73bd66cdb7bcf38c4e41902c1d4b";

const SALTS = ["0x1", "0x2a"] as const;

for (const salt of SALTS) {
  const address = hash.calculateContractAddressFromHash(
    salt,
    CLASS_HASH,
    [MASTER_PUB],
    0,
  );
  console.log(`salt ${salt.padEnd(6)} -> ${address}`);
}
