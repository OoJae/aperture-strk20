import { Proposals } from "./components/Proposals.tsx";
import {
  ANONYMIZER_ADDRESS,
  POOL_ADDRESS,
  REGISTRY_ADDRESS,
  VOYAGER,
  shortHex,
} from "./lib/chain.ts";

const REPO = "https://github.com/OoJae/aperture-strk20";

export default function Home() {
  return (
    <main>
      <header>
        <h1>Aperture</h1>
        <p className="tagline">
          Sealed-ballot governance and a shielded treasury for DAOs, native to
          STRK20.
        </p>
      </header>

      <section className="panel">
        <h2>The problem</h2>
        <p>
          On-chain governance leaks. A whale&rsquo;s vote is visible the moment it
          lands, so everyone else votes knowing it. A bought vote can be verified
          by whoever bought it. Grant recipients and amounts are public to anyone
          watching.
        </p>
        <p>
          Aperture makes a vote a <strong>private transfer</strong>. You send
          shielded weight to the identity for the choice you want. On-chain an
          observer sees a pool transaction and nothing more — not the choice, not
          the weight, not the voter. When voting closes, only the aggregate is
          published.
        </p>
      </section>

      <Proposals />

      <section className="panel">
        <h2>What is private, and what is not</h2>
        <p className="lede">
          Overclaiming privacy is worse than not having it, so here is the whole
          truth.
        </p>
        <div className="split">
          <div>
            <h3>Private</h3>
            <ul>
              <li>Which choice you voted for</li>
              <li>How much weight you voted with</li>
              <li>The link between you and your choice</li>
              <li>Who receives a treasury payout</li>
            </ul>
          </div>
          <div>
            <h3>Public</h3>
            <ul>
              <li>
                <strong>Shielding itself</strong> — depositing into the pool
                publishes your address, the token, and the amount
              </li>
              <li>Proposal metadata and voting windows</li>
              <li>The final aggregate tally</li>
              <li>The amount of a treasury payout, though not its recipient</li>
            </ul>
          </div>
        </div>
        <p className="small dim">
          In this version the tally operator holds the viewing keys, so it can
          see individual ballots and is trusted to publish only the aggregate.
          Refunds are computed but cannot yet be executed. Both are written up in{" "}
          <a href={`${REPO}/blob/main/docs/TRUST_MODEL.md`} target="_blank" rel="noreferrer">
            TRUST_MODEL.md
          </a>
          .
        </p>
      </section>

      <section className="panel">
        <h2>Contracts</h2>
        <dl className="contracts">
          <dt>ProposalRegistry</dt>
          <dd>
            <a href={`${VOYAGER}/contract/${REGISTRY_ADDRESS}`} target="_blank" rel="noreferrer" className="mono">
              {shortHex(REGISTRY_ADDRESS, 12, 8)}
            </a>
          </dd>
          <dt>GovernanceAnonymizer</dt>
          <dd>
            <a href={`${VOYAGER}/contract/${ANONYMIZER_ADDRESS}`} target="_blank" rel="noreferrer" className="mono">
              {shortHex(ANONYMIZER_ADDRESS, 12, 8)}
            </a>
          </dd>
          <dt>STRK20 pool</dt>
          <dd>
            <a href={`${VOYAGER}/contract/${POOL_ADDRESS}`} target="_blank" rel="noreferrer" className="mono">
              {shortHex(POOL_ADDRESS, 12, 8)}
            </a>
          </dd>
        </dl>
      </section>

      <footer>
        <a href={REPO} target="_blank" rel="noreferrer">
          Source
        </a>
        <span> · </span>
        <a href={`${REPO}/blob/main/docs/ARCHITECTURE.md`} target="_blank" rel="noreferrer">
          Architecture
        </a>
        <span> · </span>
        <span className="dim">Starknet mainnet</span>
      </footer>
    </main>
  );
}
