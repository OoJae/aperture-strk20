/**
 * What is in each ballot box right now, before the window closes.
 *
 *   node src/probe-ballots.ts <proposal-id>
 *
 * A read, not a count. `index.ts` refuses to tally before `end_block` — rightly,
 * since the pin has to be the window's close or the result is not reproducible.
 * But that leaves a real gap: between casting a ballot and being allowed to
 * count it, there is no way to find out whether the vote is even visible, and
 * the answer arrives an hour later as an empty tally that reads like "nobody
 * voted" rather than "something is wrong with the keys".
 *
 * This is the check that would have caught the 945-block problem the day it
 * happened instead of months later, and it costs nothing to run.
 *
 * Ballots outside the window are reported separately rather than hidden,
 * because "arrived, but too late to count" and "never arrived" are different
 * problems with different fixes.
 */

import { RpcProvider } from "starknet";
import {
  CHOICES,
  deriveBallotIdentity,
  deriveBallotViewingKey,
} from "@oojae/strk20-governance";
import { loadConfig } from "./config.ts";
import { discoverReceivedNotes } from "./discovery.ts";
import { readBallotDomain } from "./registry.ts";
import { describeError } from "./report-error.ts";

const MATURITY_BLOCKS = 10;

const strk = (v: bigint): string =>
  `${v / 10n ** 18n}.${(v % 10n ** 18n).toString().padStart(18, "0").slice(0, 4)}`;

async function main(argv: string[]): Promise<number> {
  const idArg = argv[2];
  if (!idArg) {
    console.error("Usage: node src/probe-ballots.ts <proposal-id>");
    return 1;
  }
  const proposalId = BigInt(idArg);
  const config = loadConfig();
  const provider = new RpcProvider({ nodeUrl: config.rpcUrl });

  const domain = await readBallotDomain(provider, config.registryAddress);
  const proposal = await provider.callContract({
    contractAddress: config.registryAddress,
    entrypoint: "get_proposal",
    calldata: [proposalId.toString()],
  });
  const felts = (
    Array.isArray(proposal) ? proposal : (proposal as { result: string[] }).result
  ) as string[];
  // (proposer, metadata_uri, start_block, end_block, finalized, …)
  const startBlock = Number(BigInt(felts[2]!));
  const endBlock = Number(BigInt(felts[3]!));
  if (endBlock === 0) {
    console.error(`Proposal ${proposalId} does not exist on ${config.registryAddress}.`);
    return 1;
  }

  const head = await provider.getBlockNumber();
  const pin = head - MATURITY_BLOCKS;
  const block = await provider.getBlock(pin);
  // A pending block has no hash, and pinning to one would make the read
  // irreproducible. `pin` is ten blocks back so this should not happen, but
  // "should not" is how the last three of these started.
  const blockHash = block.block_hash;
  if (!blockHash) throw new Error(`Block ${pin} has no hash; refusing to pin to it.`);

  console.log(`\nProposal ${proposalId} on ${config.network}`);
  console.log(`  window  ${startBlock} .. ${endBlock}`);
  console.log(`  head    ${head}${head > endBlock ? " (closed)" : ` (${endBlock - head} blocks left)`}`);
  console.log(`  reading at settled block ${pin}\n`);

  let counted = 0n;
  let late = 0n;
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

    const common = {
      indexerUrl: config.indexerUrl,
      poolAddress: config.poolAddress,
      blockHash,
      token: config.strkTokenAddress,
    };
    try {
      const inWindow = await discoverReceivedNotes(identity, viewingKey, {
        ...common,
        startBlock,
        endBlock,
      });
      // The same read with the window opened all the way up. The difference
      // between the two is the number that matters.
      const everything = await discoverReceivedNotes(identity, viewingKey, {
        ...common,
        startBlock: 0,
        endBlock: Number.MAX_SAFE_INTEGER,
      });

      const sum = (notes: { amount: bigint }[]) => notes.reduce((a, n) => a + n.amount, 0n);
      const inWindowTotal = sum(inWindow);
      const outsideTotal = sum(everything) - inWindowTotal;
      counted += inWindowTotal;
      late += outsideTotal;

      const blocks = inWindow.map((n) => n.blockNumber).join(", ");
      console.log(
        `  ${choice.padEnd(8)} ${strk(inWindowTotal)} STRK in ${inWindow.length} note(s)` +
          `${blocks ? ` at block ${blocks}` : ""}`,
      );
      if (outsideTotal > 0n) {
        console.log(
          `           + ${strk(outsideTotal)} STRK OUTSIDE the window — ` +
            `will not be counted, and should not be`,
        );
      }
    } catch (error) {
      console.log(`  ${choice.padEnd(8)} FAILED`);
      console.error(`           ${describeError(error)}`);
      return 1;
    }
  }

  console.log(`\n  countable turnout ${strk(counted)} STRK`);
  if (late > 0n) console.log(`  outside the window ${strk(late)} STRK`);
  if (counted === 0n) {
    console.log(
      "\n  Nothing to count. If a ballot was cast, the likely causes are a\n" +
        "  viewing key that does not match the one registered on the pool, or a\n" +
        "  vote sent to an address the registry does not publish.",
    );
  }
  return 0;
}

process.exit(await main(process.argv));
