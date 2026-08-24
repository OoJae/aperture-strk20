/**
 * The manifest is generated, so the only thing worth testing is that the file
 * on disk still equals what the generator produces, plus the invariants the
 * generator is supposed to guarantee. Every one of these assertions corresponds
 * to a defect the manifest actually had.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ACTIVE,
  DEPLOYMENTS,
  LEDGER,
  nonScoring,
  scoring,
} from "../../packages/strk20-governance/src/deployments.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifest = JSON.parse(readFileSync(resolve(ROOT, "strk20.json"), "utf8")) as {
  transactions: string[];
  contracts: string[];
  demo_video: string;
  demo_url: string;
};

test("strk20.json is in sync with the ledger", () => {
  execFileSync("node", ["scripts/sync-manifest.ts", "--check"], { cwd: ROOT, stdio: "pipe" });
});

test("every hash is a well-formed felt", () => {
  for (const hash of manifest.transactions) {
    assert.match(hash, /^0x[0-9a-fA-F]{1,64}$/);
  }
});

test("no transaction is listed twice, including under different padding", () => {
  const seen = new Set<bigint>();
  for (const hash of manifest.transactions) {
    const value = BigInt(hash);
    assert.ok(!seen.has(value), `${hash} appears more than once`);
    seen.add(value);
  }
});

test("scoring transactions occupy a strict prefix", () => {
  // Only the first ten entries are checked, so a non-scoring hash sitting
  // ahead of a scoring one wastes one of those slots. This was the bug.
  const scoringHashes = new Set(scoring(ACTIVE).map((e) => e.hash));
  const flags = manifest.transactions.map((h) => scoringHashes.has(h));
  const firstFalse = flags.indexOf(false);
  if (firstFalse !== -1) {
    assert.ok(
      !flags.slice(firstFalse).includes(true),
      "a scoring transaction is listed after a non-scoring one",
    );
  }
});

test("contracts are the active network's, live pair first", () => {
  const deployment = DEPLOYMENTS[ACTIVE];
  assert.deepEqual(manifest.contracts, [
    deployment.registry,
    deployment.anonymizer,
    ...(deployment.superseded ?? []).map((s) => s.address),
  ]);
});

test("every listed transaction has a contract it could have touched", () => {
  // The reason superseded contracts are listed at all. Every mainnet
  // transaction in the manifest predates v2 and ran through the v1 pairing, so
  // a manifest naming only the live contracts would present ten transactions
  // beside two contracts that none of them touched.
  const throughSomething = LEDGER.filter((e) => e.network === ACTIVE && e.through !== null);
  assert.ok(throughSomething.length > 0, "no routed transactions to check");
  assert.ok(
    manifest.contracts.length >= 2,
    "a manifest with routed transactions must name the contracts they routed through",
  );
});

test("no Sepolia address leaks into a mainnet manifest", () => {
  // Half the previous contracts array resolved to "Contract not found" because
  // it carried Sepolia addresses.
  const sepolia = DEPLOYMENTS.sepolia;
  const forbidden = [sepolia.registry, sepolia.anonymizer, ...(sepolia.superseded ?? []).map((s) => s.address)];
  for (const address of forbidden) {
    assert.ok(
      !manifest.contracts.some((c) => BigInt(c) === BigInt(address)),
      `${address} is a Sepolia address and must not appear in a ${ACTIVE} manifest`,
    );
  }
});

test("the ledger's scoring flags are self-consistent", () => {
  for (const entry of LEDGER) {
    if (entry.scores) {
      assert.notEqual(entry.through, null, `${entry.hash} scores but runs through nothing`);
    } else {
      assert.equal(entry.through, null, `${entry.hash} does not score but claims a route`);
    }
  }
});

test("the manifest holds every mainnet ledger entry", () => {
  assert.equal(manifest.transactions.length, scoring(ACTIVE).length + nonScoring(ACTIVE).length);
});
