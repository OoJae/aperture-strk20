/**
 * Return what is left in a closed proposal's ballot identities.
 *
 *   node scripts/sweep-ballot-accounts.ts <proposal-id>
 *
 * Ballot identities are funded generously on purpose — an identity the registry
 * publishes but which cannot pay to act is worse than one that was never
 * deployed — and generous funding leaves a remainder. Three accounts at 15 STRK
 * each is not a rounding error, and the addresses are derived per proposal, so
 * the remainder is not reused by the next one.
 *
 * This repository's recurring failure is money it cannot get back: 14 STRK in
 * the mainnet anonymizer, 20.5 in the Sepolia one, both because a payout
 * preimage was displayed and never saved. This is different — we hold the
 * signing key, so it is only stranded if nobody writes this. Writing it.
 *
 * Refuses while the window is open. An account swept mid-vote cannot pay for
 * anything, and a ballot identity that cannot act during its own vote is the
 * exact failure the generous funding exists to prevent.
 */

import { Account, RpcProvider } from "starknet";

import { makeProvider } from "../services/tally/src/provider.ts";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CHOICES, deriveBallotIdentity } from "../packages/strk20-governance/src/ballot.ts";
import { loadConfig } from "../services/tally/src/config.ts";
import { readBallotDomain } from "../services/tally/src/registry.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Left behind so the sweep itself can be paid for.
 *
 * The account signs its own transfer, so sweeping to zero is not a thing that
 * can happen: the transaction that empties it is the one it cannot afford.
 */
const GAS_RESERVE = 10n ** 18n / 2n; // 0.5 STRK

const strk = (v: bigint): string =>
  `${v / 10n ** 18n}.${(v % 10n ** 18n).toString().padStart(18, "0").slice(0, 4)}`;

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(resolve(ROOT, ".env"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    const value = m[2]!.trim().replace(/^["']|["']$/g, "");
    // A blank assignment is not a value. `.env.example` ships the _SNCAST
    // variants empty and says the plain one is used when they are unset, but
    // storing "" made `??` return the empty string instead of falling through —
    // so a verbatim .env.example failed with "No RPC configured" while a
    // perfectly good default sat two lines above. config.ts already skips
    // blanks for exactly this reason; these copies never got the fix.
    if (value === "") continue;
    out[m[1]!] = value;
  }
  return out;
}

async function call(
  provider: RpcProvider,
  contractAddress: string,
  entrypoint: string,
  calldata: string[] = [],
): Promise<string[]> {
  const result = await provider.callContract({ contractAddress, entrypoint, calldata });
  return (Array.isArray(result) ? result : (result as { result: string[] }).result) as string[];
}

async function main(): Promise<number> {
  const idArg = process.argv[2];
  if (!idArg) {
    console.error("usage: node scripts/sweep-ballot-accounts.ts <proposal-id>");
    return 2;
  }
  const proposalId = BigInt(idArg);
  const config = loadConfig();
  const env = loadEnv();
  const provider = makeProvider(config.rpcUrl, config.rpcFallbacks);

  // Read from the process environment, not from the .env file.
  //
  // A confirmation that has to be written into .env to work is a confirmation
  // that gets written once and then protects nothing — every run afterwards is
  // pre-approved by a file nobody re-reads. As a per-command variable it has to
  // be typed again each time, which is the entire point of it.
  if (config.network === "mainnet" && process.env.APERTURE_CONFIRM !== "mainnet") {
    console.error("Refusing to spend on mainnet without APERTURE_CONFIRM=mainnet.");
    return 2;
  }

  const proposal = await call(provider, config.registryAddress, "get_proposal", [
    proposalId.toString(),
  ]);
  const endBlock = Number(BigInt(proposal[3]!));
  const head = await provider.getBlockNumber();
  if (endBlock === 0) {
    console.error(`Proposal ${proposalId} does not exist.`);
    return 1;
  }
  if (head <= endBlock) {
    console.error(
      `Proposal ${proposalId} is still open (head ${head}, closes ${endBlock}). ` +
        `Refusing: an identity swept mid-vote cannot pay to act.`,
    );
    return 1;
  }

  const domain = await readBallotDomain(provider, config.registryAddress);
  console.log(`\nSweeping proposal ${proposalId} on ${config.network} (closed at ${endBlock})`);
  console.log(`  to ${config.operatorAddress}\n`);

  let recovered = 0n;
  for (const choice of CHOICES) {
    const { address } = deriveBallotIdentity(proposalId, choice, {
      ballotAccountClassHash: config.ballotAccountClassHash,
      daoMasterPublicKey: config.daoMasterPublicKey,
      domain,
    });
    const [low, high] = await call(provider, config.strkTokenAddress, "balanceOf", [address]);
    const balance = BigInt(low ?? "0x0") + (BigInt(high ?? "0x0") << 128n);

    if (balance <= GAS_RESERVE) {
      console.log(`  ${choice.padEnd(8)} ${strk(balance)} STRK — nothing worth moving`);
      continue;
    }
    const amount = balance - GAS_RESERVE;
    process.stdout.write(`  ${choice.padEnd(8)} returning ${strk(amount)} STRK … `);

    const account = new Account({
      provider,
      address,
      signer: config.ballotAccountPrivateKey,
      cairoVersion: "1",
    });
    const tx = await account.execute({
      contractAddress: config.strkTokenAddress,
      entrypoint: "transfer",
      calldata: [config.operatorAddress, amount.toString(), "0"],
    });
    const receipt = await provider.waitForTransaction(tx.transaction_hash);
    if ((receipt as { execution_status?: string }).execution_status === "REVERTED") {
      console.log("REVERTED");
      console.error(`      ${(receipt as { revert_reason?: string }).revert_reason ?? ""}`);
      continue;
    }
    recovered += amount;
    console.log(tx.transaction_hash);
  }

  console.log(`\n  recovered ${strk(recovered)} STRK`);
  console.log(
    `  ${strk(GAS_RESERVE)} STRK is left in each account by design — it signs its\n` +
      `  own transfer, so the transaction that empties it is the one it cannot afford.`,
  );
  return 0;
}

process.exit(await main());
