/**
 * Generate the DAO's own key material. Sends no transaction.
 *
 *   node scripts/new-dao-keys.ts [--network sepolia]
 *
 * A fresh clone needs three values that nothing else can supply, and they are
 * not independent — the loader rejects a set that does not hang together:
 *
 *   DAO_BALLOT_ACCOUNT_PRIVATE_KEY  signs for every ballot identity
 *   DAO_MASTER_PUBLIC_KEY           must be that key's Stark public half,
 *                                   because ballot addresses derive from it
 *   DAO_BALLOT_VIEWING_SEED         seeds every per-ballot viewing key, and has
 *                                   to land in [1, MAX_VIEWING_KEY]
 *
 * Working that out by hand from the error messages is possible and nobody
 * should have to. Deriving the public half from the private one is the part
 * that bites: a mismatched pair produces perfectly valid-looking ballot
 * addresses that no account can ever be deployed at, and the failure surfaces
 * much later, after those addresses have been published and funded.
 *
 * The seed is deliberately NOT derived from the signing key. One scalar doing
 * both jobs is how this project ended up disclosing a spending key to an
 * indexer: viewing keys are sent in cleartext, signing keys must never be.
 */

import { Buffer } from "node:buffer";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ec, num } from "starknet";

import {
  MAX_VIEWING_KEY,
  assertValidViewingKey,
} from "../packages/strk20-governance/src/viewing-key.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENV = resolve(ROOT, ".env");

function upsert(name: string, value: string): void {
  let env = existsSync(ENV) ? readFileSync(ENV, "utf8") : "";
  const pattern = new RegExp(`^${name}=.*$`, "m");
  if (pattern.test(env)) env = env.replace(pattern, `${name}=${value}`);
  else env += `${env.endsWith("\n") || env === "" ? "" : "\n"}${name}=${value}\n`;
  writeFileSync(ENV, env, { mode: 0o600 });
}


const randomFelt = (): string =>
  `0x${Buffer.from(ec.starkCurve.utils.randomPrivateKey()).toString("hex")}`;

function randomViewingKey(): bigint {
  for (;;) {
    const candidate = BigInt(randomFelt());
    if (candidate > 0n && candidate <= MAX_VIEWING_KEY) return candidate;
  }
}

function alreadySet(name: string): boolean {
  try {
    return readFileSync(ENV, "utf8")
      .split("\n")
      .some((l) => l.startsWith(`${name}=`) && l.slice(name.length + 1).trim() !== "");
  } catch {
    return false;
  }
}

function main(): number {
  const names = [
    "DAO_BALLOT_ACCOUNT_PRIVATE_KEY",
    "DAO_MASTER_PUBLIC_KEY",
    "DAO_BALLOT_VIEWING_SEED",
  ];
  const set = names.filter(alreadySet);
  if (set.length > 0 && !process.argv.includes("--force")) {
    console.error(
      `Refusing to overwrite: ${set.join(", ")} already set.\n\n` +
        `Rotating these is not a fresh start — it changes every ballot address\n` +
        `this DAO publishes and makes every already-registered ballot\n` +
        `unreadable. Pass --force only if that is what you want.`,
    );
    return 1;
  }

  const privateKey = randomFelt();
  const publicKey = ec.starkCurve.getStarkKey(privateKey);
  const seed = randomViewingKey();
  assertValidViewingKey(seed);

  // Replaced in place, not appended: .env.example ships these as blank
  // placeholders, and an appended duplicate sits below one that already
  // declared the name.
  upsert("DAO_BALLOT_ACCOUNT_PRIVATE_KEY", privateKey);
  upsert("DAO_MASTER_PUBLIC_KEY", publicKey);
  upsert("DAO_BALLOT_VIEWING_SEED", num.toHex(seed));

  console.log("Wrote three values to .env (gitignored). Nothing was sent.\n");
  console.log(`  DAO_MASTER_PUBLIC_KEY  ${publicKey}`);
  console.log(`  the private half and the viewing seed are in .env\n`);
  console.log("Keep them. Changing the seed makes every registered ballot");
  console.log("unreadable; changing the signing key orphans every ballot address.");
  return 0;
}

process.exit(main());
