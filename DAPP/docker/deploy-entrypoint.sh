#!/bin/sh
set -eu

RPC_URL="${RPC_URL:-http://chain:8545}"
mkdir -p /runtime
cd /app/contracts

echo "Waiting for Anvil at ${RPC_URL}..."
attempt=0
until [ "$(cast chain-id --rpc-url "$RPC_URL" 2>/dev/null || true)" = "31337" ]; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    echo "Anvil did not become ready in time." >&2
    exit 1
  fi
  sleep 2
done

echo "Compiling Crowdfunding.sol..."
forge build
forge inspect src/Crowdfunding.sol:Crowdfunding abi --json > /runtime/Crowdfunding.abi.json

if [ -f /runtime/config.json ]; then
  address=$(sed -n 's/.*"contractAddress"[[:space:]]*:[[:space:]]*"\(0x[0-9a-fA-F]*\)".*/\1/p' /runtime/config.json | head -n 1)
  if [ -n "$address" ]; then
    code=$(cast code "$address" --rpc-url "$RPC_URL" 2>/dev/null || true)
    if [ -n "$code" ] && [ "$code" != "0x" ]; then
      echo "Existing deployment $address matches the persisted Anvil chain; keeping it."
      exit 0
    fi
  fi
fi

echo "Deploying contract and creating local example projects..."
forge script script/Deploy.s.sol:DeployScript \
  --broadcast --unlocked --sender "$ANVIL_ACCOUNT_0" --rpc-url "$RPC_URL"
cp out/deployment.json /runtime/config.json

echo "Advancing local chain so the success and failure examples enter their next phase..."
cast rpc evm_increaseTime 100 --rpc-url "$RPC_URL"
cast rpc evm_mine --rpc-url "$RPC_URL"

echo "Deployment ready:"
cat /runtime/config.json
