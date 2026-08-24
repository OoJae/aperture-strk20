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
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { mintPayout, parseTokenAmount } from "@oojae/strk20-governance";
import { Open, createPrivateTransfers } from "@starkware-libs/starknet-privacy-sdk";
import { loadConfig } from "./config.ts";
import { describeError } from "./report-error.ts";
import { ensurePoolAllowance } from "./pool-allowance.ts";

const MATURITY_BLOCKS = 10;

// The tag and the commitment live in @oojae/strk20-governance, pinned
// against Cairo by a vector test. They were duplicated in four places and
// nothing compared them.

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
  const operatorViewingKey = config.poolActorViewingKey;
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
  // From the contract that will check it. A commitment built against the wrong
  // domain still registers and then can never be claimed.
  const [payoutDomain] = await (async () => {
    const result = await provider.callContract({
      contractAddress: anonymizer,
      entrypoint: "get_payout_domain",
      calldata: [],
    });
    return (Array.isArray(result) ? result : (result as { result: string[] }).result) as string[];
  })();
  if (!payoutDomain || BigInt(payoutDomain) === 0n) {
    throw new Error(
      `Anonymizer ${anonymizer} returned an empty payout domain; it predates v2.`,
    );
  }

  // Reuse an unclaimed ticket for these exact terms before minting a new one.
  //
  // A payout's budget is committed on the registry per COMMITMENT HASH, and
  // minting is random, so every retry would otherwise burn another slice of the
  // proposal's cap on a commitment the previous attempt already paid for. Two
  // failed attempts against a 2 STRK cap and a 1 STRK payout exhaust it, with
  // nothing escrowed and nothing claimable — permanently, since the cap is
  // fixed at proposal creation.
  //
  // Only a ticket that is licensed and NOT yet registered is safe to reuse: one
  // already registered would fail COMMITMENT_EXISTS, and one never licensed is
  // no cheaper than a fresh mint.
  const payoutDir = process.env.APERTURE_PAYOUT_DIR ?? ".payouts";
  const reusable = await (async () => {
    let files: string[] = [];
    try {
      files = readdirSync(payoutDir).filter((f) => f.startsWith(`${config.network}-`));
    } catch {
      return undefined;
    }
    for (const file of files) {
      let saved: Record<string, string>;
      try {
        saved = JSON.parse(readFileSync(resolve(payoutDir, file), "utf8"));
      } catch {
        continue;
      }
      if (
        saved.proposalId !== proposalId.toString() ||
        saved.amount !== amount.toString() ||
        BigInt(saved.anonymizer ?? "0x0") !== BigInt(anonymizer) ||
        BigInt(saved.domain ?? "0x0") !== BigInt(payoutDomain!)
      ) {
        continue;
      }
      const [, licensed] = (await provider.callContract({
        contractAddress: config.registryAddress,
        entrypoint: "payout_authorization",
        calldata: [saved.commitment!],
      })) as unknown as string[];
      if (BigInt(licensed ?? "0x0") === 0n) continue;

      const entry = (await provider.callContract({
        contractAddress: anonymizer,
        entrypoint: "get_payout",
        calldata: [saved.commitment!],
      })) as unknown as string[];
      // entry[0] is the token; zero means nothing was ever registered here.
      if (BigInt(entry[0] ?? "0x0") !== 0n) continue;

      console.log(`Reusing the licensed, unregistered ticket in ${file}.`);
      console.log(`  Minting a new one would spend more of the proposal's cap.\n`);
      return { commitment: saved.commitment!, secret: saved.secret! };
    }
    return undefined;
  })();

  const minted = reusable ?? (() => {
    const { ticket, commitment } = mintPayout({ domain: payoutDomain, proposalId, token, amount });
    return { commitment, secret: ticket.secret };
  })();
  const commitment = minted.commitment;
  const secret = minted.secret;

  // Written to disk BEFORE anything is submitted.
  //
  // A run that registers a payout and then dies has escrowed value against a
  // commitment only this preimage can open, and an anonymizer with no sweep
  // cannot return it. That is not hypothetical: it is how 14 STRK was lost on
  // mainnet, and how another 0.5 STRK was lost on Sepolia during the very
  // investigation into why. Printing it at the end is too late.
  const ticketPath = resolve(payoutDir, `${config.network}-${commitment.slice(0, 18)}.json`);
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
        domain: payoutDomain,
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

  // Two accounts, because they are two roles.
  //
  // The licence is a registry call, and the registry names its tally operator
  // at construction and can never be told a different one. The two pool legs
  // are pool work, and the pool binds an account to a viewing key write-once —
  // our mainnet operator's is lost, so it cannot touch the pool at all. On
  // Sepolia both resolve to the same account and this distinction costs
  // nothing.
  const account = new Account({
    provider,
    address: config.poolActorAddress,
    signer: config.poolActorPrivateKey,
    cairoVersion: "1",
  });
  const registryAccount = new Account({
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
    return (spends ? (b.surplusTo as (a: string) => typeof b)(config.poolActorAddress) : b) as never as {
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

  // 0. Commit the budget on the registry, publicly, before anything private
  //    happens.
  //
  //    The anonymizer refuses a registration it has no licence for. It has to:
  //    it is reached through the pool, which relays anybody's private
  //    transaction, and it is handed value with no sender. Without this step a
  //    stranger could escrow their own money against a passed proposal, claim
  //    it straight back, and leave the proposal's cap burnt to zero for good.
  //
  //    Naming the commitment here discloses nothing the register leg would not
  //    publish a moment later. The recipient is hidden by the claim being a
  //    private transaction, not by this hash being secret.
  //
  //    An ordinary public call — the operator's own account, gas only, no pool
  //    fee — and idempotent, so a rerun after a crash does not spend the budget
  //    twice.
  console.log("0. Committing the budget on the registry (public, gas only)");
  const existingLicence = await provider.callContract({
    contractAddress: config.registryAddress,
    entrypoint: "payout_authorization",
    calldata: [commitment],
  });
  const licenceFelts = (
    Array.isArray(existingLicence)
      ? existingLicence
      : (existingLicence as { result: string[] }).result
  ) as string[];
  if (BigInt(licenceFelts[1] ?? "0x0") !== 0n) {
    console.log(`   already licensed for ${licenceFelts[1]}; not spending it again\n`);
  } else {
    const licenceTx = await registryAccount.execute({
      contractAddress: config.registryAddress,
      entrypoint: "authorize_payout",
      calldata: [num.toHex(proposalId), commitment, num.toHex(amount)],
    });
    const licenceReceipt = await provider.waitForTransaction(licenceTx.transaction_hash);
    if ((licenceReceipt as { execution_status?: string }).execution_status === "REVERTED") {
      throw new Error(
        `authorize_payout REVERTED: ` +
          `${(licenceReceipt as { revert_reason?: string }).revert_reason ?? "(no reason)"}`,
      );
    }
    console.log(`   ${licenceTx.transaction_hash}\n`);
  }

  // 1. Register — the pool withdraws to the helper, which parks the value
  //    against the commitment and returns an empty span.
  console.log("1. Registering the payout (pool -> our anonymizer)");
  // The pool pulls its flat fee from this account. The escrowed value comes out
  // of the shielded balance via the withdraw, so only the fee needs an
  // allowance — and the allowance is CONSUMED, so every leg needs its own.
  await ensurePoolAllowance({
    provider,
    account,
    pool: config.poolAddress,
    token: config.strkTokenAddress,
  });
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
  await ensurePoolAllowance({
    provider,
    account,
    pool: config.poolAddress,
    token: config.strkTokenAddress,
  });
  const claimTx = await submit(
    await build(false)
      .with(token, (t) => {
        (t as { transfer: (o: unknown) => unknown }).transfer({
          recipient: config.poolActorAddress,
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
            // The contract ignores this and recomputes from the preimage.
            "0x0",
            token,
            // Real values, not zeros. v2 binds them into the commitment, so a
            // claim that sends zeros recomputes a hash that cannot match what
            // registration stored — and the value is then unrecoverable.
            num.toHex(amount),
            num.toHex(proposalId),
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

// A pool transaction carries its proof inline, so an unhandled rejection here
// prints tens of thousands of characters of base64 with the cause buried in it,
// or truncated out of it entirely. Every other entry point learned this already.
try {
  process.exit(await main(process.argv));
} catch (error) {
  console.error(`\nFAILED\n  ${describeError(error, 1400)}`);
  process.exit(1);
}
