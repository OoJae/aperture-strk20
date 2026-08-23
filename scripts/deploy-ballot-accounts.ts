/**
 * Deploy the three ballot identity accounts for a proposal.
 *
 *   node scripts/deploy-ballot-accounts.ts <proposal-id>
 *
 * Nothing in this repository did this. The v1 Sepolia identities were stood up
 * out of band, so `docs/DEPLOYMENTS.md` could say three ballot identities were
 * deployed while no code could reproduce them — and on mainnet the registry
 * published the same three addresses with nothing at them, which the demo
 * offered to voters until it was corrected.
 *
 * The shape is counterfactual deployment, and the ordering is not a choice: a
 * ballot identity's address is *derived* rather than picked, and a Starknet
 * account pays for its own deployment. So it goes derive, fund, self-deploy.
 * Nobody can deploy one of these on its behalf, and it cannot pay before it
 * exists.
 */

import { Account, RpcProvider, ec } from "starknet";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CHOICES,
  ballotSalt,
  deriveBallotIdentity,
} from "../packages/strk20-governance/src/ballot.ts";
import { loadConfig } from "../services/tally/src/config.ts";
import { readBallotDomain } from "../services/tally/src/registry.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * What each identity is sent before it deploys itself.
 *
 * It has to cover its own deploy_account gas and then the pool's flat fee when
 * it registers its viewing key — 2 STRK on Sepolia, 6 on mainnet — with room
 * for one retry. Underfunding strands an identity whose address the registry
 * publishes but which cannot act, which is worse than not deploying it at all.
 */
const FUNDING = {
  sepolia: 5n * 10n ** 18n,
  mainnet: 9n * 10n ** 18n,
} as const;

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(resolve(ROOT, ".env"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]!] = m[2]!.trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

async function isDeployed(provider: RpcProvider, address: string): Promise<boolean> {
  try {
    await provider.getClassHashAt(address, "latest");
    return true;
  } catch {
    return false;
  }
}

async function strkBalance(
  provider: RpcProvider,
  token: string,
  address: string,
): Promise<bigint> {
  const result = await provider.callContract({
    contractAddress: token,
    entrypoint: "balanceOf",
    calldata: [address],
  });
  const raw = (Array.isArray(result) ? result : (result as { result: string[] }).result) as string[];
  return BigInt(raw[0]!);
}

const strk = (v: bigint): string =>
  `${v / 10n ** 18n}.${(v % 10n ** 18n).toString().padStart(18, "0").slice(0, 3)}`;

async function main(): Promise<number> {
  const idArg = process.argv[2];
  if (!idArg) {
    console.error("usage: node scripts/deploy-ballot-accounts.ts <proposal-id>");
    return 2;
  }
  const proposalId = BigInt(idArg);

  const config = loadConfig();
  const env = loadEnv();
  const provider = new RpcProvider({ nodeUrl: config.rpcUrl });

  if (config.network === "mainnet" && env.APERTURE_CONFIRM !== "mainnet") {
    console.error("Refusing to spend on mainnet without APERTURE_CONFIRM=mainnet.");
    return 2;
  }

  // Read the domain from the registry rather than deriving it here. Deriving it
  // locally would let a mismatch produce three perfectly good accounts at
  // addresses no voter is ever sent to.
  const domain = await readBallotDomain(provider, config.registryAddress);
  const funding = FUNDING[config.network];

  console.log(`\nBallot identities for proposal ${proposalId} on ${config.network}`);
  console.log(`  registry ${config.registryAddress}`);
  console.log(`  domain   ${domain}`);
  console.log(`  funding  ${strk(funding)} STRK each\n`);

  const funder = new Account({
    provider,
    address: config.operatorAddress,
    signer: config.operatorPrivateKey,
    cairoVersion: "1",
  });

  // The signing key must be the private half of the public key the addresses
  // derive from, or these accounts exist at addresses they can never sign for.
  const derivedPublic = ec.starkCurve.getStarkKey(config.ballotAccountPrivateKey);
  if (BigInt(derivedPublic) !== BigInt(config.daoMasterPublicKey)) {
    throw new Error(
      "DAO_BALLOT_ACCOUNT_PRIVATE_KEY is not the private half of " +
        "DAO_MASTER_PUBLIC_KEY. Every address derived below would be one these " +
        "accounts could never sign for.",
    );
  }

  const identities = CHOICES.map((choice) => ({
    choice,
    salt: ballotSalt(domain, proposalId, choice),
    ...deriveBallotIdentity(proposalId, choice, {
      ballotAccountClassHash: config.ballotAccountClassHash,
      daoMasterPublicKey: config.daoMasterPublicKey,
      domain,
    }),
  }));

  // 1 — top up whatever is short. Ordinary ERC20 transfers; gas only, no pool fee.
  for (const identity of identities) {
    const held = await strkBalance(provider, config.strkTokenAddress, identity.address);
    if (held >= funding) {
      console.log(`  ${identity.choice.padEnd(8)} funded already (${strk(held)} STRK)`);
      continue;
    }
    const top = funding - held;
    console.log(`  ${identity.choice.padEnd(8)} sending ${strk(top)} STRK -> ${identity.address}`);
    const tx = await funder.execute({
      contractAddress: config.strkTokenAddress,
      entrypoint: "transfer",
      calldata: [identity.address, top.toString(), "0"],
    });
    await provider.waitForTransaction(tx.transaction_hash);
  }

  console.log();

  // 2 — each account deploys itself, at the address its salt determines.
  for (const identity of identities) {
    if (await isDeployed(provider, identity.address)) {
      console.log(`  ${identity.choice.padEnd(8)} already deployed`);
      continue;
    }

    const account = new Account({
      provider,
      address: identity.address,
      signer: config.ballotAccountPrivateKey,
      cairoVersion: "1",
    });

    process.stdout.write(`  ${identity.choice.padEnd(8)} deploying … `);
    const { transaction_hash, contract_address } = await account.deployAccount({
      classHash: config.ballotAccountClassHash,
      constructorCalldata: [config.daoMasterPublicKey],
      addressSalt: identity.salt,
      contractAddress: identity.address,
    });
    await provider.waitForTransaction(transaction_hash);

    // The address is derived, so a mismatch means the derivation and the
    // deployment disagree — and a voter following the registry would be sending
    // to an address with nothing at it.
    if (BigInt(contract_address) !== BigInt(identity.address)) {
      throw new Error(
        `Deployed to ${contract_address} but the registry publishes ` +
          `${identity.address}. Stopping: a vote sent to the published address ` +
          `would be unreachable.`,
      );
    }
    console.log(transaction_hash);
  }

  // 3 — check against the registry itself, not against our own derivation.
  console.log("\nVerifying against what the registry publishes:");
  let allGood = true;
  for (const identity of identities) {
    const result = await provider.callContract({
      contractAddress: config.registryAddress,
      entrypoint: "ballot_address",
      calldata: [proposalId.toString(), String(CHOICES.indexOf(identity.choice))],
    });
    const raw = (Array.isArray(result) ? result : (result as { result: string[] }).result) as string[];
    const published = raw[0]!;
    const matches = BigInt(published) === BigInt(identity.address);
    const deployed = await isDeployed(provider, identity.address);
    if (!matches || !deployed) allGood = false;
    console.log(
      `  ${identity.choice.padEnd(8)} ${identity.address}  ` +
        `${matches ? "matches registry" : "MISMATCH"}  ${deployed ? "deployed" : "NOT DEPLOYED"}`,
    );
  }

  if (!allGood) {
    console.error("\nSomething does not line up. Do not register viewing keys yet.");
    return 1;
  }

  console.log(`\nNext: node services/tally/src/register-ballots.ts ${proposalId}`);
  return 0;
}

process.exit(await main());
