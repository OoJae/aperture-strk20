/**
 * Cast one sealed ballot.
 *
 *   node src/cast-vote.ts <proposal-id> <for|against|abstain> <amount-in-strk>
 *
 * A vote is an ordinary private transfer into the identity for the choice you
 * want. On-chain an observer sees a pool transaction and nothing else — not the
 * choice, not the weight, not the voter. That is the whole design, and this
 * script is the smallest thing that demonstrates it.
 *
 * Shielding first is a separate step because a deposit and the transfer it
 * funds must be different transactions: notes need ten blocks to mature before
 * they can be spent. Bundling them also correlates the two, which defeats the
 * point.
 */

import { Account, RpcProvider } from "starknet";
import {
  SimplePrivateTransfersImpl,
  createPrivateTransfers,
} from "@starkware-libs/starknet-privacy-sdk";
import { deriveBallotIdentity } from "@aperture/strk20-governance";
import type { Choice } from "@aperture/strk20-governance";
import { loadConfig } from "./config.ts";

const MATURITY_BLOCKS = 10;

function isChoice(value: string): value is Choice {
  return value === "for" || value === "against" || value === "abstain";
}

async function waitBlocks(provider: RpcProvider, count: number): Promise<void> {
  const start = await provider.getBlockNumber();
  process.stdout.write(`  waiting ${count} blocks for note maturity `);
  for (;;) {
    await new Promise((r) => setTimeout(r, 4000));
    const now = await provider.getBlockNumber();
    if (now >= start + count) break;
    process.stdout.write(".");
  }
  console.log(" done");
}

async function main(argv: string[]): Promise<number> {
  const [idArg, choiceArg, amountArg] = argv.slice(2);
  if (!idArg || !choiceArg || !amountArg || !isChoice(choiceArg)) {
    console.error(
      "Usage: node src/cast-vote.ts <proposal-id> <for|against|abstain> <amount-in-strk>",
    );
    return 1;
  }

  const provingServiceUrl = process.env.PROVING_SERVICE_URL;
  if (!provingServiceUrl) {
    console.error("PROVING_SERVICE_URL is required — casting a ballot is a pool tx.");
    return 1;
  }

  const proposalId = BigInt(idArg);
  const weight = BigInt(Math.round(Number(amountArg) * 1e18));
  const config = loadConfig();
  const provider = new RpcProvider({ nodeUrl: config.rpcUrl });
  const chainId = await provider.getChainId();

  const identity = deriveBallotIdentity(proposalId, choiceArg, {
    ballotAccountClassHash: config.ballotAccountClassHash,
    daoMasterPublicKey: config.daoMasterPublicKey,
  });

  console.log(`Casting ${amountArg} STRK for "${choiceArg}" on proposal ${proposalId}`);
  console.log(`  ballot identity: ${identity.address}\n`);

  const account = new Account({
    provider,
    address: config.operatorAddress,
    signer: config.operatorPrivateKey,
    cairoVersion: "1",
  });

  // The voter's own viewing key. Any stable secret works; it only ever decrypts
  // this account's own notes.
  const voterViewingKey = config.daoMasterSecret;

  const transfers = createPrivateTransfers({
    account,
    viewingKeyProvider: { getViewingKey: async () => voterViewingKey },
    provingProvider: { url: provingServiceUrl, chainId },
    discoveryProvider: { url: config.indexerUrl },
    poolContractAddress: config.poolAddress,
  } as never);

  const simple = new SimplePrivateTransfersImpl(transfers as never);
  const token = process.env.STRK_TOKEN_ADDRESS!;

  // A voter has to exist in the pool before it can shield: without a registered
  // viewing key there is no channel to create notes in, and the SDK fails with
  // "missing channel context" rather than saying so.
  const poolCheck = await provider.callContract({
    contractAddress: config.poolAddress,
    entrypoint: "get_public_key",
    calldata: [config.operatorAddress],
  });
  const registered =
    BigInt((Array.isArray(poolCheck) ? poolCheck : (poolCheck as { result: string[] }).result)[0]!) !== 0n;

  if (!registered) {
    console.log("0. Registering the voter with the pool (one time).");
    const { callAndProof } = await (transfers as never as {
      build: (o: unknown) => {
        register: () => { execute: (o: unknown) => Promise<{ callAndProof: unknown }> };
      };
    })
      .build({ autoSetup: true })
      .register()
      .execute({ provingBlockId: (await provider.getBlockNumber()) - MATURITY_BLOCKS });

    const p = callAndProof as {
      call: Parameters<Account["execute"]>[0];
      proof: { proofFacts?: unknown[]; data?: unknown };
    };
    const details = p.proof?.proofFacts?.length
      ? { proofFacts: p.proof.proofFacts, proof: p.proof.data }
      : {};
    const tx = await account.execute(p.call, { tip: 0n, ...details } as never);
    await provider.waitForTransaction(tx.transaction_hash);
    console.log(`   registered in ${tx.transaction_hash}\n`);
    await waitBlocks(provider, MATURITY_BLOCKS);
  }

  /**
   * The SDK prepares a call and its proof; submitting is the caller's job.
   * Forgetting this half looks exactly like a silent no-op: the next step just
   * reports a zero balance.
   */
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
    const tx = await account.execute(callAndProof.call, {
      tip: 0n,
      ...details,
    } as never);
    await provider.waitForTransaction(tx.transaction_hash);
    return tx.transaction_hash;
  };

  /**
   * Prove against a block the pool already considers settled. The convenience
   * API picks its own and the pool rejects it as "too recent", so the builder
   * is used here purely to control this one number.
   */
  const provingBlockId = async () =>
    (await provider.getBlockNumber()) - MATURITY_BLOCKS;

  const builder = () =>
    (transfers as never as {
      build: (o: unknown) => {
        with: (t: string, ops: (b: unknown) => void) => {
          execute: (o: unknown) => Promise<unknown>;
        };
      };
    }).build({
      autoSetup: true,
      autoDiscover: { notes: "refresh", channels: "refresh" },
      autoSelectNotes: "naive",
    });

  console.log("1. Shielding — this is public: address, token and amount all show.");
  const depositTx = await submit(
    await builder()
      .with(token, (t) => {
        (t as { deposit: (a: unknown) => unknown }).deposit({ amount: weight });
      })
      .execute({ provingBlockId: await provingBlockId() }),
  );
  console.log(`   ${depositTx}\n`);

  await waitBlocks(provider, MATURITY_BLOCKS);

  console.log("\n2. Casting the ballot — a private transfer. Nothing above shows.");
  const castTx = await submit(
    await builder()
      .with(token, (t) => {
        (t as { transfer: (o: unknown) => unknown }).transfer({
          recipient: identity.address,
          amount: weight,
        });
      })
      .execute({ provingBlockId: await provingBlockId() }),
  );
  console.log(`   ${castTx}`);

  console.log("\nBallot cast. Run the tally to count it.");
  return 0;
}

process.exit(await main(process.argv));
