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

/** The Ready/Argent v0.4 account class, as deployed on mainnet. */
const CLASS_HASH =
  "0x036078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f";

/** Stand-in for the DAO master public key; only its arithmetic matters here. */
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
