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
  latencyMs: number | null;
  status: 'running' | 'completed' | 'failed' | 'timed_out' | 'invalid_response';
};
