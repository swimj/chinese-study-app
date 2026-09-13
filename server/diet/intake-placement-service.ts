import { randomUUID } from 'node:crypto';
import {
  DIET_INTAKE_PLACEMENT_REQUEST_VERSION,
  isDietIntakePlacementAnswers,
  type DietIntakePlacementAnswer,
} from '../../src/domain/diet-intake-placement.ts';
import { requireLearnerId } from '../db/learner-context.ts';
import {
  DietManifestUnavailableError,
  mapNextLearningLevelToDeckId,
  recordAssessedDietIntakeIfUnchanged,
  snapshotStoredDietProfile,
  type DietProfile,
} from '../db/diet-profile.ts';
import { loadDeckManifest } from '../decks/manifest.ts';
import type { DeckManifest } from '../decks/manifest.ts';
import { createDietIntakePlacementProvider, DietIntakePlacementProviderError, type DietIntakePlacementProvider } from './intake-placement-provider.ts';
export class DietIntakePlacementAssessmentError extends Error {
  constructor(
    readonly code: 'invalid_input' | 'already_running' | 'provider_failure',
    message: string,
    readonly providerCode: string | null = null,
  ) {
    super(message);
    this.name = 'DietIntakePlacementAssessmentError';
  }
}
export type DietIntakePlacementService = {
  assessAndApply(answers: DietIntakePlacementAnswer[]): Promise<DietProfile>;
};

export function createDietIntakePlacementService(options: {
  provider?: DietIntakePlacementProvider;
  now?: () => Date;
  loadManifest?: () => DeckManifest | null;
} = {}): DietIntakePlacementService {
  const provider = options.provider ?? createDietIntakePlacementProvider();
  const now = options.now ?? (() => new Date());
  const loadManifest = options.loadManifest ?? loadDeckManifest;
  const inFlight = new Set<string>();
  return {
    async assessAndApply(answers) {
      if (!isDietIntakePlacementAnswers(answers)) {
        throw new DietIntakePlacementAssessmentError('invalid_input', 'Expected one or two bounded non-empty intake answers.');
      }
      const manifest = loadManifest();
      if (manifest === null) {
        throw new DietManifestUnavailableError();
      }
      // Preflight a valid scale value to ensure this installation has an HSK
      // placement deck before it sends learner-authored text to the provider.
      mapNextLearningLevelToDeckId(manifest, 1);
      const learnerId = requireLearnerId();
      if (inFlight.has(learnerId)) {
        throw new DietIntakePlacementAssessmentError('already_running', 'A diet intake assessment is already in progress.');
      }
      inFlight.add(learnerId);
      try {
        const beforeSnapshot = snapshotStoredDietProfile();
        let generated;
        try {
          generated = await provider.assess(
            { schemaVersion: DIET_INTAKE_PLACEMENT_REQUEST_VERSION, answers },
            { clientRequestId: randomUUID() },
          );
        } catch (error) {
          if (error instanceof DietIntakePlacementProviderError) {
            throw new DietIntakePlacementAssessmentError('provider_failure', error.message, error.code);
          }
          throw error;
        }
        return recordAssessedDietIntakeIfUnchanged({
          answers, level: generated.result.nextLearningLevel, rationale: generated.result.rationale,
          provider: generated.metadata, at: now().toISOString(),
        }, beforeSnapshot, manifest);
      } finally {
        inFlight.delete(learnerId);
      }
    },
  };
}
