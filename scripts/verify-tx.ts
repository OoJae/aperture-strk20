/**
 * Check the manifest against the chain.
 *
 * Two rules are in play and they are not the same rule:
 *
 *   organizer check   SUCCEEDED and at least one event from the STRK20 pool.
 *                     This is what the sprint's checker applies.
 *   strict            SUCCEEDED and at least one event from one of Aperture's
 *                     own contracts. This is the claim docs/DEPLOYMENTS.md
 *                     makes, and it is the one worth holding ourselves to.
 *
 * An earlier version of this script implemented the first and printed a summary
 * that assumed the second — "Scoring floor met (needs 3)" on a 7/7 pass, when
 * the strict count was 3 with no margin. It now reports both and never conflates
 * them.
 *
 *   node scripts/verify-tx.ts 0xabc...    one hash
 *   node scripts/verify-tx.ts --all       every hash in strk20.json
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ACTIVE,
  DEPLOYMENTS,
} from "../packages/strk20-governance/src/deployments.ts";
import {
  classifyReceipt,
  describeVerdict,
  type RawReceipt,
} from "../packages/strk20-governance/src/receipt.ts";

const DEPLOYMENT = DEPLOYMENTS[ACTIVE];
const CONTEXT = {
  pool: DEPLOYMENT.pool,
  registry: DEPLOYMENT.registry,
  anonymizer: DEPLOYMENT.anonymizer,
  superseded: DEPLOYMENT.superseded,
};

/** Defaults to the endpoint the organisers' verifier uses. */
const RPC = process.env.STRK20_VERIFY_RPC ?? DEPLOYMENT.rpcUrls[1] ?? DEPLOYMENT.rpcUrls[0]!;

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = resolve(HERE, "..", "strk20.json");

async function fetchReceipt(hash: string): Promise<RawReceipt | null> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "starknet_getTransactionReceipt",
      params: [hash],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json()) as { result?: RawReceipt; error?: { message: string } };
  if (body.error) return null;
  return body.result ?? null;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("usage: node scripts/verify-tx.ts <hash> | --all");
    return 2;
  }

  const hashes = args.includes("--all")
    ? (JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as { transactions: string[] }).transactions
    : args;

  let reachable = 0;
  let strict = 0;
  let organizer = 0;

  for (const hash of hashes) {
    const receipt = await fetchReceipt(hash);
    if (!receipt) {
      console.log(`${hash.slice(0, 12)}…  NOT FOUND on ${ACTIVE}`);
      continue;
    }
    reachable += 1;
    const verdict = classifyReceipt(receipt, CONTEXT);
    if (verdict.scores) strict += 1;
    if (verdict.passesOrganizerCheck) organizer += 1;
    console.log(describeVerdict(hash, verdict));
    if (!verdict.succeeded && verdict.revertReason) {
      console.log(`               reverted: ${verdict.revertReason}`);
    }
  }

  console.log();
  console.log(`${reachable}/${hashes.length} reachable on ${ACTIVE}.`);
  console.log(`${strict} run through Aperture's own contracts (the rule docs/DEPLOYMENTS.md states).`);
  console.log(`${organizer} emit a pool event (the rule the organisers' checker applies).`);
  console.log(
    strict >= 3
      ? `Scoring floor (3) met by the strict rule, with ${strict - 3} to spare.`
      : `Scoring floor (3) NOT met by the strict rule — ${strict} qualifying.`,
  );

  return reachable === hashes.length ? 0 : 1;
}

process.exit(await main());
