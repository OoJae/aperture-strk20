/**
 * Derive and record an additional multisig signer. Sends no transaction.
 *
 *   node scripts/new-signer.ts <network> <label>
 *
 * A signer's address is counterfactual: the multisig constructor accepts it
 * whether or not an account exists there, and the account only has to be
 * deployed before it first confirms a transaction. So this costs nothing and
 * can run long before the money does.
 *
 * Why a third signer at all: `tally_operator` is fixed at construction and can
 * never be changed. A 2-of-2 multisig therefore has a failure mode where losing
 * either key leaves the treasury permanently unusable — the surviving key cannot
 * reach quorum, so it cannot even vote to replace the lost one. This project has
 * lost keys twice already. 2-of-3 tolerates one loss; 2-of-2 does not.
 *
 * Keys are written to .env before anything else happens, for the same reason
 * every other secret here is.
 */

import { Buffer } from "node:buffer";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ec, hash, num } from "starknet";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENV = resolve(ROOT, ".env");

function upsert(name: string, value: string): void {
  let env = existsSync(ENV) ? readFileSync(ENV, "utf8") : "";
  const pattern = new RegExp(`^${name}=.*$`, "m");
  if (pattern.test(env)) env = env.replace(pattern, `${name}=${value}`);
  else env += `${env.endsWith("\n") || env === "" ? "" : "\n"}${name}=${value}\n`;
  writeFileSync(ENV, env, { mode: 0o600 });
}


/** The OpenZeppelin account class, declared on both networks. */
const OZ_ACCOUNT_CLASS =
  "0x5b4b537eaa2399e3aa99c4e2e0208ebd6c71bc1467938cd52c798c601e43564";

const randomFelt = (): string =>
  `0x${Buffer.from(ec.starkCurve.utils.randomPrivateKey()).toString("hex")}`;

function has(name: string): boolean {
  return readFileSync(ENV, "utf8")
    .split("\n")
    .some((l) => l.startsWith(`${name}=`) && l.slice(name.length + 1).trim() !== "");
}

function main(): number {
  const [network, label] = process.argv.slice(2);
  if (!network || !label) {
    console.error("usage: node scripts/new-signer.ts <mainnet|sepolia> <label>");
    return 2;
  }
  const suffix = network === "sepolia" ? "_SEPOLIA" : "";
  const base = `MULTISIG_SIGNER_${label.toUpperCase()}${suffix}`;

  if (has(`${base}_ADDRESS`)) {
    console.error(`${base}_ADDRESS is already set. Refusing to overwrite a signer.`);
    return 1;
  }

  const privateKey = randomFelt();
  const publicKey = ec.starkCurve.getStarkKey(privateKey);
  const salt = randomFelt();
  const address = hash.calculateContractAddressFromHash(
    salt,
    OZ_ACCOUNT_CLASS,
    [publicKey],
    0,
  );

  upsert(`${base}_ADDRESS`, address);
  upsert(`${base}_PRIVATE_KEY`, privateKey);
  upsert(`${base}_SALT`, salt);

  console.log(`Signer "${label}" for ${network}:`);
  console.log(`  ${address}`);
  console.log(`  key and salt written to .env (gitignored). Nothing was sent.`);
  console.log(`\nAdd the address to deployments/params.json under ${network}.multisigSigners,`);
  console.log(`then deploy the account before it needs to confirm anything:`);
  console.log(`  node scripts/deploy-signer.ts ${network} ${label}`);
  return 0;
}

process.exit(main());
