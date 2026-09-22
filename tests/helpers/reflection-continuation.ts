import type {
  CuratedReflectionBundleV2,
  PureCuePromotionEvidenceV1,
  ReflectionItemV4,
  SessionReflectionBundleV5,
  StagedReflectionDiagnosisSharedAxisResultV1,
} from '../../src/domain/reflection.ts';
import type {
  InitialReflectionGenerationDependencies,
} from '../../server/reflection/generation.ts';
import type {
  ReflectionGenerationContinuation,
  ReflectionGenerationContinuationRetrySource,
} from '../../server/db/reflections.ts';

export function createTestReflectionContinuationBoundaries(): Pick<
  InitialReflectionGenerationDependencies,
  'createContinuation' | 'preparePromotion' | 'linkContinuationRun' | 'getContinuationRetrySource'
> & {
  continuations: Map<string, ReflectionGenerationContinuation>;
} {
  const continuations = new Map<string, ReflectionGenerationContinuation>();
  const runLinks = new Map<string, { continuationId: string; stage: 'diagnosis' | 'promotion' }>();
  let sequence = 0;
  return {
    continuations,
    createContinuation(input) {
      const continuationId = input.continuationId ?? `test-continuation-${++sequence}`;
      const continuation: ReflectionGenerationContinuation = {
        continuationId,
        sourceSessionId: input.sourceSessionId,
        reflectionFlowVersion: input.reflectionFlowVersion,
        createdAt: input.createdAt,
        eligibleItemCount: input.eligibleItemCount,
        includedItemCount: input.includedItemCount,
        diagnosisBundle: input.diagnosisBundle,
        sourceProposalIds: input.sourceProposalIds ?? null,
        overlapOmittedItemCount: input.overlapOmittedItemCount ?? 0,
        diagnosisResult: null,
        finalEvidenceBundle: null,
        promotionBundle: null,
        artifactId: null,
      };
      continuations.set(continuationId, continuation);
      return continuation;
    },
    preparePromotion(input) {
      const current = continuations.get(input.continuationId);
      if (current === undefined) throw new Error('Missing test reflection continuation.');
      if (current.diagnosisResult !== null) return current;
      const resultByItemId = new Map(
        input.diagnosisResult.itemResults.map((itemResult) => [itemResult.itemId, itemResult]),
      );
      const items = current.diagnosisBundle.items.map((item) => {
        const itemResult = resultByItemId.get(item.itemId)!;
        return {
          ...item,
          promotionEvidence: itemResult.kind === 'shared_axis'
            ? testPromotionEvidence(item, itemResult)
            : null,
        };
      });
      const studyProfile = 'session' in current.diagnosisBundle
        ? current.diagnosisBundle.session.studyProfile
        : current.diagnosisBundle.studyProfile;
      const finalEvidenceBundle: SessionReflectionBundleV5 | CuratedReflectionBundleV2 =
        'session' in current.diagnosisBundle
          ? {
              schemaVersion: 'session_reflection_bundle.v5',
              generatedAt: input.preparedAt,
              session: current.diagnosisBundle.session,
              items,
            }
          : {
              schemaVersion: 'curated_reflection_bundle.v2',
              generatedAt: input.preparedAt,
              studyProfile,
              items,
            };
      const promotionBundle = {
        schemaVersion: 'pure_cue_promotion_bundle.v1' as const,
        generatedAt: input.preparedAt,
        sourceSessionId: current.sourceSessionId,
        studyProfile,
        items: items.flatMap((item) => {
          const result = resultByItemId.get(item.itemId)!;
          if (
            result.kind !== 'shared_axis'
            || item.promotionEvidence === null
            || item.submittedWord === null
          ) return [];
          return [{
            itemId: item.itemId,
            sourceAttemptId: item.sourceAttemptId,
            targetWord: item.targetWord,
            responseWord: item.submittedWord,
            servedCue: item.servedCue,
            handoff: result.handoff,
            promotionEvidence: item.promotionEvidence,
          }];
        }),
      };
      const prepared: ReflectionGenerationContinuation = {
        ...current,
        diagnosisResult: input.diagnosisResult,
        finalEvidenceBundle,
        promotionBundle,
      };
      continuations.set(input.continuationId, prepared);
      return prepared;
    },
    linkContinuationRun(input) {
      runLinks.set(input.runId, {
        continuationId: input.continuationId,
        stage: input.stage,
      });
    },
    getContinuationRetrySource(runId): ReflectionGenerationContinuationRetrySource | null {
      const link = runLinks.get(runId);
      if (link === undefined) return null;
      const continuation = continuations.get(link.continuationId);
      if (continuation === undefined) return null;
      return {
        runId,
        continuation,
        stage: link.stage,
        provider: 'openai',
        model: 'gpt-5.6-luna-high',
        providerModel: 'gpt-5.6-luna',
        promptVersion: link.stage === 'diagnosis'
          ? 'reflection-staged-v1'
          : 'pure-cue-promotion-v1',
      };
    },
  };
}

function testPromotionEvidence(
  item: ReflectionItemV4,
  result: StagedReflectionDiagnosisSharedAxisResultV1,
): PureCuePromotionEvidenceV1 | null {
  const responseWordId = item.submittedWord?.wordId;
  if (
    item.responseKind !== 'matched_known_word'
    || responseWordId === undefined
    || responseWordId === item.targetWord.wordId
  ) return null;
  return {
    diagnosisTags: result.diagnosisTags,
    words: [item.targetWord.wordId, responseWordId].map((wordId) => ({
      wordId,
      activeProductionCues: [],
    })),
    intersectingPureCues: [],
  };
}
