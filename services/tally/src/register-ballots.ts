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

import { makeProvider } from "./provider.ts";
import { createPrivateTransfers } from "@starkware-libs/starknet-privacy-sdk";
import {
  CHOICES,
  deriveBallotIdentity,
  deriveBallotViewingKey,
} from "@oojae/strk20-governance";
import { loadConfig } from "./config.ts";
import { describeError } from "./report-error.ts";
import { ensurePoolAllowance } from "./pool-allowance.ts";
import { readBallotDomain } from "./registry.ts";

async function main(argv: string[]): Promise<number> {
  const idArg = argv[2];
  if (!idArg) {
    console.error("Usage: node src/register-ballots.ts <proposal-id>");
    return 1;
  }
  const proposalId = BigInt(idArg);
  const config = loadConfig();

  // One pool transaction per identity, so this is the most expensive step in
  // the lifecycle: three flat fees before a single vote is cast.
  if (config.network === "mainnet" && process.env.APERTURE_CONFIRM !== "mainnet") {
    console.error("Refusing to spend on mainnet without APERTURE_CONFIRM=mainnet.");
    return 2;
  }
  // Not process.env.PROVING_SERVICE_URL: that name is the mainnet one, so
  // reading it directly pointed every Sepolia run at the mainnet prover.
  // loadConfig picks PROVING_SERVICE_URL_SEPOLIA when the network is Sepolia.
  const provingServiceUrl = config.provingServiceUrl;
  if (!provingServiceUrl) {
    console.error("A proving service is required to register (registration is a pool tx).");
    return 1;
  }
  const provider = makeProvider(config.rpcUrl, config.rpcFallbacks);
  // From the registry, so it matches the contract that publishes the addresses.
  const domain = await readBallotDomain(provider, config.registryAddress);
  const chainId = await provider.getChainId();

  console.log(`Registering ballot identities for proposal ${proposalId} on ${config.network}.\n`);

  for (const choice of CHOICES) {
    const identity = deriveBallotIdentity(proposalId, choice, {
      ballotAccountClassHash: config.ballotAccountClassHash,
      daoMasterPublicKey: config.daoMasterPublicKey,
      domain,
    });
    const viewingKey = deriveBallotViewingKey({
      masterSecret: config.ballotViewingSeed,
      domain,
      proposalId,
      choice,
    });

    process.stdout.write(`  ${choice.padEnd(8)} ${identity.address} … `);

    try {
      const account = new Account({
        provider,
        address: identity.address,
        // Every ballot account is owned by the same key; they differ only by
        // the salt their address was derived with. This is the SIGNING role,
        // deliberately not the seed the viewing keys come from: the seed's
        // derived children go to the indexer, and a key that both reads and
        // spends must never be one of them.
        signer: config.ballotAccountPrivateKey,
        cairoVersion: "1",
      });

      // The pool pulls its flat fee from this account during the register.
      // Nothing on the SDK route approves it for you.
      const approval = await ensurePoolAllowance({
        provider,
        account,
        pool: config.poolAddress,
        token: config.strkTokenAddress,
      });
      if (approval) process.stdout.write("approved, ");

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
      console.error(`      ${describeError(error)}`);
      return 1;
    }
  }

  console.log("\nAll ballot identities registered.");
  return 0;
}

process.exit(await main(process.argv));
