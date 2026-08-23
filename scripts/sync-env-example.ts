/**
 * Render .env.example from services/tally/src/env-spec.ts.
 *
 *   node scripts/sync-env-example.ts            write it
 *   node scripts/sync-env-example.ts --check    fail if it would change (CI)
 *
 * The file this replaces declared four variables nothing read and omitted
 * thirteen the worker required, while MissingConfigError told the operator to
 * copy it in order to fix exactly that. Generating it means the instruction and
 * the file cannot disagree.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ENV_SPEC, type EnvVarSpec } from "../services/tally/src/env-spec.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, ".env.example");

const WIDTH = 74;

function wrap(text: string, prefix: string): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && `${prefix}${line} ${word}`.length > WIDTH) {
      lines.push(`${prefix}${line}`);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(`${prefix}${line}`);
  return lines.join("\n");
}

function requirementNote(spec: EnvVarSpec): string {
  switch (spec.requirement) {
    case "always":
      return "Required.";
    case "mainnet":
      return "Required when APERTURE_NETWORK=mainnet.";
    case "sepolia":
      return "Required when APERTURE_NETWORK=sepolia.";
    case "optional":
      return "Optional.";
  }
}

function render(): string {
  const header = `# Aperture — configuration.
#
# Copy to .env and fill in the blanks. .env is gitignored and must stay that
# way. Nothing in this file is a secret, and nothing secret belongs in it.
#
# GENERATED from services/tally/src/env-spec.ts by
# \`node scripts/sync-env-example.ts\`. Do not hand-edit: a test fails the build
# if this file and the spec disagree.
`;

  const groups = new Map<string, EnvVarSpec[]>();
  for (const spec of ENV_SPEC) {
    const list = groups.get(spec.group) ?? [];
    list.push(spec);
    groups.set(spec.group, list);
  }

  const sections = [...groups.entries()].map(([group, specs]) => {
    const rule = "─".repeat(Math.max(3, WIDTH - group.length - 6));
    const body = specs
      .map((spec) => {
        const note = `${requirementNote(spec)} ${spec.description}`;
        const doc = wrap(note, "# ");
        const secret = spec.secret ? "\n# SECRET — never commit a value for this.\n" : "\n";
        return `${doc}${secret}${spec.name}=${spec.example ?? ""}`;
      })
      .join("\n\n");
    return `# ── ${group} ${rule}\n\n${body}`;
  });

  return `${header}\n${sections.join("\n\n")}\n`;
}

const wanted = render();
const current = (() => {
  try {
    return readFileSync(OUT, "utf8");
  } catch {
    return "";
  }
})();

if (process.argv.includes("--check")) {
  if (current === wanted) {
    console.log(`.env.example is in sync: ${ENV_SPEC.length} variables.`);
    process.exit(0);
  }
  console.error(".env.example is out of sync with services/tally/src/env-spec.ts.");
  console.error("Run: node scripts/sync-env-example.ts");
  process.exit(1);
}

writeFileSync(OUT, wanted);
console.log(`.env.example written: ${ENV_SPEC.length} variables.`);
