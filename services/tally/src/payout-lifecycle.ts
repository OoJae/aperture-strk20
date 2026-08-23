/**
 * Drive a treasury payout through the pool and our own anonymizer.
 *
 *   node src/payout-lifecycle.ts <proposal-id> <amount-in-strk>
 *
 * This is the transaction shape the whole project is really about: the pool
 * withdraws value to `GovernanceAnonymizer`, calls its `privacy_invoke`, and —
 * on the claim leg — pulls the result back in as an open note. Two pool
 * transactions, both running through code we wrote.
 *
 * Register parks value against a commitment and returns an empty span, so that
 * leg creates no open note. Claim opens the commitment and returns one deposit,
 * so that leg must create an open note for the pool to fill. Getting those two
 * shapes the wrong way round makes the pool reject the call.
 */

import { Account, RpcProvider } from "starknet";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseTokenAmount } from "@aperture/strk20-governance";
import { Open, createPrivateTransfers } from "@starkware-libs/starknet-privacy-sdk";
import { loadConfig } from "./config.ts";

const MATURITY_BLOCKS = 10;

/** Mirrors PAYOUT_COMMITMENT_TAG in contracts/src/governance_anonymizer.cairo. */
const PAYOUT_TAG = "APERTURE_PAYOUT:V1";

/** GovernanceOperation discriminants, in declaration order. */
const OP_REGISTER = 0;
const OP_CLAIM = 1;

async function main(argv: string[]): Promise<number> {
  const [idArg, amountArg] = argv.slice(2);
  if (!idArg || !amountArg) {
    console.error("Usage: node src/payout-lifecycle.ts <proposal-id> <amount-in-strk>");
    return 1;
  }
  const provingServiceUrl = process.env.PROVING_SERVICE_URL;
  const anonymizer = process.env.APERTURE_ANONYMIZER_ADDRESS;
  if (!provingServiceUrl || !anonymizer) {
    console.error("PROVING_SERVICE_URL and APERTURE_ANONYMIZER_ADDRESS are required.");
    return 1;
  }

  const { shortString, hash: h, num } = await import("starknet");
  const proposalId = BigInt(idArg);
  const amount = parseTokenAmount(amountArg);
  const config = loadConfig();

  // Disclosed to the indexer in cleartext, so it is its own key rather than the
  // seed every ballot viewing key derives from.
  const operatorViewingKey = config.operatorViewingKey;
  if (operatorViewingKey === undefined) {
    console.error(
      "TALLY_OPERATOR_VIEWING_KEY is not set. See .env.example — it must be a " +
        "key of its own, because it is sent to the indexer in cleartext.",
    );
    return 1;
  }
  const provider = new RpcProvider({ nodeUrl: config.rpcUrl });
  const chainId = await provider.getChainId();
  const token = process.env.STRK_TOKEN_ADDRESS!;

  // A payout is unlocked by revealing this preimage, so it is the one value
  // that must not be predictable. Random per run.
  const secret = `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(30))).toString("hex")}`;
  const commitment = h.computePoseidonHashOnElements([
    num.toHex(BigInt(shortString.encodeShortString(PAYOUT_TAG))),
    secret,
  ]);

  // Written to disk BEFORE anything is submitted.
  //
  // A run that registers a payout and then dies has escrowed value against a
  // commitment only this preimage can open, and an anonymizer with no sweep
  // cannot return it. That is not hypothetical: it is how 14 STRK was lost on
  // mainnet, and how another 0.5 STRK was lost on Sepolia during the very
  // investigation into why. Printing it at the end is too late.
  const ticketPath = resolve(
    process.env.APERTURE_PAYOUT_DIR ?? ".payouts",
    `${config.network}-${commitment.slice(0, 18)}.json`,
  );
  mkdirSync(dirname(ticketPath), { recursive: true });
  writeFileSync(
    ticketPath,
    `${JSON.stringify(
      {
        network: config.network,
        anonymizer,
        proposalId: proposalId.toString(),
        token,
        amount: amount.toString(),
        commitment,
        secret,
        createdAtBlock: await provider.getBlockNumber(),
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  console.log(`  preimage saved to ${ticketPath} (gitignored, chmod 600)`);

  console.log(`Payout of ${amountArg} STRK against proposal ${proposalId}`);
  console.log(`  anonymizer: ${anonymizer}`);
  console.log(`  commitment: ${commitment}\n`);

  const account = new Account({
    provider,
    address: config.operatorAddress,
    signer: config.operatorPrivateKey,
    cairoVersion: "1",
  });

  const transfers = createPrivateTransfers({
    account,
    viewingKeyProvider: { getViewingKey: async () => operatorViewingKey },
    provingProvider: { url: provingServiceUrl, chainId },
    discoveryProvider: { url: config.indexerUrl },
    poolContractAddress: config.poolAddress,
  } as never);

  const submit = async (result: unknown): Promise<string> => {
    const { callAndProof } = result as {
      callAndProof: {
        call: Parameters<Account["execute"]>[0];
        proof: { proofFacts?: unknown[]; data?: unknown };
      };
    };
    const details = callAndProof.proof?.proofFacts?.length
      ? { proofFacts: callAndProof.proof.proofFacts, proof: callAndProof.proof.data }
      : {};
    const tx = await account.execute(callAndProof.call, { tip: 0n, ...details } as never);
    const receipt = await provider.waitForTransaction(tx.transaction_hash);
    const status = (receipt as { execution_status?: string }).execution_status;
    if (status === "REVERTED") {
      const reason = (receipt as { revert_reason?: string }).revert_reason ?? "(no reason given)";
      throw new Error(
        `${tx.transaction_hash} REVERTED: ${reason}\n` +
          `A reverted pool transaction still costs the flat fee. See ` +
          `docs/evidence/2026-08-23-claim-leg-diagnosis.md for how to read these.`,
      );
    }
    return tx.transaction_hash;
  };

  /**
   * The two legs need different builders.
   *
   * Register spends a note and must say where the change goes. Claim spends
   * nothing — it only creates an empty open note for the helper to fill.
   *
   * Both legs must read a block that already contains the other's writes, and
   * that is what `waitForPin` below enforces. A note id is
   * `poseidon(tag, channel_key, token, index)` with no block and no randomness
   * in it, and `index` is the indexer's `last_note_index + 1` evaluated at
   * whatever block the SDK is proving against — the SDK forwards
   * `provingBlockId` into discovery, there being no separate discovery block.
   *
   * The original code computed `head - 10` independently for each leg. The
   * claim leg ran seconds after the register transaction landed, so its pin
   * still pointed before it, the indexer returned the pre-register index, and
   * the open note targeted the slot the register leg's surplus note had just
   * filled. The pool's WriteOnce asserts that slot is zero, and reverted with
   * NON_ZERO_VALUE.
   *
   * Threading the register leg's returned registry instead — it is advanced
   * optimistically at compile time — removed NON_ZERO_VALUE and produced
   * INDEX_NOT_SEQUENTIAL instead: an index past what the pool would accept.
   * Waiting for the pin is the fix that matches how the pool actually works,
   * rather than one that races it.
   *
   * Full working: docs/evidence/2026-08-23-claim-leg-diagnosis.md
   */
  const build = (spends: boolean) => {
    const b = (transfers as never as {
      build: (o: unknown) => Record<string, (...a: never[]) => unknown>;
    }).build(
      spends
        ? {
            autoSetup: true,
            autoDiscover: { notes: "refresh", channels: "refresh" },
            autoSelectNotes: "naive",
          }
        : {
            autoSetup: true,
            // Re-reading channels is correct — as long as the block being read
            // is past the register transaction. See waitForPin below, which is
            // the part that was missing.
            autoDiscover: { channels: "refresh" },
          },
    );
    return (spends ? (b.surplusTo as (a: string) => typeof b)(config.operatorAddress) : b) as never as {
      with: (t: string, ops: (b: unknown) => void) => {
        invoke: (cb: (a: never) => unknown) => { execute: (o: unknown) => Promise<unknown> };
      };
    };
  };

  const settledBlock = async () => (await provider.getBlockNumber()) - MATURITY_BLOCKS;

  const blockOf = async (txHash: string): Promise<number> => {
    const receipt = (await provider.getTransactionReceipt(txHash)) as { block_number?: number };
    if (typeof receipt.block_number !== "number") {
      throw new Error(`${txHash} has no block number yet; refusing to pin against it.`);
    }
    return receipt.block_number;
  };

  /**
   * Block until the settled pin has caught up past `target`.
   *
   * This is the whole fix. Discovery and proving share one block parameter, so
   * a pin chosen before a transaction it depends on silently reads pre-transaction
   * state — and the symptom is a pool revert that names a storage slot, not a
   * stale read.
   */
  const waitForPin = async (target: number): Promise<void> => {
    for (;;) {
      const pin = await settledBlock();
      if (pin >= target) {
        console.log(`   pin ${pin} is past block ${target}; safe to read.\n`);
        return;
      }
      console.log(`   waiting: pin ${pin} is still behind block ${target} (${target - pin} to go)…`);
      await new Promise((resolve) => setTimeout(resolve, 15_000));
    }
  };

  // 1. Register — the pool withdraws to the helper, which parks the value
  //    against the commitment and returns an empty span.
  console.log("1. Registering the payout (pool -> our anonymizer)");
  const registerResult = await (async () =>
    await build(true)
      .with(token, (t) => {
        (t as { withdraw: (o: unknown) => unknown }).withdraw({
          recipient: anonymizer,
          amount,
        });
      })
      .invoke(() => ({
        contractAddress: anonymizer,
        calldata: [
          OP_REGISTER,
          commitment,
          token,
          num.toHex(amount),
          num.toHex(proposalId),
          "0x0",
          "0x0",
        ],
      }))
      .execute({ provingBlockId: await settledBlock() }))();
  const registerTx = await submit(registerResult);
  console.log(`   ${registerTx}\n`);

  // The registry that comes back is already advanced past this transaction:
  // PoolSimulator increments the note nonce while compiling and writes it back.
  // Carrying it into the claim leg is what stops that leg asking an indexer
  // pinned to a block where this note did not yet exist.
  // The claim leg must not read a block older than the note the register leg
  // just wrote, or it will be handed an index that is already spent.
  const registerBlock = await blockOf(registerTx);
  await waitForPin(registerBlock);

  // 2. Claim — an open note is created for the helper to fill, and the helper
  //    approves the pool to pull exactly the escrowed amount into it.
  console.log("2. Claiming the payout (preimage -> open note credited back)");
  const claimTx = await submit(
    await build(false)
      .with(token, (t) => {
        (t as { transfer: (o: unknown) => unknown }).transfer({
          recipient: config.operatorAddress,
          // The SDK's sentinel for "open note". The literal string "OPEN" is
          // the wallet route's placeholder and means nothing here.
          amount: Open,
        });
      })
      .invoke((args: never) => {
        const { openNotes } = args as unknown as { openNotes: { noteId: string }[] };
        return {
          contractAddress: anonymizer,
          calldata: [
            OP_CLAIM,
            "0x0",
            token,
            "0x0",
            "0x0",
            secret,
            openNotes[0]!.noteId,
          ],
        };
      })
      .execute({ provingBlockId: await settledBlock() }),
  );
  console.log(`   ${claimTx}\n`);

  console.log("Both legs ran through GovernanceAnonymizer.");
  return 0;
}

process.exit(await main(process.argv));
