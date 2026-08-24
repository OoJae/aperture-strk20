/**
 * Move public STRK into the pool, as the pool actor.
 *
 *   node src/shield.ts <amount-in-strk>
 *
 * Shielding and spending are separate acts, and conflating them is how a retry
 * doubles a stake. cast-vote shields because a voter needs weight; the payout
 * lifecycle does not, because its register leg withdraws from a shielded
 * balance it assumes is already there. When it is not — say the last shielded
 * note just became a ballot — the failure is an SDK error about an insufficient
 * balance that names no account.
 *
 * This is public by design: the address, the token and the amount all show.
 * Only what happens to the note afterwards is private.
 */

import { Account, RpcProvider } from "starknet";
import { parseTokenAmount } from "@oojae/strk20-governance";
import { createPrivateTransfers } from "@starkware-libs/starknet-privacy-sdk";
import { loadConfig } from "./config.ts";
import { ensurePoolAllowance } from "./pool-allowance.ts";
import { assertRegisteredViewingKey } from "./pool-identity.ts";
import { describeError } from "./report-error.ts";

const MATURITY_BLOCKS = 10;

async function main(argv: string[]): Promise<number> {
  const amountArg = argv[2];
  if (!amountArg) {
    console.error("Usage: node src/shield.ts <amount-in-strk>");
    return 1;
  }
  const config = loadConfig();
  if (config.network === "mainnet" && process.env.APERTURE_CONFIRM !== "mainnet") {
    console.error("Refusing to spend on mainnet without APERTURE_CONFIRM=mainnet.");
    return 2;
  }
  const viewingKey = config.poolActorViewingKey;
  if (viewingKey === undefined) {
    console.error("No pool viewing key is configured for this network.");
    return 1;
  }

  const amount = parseTokenAmount(amountArg);
  const provider = new RpcProvider({ nodeUrl: config.rpcUrl });
  const chainId = await provider.getChainId();

  // Free, and it turns an opaque indexer 400 into a local error.
  try {
    await assertRegisteredViewingKey(
      provider,
      config.poolAddress,
      config.poolActorAddress,
      viewingKey,
    );
  } catch (error) {
    console.error(`\n${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  console.log(`Shielding ${amountArg} STRK on ${config.network}`);
  console.log(`  as ${config.poolActorAddress}`);
  console.log(`  public: the address, the token and the amount all show.\n`);

  const account = new Account({
    provider,
    address: config.poolActorAddress,
    signer: config.poolActorPrivateKey,
    cairoVersion: "1",
  });

  try {
    // The pool pulls its flat fee and the deposit itself.
    await ensurePoolAllowance({
      provider,
      account,
      pool: config.poolAddress,
      token: config.strkTokenAddress,
      plus: amount,
    });

    const transfers = createPrivateTransfers({
      account,
      viewingKeyProvider: { getViewingKey: async () => viewingKey },
      provingProvider: { url: config.provingServiceUrl, chainId },
      discoveryProvider: { url: config.indexerUrl },
      poolContractAddress: config.poolAddress,
    } as never);

    const result = await (transfers as never as {
      build: (o: unknown) => {
        with: (t: string, ops: (b: unknown) => void) => {
          execute: (o: unknown) => Promise<{ callAndProof: unknown }>;
        };
      };
    })
      .build({
        autoSetup: true,
        autoDiscover: { notes: "refresh", channels: "refresh" },
        autoSelectNotes: "naive",
      })
      // A deposit creates a note and spends none, so there is no change and no
      // surplus action is needed.
      .with(config.strkTokenAddress, (t) => {
        (t as { deposit: (a: unknown) => unknown }).deposit({ amount });
      })
      .execute({ provingBlockId: (await provider.getBlockNumber()) - MATURITY_BLOCKS });

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
    console.log(`  ${tx.transaction_hash}`);
    console.log(`\n  The note matures in ${MATURITY_BLOCKS} blocks; it cannot be spent before that.`);
    return 0;
  } catch (error) {
    console.error(`  FAILED\n  ${describeError(error)}`);
    return 1;
  }
}

process.exit(await main(process.argv));
