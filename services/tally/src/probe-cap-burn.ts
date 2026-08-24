/**
 * Try to burn a passed proposal's payout budget, against a live deployment.
 *
 *   node src/probe-cap-burn.ts <proposal-id> <amount-in-strk>
 *
 * This performs the attack. It is expected to fail, and the script fails if it
 * does not.
 *
 * The attack: `register_payout` escrows value and adds it to `spent`, which
 * never decreases. Before `authorize_payout` existed, every gate on the way
 * there was satisfiable by a stranger — `caller == pool` because the pool
 * relays anybody's private transaction, `terms.passed` because it is a
 * permanent public fact, and the funding check because the attacker escrows
 * their own money. Register the remaining cap, claim it straight back, and the
 * DAO's own payout fails forever on a contract with no owner and no sweep.
 *
 * Why run it against a chain when there are tests for it: every one of the
 * contract tests that passed against the vulnerable code approached
 * `register_payout` as the DAO. That is exactly the blind spot that let the bug
 * through, and a test suite cannot tell you the deployed bytecode is the code
 * you tested. This can.
 *
 * **It costs a pool flat fee** — 2 STRK on Sepolia, 6 on mainnet — because a
 * reverted pool transaction is still a pool transaction. That is the price of
 * knowing.
 */

import { Account, RpcProvider, num } from "starknet";
import { createPrivateTransfers } from "@starkware-libs/starknet-privacy-sdk";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  computePayoutCommitment,
  generatePayoutSecret,
  parseTokenAmount,
} from "@oojae/strk20-governance";
import { loadConfig } from "./config.ts";
import { describeError } from "./report-error.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const OP_REGISTER = 0;
const MATURITY_BLOCKS = 10;
const EXPECTED = "PAYOUT_NOT_AUTHORIZED";

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(resolve(ROOT, ".env"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]!] = m[2]!.trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

async function main(): Promise<number> {
  const [idArg, amountArg] = process.argv.slice(2);
  if (!idArg || !amountArg) {
    console.error("usage: node src/probe-cap-burn.ts <proposal-id> <amount-in-strk>");
    return 2;
  }
  const proposalId = BigInt(idArg);
  const amount = parseTokenAmount(amountArg);
  const config = loadConfig();
  const env = loadEnv();
  const anonymizer = env.APERTURE_ANONYMIZER_ADDRESS;
  const provingServiceUrl = env.PROVING_SERVICE_URL;
  if (!anonymizer || !provingServiceUrl) {
    console.error("APERTURE_ANONYMIZER_ADDRESS and PROVING_SERVICE_URL are required.");
    return 2;
  }
  if (config.network === "mainnet" && process.env.APERTURE_CONFIRM !== "mainnet") {
    console.error("Refusing to spend on mainnet without APERTURE_CONFIRM=mainnet.");
    return 2;
  }

  const provider = new RpcProvider({ nodeUrl: config.rpcUrl });
  const chainId = await provider.getChainId();
  const token = config.strkTokenAddress;

  const [domainFelt] = (await provider.callContract({
    contractAddress: anonymizer,
    entrypoint: "get_payout_domain",
    calldata: [],
  })) as unknown as string[];

  // A perfectly well-formed commitment. Nothing about it is malformed; the only
  // thing it lacks is a licence.
  const secret = generatePayoutSecret();
  const commitment = computePayoutCommitment({
    domain: domainFelt!,
    proposalId,
    token,
    amount,
    secret,
  });

  const [licenceAmount] = (
    (await provider.callContract({
      contractAddress: config.registryAddress,
      entrypoint: "payout_authorization",
      calldata: [commitment],
    })) as unknown as string[]
  ).slice(1);
  if (BigInt(licenceAmount ?? "0x0") !== 0n) {
    console.error("This commitment is licensed. The probe is meaningless; aborting.");
    return 2;
  }

  const spentBefore = BigInt(
    (
      (await provider.callContract({
        contractAddress: anonymizer,
        entrypoint: "get_spent",
        calldata: [proposalId.toString()],
      })) as unknown as string[]
    )[0]!,
  );

  console.log(`\nAttempting the cap-burn against ${config.network}`);
  console.log(`  anonymizer  ${anonymizer}`);
  console.log(`  proposal    ${proposalId}, spent so far ${spentBefore}`);
  console.log(`  commitment  ${commitment} (no licence)`);
  console.log(`  expecting   ${EXPECTED}\n`);

  const account = new Account({
    provider,
    address: config.operatorAddress,
    signer: config.operatorPrivateKey,
    cairoVersion: "1",
  });
  const transfers = createPrivateTransfers({
    account,
    viewingKeyProvider: { getViewingKey: async () => config.operatorViewingKey! },
    provingProvider: { url: provingServiceUrl, chainId },
    discoveryProvider: { url: config.indexerUrl },
    poolContractAddress: config.poolAddress,
  } as never);

  let reverted: string | null = null;
  try {
    const builder = (transfers as never as {
      build: (o: unknown) => Record<string, (...a: never[]) => unknown>;
    }).build({
      autoSetup: true,
      autoDiscover: { notes: "refresh", channels: "refresh" },
      autoSelectNotes: "naive",
    });
    const withSurplus = (builder.surplusTo as (a: string) => typeof builder)(
      config.operatorAddress,
    ) as never as {
      with: (t: string, ops: (b: unknown) => void) => {
        invoke: (cb: () => unknown) => { execute: (o: unknown) => Promise<unknown> };
      };
    };

    const result = (await withSurplus
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
      .execute({
        provingBlockId: (await provider.getBlockNumber()) - MATURITY_BLOCKS,
      })) as { callAndProof: { call: unknown; proof: { proofFacts?: unknown[]; data?: unknown } } };

    const { call, proof } = result.callAndProof;
    const details = proof?.proofFacts?.length
      ? { proofFacts: proof.proofFacts, proof: proof.data }
      : {};
    const tx = await account.execute(
      call as Parameters<Account["execute"]>[0],
      { tip: 0n, ...details } as never,
    );
    const receipt = await provider.waitForTransaction(tx.transaction_hash);
    const status = (receipt as { execution_status?: string }).execution_status;
    console.log(`  submitted ${tx.transaction_hash} -> ${status}`);
    if (status === "REVERTED") {
      reverted = (receipt as { revert_reason?: string }).revert_reason ?? "";
    }
  } catch (error) {
    // Fee estimation simulates the call, so the refusal usually lands here —
    // before a transaction is even submitted. That is a better outcome, not a
    // worse one: the attack is refused for free.
    reverted = describeError(error, 2000);
    console.log("  refused before submission (fee estimation simulates the call)");
  }

  const spentAfter = BigInt(
    (
      (await provider.callContract({
        contractAddress: anonymizer,
        entrypoint: "get_spent",
        calldata: [proposalId.toString()],
      })) as unknown as string[]
    )[0]!,
  );

  console.log();
  if (reverted === null) {
    console.error("  THE ATTACK SUCCEEDED. An unlicensed registration was accepted.");
    console.error(`  spent went ${spentBefore} -> ${spentAfter}.`);
    return 1;
  }
  if (!reverted.includes(EXPECTED)) {
    console.error(`  Refused, but not for the expected reason. Wanted ${EXPECTED}, got:`);
    console.error(`  ${reverted.slice(0, 600)}`);
    return 1;
  }
  if (spentAfter !== spentBefore) {
    console.error(`  Refused, but spent moved ${spentBefore} -> ${spentAfter}.`);
    return 1;
  }

  console.log(`  REFUSED with ${EXPECTED}, and spent is unchanged at ${spentAfter}.`);
  console.log("  The deployed contract is the fixed one.");
  return 0;
}

process.exit(await main());
