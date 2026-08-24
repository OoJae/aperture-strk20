/**
 * Return each voter's stake, by private transfer, from the ballot identity that
 * received it.
 *
 *   node src/refund-lifecycle.ts <proposal-id> [--force-uneconomic]
 *
 * Until now this was the largest honest gap in the system: vote weight went in
 * and never came back, and `docs/TRUST_MODEL.md` said to treat voting as a
 * one-way stake. The blockage was described as a missing prover; the prover
 * exists, and the part that was genuinely missing for longer was the payee —
 * discovery parsed each note's sender and discarded it, so the queue was
 * undeliverable by construction. Both are fixed, so this can run.
 *
 * Three things that are not obvious:
 *
 * **Refunding cannot corrupt a re-count.** Discovery reads received-transfer
 * history, not the unspent-note set, so spending a ballot note leaves the tally
 * reproducible at its pin. That is precisely why `discoverReceivedNotes` reads
 * history rather than the obvious `discoverNotes`, and it is the property that
 * makes refunding safe to do at all rather than a thing that quietly rewrites
 * the result.
 *
 * **The proposal must be finalized first.** Moving stake before the aggregate is
 * pinned on chain invites the exact confusion `counted_through` exists to
 * prevent, even though the count itself would survive it.
 *
 * **The fee can exceed the refund.** A pool transaction costs a flat 6 STRK on
 * mainnet, so refunding a 5 STRK ballot destroys more value than it returns.
 * That is a real property of doing this one note at a time on this pool, not a
 * bug, so it is printed per entry and skipped unless --force-uneconomic says
 * otherwise.
 */

import { Account, RpcProvider } from "starknet";
import { mkdirSync, writeFileSync } from "node:fs";

import { deriveBallotViewingKey } from "@oojae/strk20-governance";
import { loadConfig } from "./config.ts";
import { loadPinnedRun, FINALITY_LAG } from "./pinned-run.ts";
import { ensurePoolAllowance, poolFee } from "./pool-allowance.ts";
import { assertRegisteredViewingKey } from "./pool-identity.ts";
import { describeError } from "./report-error.ts";
import { refundDir, refundReceiptPath, isRefunded } from "./refund-receipts.ts";
import type { RefundEntry } from "./refunds.ts";

const strk = (v: bigint): string =>
  `${v / 10n ** 18n}.${(v % 10n ** 18n).toString().padStart(18, "0").slice(0, 4)}`;

/** Headroom above the flat fee for the resource-bound ceiling. */
const GAS_HEADROOM = 5n * 10n ** 18n;

async function main(argv: string[]): Promise<number> {
  const idArg = argv.slice(2).find((a) => !a.startsWith("--"));
  const force = argv.includes("--force-uneconomic");
  if (!idArg) {
    console.error("Usage: node src/refund-lifecycle.ts <proposal-id> [--force-uneconomic]");
    return 1;
  }
  const proposalId = BigInt(idArg);
  const config = loadConfig();

  if (config.network === "mainnet" && process.env.APERTURE_CONFIRM !== "mainnet") {
    console.error("Refusing to spend on mainnet without APERTURE_CONFIRM=mainnet.");
    return 2;
  }
  if (config.provingServiceUrl === null) {
    console.error("PROVING_SERVICE_URL is required — a refund is a private transfer.");
    return 1;
  }

  const provider = new RpcProvider({ nodeUrl: config.rpcUrl });
  const { proposal, run, pinned, domain } = await loadPinnedRun(proposalId, config, provider);

  if (!proposal.finalized) {
    console.error(
      `Proposal ${proposalId} is not finalized. Publish the tally first: moving ` +
        `stake before the aggregate is pinned invites exactly the confusion the ` +
        `counted_through assert exists to prevent.`,
    );
    return 1;
  }

  const fee = await poolFee(provider, config.poolAddress);
  const entries = run.refunds.entries;

  console.log(`\nRefunds for proposal ${proposalId} on ${config.network}`);
  console.log(`  counted at block ${pinned}, ${entries.length} ballot(s), ` +
    `${strk(run.refunds.totalAmount)} STRK owed`);
  console.log(`  pool flat fee ${strk(fee)} STRK per refund\n`);

  const chainId = await provider.getChainId();
  const { createPrivateTransfers } = await import("@starkware-libs/starknet-privacy-sdk");

  let paid = 0n;
  let skipped = 0;

  for (const entry of entries) {
    const label = `${entry.choice.padEnd(8)} ${strk(entry.amount)} STRK`;
    const path = refundReceiptPath(config.network, entry);
    if (isRefunded(config.network, entry)) {
      console.log(`  ${label} — already refunded (${path})`);
      continue;
    }

    if (entry.amount <= fee && !force) {
      console.log(
        `  ${label} — SKIPPED: refunding it costs ${strk(fee)} STRK in fees, ` +
          `more than the stake returns. Pass --force-uneconomic to do it anyway.`,
      );
      skipped++;
      continue;
    }

    // The identity that holds the note signs for itself, and pays the fee from
    // its own public balance. It was swept after the vote, so it is short.
    const viewingKey = deriveBallotViewingKey({
      masterSecret: config.ballotViewingSeed,
      domain,
      proposalId,
      choice: entry.choice,
    });
    const account = new Account({
      provider,
      address: entry.from,
      signer: config.ballotAccountPrivateKey,
      cairoVersion: "1",
    });

    try {
      await assertRegisteredViewingKey(provider, config.poolAddress, entry.from, viewingKey);

      const needed = fee + GAS_HEADROOM;
      const held = await (async () => {
        const r = await provider.callContract({
          contractAddress: config.strkTokenAddress,
          entrypoint: "balanceOf",
          calldata: [entry.from],
        });
        const x = (Array.isArray(r) ? r : (r as { result: string[] }).result) as string[];
        return BigInt(x[0]!) + (BigInt(x[1] ?? "0x0") << 128n);
      })();

      if (held < needed) {
        const top = needed - held;
        process.stdout.write(`  ${label} — funding ${strk(top)} STRK … `);
        const funder = new Account({
          provider,
          address: config.operatorAddress,
          signer: config.operatorPrivateKey,
          cairoVersion: "1",
        });
        const fundTx = await funder.execute({
          contractAddress: config.strkTokenAddress,
          entrypoint: "transfer",
          calldata: [entry.from, top.toString(), "0"],
        });
        await provider.waitForTransaction(fundTx.transaction_hash);
        process.stdout.write("done\n");
      }

      await ensurePoolAllowance({
        provider,
        account,
        pool: config.poolAddress,
        token: config.strkTokenAddress,
      });

      // Written before submitting. A run that transfers and then dies must not
      // look unpaid on the retry — the note is spent either way.
      mkdirSync(refundDir(), { recursive: true });
      writeFileSync(
        path,
        `${JSON.stringify(
          {
            network: config.network,
            proposalId: proposalId.toString(),
            choice: entry.choice,
            noteId: entry.noteId,
            amount: entry.amount.toString(),
            from: entry.from,
            payee: entry.payee,
            countedAtBlock: pinned,
            submittedAtBlock: await provider.getBlockNumber(),
          },
          null,
          2,
        )}\n`,
        { mode: 0o600 },
      );

      const transfers = createPrivateTransfers({
        account,
        viewingKeyProvider: { getViewingKey: async () => viewingKey },
        provingProvider: { url: config.provingServiceUrl, chainId },
        discoveryProvider: { url: config.indexerUrl },
        poolContractAddress: config.poolAddress,
      } as never);

      const builder = (transfers as never as {
        build: (o: unknown) => Record<string, (...a: never[]) => unknown>;
      }).build({
        autoSetup: true,
        autoDiscover: { notes: "refresh", channels: "refresh" },
        autoSelectNotes: "naive",
      });
      // A transfer spends whole notes; the remainder has to be named or the
      // compiler refuses to build anything at all. Change goes back to the
      // identity, which is where it already was.
      const withSurplus = (builder.surplusTo as (a: string) => typeof builder)(
        entry.from,
      ) as never as {
        with: (t: string, ops: (b: unknown) => void) => {
          execute: (o: unknown) => Promise<{ callAndProof: unknown }>;
        };
      };

      process.stdout.write(`  ${label} -> ${entry.payee.slice(0, 14)}… `);
      const result = await withSurplus
        .with(config.strkTokenAddress, (t) => {
          (t as { transfer: (o: unknown) => unknown }).transfer({
            recipient: entry.payee,
            amount: entry.amount,
          });
        })
        .execute({ provingBlockId: (await provider.getBlockNumber()) - FINALITY_LAG });

      const { call, proof } = result.callAndProof as {
        call: Parameters<Account["execute"]>[0];
        proof: { proofFacts?: unknown[]; data?: unknown };
      };
      const details = proof?.proofFacts?.length
        ? { proofFacts: proof.proofFacts, proof: proof.data }
        : {};
      const tx = await account.execute(call, { tip: 0n, ...details } as never);
      const receipt = await provider.waitForTransaction(tx.transaction_hash);
      if ((receipt as { execution_status?: string }).execution_status === "REVERTED") {
        throw new Error(
          `REVERTED: ${(receipt as { revert_reason?: string }).revert_reason ?? "(no reason)"}`,
        );
      }
      console.log(tx.transaction_hash);
      paid += entry.amount;
    } catch (error) {
      console.log("FAILED");
      console.error(`      ${describeError(error)}`);
      return 1;
    }
  }

  console.log(`\n  refunded ${strk(paid)} STRK` + (skipped ? `, ${skipped} skipped as uneconomic` : ""));
  console.log(
    `  Re-run the tally to confirm the aggregate is unchanged — spending a\n` +
      `  ballot note must not move the count, which is why discovery reads\n` +
      `  received-transfer history rather than the unspent set.`,
  );
  return 0;
}

process.exit(await main(process.argv));
