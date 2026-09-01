/**
 * Check a published tally against an independent count.
 *
 *   node src/verify-tally.ts <proposal-id>
 *
 * This is the point of the ballot-set commitment. Without a verifier it is a
 * felt nobody looks at, and "the tally is checkable" is a claim with no way to
 * exercise it.
 *
 * It re-runs the count from the chain — same pin, same window, same viewing
 * keys — recomputes the commitment, and compares both the aggregate and the
 * commitment against what the registry published.
 *
 * What a green result means, exactly: whoever ran this reached the same set of
 * ballots and the same totals as the operator did. It does **not** prove the
 * operator counted correctly. Anyone can count wrong and commit to their wrong
 * set; the pair will be self-consistent. What it removes is the ability to
 * publish a total that does not follow from any particular set of ballots, and
 * it makes a disagreement locatable rather than vague.
 *
 * It needs the viewing keys, so only someone the DAO trusts with them can run
 * it. That is a real limit and it is why TRUST_MODEL still says the tally is
 * checkable rather than provable.
 */

import { RpcProvider } from "starknet";

import { makeProvider } from "./provider.ts";

import { loadConfig } from "./config.ts";
import { loadPinnedRun, WindowStillOpenError } from "./pinned-run.ts";
import { describeError } from "./report-error.ts";

const strk = (v: bigint): string =>
  `${v / 10n ** 18n}.${(v % 10n ** 18n).toString().padStart(18, "0").slice(0, 4)}`;

async function main(argv: string[]): Promise<number> {
  const idArg = argv.slice(2).find((a) => !a.startsWith("--"));
  if (!idArg) {
    console.error("Usage: node src/verify-tally.ts <proposal-id>");
    return 1;
  }
  const proposalId = BigInt(idArg);
  const config = loadConfig();
  const provider = makeProvider(config.rpcUrl, config.rpcFallbacks);

  const call = async (entrypoint: string, calldata: string[] = []): Promise<string[]> => {
    const r = await provider.callContract({
      contractAddress: config.registryAddress,
      entrypoint,
      calldata,
    });
    return (Array.isArray(r) ? r : (r as { result: string[] }).result) as string[];
  };

  let loaded;
  try {
    loaded = await loadPinnedRun(proposalId, config, provider);
  } catch (error) {
    if (error instanceof WindowStillOpenError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }
  const { proposal, run, pinned } = loaded;
  if (!proposal.finalized) {
    console.error(`Proposal ${proposalId} is not finalized; there is nothing to verify yet.`);
    return 1;
  }

  const published = await call("get_tally", [proposalId.toString()]);
  const publishedCommitment = (await call("get_ballot_commitment", [proposalId.toString()]))[0]!;
  const countedThrough = Number(BigInt((await call("get_counted_through", [proposalId.toString()]))[0]!));

  const chain = {
    for: BigInt(published[0]!),
    against: BigInt(published[1]!),
    abstain: BigInt(published[2]!),
  };
  const mine = run.tally;

  console.log(`\nVerifying proposal ${proposalId} on ${config.network}`);
  console.log(`  counted independently at block ${pinned}\n`);

  const rows: Array<[string, bigint, bigint]> = [
    ["for", chain.for, mine.forWeight],
    ["against", chain.against, mine.againstWeight],
    ["abstain", chain.abstain, mine.abstainWeight],
  ];
  let ok = true;
  for (const [label, onChain, counted] of rows) {
    const match = onChain === counted;
    if (!match) ok = false;
    console.log(
      `  ${label.padEnd(8)} published ${strk(onChain).padStart(12)}  ` +
        `counted ${strk(counted).padStart(12)}  ${match ? "match" : "MISMATCH"}`,
    );
  }

  const pinMatches = countedThrough === proposal.endBlock;
  const commitmentMatches =
    BigInt(publishedCommitment) === BigInt(run.ballotCommitment);
  if (!pinMatches || !commitmentMatches) ok = false;

  console.log(
    `\n  counted_through ${countedThrough} ` +
      `${pinMatches ? "equals end_block" : `!= end_block ${proposal.endBlock}`}`,
  );
  console.log(`  published  ${publishedCommitment}`);
  console.log(`  recomputed ${run.ballotCommitment}`);
  console.log(`  ${commitmentMatches ? "commitments match" : "COMMITMENTS DIFFER"}`);

  if (!ok) {
    console.error(
      `\n  This count does not agree with what was published. The commitment\n` +
        `  says which ballots the operator counted, so compare that set against\n` +
        `  the ${run.refunds.entries.length} note(s) this run found before concluding who is wrong.`,
    );
    return 1;
  }

  console.log(
    `\n  Verified: ${run.refunds.entries.length} ballot(s), same totals, same set.\n` +
      `  This proves the count is reproducible, not that it is correct — an\n` +
      `  operator who counts wrong and commits to their wrong set also passes.`,
  );
  return 0;
}

try {
  process.exit(await main(process.argv));
} catch (error) {
  console.error(`\nFAILED\n  ${describeError(error)}`);
  process.exit(1);
}
