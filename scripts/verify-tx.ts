/**
 * Verify a transaction the way the sprint organizers do.
 *
 * Their checker (`scripts/build-projects.mjs` in the hackathon repo) applies
 * exactly two tests to each declared hash: the receipt must report
 * `execution_status === "SUCCEEDED"`, and at least one emitted event must come
 * from the STRK20 pool. Addresses are compared numerically, so leading-zero
 * padding is irrelevant.
 *
 *   node scripts/verify-tx.ts 0xabc...        # one hash
 *   node scripts/verify-tx.ts --all           # every hash in strk20.json
 *
 * Defaults to the same RPC their verifier uses, because a hash that resolves
 * for us but not for them scores nothing.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const POOL = 0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812an;
const RPC = process.env.STRK20_VERIFY_RPC ?? "https://rpc.starknet.lava.build";

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = resolve(HERE, "..", "strk20.json");

interface Receipt {
  execution_status?: string;
  events?: { from_address: string }[];
}

async function fetchReceipt(hash: string): Promise<Receipt | null> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "starknet_getTransactionReceipt",
      params: [hash],
    }),
  });
  const body = (await res.json()) as { result?: Receipt; error?: unknown };
  return body.result ?? null;
}

async function verify(hash: string): Promise<boolean> {
  const receipt = await fetchReceipt(hash);
  if (!receipt) {
    console.log(`FAIL  ${hash}\n      not found on mainnet`);
    return false;
  }

  const succeeded = receipt.execution_status === "SUCCEEDED";
  const events = receipt.events ?? [];
  const poolEvents = events.filter((e) => BigInt(e.from_address) === POOL);
  const ok = succeeded && poolEvents.length > 0;

  if (ok) {
    console.log(
      `PASS  ${hash}\n      SUCCEEDED, ${poolEvents.length} pool event(s) of ${events.length} total`,
    );
  } else {
    const why = !succeeded
      ? `execution_status = ${receipt.execution_status ?? "unknown"}`
      : "did not touch the pool";
    console.log(`FAIL  ${hash}\n      ${why}`);
  }
  return ok;
}

async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  let hashes: string[];

  if (args[0] === "--all") {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as {
      transactions?: string[];
    };
    hashes = manifest.transactions ?? [];
    if (hashes.length === 0) {
      console.log("strk20.json has no transactions yet.");
      return 0;
    }
  } else if (args[0]) {
    hashes = [args[0]];
  } else {
    console.error("Usage: node scripts/verify-tx.ts [--all | <0x-hash>]");
    return 1;
  }

  console.log(`Verifying ${hashes.length} hash(es) against ${RPC}\n`);

  let passed = 0;
  for (const hash of hashes) {
    if (await verify(hash)) passed += 1;
  }

  console.log(`\n${passed}/${hashes.length} verified.`);
  if (args[0] === "--all") {
    console.log(
      passed >= 3
        ? "Scoring floor met (needs 3)."
        : `Below the scoring floor — needs ${3 - passed} more.`,
    );
  }
  return passed === hashes.length ? 0 : 1;
}

process.exit(await main(process.argv));
