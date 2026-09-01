/**
 * Copy an `sncast` account into `.env`. Sends no transaction.
 *
 *   node scripts/import-sncast-account.ts <account-name> [--network sepolia]
 *
 * `sncast account create` writes its keys to ~/.starknet_accounts, and every
 * script here reads the operator from `.env`. Nothing bridged the two, so a
 * first-time follower created and funded an account and then hit "Missing
 * required environment variables" naming values they had already generated —
 * just somewhere else.
 */

import { existsSync, appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENV = resolve(ROOT, ".env");
/**
 * Where sncast keeps its accounts.
 *
 * `sncast --accounts-file` puts them somewhere else, which is the sane thing to
 * do when you do not want a throwaway account in your real keyring — so honour
 * the same override here rather than forcing the default.
 */
const ACCOUNTS =
  process.env.SNCAST_ACCOUNTS_FILE ??
  resolve(homedir(), ".starknet_accounts/starknet_open_zeppelin_accounts.json");

function flag(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}

function upsert(name: string, value: string): void {
  let env = existsSync(ENV) ? readFileSync(ENV, "utf8") : "";
  const pattern = new RegExp(`^${name}=.*$`, "m");
  if (pattern.test(env)) env = env.replace(pattern, `${name}=${value}`);
  else env += `${env.endsWith("\n") || env === "" ? "" : "\n"}${name}=${value}\n`;
  writeFileSync(ENV, env, { mode: 0o600 });
}

function main(): number {
  const name = process.argv[2];
  if (!name || name.startsWith("--")) {
    console.error("usage: node scripts/import-sncast-account.ts <account-name> [--network sepolia]");
    return 2;
  }
  const network = flag("network", "sepolia");
  const suffix = network === "sepolia" ? "_SEPOLIA" : "";

  if (!existsSync(ACCOUNTS)) {
    console.error(`No sncast accounts file at ${ACCOUNTS}. Run \`sncast account create\` first.`);
    return 1;
  }
  const all = JSON.parse(readFileSync(ACCOUNTS, "utf8")) as Record<
    string,
    Record<string, { address?: string; private_key?: string; deployed?: boolean }>
  >;

  let found: { address: string; privateKey: string; deployed: boolean } | undefined;
  for (const accounts of Object.values(all)) {
    const a = accounts[name];
    if (a?.address && a.private_key) {
      found = { address: a.address, privateKey: a.private_key, deployed: a.deployed === true };
      break;
    }
  }
  if (!found) {
    console.error(
      `No account named "${name}". Available: ` +
        Object.values(all).flatMap((n) => Object.keys(n)).join(", "),
    );
    return 1;
  }

  upsert(`TALLY_OPERATOR_ADDRESS${suffix}`, found.address);
  upsert(`TALLY_OPERATOR_PRIVATE_KEY${suffix}`, found.privateKey);

  console.log(`Imported "${name}" into .env as the ${network} tally operator.`);
  console.log(`  ${found.address}`);
  if (!found.deployed) {
    console.log(
      `\n  Not deployed yet. Fund that address, then:\n` +
        `    sncast account deploy --name ${name} --url "$STARKNET_RPC_URL${suffix}_SNCAST"`,
    );
  }
  return 0;
}

process.exit(main());
