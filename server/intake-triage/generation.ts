import { randomUUID } from 'node:crypto';
import {
  materializeSuccessfulIntakeTriageRun,
  recordFailedIntakeTriageRun,
  type IntakeTriageRunRecord,
} from '../db/intake-triage.ts';
import {
  buildIntakeTriageProviderRequest,
  selectIntakeTriageWords,
} from './evidence.ts';
import {
  estimateRunCostFromSnapshot,
  LUNA_STANDARD_SHORT_CONTEXT_PRICING,
} from '../llm/run-pricing.ts';
import {
  createIntakeTriageProvider,
  INTAKE_TRIAGE_MODEL_CONFIG,
  IntakeTriageProviderError,
  type IntakeTriageProvider,
  type IntakeTriageRunMetadata,
} from './provider.ts';
import type { RunCostEstimate } from '../llm/run-pricing.ts';

export class IntakeTriageGenerationError extends Error {
  readonly code: 'no_candidates' | 'already_running' | 'provider_failure';
  readonly providerCode: string | null;

  constructor(code: IntakeTriageGenerationError['code'], message: string, providerCode: string | null = null) {
    super(message);
    this.name = 'IntakeTriageGenerationError';
    this.code = code;
    this.providerCode = providerCode;
  }
}

export type IntakeTriageGenerationService = {
  generate(): Promise<IntakeTriageRunRecord>;
};

export function createIntakeTriageGenerationService(options: {
  provider?: IntakeTriageProvider;
  now?: () => Date;
} = {}): IntakeTriageGenerationService {
  const provider = options.provider ?? createIntakeTriageProvider();
  const now = options.now ?? (() => new Date());
  let running = false;

  return {
    async generate() {
      if (running) {
        throw new IntakeTriageGenerationError('already_running', 'An intake advisor run is already in progress.');
      }
      const startedAt = now().toISOString();
      const selectedWords = selectIntakeTriageWords();
      if (selectedWords.length === 0) {
        throw new IntakeTriageGenerationError('no_candidates', 'No new words need intake analysis.');
      }

      running = true;
      const runId = randomUUID();
      const request = buildIntakeTriageProviderRequest(selectedWords);
      try {
        const generated = await provider.generate(request, { clientRequestId: runId });
        const costEstimate = estimateIntakeTriageRunCost(generated.metadata);
        return materializeSuccessfulIntakeTriageRun({
          runId,
          startedAt,
          completedAt: now().toISOString(),
          selectedWords,
          assessments: generated.assessments,
          metadata: generated.metadata,
          costEstimate,
        });
      } catch (error) {
        if (error instanceof IntakeTriageProviderError) {
          recordFailedIntakeTriageRun({
            runId,
            startedAt,
            completedAt: now().toISOString(),
            includedWordCount: selectedWords.length,
            metadata: error.metadata,
            failureCode: error.code,
            costEstimate: estimateIntakeTriageRunCost(error.metadata),
          });
          throw new IntakeTriageGenerationError('provider_failure', error.message, error.code);
        }
        throw error;
      } finally {
        running = false;
      }
    },
  };
}

function estimateIntakeTriageRunCost(metadata: IntakeTriageRunMetadata): RunCostEstimate | null {
  if (
    metadata.provider !== INTAKE_TRIAGE_MODEL_CONFIG.provider
    || metadata.providerModel !== LUNA_STANDARD_SHORT_CONTEXT_PRICING.providerModel
  ) return null;
  return estimateRunCostFromSnapshot(metadata.usage, LUNA_STANDARD_SHORT_CONTEXT_PRICING);
}
