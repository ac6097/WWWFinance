import type { InterfaceAbi } from 'ethers';

// The deployment container writes the compiled ABI to /runtime/Crowdfunding.abi.json.
// This module intentionally contains no deployment address or account secret.
export async function loadAbi(): Promise<InterfaceAbi> {
  const response = await fetch('/runtime/Crowdfunding.abi.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('合约 ABI 尚未就绪，请确认 Docker 部署服务已完成。');
  return response.json() as Promise<InterfaceAbi>;
}
