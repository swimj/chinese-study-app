export type ModelInvocationRow = {
  id: string;
  timestamp: string;
  provider: string;
  model: string;
  invocationType: string;
  learnerId: string;
  userDisplayName: string | null;
  spendUsd: number | null;
  spendSource: 'reported' | 'estimated' | 'unknown';
  status: 'running' | 'completed' | 'failed';
};
