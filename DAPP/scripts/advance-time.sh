#!/bin/sh
set -eu
seconds="${1:-}"
case "$seconds" in
  ''|*[!0-9]*) echo "Usage: $0 <seconds> (1..31536000)" >&2; exit 2 ;;
esac
if [ "$seconds" -lt 1 ] || [ "$seconds" -gt 31536000 ]; then
  echo "Seconds must be between 1 and 31536000." >&2
  exit 2
fi
rpc=http://chain:8545
chain_id=$(docker compose exec -T foundry-tools cast chain-id --rpc-url "$rpc")
if [ "$chain_id" != "31337" ]; then
  echo "Refusing to advance time: RPC is not local Chain ID 31337." >&2
  exit 1
fi
docker compose exec -T foundry-tools cast rpc evm_increaseTime "$seconds" --rpc-url "$rpc"
docker compose exec -T foundry-tools cast rpc evm_mine --rpc-url "$rpc"
echo "Advanced local simulation chain by ${seconds}s."
