/**
 * Verify a transaction against the chain and print the ledger entry for it.
 *
 * This used to append a hash straight into strk20.json after a regex check on
 * its shape, which is how the manifest came to contain a transaction that
 * emits no event from any contract of ours, filed under a heading that says it
 * does. Nothing is written blind any more: the receipt is fetched and
 * classified first, and the output is a ledger entry to paste into
 * packages/strk20-governance/src/deployments.ts, after which `pnpm sync`
 * regenerates the manifest.
 *
 *   node scripts/record-tx.ts <hash> [--kind payout-register] [--network mainnet]
 */

import {
  ACTIVE,
  DEPLOYMENTS,
  LEDGER,
  type NetworkName,
  type TxKind,
} from "../packages/strk20-governance/src/deployments.ts";
import {
  classifyReceipt,
  describeVerdict,
  type RawReceipt,
} from "../packages/strk20-governance/src/receipt.ts";

const HASH_PATTERN = /^0x[0-9a-fA-F]{1,64}$/;

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main(): Promise<number> {
  const hash = process.argv[2];
  if (!hash || hash.startsWith("--")) {
    console.error("usage: node scripts/record-tx.ts <hash> [--kind <kind>] [--network <network>]");
    return 2;
  }
  if (!HASH_PATTERN.test(hash)) {
    console.error(`Rejected "${hash}": expected 0x followed by 1-64 hex digits.`);
    return 2;
  }

  const network = (flag("network") ?? ACTIVE) as NetworkName;
  const deployment = DEPLOYMENTS[network];
  if (!deployment) {
    console.error(`Unknown network "${network}".`);
    return 2;
  }

  if (LEDGER.some((e) => BigInt(e.hash) === BigInt(hash))) {
    console.log(`Already in the ledger: ${hash}`);
    return 0;
  }

  const rpc = process.env.STRK20_VERIFY_RPC ?? deployment.rpcUrls[0]!;
  const res = await fetch(rpc, {
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
  if (body.error || !body.result) {
    console.error(`Not found on ${network}: ${body.error?.message ?? "no receipt"}`);
    return 1;
  }

  const verdict = classifyReceipt(body.result, {
    pool: deployment.pool,
    registry: deployment.registry,
    anonymizer: deployment.anonymizer,
    superseded: deployment.superseded,
  });

  console.log(describeVerdict(hash, verdict));
  if (!verdict.succeeded) {
    console.error(`\nThis transaction REVERTED${verdict.revertReason ? `: ${verdict.revertReason}` : ""}.`);
    console.error("Not recording it. A reverted transaction is not evidence of anything working.");
    return 1;
  }

  const through =
    verdict.ourEvents.find((e) => e.role === "anonymizer")
      ? '"anonymizer"'
      : verdict.ourEvents.find((e) => e.role === "registry")
        ? '"registry"'
        : "null";

  console.log("\nPaste into LEDGER in packages/strk20-governance/src/deployments.ts:\n");
  console.log(`  {
    hash: "${hash}",
    network: "${network}",
    kind: "${flag("kind") ?? "payout-register"}" as TxKind,
    block: ${verdict.blockNumber},
    scores: ${verdict.scores},
    through: ${through},
    what: "TODO",
    detail: "TODO",
  },`);
  console.log("\nThen: node scripts/sync-manifest.ts");

  if (!verdict.scores) {
    console.log(
      "\nNote: this emits no event from Aperture's own contracts, so it counts " +
      "for the organisers' checker but not for the claim this project makes " +
      "about itself. Say so in `detail`.",
    );
  }
  return 0;
}

process.exit(await main());
