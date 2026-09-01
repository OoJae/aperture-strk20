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
 * **The fee is charged per transaction, not per note.** So refunds are batched:
 * one pool transaction per ballot identity, settling every note that identity
 * holds. That is at most three per proposal — `for`, `against` and `abstain`
 * keep their stakes at different addresses and no account can sign for another —
 * rather than the one this repository used to claim. A batch can still be
 * uneconomic if its total is under the flat fee, which is reported per batch and
 * skipped unless --force-uneconomic says otherwise.
 */

import { Account, RpcProvider } from "starknet";

import { makeProvider } from "./provider.ts";
import { mkdirSync, writeFileSync } from "node:fs";

import { deriveBallotViewingKey } from "@oojae/strk20-governance";
import { loadConfig } from "./config.ts";
import { loadPinnedRun, FINALITY_LAG, WindowStillOpenError } from "./pinned-run.ts";
import { ensurePoolAllowance, poolFee } from "./pool-allowance.ts";
import { assertRegisteredViewingKey } from "./pool-identity.ts";
import { describeError } from "./report-error.ts";
import { refundDir, refundReceiptPath, isRefunded } from "./refund-receipts.ts";
import { groupRefundsByIdentity } from "./refunds.ts";
import type { RefundEntry } from "./refunds.ts";

const strk = (v: bigint): string =>
  `${v / 10n ** 18n}.${(v % 10n ** 18n).toString().padStart(18, "0").slice(0, 4)}`;

/**
 * Headroom above the flat fee for the resource-bound ceiling.
 *
 * The ceiling, not the flat fee, is what makes a node refuse a transaction —
 * `scripts/deploy-ballot-accounts.ts` documents the same lesson after a register
 * was refused at a 5.77 STRK ceiling against a 4.88 balance. A batch spends more
 * notes and creates more, so the proof and the ceiling both grow with it; the
 * per-note term is deliberately generous because underfunding strands a batch
 * that has already written its receipts.
 */
const GAS_HEADROOM_BASE = 5n * 10n ** 18n;
const GAS_HEADROOM_PER_NOTE = 2n * 10n ** 18n;

const gasHeadroom = (notes: number): bigint =>
  GAS_HEADROOM_BASE + GAS_HEADROOM_PER_NOTE * BigInt(Math.max(0, notes - 1));

/**
 * Write one refund receipt, before the spend and again after it.
 *
 * Called twice on purpose. The first call is the safety record — a run that
 * submits and then dies must not look unpaid, because the note is spent either
 * way. The second fills in the hash, which `refundTxHash` has always tried to
 * read from a field nothing wrote.
 */
function writeReceipt(
  entry: RefundEntry,
  ctx: {
    proposalId: bigint;
    config: { network: string };
    pinned: number;
    submittedAtBlock: number;
    txHash?: string;
  },
): void {
  writeFileSync(
    refundReceiptPath(ctx.config.network, entry),
    `${JSON.stringify(
      {
        network: ctx.config.network,
        proposalId: ctx.proposalId.toString(),
        choice: entry.choice,
        noteId: entry.noteId,
        amount: entry.amount.toString(),
        from: entry.from,
        payee: entry.payee,
        countedAtBlock: ctx.pinned,
        submittedAtBlock: ctx.submittedAtBlock,
        ...(ctx.txHash ? { txHash: ctx.txHash } : {}),
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
}

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

  const provider = makeProvider(config.rpcUrl, config.rpcFallbacks);
  // "Not yet" is the most ordinary thing a first run hits, and it used to print
  // a stack trace for it.
  let loaded;
  try {
    loaded = await loadPinnedRun(proposalId, config, provider);
  } catch (error) {
    if (error instanceof WindowStillOpenError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }
  const { proposal, run, pinned, domain } = loaded;

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
  console.log(`  pool flat fee ${strk(fee)} STRK per pool transaction\n`);

  const chainId = await provider.getChainId();
  const { createPrivateTransfers } = await import("@starkware-libs/starknet-privacy-sdk");

  let paid = 0n;
  let skipped = 0;
  let transactions = 0;

  const groups = groupRefundsByIdentity(entries);
  console.log(
    `  ${groups.length} pool transaction(s) for ${entries.length} ballot(s) — ` +
      `one per ballot identity holding stake\n`,
  );

  for (const group of groups) {
    // A receipt is the record that a note was spent, so an already-receipted
    // entry must not be re-sent even though its neighbours still need paying.
    const pending = group.entries.filter((e) => !isRefunded(config.network, e));
    const already = group.entries.length - pending.length;
    const head = `${group.choice.padEnd(8)}`;

    if (pending.length === 0) {
      console.log(`  ${head} — all ${group.entries.length} already refunded`);
      continue;
    }

    const owed = pending.reduce((sum, e) => sum + e.amount, 0n);
    const label = `${head} ${pending.length} note(s), ${strk(owed)} STRK`;

    // The economics are now a property of the batch, not of one note. This is
    // the whole point of batching: one flat fee against the sum, so an ordinary
    // proposal stops needing --force-uneconomic.
    if (owed <= fee && !force) {
      console.log(
        `  ${label} — SKIPPED: one pool transaction costs ${strk(fee)} STRK, ` +
          `more than this batch returns. Pass --force-uneconomic to do it anyway.`,
      );
      skipped += pending.length;
      continue;
    }

    // Derived once per identity rather than once per note: a pool transaction is
    // scoped to one signing account and one viewing key, which is exactly why
    // the batch boundary is the identity.
    const viewingKey = deriveBallotViewingKey({
      masterSecret: config.ballotViewingSeed,
      domain,
      proposalId,
      choice: group.choice,
    });
    const account = new Account({
      provider,
      address: group.from,
      signer: config.ballotAccountPrivateKey,
      cairoVersion: "1",
    });

    try {
      await assertRegisteredViewingKey(provider, config.poolAddress, group.from, viewingKey);

      // A batch spends more notes and creates more, so the resource-bound
      // ceiling grows with it. The ceiling, not the flat fee, is what refuses a
      // transaction, so headroom scales per output.
      const needed = fee + gasHeadroom(pending.length);
      const held = await (async () => {
        const r = await provider.callContract({
          contractAddress: config.strkTokenAddress,
          entrypoint: "balanceOf",
          calldata: [group.from],
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
          calldata: [group.from, top.toString(), "0"],
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

      // Every receipt in the batch is written before the single submit. One
      // transaction settles all of them, so a run that submits and then dies
      // must not leave any of them looking unpaid — the notes are spent either
      // way. The hash is filled in afterwards.
      const submittedAtBlock = await provider.getBlockNumber();
      mkdirSync(refundDir(), { recursive: true });
      for (const entry of pending) {
        writeReceipt(entry, { proposalId, config, pinned, submittedAtBlock });
      }

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
        group.from,
      ) as never as {
        with: (t: string, ops: (b: unknown) => void) => {
          execute: (o: unknown) => Promise<{ callAndProof: unknown }>;
        };
      };

      process.stdout.write(`  ${label} -> ${pending.length} payee(s) … `);
      const result = await withSurplus
        .with(config.strkTokenAddress, (t) => {
          // Variadic by design in the SDK — one output note per recipient, all
          // inside the single pool transaction this identity is paying for.
          (t as { transfer: (...o: unknown[]) => unknown }).transfer(
            ...pending.map((e) => ({ recipient: e.payee, amount: e.amount })),
          );
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

      // Now that there is a hash, put it in the receipts. refundTxHash() read a
      // field nothing ever wrote, so it always returned undefined.
      for (const entry of pending) {
        writeReceipt(entry, {
          proposalId,
          config,
          pinned,
          submittedAtBlock,
          txHash: tx.transaction_hash,
        });
      }

      console.log(tx.transaction_hash);
      if (already) console.log(`      (${already} in this batch were already refunded)`);
      paid += owed;
      transactions++;
    } catch (error) {
      console.log("FAILED");
      console.error(`      ${describeError(error)}`);
      // Batching trades granularity for cost: one unreachable payee reverts the
      // whole group, where before it would have lost only its own refund.
      console.error(
        `      This batch settles ${pending.length} note(s) in one transaction, ` +
          `so none of them were paid.`,
      );
      return 1;
    }
  }

  const saved = entries.length - transactions;
  console.log(
    `\n  refunded ${strk(paid)} STRK in ${transactions} pool transaction(s)` +
      (skipped ? `, ${skipped} skipped as uneconomic` : ""),
  );
  if (saved > 0) {
    console.log(
      `  ${saved} fewer transaction(s) than one per note — ${strk(BigInt(saved) * fee)} STRK ` +
        `of flat fees not spent.`,
    );
  }
  console.log(
    `  Re-run the tally to confirm the aggregate is unchanged — spending a\n` +
      `  ballot note must not move the count, which is why discovery reads\n` +
      `  received-transfer history rather than the unspent set.`,
  );
  return 0;
}

process.exit(await main(process.argv));
