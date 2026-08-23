/**
 * Download the site's webfonts and generate `apps/web/app/fonts.css`.
 *
 *   node scripts/fetch-fonts.ts
 *
 * The stylesheet used to be `@import url(fonts.googleapis.com/…)`. Two reasons
 * that had to go, one of them the point of the project: an @import is
 * render-blocking and serial — the browser fetches and parses it before it even
 * learns which font files to ask for — and every visitor to a site about not
 * being observed was making a request to a third party that logs it.
 *
 * Deduplicated by content hash, which is not an optimisation but a correctness
 * fix. Inter Tight is a VARIABLE font: Google returns the same woff2 for 400,
 * 500 and 600, and writing it out three times under three names makes the
 * browser download the same 90KB three times, since different URLs are
 * different cache entries. Identical files are emitted once with a weight
 * range.
 *
 * Latin and latin-ext only. The site has no other scripts, and the full set is
 * mostly Cyrillic, Greek and Vietnamese nobody here will render.
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = resolve(ROOT, "apps/web/public/fonts");
const CSS_OUT = resolve(ROOT, "apps/web/app/fonts.css");

const SOURCE =
  "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1" +
  "&family=Inter+Tight:wght@400;500;600" +
  "&family=IBM+Plex+Mono:wght@400;500&display=swap";

// Without a browser UA, Google serves TTF for compatibility. woff2 is ~40%
// smaller and universally supported now.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** A subset is identified by where its unicode-range starts. */
const SUBSETS: ReadonlyArray<readonly [string, string]> = [
  ["U+0000-00FF", "latin"],
  ["U+0100-02BA", "latin-ext"],
];

interface Face {
  family: string;
  style: string;
  weight: number;
  unicodeRange: string;
  url: string;
  subset: string;
}

function parse(css: string): Face[] {
  const faces: Face[] = [];
  for (const [, body] of css.matchAll(/@font-face\s*\{(.*?)\}/gs)) {
    const family = body.match(/font-family:\s*'([^']+)'/)?.[1];
    const style = body.match(/font-style:\s*(\w+)/)?.[1];
    const weight = body.match(/font-weight:\s*(\d+)/)?.[1];
    const range = body.match(/unicode-range:\s*([^;]+);/)?.[1]?.trim();
    const url = body.match(/url\((https:\/\/[^)]+)\)/)?.[1];
    if (!family || !style || !weight || !range || !url) continue;
    const subset = SUBSETS.find(([prefix]) => range.startsWith(prefix))?.[1];
    if (!subset) continue;
    faces.push({ family, style, weight: Number(weight), unicodeRange: range, url, subset });
  }
  return faces;
}

async function main(): Promise<number> {
  const response = await fetch(SOURCE, { headers: { "User-Agent": UA } });
  if (!response.ok) {
    console.error(`Google Fonts returned ${response.status}.`);
    return 1;
  }
  const faces = parse(await response.text());
  if (faces.length === 0) {
    console.error("Parsed no usable @font-face blocks — the CSS format changed.");
    return 1;
  }

  mkdirSync(OUT_DIR, { recursive: true });

  // Fetch once per URL, then group by the BYTES, so a variable font shared
  // across weights is written and served exactly once.
  const bytesByUrl = new Map<string, Buffer>();
  for (const face of faces) {
    if (bytesByUrl.has(face.url)) continue;
    const file = await fetch(face.url, { headers: { "User-Agent": UA } });
    if (!file.ok) {
      console.error(`${face.url} returned ${file.status}.`);
      return 1;
    }
    bytesByUrl.set(face.url, Buffer.from(await file.arrayBuffer()));
  }

  interface Group {
    family: string;
    style: string;
    subset: string;
    unicodeRange: string;
    weights: number[];
    bytes: Buffer;
  }
  const groups = new Map<string, Group>();
  for (const face of faces) {
    const bytes = bytesByUrl.get(face.url)!;
    const key = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    const existing = groups.get(key);
    if (existing) {
      if (!existing.weights.includes(face.weight)) existing.weights.push(face.weight);
      continue;
    }
    groups.set(key, {
      family: face.family,
      style: face.style,
      subset: face.subset,
      unicodeRange: face.unicodeRange,
      weights: [face.weight],
      bytes,
    });
  }

  const blocks: string[] = [];
  let total = 0;
  for (const group of [...groups.values()].sort((a, b) =>
    `${a.family}${a.style}${a.subset}`.localeCompare(`${b.family}${b.style}${b.subset}`),
  )) {
    const weights = group.weights.sort((a, b) => a - b);
    const slug =
      `${group.family.toLowerCase().replace(/\s+/g, "-")}-` +
      `${weights.join("-")}${group.style === "italic" ? "-italic" : ""}-${group.subset}.woff2`;
    writeFileSync(resolve(OUT_DIR, slug), group.bytes);
    total += group.bytes.length;

    // A range, not a list: this is one variable file covering all of them, and
    // a browser given `400 600` can synthesise the intermediate weights.
    const weightRule =
      weights.length === 1 ? `${weights[0]}` : `${weights[0]} ${weights[weights.length - 1]}`;
    blocks.push(
      `@font-face {\n` +
        `  font-family: "${group.family}";\n` +
        `  font-style: ${group.style};\n` +
        `  font-weight: ${weightRule};\n` +
        `  font-display: swap;\n` +
        `  src: url("/fonts/${slug}") format("woff2");\n` +
        `  unicode-range: ${group.unicodeRange};\n` +
        `}`,
    );
    console.log(`  ${slug}  ${(group.bytes.length / 1024).toFixed(0)} KB`);
  }

  writeFileSync(
    CSS_OUT,
    `/*\n * Generated by scripts/fetch-fonts.ts. Do not edit by hand.\n *\n` +
      ` * Self-hosted rather than imported from fonts.googleapis.com: an @import is\n` +
      ` * render-blocking and serial, and a site about not being observed should not\n` +
      ` * make every visitor announce themselves to a third party to read it.\n */\n\n` +
      `${blocks.join("\n\n")}\n`,
  );
  console.log(
    `\n${groups.size} faces from ${faces.length} declarations, ${(total / 1024).toFixed(0)} KB.`,
  );
  return 0;
}

process.exit(await main());
