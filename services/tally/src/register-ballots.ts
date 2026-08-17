/**
 * One-off: register the viewing key for each of a proposal's ballot identities.
 *
 *   node src/register-ballots.ts <proposal-id>
 *
 * A ballot identity can only *receive* a sealed vote once its viewing key is
 * registered on-chain — that public half is what senders encrypt notes to. This
 * is a pool transaction, so unlike the tally it needs the proving service.
 *
 * The key registered here must be exactly what `deriveBallotViewingKey`
 * produces, because that is the key the tally worker will scan with later.
 * Register anything else and notes arrive encrypted to a key nobody holds: the
 * tally then reports an empty ballot box, which reads as "nobody voted" rather
 * than as the error it is.
 */

import { Account, RpcProvider } from "starknet";
import { createPrivateTransfers } from "@starkware-libs/starknet-privacy-sdk";
import {
  CHOICES,
  deriveBallotIdentity,
  deriveBallotViewingKey,
} from "@aperture/strk20-governance";
import { loadConfig } from "./config.ts";

const provingServiceUrl = process.env.PROVING_SERVICE_URL;

async function main(argv: string[]): Promise<number> {
  const idArg = argv[2];
  if (!idArg) {
    console.error("Usage: node src/register-ballots.ts <proposal-id>");
    return 1;
  }
  if (!provingServiceUrl) {
    console.error("PROVING_SERVICE_URL is required to register (registration is a pool tx).");
    return 1;
  }

  const proposalId = BigInt(idArg);
  const config = loadConfig();
  const provider = new RpcProvider({ nodeUrl: config.rpcUrl });
  const chainId = await provider.getChainId();

  console.log(`Registering ballot identities for proposal ${proposalId} on ${config.network}.\n`);

  for (const choice of CHOICES) {
    const identity = deriveBallotIdentity(proposalId, choice, {
      ballotAccountClassHash: config.ballotAccountClassHash,
      daoMasterPublicKey: config.daoMasterPublicKey,
    });
    const viewingKey = deriveBallotViewingKey(config.daoMasterSecret, proposalId, choice);

    process.stdout.write(`  ${choice.padEnd(8)} ${identity.address} … `);

    try {
      const account = new Account({
        provider,
        address: identity.address,
        // Every ballot account is owned by the DAO master key; they differ only
        // by the salt their address was derived with.
        signer: `0x${config.daoMasterSecret.toString(16)}`,
        cairoVersion: "1",
      });

      const transfers = createPrivateTransfers({
        account,
        viewingKeyProvider: { getViewingKey: async () => viewingKey },
        provingProvider: { url: provingServiceUrl, chainId },
        discoveryProvider: { url: config.indexerUrl },
        poolContractAddress: config.poolAddress,
      } as never);

      const { callAndProof } = await (transfers as never as {
        build: (o: unknown) => { register: () => { execute: (o: unknown) => Promise<{ callAndProof: unknown }> } };
      })
        .build({ autoSetup: true })
        .register()
        .execute({ provingBlockId: (await provider.getBlockNumber()) - 10 });

      const proof = callAndProof as {
        call: Parameters<Account["execute"]>[0];
        proof: { proofFacts?: unknown[]; data?: unknown };
      };
      const proofDetails = proof.proof?.proofFacts?.length
        ? { proofFacts: proof.proof.proofFacts, proof: proof.proof.data }
        : {};

      const tx = await account.execute(proof.call, { tip: 0n, ...proofDetails } as never);
      await provider.waitForTransaction(tx.transaction_hash);
      console.log(`registered in ${tx.transaction_hash}`);
    } catch (error) {
      console.log("FAILED");
      console.error(`      ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
  }

  console.log("\nAll ballot identities registered.");
  return 0;
}

process.exit(await main(process.argv));
