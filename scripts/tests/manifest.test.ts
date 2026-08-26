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
  touchesPool,
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

/**
 * Only the first ten hashes are ever checked, and two different rules get
 * applied to them: ours (ran through one of our contracts) and the organisers'
 * (emits a pool event). Neither set contains the other.
 *
 * The test above guards ours and passed happily while three of the ten checked
 * slots held a proposal-create, a finalize and a payout-authorize — all ours,
 * none of them visible to the organisers' checker, which read 7/10. Guarding one
 * rule and calling the prefix safe is what let that sit there.
 */
const CHECKED_PREFIX = 10;

test("every checked slot satisfies BOTH scoring rules", () => {
  const byHash = new Map(LEDGER.map((e) => [BigInt(e.hash), e]));
  const prefix = manifest.transactions.slice(0, CHECKED_PREFIX);

  for (const [i, hash] of prefix.entries()) {
    const entry = byHash.get(BigInt(hash));
    assert.ok(entry, `${hash} is in the manifest but not the ledger`);
    assert.equal(
      entry!.scores,
      true,
      `slot ${i + 1} (${hash}) does not run through one of our contracts`,
    );
    assert.equal(
      touchesPool(entry!),
      true,
      `slot ${i + 1} (${hash}) emits no pool event, so the organisers' checker ` +
        `ignores it — a wasted slot out of the only ${CHECKED_PREFIX} they read`,
    );
  }
});

test("the prefix is as long as the qualifying set allows", () => {
  // If more transactions satisfy both rules than there are checked slots, the
  // prefix should be full. If fewer, it should hold all of them — a qualifying
  // transaction left outside the prefix is a slot given away.
  const qualifying = scoring(ACTIVE).filter(touchesPool);
  const want = Math.min(qualifying.length, CHECKED_PREFIX);
  const got = manifest.transactions
    .slice(0, CHECKED_PREFIX)
    .filter((h) => qualifying.some((e) => BigInt(e.hash) === BigInt(h))).length;
  assert.equal(
    got,
    want,
    `${got} of the first ${CHECKED_PREFIX} satisfy both rules, but ${want} could`,
  );
});

test("contracts are the active network's, live set first", () => {
  const deployment = DEPLOYMENTS[ACTIVE];
  assert.deepEqual(manifest.contracts, [
    deployment.registry,
    deployment.anonymizer,
    // The multisig is one of ours too: it is the registry's tally_operator, and
    // a routed finalize emits from both. Omitting it made a call that moved the
    // treasury look like it touched nothing we wrote.
    ...(deployment.multisig ? [deployment.multisig] : []),
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
