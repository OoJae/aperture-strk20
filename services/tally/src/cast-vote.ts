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

import { makeProvider } from "./provider.ts";
import {
  SimplePrivateTransfersImpl,
  createPrivateTransfers,
} from "@starkware-libs/starknet-privacy-sdk";
import { deriveBallotIdentity } from "@oojae/strk20-governance";
import { parseTokenAmount } from "@oojae/strk20-governance";
import type { Choice } from "@oojae/strk20-governance";
import { loadConfig } from "./config.ts";
import { assertRegisteredViewingKey } from "./pool-identity.ts";
import { ensurePoolAllowance } from "./pool-allowance.ts";
import { readBallotDomain } from "./registry.ts";

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

  const proposalId = BigInt(idArg);
  const weight = parseTokenAmount(amountArg);
  const config = loadConfig();

  // A cast is a pool transaction and costs the flat fee. Every other script
  // that spends on mainnet asks first; these four did not, which left the
  // maintainer's own ground rule enforced in some places and not others.
  if (config.network === "mainnet" && process.env.APERTURE_CONFIRM !== "mainnet") {
    console.error("Refusing to spend on mainnet without APERTURE_CONFIRM=mainnet.");
    return 2;
  }
  // Network-scoped, via config. Reading process.env.PROVING_SERVICE_URL here
  // sent Sepolia runs to the mainnet prover, which is the one thing a
  // walkthrough on Sepolia must not do.
  const provingServiceUrl = config.provingServiceUrl;
  const provider = makeProvider(config.rpcUrl, config.rpcFallbacks);
  // From the registry, so it matches the contract that publishes the addresses.
  const domain = await readBallotDomain(provider, config.registryAddress);
  const chainId = await provider.getChainId();

  const identity = deriveBallotIdentity(proposalId, choiceArg, {
    ballotAccountClassHash: config.ballotAccountClassHash,
    daoMasterPublicKey: config.daoMasterPublicKey,
    domain,
  });

  console.log(`Casting ${amountArg} STRK for "${choiceArg}" on proposal ${proposalId}`);
  console.log(`  ballot identity: ${identity.address}\n`);

  const account = new Account({
    provider,
    address: config.poolActorAddress,
    signer: config.poolActorPrivateKey,
    cairoVersion: "1",
  });

  // The voter's own pool viewing key.
  //
  // This was the DAO master secret, under a comment claiming it "only ever
  // decrypts this account's own notes". Both halves were wrong: that scalar
  // also signed for every ballot account, and the SDK POSTs whatever is given
  // here to the indexer in cleartext — so the indexer received read and spend
  // authority over the whole system.
  // The pool actor's own key, because the pool actor is the account signing
  // this. A viewing key belongs to an ACCOUNT, not to a job, and pairing one
  // account's key with another's address is rejected by the indexer with a 400
  // that names neither.
  const voterViewingKey = config.poolActorViewingKey;
  if (voterViewingKey === undefined) {
    console.error(
      "No pool viewing key is configured for this network. It is disclosed to " +
        "the indexer in cleartext, so it must be a key of its own — see " +
        ".env.example.",
    );
    return 1;
  }

  // A free read, before any proof is requested.
  try {
    await assertRegisteredViewingKey(
      provider,
      config.poolAddress,
      config.poolActorAddress,
      voterViewingKey,
    );
  } catch (error) {
    console.error(`\n${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

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
    calldata: [config.poolActorAddress],
  });
  const registered =
    BigInt((Array.isArray(poolCheck) ? poolCheck : (poolCheck as { result: string[] }).result)[0]!) !== 0n;

  if (!registered) {
    console.log("0. Registering the voter with the pool (one time).");
    await ensurePoolAllowance({
      provider,
      account,
      pool: config.poolAddress,
      token: config.strkTokenAddress,
    });
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

  /**
   * `spends` decides whether the change has somewhere to go.
   *
   * A deposit creates a note and spends none, so there is no change. A transfer
   * spends whole notes and the remainder has to be named: the compiler refuses
   * to guess, with "Surplus of N found for token X but no surplus action found".
   * That is not a warning — nothing is built at all. Casting 5 STRK out of a
   * 9-STRK note is the ordinary case, not an edge one.
   */
  const builder = (spends: boolean) => {
    const b = (transfers as never as {
      build: (o: unknown) => Record<string, (...a: never[]) => unknown>;
    }).build({
      autoSetup: true,
      autoDiscover: { notes: "refresh", channels: "refresh" },
      autoSelectNotes: "naive",
    });
    return (spends
      ? (b.surplusTo as (a: string) => typeof b)(config.poolActorAddress)
      : b) as never as {
      with: (t: string, ops: (b: unknown) => void) => {
        execute: (o: unknown) => Promise<unknown>;
      };
    };
  };

  // A rerun after a failed cast must not shield a second time: the first
  // deposit is still there, and shielding again would double the stake for a
  // vote that was never recorded.
  if (process.argv.includes("--skip-shield")) {
    console.log("1. Shielding — skipped (--skip-shield); using what is already in the pool.\n");
  } else {
  console.log("1. Shielding — this is public: address, token and amount all show.");
  // The pool pulls its fee and the deposit itself, so the allowance covers both.
  await ensurePoolAllowance({
    provider,
    account,
    pool: config.poolAddress,
    token: config.strkTokenAddress,
    plus: weight,
  });
  const depositTx = await submit(
    await builder(false)
      .with(token, (t) => {
        (t as { deposit: (a: unknown) => unknown }).deposit({ amount: weight });
      })
      .execute({ provingBlockId: await provingBlockId() }),
  );
  console.log(`   ${depositTx}\n`);

  await waitBlocks(provider, MATURITY_BLOCKS);
  }

  console.log("\n2. Casting the ballot — a private transfer. Nothing above shows.");
  // Value moves between notes inside the pool, but the flat fee is still pulled
  // from this account — and the deposit above consumed the previous allowance.
  await ensurePoolAllowance({
    provider,
    account,
    pool: config.poolAddress,
    token: config.strkTokenAddress,
  });
  const castTx = await submit(
    await builder(true)
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
