/**
 * The environment contract, checked.
 *
 * The previous .env.example declared four variables nothing read and omitted
 * thirteen the tally worker required — including the one secret without which
 * nothing runs at all. MissingConfigError told the operator to copy that file
 * to fix it. Nobody noticed because nothing compared the two.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { ENV_SPEC } from "../../services/tally/src/env-spec.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

test(".env.example is in sync with the spec", () => {
  execFileSync("node", ["scripts/sync-env-example.ts", "--check"], { cwd: ROOT, stdio: "pipe" });
});

test("every variable the code reads is declared in the spec", () => {
  const files = execFileSync("git", ["ls-files", "services", "scripts"], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter((f) => f.endsWith(".ts"));

  const declared = new Set(ENV_SPEC.map((v) => v.name));
  const undeclared = new Set<string>();

  for (const file of files) {
    const src = readFileSync(resolve(ROOT, file), "utf8");
    for (const m of src.matchAll(/(?:process\.)?env(?:\.|\[")([A-Z][A-Z0-9_]*)/g)) {
      const name = m[1]!;
      if (!declared.has(name)) undeclared.add(`${name} (${file})`);
    }
  }

  assert.deepEqual(
    [...undeclared].sort(),
    [],
    `read by code but missing from env-spec.ts:\n${[...undeclared].join("\n")}`,
  );
});

test("no secret carries a committed example value", () => {
  for (const spec of ENV_SPEC) {
    if (spec.secret) {
      assert.equal(spec.example, undefined, `${spec.name} is a secret and must have no example`);
    }
  }
});

test("the example file contains no value that looks like a key", () => {
  const text = readFileSync(resolve(ROOT, ".env.example"), "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.+)$/);
    if (!m) continue;
    const [, name, value] = m;
    // Addresses and class hashes are public and legitimately committed; a
    // 60+ hex-char value on a variable marked secret is not.
    const spec = ENV_SPEC.find((v) => v.name === name);
    if (spec?.secret) {
      assert.fail(`${name} is marked secret but has a value in .env.example`);
    }
    assert.ok(value !== undefined);
  }
});
