param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateRange(1, 31536000)]
  [int]$Seconds
)

$ErrorActionPreference = 'Stop'
$rpc = 'http://chain:8545'
$chainId = docker compose exec -T foundry-tools cast chain-id --rpc-url $rpc
if ($LASTEXITCODE -ne 0 -or "$chainId".Trim() -ne '31337') {
  throw '拒绝推进时间：当前 RPC 不是 Chain ID 31337 的本地 Anvil。'
}

docker compose exec -T foundry-tools cast rpc evm_increaseTime $Seconds --rpc-url $rpc
if ($LASTEXITCODE -ne 0) { throw 'Anvil 时间推进失败。' }
docker compose exec -T foundry-tools cast rpc evm_mine --rpc-url $rpc
if ($LASTEXITCODE -ne 0) { throw '挖出新块失败。' }
Write-Host "已在本地模拟链推进 $Seconds 秒。"
