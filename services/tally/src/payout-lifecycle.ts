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
    await provider.waitForTransaction(tx.transaction_hash);
    return tx.transaction_hash;
  };

  /**
   * The two legs need different builders. Register spends a note and must say
   * where the change goes; claim spends nothing at all — it only creates an
   * empty open note for the helper to fill, so selecting notes or routing
   * surplus into it makes the pool reject the note as non-empty.
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
        : { autoSetup: true, autoDiscover: { notes: "refresh", channels: "refresh" } },
    );
    return (spends ? (b.surplusTo as (a: string) => typeof b)(config.operatorAddress) : b) as never as {
      with: (t: string, ops: (b: unknown) => void) => {
        invoke: (cb: (a: never) => unknown) => { execute: (o: unknown) => Promise<unknown> };
      };
    };
  };

  const settledBlock = async () => (await provider.getBlockNumber()) - MATURITY_BLOCKS;

  // 1. Register — the pool withdraws to the helper, which parks the value
  //    against the commitment and returns an empty span.
  console.log("1. Registering the payout (pool -> our anonymizer)");
  const registerTx = await submit(
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
      .execute({ provingBlockId: await settledBlock() }),
  );
  console.log(`   ${registerTx}\n`);

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
