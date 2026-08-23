/**
 * Generate strk20.json from the ledger.
 *
 * The manifest used to be hand-appended, and it drifted: two of its four
 * `contracts` entries were Sepolia addresses that do not exist on mainnet, and
 * the three transactions that score nothing occupied the first three slots —
 * the only ten the organisers check. Generating it removes both failure modes
 * by construction rather than by care.
 *
 *   node scripts/sync-manifest.ts            write it
 *   node scripts/sync-manifest.ts --check    fail if it would change (CI)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ACTIVE,
  DEMO_URL,
  DEMO_VIDEO,
  DEPLOYMENTS,
  nonScoring,
  scoring,
} from "../packages/strk20-governance/src/deployments.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST = resolve(HERE, "..", "strk20.json");

function render(): string {
  const deployment = DEPLOYMENTS[ACTIVE];

  // Scoring entries lead. record-tx.ts notes that only the first ten are
  // checked, so the ordering is load-bearing, not cosmetic.
  const transactions = [...scoring(ACTIVE), ...nonScoring(ACTIVE)].map((e) => e.hash);

  // Only contracts that exist on the network being submitted. Sepolia
  // addresses are excluded by construction — putting them here is what made
  // half the previous array resolve to "Contract not found".
  const contracts = [deployment.registry, deployment.anonymizer];

  return `${JSON.stringify({ transactions, contracts, demo_video: DEMO_VIDEO, demo_url: DEMO_URL }, null, 2)}\n`;
}

const wanted = render();
const check = process.argv.includes("--check");
const current = (() => {
  try {
    return readFileSync(MANIFEST, "utf8");
  } catch {
    return "";
  }
})();

if (check) {
  if (current === wanted) {
    console.log("strk20.json is in sync with the ledger.");
    process.exit(0);
  }
  console.error("strk20.json is out of sync with packages/strk20-governance/src/deployments.ts.");
  console.error("Run: node scripts/sync-manifest.ts");
  process.exit(1);
}

writeFileSync(MANIFEST, wanted);
const scored = scoring(ACTIVE).length;
const total = scored + nonScoring(ACTIVE).length;
console.log(`strk20.json written: ${total} transactions on ${ACTIVE}, ${scored} through our own contracts.`);
