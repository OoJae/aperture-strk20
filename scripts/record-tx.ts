/**
 * Append a transaction hash to `strk20.json`.
 *
 * Run this the moment a hash lands, never in a batch later — `strk20.json` is
 * what the judges' pipeline reads, and a hash that only exists in a terminal
 * scrollback is a hash that does not count.
 *
 *   node scripts/record-tx.ts 0xabc123...
 *   node scripts/record-tx.ts --contract 0xdef456...
 *
 * The organizers verify each hash against mainnet: it must exist, have
 * succeeded, and have emitted at least one event from the STRK20 pool. Only the
 * first ten entries are checked, so ordering matters once the list grows.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HASH_PATTERN = /^0x[0-9a-fA-F]{1,64}$/;
const VERIFIED_LIMIT = 10;

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = resolve(HERE, "..", "strk20.json");

interface Manifest {
  transactions: string[];
  contracts: string[];
  demo_video: string;
  demo_url: string;
}

function readManifest(): Manifest {
  const raw = readFileSync(MANIFEST_PATH, "utf8");
  const parsed = JSON.parse(raw) as Partial<Manifest>;
  return {
    transactions: parsed.transactions ?? [],
    contracts: parsed.contracts ?? [],
    demo_video: parsed.demo_video ?? "",
    demo_url: parsed.demo_url ?? "",
  };
}

function writeManifest(manifest: Manifest): void {
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
}

/**
 * Hashes are compared numerically: the same value can be written with or
 * without leading-zero padding, and both refer to one transaction.
 */
function isSameHash(a: string, b: string): boolean {
  try {
    return BigInt(a) === BigInt(b);
  } catch {
    return a.toLowerCase() === b.toLowerCase();
  }
}

function main(argv: string[]): number {
  const args = argv.slice(2);
  const isContract = args[0] === "--contract";
  const value = isContract ? args[1] : args[0];
  const field = isContract ? "contracts" : "transactions";

  if (!value) {
    console.error("Usage: node scripts/record-tx.ts [--contract] <0x-hash>");
    return 1;
  }

  if (!HASH_PATTERN.test(value)) {
    console.error(
      `Rejected "${value}": expected 0x followed by 1-64 hex digits.`,
    );
    return 1;
  }

  const manifest = readManifest();
  const existing = manifest[field];

  if (existing.some((entry) => isSameHash(entry, value))) {
    console.log(`Already recorded in ${field}: ${value}`);
    return 0;
  }

  existing.push(value);
  writeManifest(manifest);

  console.log(`Recorded in ${field}: ${value}`);
  console.log(`${field} now holds ${existing.length} entr${existing.length === 1 ? "y" : "ies"}.`);

  if (field === "transactions" && existing.length > VERIFIED_LIMIT) {
    console.warn(
      `Only the first ${VERIFIED_LIMIT} transactions are verified by the ` +
        `organizers; ${existing.length - VERIFIED_LIMIT} entr` +
        `${existing.length - VERIFIED_LIMIT === 1 ? "y is" : "ies are"} past that cutoff.`,
    );
  }

  return 0;
}

process.exit(main(process.argv));
