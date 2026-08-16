#!/usr/bin/env bash
#
# Declare and deploy Aperture's contracts to Starknet Sepolia, then walk the
# full governance lifecycle against them.
#
#   scripts/deploy-sepolia.sh account   # create the deploy account (once)
#   scripts/deploy-sepolia.sh deploy    # declare + deploy both contracts
#   scripts/deploy-sepolia.sh lifecycle # propose -> finalize -> register -> claim
#
# Reads STARKNET_RPC_URL_SEPOLIA from .env. snforge 0.63 removed `sncast
# script`, so this drives the sncast subcommands directly rather than running a
# Cairo deployment script.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck disable=SC1091
set -a; source .env; set +a

ACCOUNT_NAME="${ACCOUNT_NAME:-aperture-sepolia}"
# sncast rejects anything below RPC spec 0.10, and Alchemy's bare host still
# serves 0.8.1 — hence the explicitly versioned endpoint.
RPC="${STARKNET_RPC_URL_SEPOLIA_SNCAST:?set STARKNET_RPC_URL_SEPOLIA_SNCAST in .env}"
STATE_FILE="$REPO_ROOT/.sepolia-deploy.json"

export PATH="$HOME/.local/bin:$PATH"

note() { printf '\n\033[1m%s\033[0m\n' "$*"; }

case "${1:-}" in
  account)
    note "Creating Sepolia deploy account '$ACCOUNT_NAME'"
    sncast account create --name "$ACCOUNT_NAME" --url "$RPC"
    note "Fund the address printed above at https://faucet.starknet.io, then run:"
    echo "  scripts/deploy-sepolia.sh deploy"
    ;;

  deploy)
    note "Building"
    (cd contracts && scarb build)

    note "Deploying the account (no-op if already deployed)"
    sncast account deploy --name "$ACCOUNT_NAME" --url "$RPC" || true

    note "Declaring ProposalRegistry"
    sncast --account "$ACCOUNT_NAME" declare \
      --url "$RPC" --contract-name ProposalRegistry --package aperture

    note "Declaring GovernanceAnonymizer"
    sncast --account "$ACCOUNT_NAME" declare \
      --url "$RPC" --contract-name GovernanceAnonymizer --package aperture

    note "Declared. Deploy with the printed class hashes:"
    cat <<'EOF'
  # ProposalRegistry(owner, tally_operator, ballot_account_class_hash, dao_master_public_key)
  sncast --account aperture-sepolia deploy --url "$RPC" \
    --class-hash <REGISTRY_CLASS_HASH> \
    --constructor-calldata <OWNER> <OPERATOR> <BALLOT_CLASS_HASH> <MASTER_PUBKEY>

  # GovernanceAnonymizer(pool, registry)
  sncast --account aperture-sepolia deploy --url "$RPC" \
    --class-hash <ANONYMIZER_CLASS_HASH> \
    --constructor-calldata "$STRK20_POOL_ADDRESS_SEPOLIA" <REGISTRY_ADDRESS>

Record both addresses:
  node scripts/record-tx.ts --contract <ADDRESS>
EOF
    ;;

  lifecycle)
    : "${REGISTRY_ADDRESS:?export REGISTRY_ADDRESS=0x...}"
    : "${ANONYMIZER_ADDRESS:?export ANONYMIZER_ADDRESS=0x...}"

    note "Reading proposal count"
    sncast --account "$ACCOUNT_NAME" call --url "$RPC" \
      --contract-address "$REGISTRY_ADDRESS" --function proposal_count

    note "Creating a proposal"
    sncast --account "$ACCOUNT_NAME" invoke --url "$RPC" \
      --contract-address "$REGISTRY_ADDRESS" --function create_proposal \
      --calldata 0x1 0x0 0x1

    note "Reading back proposal 1"
    sncast --account "$ACCOUNT_NAME" call --url "$RPC" \
      --contract-address "$REGISTRY_ADDRESS" --function get_proposal --calldata 0x1

    note "Ballot address for FOR on proposal 1"
    sncast --account "$ACCOUNT_NAME" call --url "$RPC" \
      --contract-address "$REGISTRY_ADDRESS" --function ballot_address --calldata 0x1 0x0

    note "Anonymizer wiring"
    sncast --account "$ACCOUNT_NAME" call --url "$RPC" \
      --contract-address "$ANONYMIZER_ADDRESS" --function get_pool
    ;;

  *)
    sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
