export type ModelInvocationProvenance = {
  workflowId?: string; stepName?: string; attemptNumber?: number;
  promptName?: string; promptVersion?: string; promptHash?: string; promptTemplate?: string;
  schemaName?: string; schemaVersion?: string; schema?: unknown;
  inputProjectionVersion?: string; settings?: unknown; requestSnapshot?: unknown;
  resolvedModel?: string; providerRequestId?: string;
};

export type ModelInvocationRow = {
  id: string;
  timestamp: string;
  provider: string;
  model: string;
  invocationType: string;
  learnerId: string | null;
  actorKind?: 'learner' | 'service';
  actorId?: string;
  requestingLearnerId?: string | null;
  userDisplayName: string | null;
  spendUsd: number | null;
  spendSource: 'reported' | 'estimated' | 'unknown';
  latencyMs: number | null;
  status: 'running' | 'completed' | 'failed' | 'timed_out' | 'invalid_response';
};
