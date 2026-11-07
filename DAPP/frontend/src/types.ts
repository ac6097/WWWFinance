import type { Contract, Provider, Signer } from 'ethers';

export type RuntimeConfig = {
  contractAddress: string | null;
  chainId: number;
  rpcUrl: string;
  demoEnabled: boolean;
  environment: string;
};

export type ProjectStatus = 'Funding' | 'Failed' | 'Voting' | 'Approved' | 'Rejected' | 'Released';

export type Project = {
  id: number;
  name: string;
  description: string;
  creator: string;
  goal: bigint;
  raised: bigint;
  fundingDeadline: number;
  votingDuration: number;
  yesWeight: bigint;
  noWeight: bigint;
  withdrawn: boolean;
  status: ProjectStatus;
  contributed: bigint;
  voted: boolean;
};

export type ChainContext = {
  config: RuntimeConfig;
  contract: Contract;
  provider: Provider;
  signer: Signer;
  account: string;
  mode: 'demo' | 'metamask';
};

export type ChainEvent = {
  name: string;
  label: string;
  projectId: number;
  account: string;
  amount?: bigint;
  detail?: string;
  hash: string;
  blockNumber: number;
  timestamp?: number;
};
