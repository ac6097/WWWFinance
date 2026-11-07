import {
  BrowserProvider,
  Contract,
  JsonRpcProvider,
  type Provider,
  type Signer,
} from 'ethers';
import type { ChainContext, RuntimeConfig } from './types';
import { loadAbi } from './abi';

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on?: (event: string, callback: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, callback: (...args: unknown[]) => void) => void;
    };
  }
}

export async function loadConfig(): Promise<RuntimeConfig> {
  const response = await fetch('/runtime/config.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('无法读取本地部署信息。');
  return response.json() as Promise<RuntimeConfig>;
}

export async function createContext(
  config: RuntimeConfig,
  mode: 'demo' | 'metamask',
  demoAccount?: string,
  requestWallet = false,
): Promise<ChainContext> {
  if (!config.contractAddress) throw new Error('合约尚未部署，请检查 deployer 容器日志。');
  const abi = await loadAbi();
  let provider: Provider;
  let signer: Signer;
  let account: string;

  if (mode === 'demo') {
    if (!config.demoEnabled) throw new Error('当前环境未开启本地模拟账号。');
    const demoProvider = new JsonRpcProvider(config.rpcUrl, config.chainId, { staticNetwork: true });
    const accounts = (await demoProvider.send('eth_accounts', [])) as string[];
    if (!accounts.length) throw new Error('Anvil 未返回本地模拟账号，请检查链容器。');
    account = demoAccount && accounts.some((item) => item.toLowerCase() === demoAccount.toLowerCase())
      ? accounts.find((item) => item.toLowerCase() === demoAccount.toLowerCase())!
      : accounts[0];
    signer = await demoProvider.getSigner(account);
    provider = demoProvider;
  } else {
    if (!window.ethereum) throw new Error('没有检测到 MetaMask，请安装扩展或切换到演示账号。');
    const browserProvider = new BrowserProvider(window.ethereum as never);
    if (requestWallet) await browserProvider.send('eth_requestAccounts', []);
    const network = await browserProvider.getNetwork();
    if (Number(network.chainId) !== config.chainId) {
      throw new Error(`MetaMask 网络不匹配。请切换到本地 Chain ID ${config.chainId}。`);
    }
    signer = await browserProvider.getSigner();
    account = await signer.getAddress();
    provider = browserProvider;
  }

  const contract = new Contract(config.contractAddress, abi, signer);
  return { config, contract, provider, signer, account, mode };
}

export async function listDemoAccounts(config: RuntimeConfig): Promise<string[]> {
  const provider = new JsonRpcProvider(config.rpcUrl, config.chainId, { staticNetwork: true });
  return (await provider.send('eth_accounts', [])) as string[];
}

export async function switchMetaMaskToLocal(config: RuntimeConfig): Promise<void> {
  if (!window.ethereum) throw new Error('没有检测到 MetaMask。');
  const chainId = `0x${config.chainId.toString(16)}`;
  try {
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code !== 4902) throw error;
    await window.ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId,
        chainName: 'Anvil 本地课程链',
        nativeCurrency: { name: 'Test Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: [config.rpcUrl],
      }],
    });
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
  }
}

export function asProvider(provider: Provider): Provider {
  return provider;
}
