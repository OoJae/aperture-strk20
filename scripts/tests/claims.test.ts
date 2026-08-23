/**
 * Claims the repository makes about itself, checked against the repository.
 *
 * Every assertion here corresponds to a statement that was false when the audit
 * ran. RUBRIC_MAP.md froze at the scaffold commit and spent months telling a
 * reader that nothing was built; CLAUDE.md said "Nothing is deployed and
 * strk20.json is empty" while two contracts were live; three files disagreed
 * about how many payouts had run. None of that was caught because nothing
 * checked prose against fact.
 *
 * This is that check. It is deliberately mechanical: a count in a sentence is a
 * claim, and a claim can be verified.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { ACTIVE, scoring } from "../../packages/strk20-governance/src/deployments.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

function tracked(): string[] {
  return execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

test("no file still describes the project as Phase 0", () => {
  const offenders: string[] = [];
  for (const file of tracked()) {
    if (file.startsWith("docs/evidence/")) continue; // evidence quotes the old text
    if (file === "scripts/tests/claims.test.ts") continue; // this scanner names the string it hunts
    if (file.endsWith(".png") || file.endsWith(".svg")) continue;
    let content: string;
    try {
      content = read(file);
    } catch {
      continue;
    }
    // "Phase 0" as a status claim. The audit found it in five files, including
    // the one every session is told to read first.
    for (const [i, line] of content.split("\n").entries()) {
      if (/Phase 0/.test(line) && !/was Phase 0|no longer|used to|formerly/i.test(line)) {
        offenders.push(`${file}:${i + 1}: ${line.trim().slice(0, 90)}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `stale Phase 0 status:\n${offenders.join("\n")}`);
});

test("the payout count quoted on the landing page matches the ledger", () => {
  const page = read("apps/web/app/page.tsx");
  // It must be derived, not typed. A literal here is how "3" survived until
  // there were six.
  assert.match(
    page,
    /scoring\(ACTIVE\)\.length/,
    "apps/web/app/page.tsx should derive the payout count from the ledger, not hardcode it",
  );
  assert.ok(scoring(ACTIVE).length >= 3, "fewer scoring transactions than the floor requires");
});

test("the quoted test count is generated, and current", () => {
  const page = read("apps/web/app/page.tsx");
  assert.match(
    page,
    /TEST_COUNTS\.total/,
    "apps/web/app/page.tsx should read the generated count, not quote a literal",
  );
  execFileSync("node", ["scripts/sync-counts.ts", "--check"], { cwd: ROOT, stdio: "pipe" });
});

function countCairoTests(): number {
  let n = 0;
  for (const file of tracked().filter((f) => f.startsWith("contracts/tests/"))) {
    n += (read(file).match(/^\s*#\[test\]/gm) ?? []).length;
  }
  return n;
}

function countTsTests(): number {
  let n = 0;
  const walk = (dir: string) => {
    for (const entry of readdirSync(resolve(ROOT, dir))) {
      const rel = join(dir, entry);
      const full = resolve(ROOT, rel);
      if (entry === "node_modules" || entry === ".git") continue;
      if (statSync(full).isDirectory()) walk(rel);
      else if (entry.endsWith(".test.ts")) {
        const src = readFileSync(full, "utf8");
        n += (src.match(/^\s*(?:test|it)\(/gm) ?? []).length;
      }
    }
  };
  walk("packages");
  walk("scripts");
  return n;
}

test("no contract address is hardcoded outside the source of truth", () => {
  // Addresses lived in four files and drifted. chain.ts re-exports them; nothing
  // else in the app should carry a literal.
  const offenders: string[] = [];
  for (const file of tracked()) {
    if (!file.startsWith("apps/web/app/")) continue;
    const content = read(file);
    for (const [i, line] of content.split("\n").entries()) {
      const match = line.match(/0x[0-9a-fA-F]{55,64}/);
      if (match && !line.trimStart().startsWith("*") && !line.trimStart().startsWith("//")) {
        offenders.push(`${file}:${i + 1}: ${match[0].slice(0, 22)}…`);
      }
    }
  }
  assert.deepEqual(offenders, [], `hardcoded addresses:\n${offenders.join("\n")}`);
});

test("the site does not claim nobody can see a ballot", () => {
  // The operator can. The trust page said so while the homepage denied it.
  for (const file of tracked().filter((f) => f.startsWith("apps/web/app/") && f.endsWith(".tsx"))) {
    const content = read(file);
    assert.ok(
      !/Nobody sees the choice/.test(content),
      `${file} still claims nobody sees the choice; the tally operator does`,
    );
  }
});
