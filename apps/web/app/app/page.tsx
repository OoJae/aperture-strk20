import { Chrome } from "../components/Chrome.tsx";
import { Proposals } from "../components/Proposals.tsx";
import { TreasuryPayout } from "../components/TreasuryPayout.tsx";
import {
  ANONYMIZER_ADDRESS,
  POOL_ADDRESS,
  REGISTRY_ADDRESS,
  VOYAGER,
  shortHex,
} from "../lib/chain.ts";

const CONTRACTS = [
  { name: "ProposalRegistry", address: REGISTRY_ADDRESS },
  { name: "GovernanceAnonymizer", address: ANONYMIZER_ADDRESS },
  { name: "STRK20 pool", address: POOL_ADDRESS },
];

/**
 * The app. Deliberately not a second landing page — the argument lives on `/`
 * and `/trust`, so this route is only the parts that read live state or send a
 * transaction. The iris is off here: behind real numbers it competes with them.
 */
export default function App() {
  return (
    <Chrome iris={false}>
      <section className="shell app-head">
        <p className="label">Live · Starknet mainnet</p>
        <h1>The app</h1>
        <p className="dim">
          Everything below is read from mainnet as you load it. Reading needs no
          wallet; only the payout does.
        </p>
      </section>

      <hr className="rule" />

      <Proposals />

      <TreasuryPayout />

      <section className="shell block">
        <p className="label">Contracts</p>
        <ul className="rows plain">
          {CONTRACTS.map((c) => (
            <li className="row" key={c.name}>
              <span>{c.name}</span>
              <a
                className="mono dim"
                href={`${VOYAGER}/contract/${c.address}`}
                target="_blank"
                rel="noreferrer"
              >
                {shortHex(c.address, 12, 8)}
              </a>
            </li>
          ))}
        </ul>
      </section>
    </Chrome>
  );
}
