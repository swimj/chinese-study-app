import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, beforeEach, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { SessionReflectionEvidenceSupplementV1 } from '../src/domain/reflection-evidence.ts';
import type { SessionReflectionBundleV4 } from '../src/domain/reflection.ts';
import { createInitialReflectionGenerationService } from '../server/reflection/generation.ts';
import {
  createLunaReflectionProvider,
  LunaReflectionProviderError,
} from '../server/reflection/luna-provider.ts';
import type { JsonValue } from '../server/llm/types.ts';

type DbModule = typeof import('../server/db.ts');

const startedAt = '2026-07-29T08:00:00.000Z';
const completedAt = '2026-07-29T08:20:00.000Z';
const generatedAt = '2026-07-29T08:21:00.000Z';

let dataDir = '';
let sqlite: DatabaseSync;
let dbModule: DbModule;

describe('reflection generation failure isolation', { concurrency: false }, () => {
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reflection-generation-isolation-'));
    const previousMode = process.env.APP_MODE;
    const previousDataDir = process.env.APP_DATA_DIR;
    const previousStudyProfile = process.env.APP_STUDY_PROFILE;
    try {
      process.env.APP_MODE = 'study';
      process.env.APP_DATA_DIR = dataDir;
      process.env.APP_STUDY_PROFILE = 'mandarin';
      dbModule = await import(
        `${pathToFileURL(path.resolve('server/db.ts')).href}?test=${Date.now()}`
      );
    } finally {
      restoreEnv('APP_MODE', previousMode);
      restoreEnv('APP_DATA_DIR', previousDataDir);
      restoreEnv('APP_STUDY_PROFILE', previousStudyProfile);
    }

    sqlite = new DatabaseSync(path.join(dataDir, 'app.db'));
    sqlite.function('current_learner_id', () => 'test-learner');
    sqlite.exec('PRAGMA foreign_keys = ON;');
  });

  beforeEach(() => {
    sqlite.exec(`
      PRAGMA defer_foreign_keys = ON;
      BEGIN;
      DELETE FROM reflection_help_inbox;
      DELETE FROM reflection_quality_annotations;
      DELETE FROM reflection_proposal_reviews;
      DELETE FROM reflection_operation_invocations;
      DELETE FROM reflection_generation_continuation_runs;
      DELETE FROM reflection_generation_continuations;
      DELETE FROM reflection_generation_runs;
      DELETE FROM reflection_generation_run_starts;
      DELETE FROM reflection_artifacts;
      DELETE FROM review_session_summaries;
      DELETE FROM study_attempt_events;
      DELETE FROM study_events;
      DELETE FROM study_sessions;
      DELETE FROM word_meanings;
      DELETE FROM words;
      COMMIT;
    `);
    insertCompletedStudyState();
  });

  after(() => {
    sqlite.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('an upstream provider error preserves study state and records an unavailable-usage failure', async () => {
    const before = completedStudyState();
    const provider = createLunaReflectionProvider({
      environment: { OPENAI_API_KEY: 'test-only-key' },
      systemPrompt: 'Test reflection prompt.',
      fetchImplementation: providerFetch({ error: 'provider unavailable' }, 503),
    });
    const service = createInitialReflectionGenerationService({
      provider,
      now: () => generatedAt,
    });

    await assert.rejects(
      service.generate('session-1', supplement()),
      (error: unknown) => (
        error instanceof LunaReflectionProviderError
        && error.code === 'upstream_failure'
      ),
    );

    assert.deepEqual(completedStudyState(), before);
    assertNoArtifactRows();
    const [run] = dbModule.listReflectionGenerationRuns();
    assert.ok(run);
    assert.match(run.runId, /^[0-9a-f-]{36}$/);
    assert.deepEqual({ ...run, runId: 'generated-run-id' }, {
      runId: 'generated-run-id',
      sourceSessionId: 'session-1',
      reflectionFlowVersion: 'initial_post_session_reflection.v4',
      startedAt: generatedAt,
      completedAt: generatedAt,
      provider: 'openai',
      model: 'gpt-5.6-luna-high',
      providerModel: 'gpt-5.6-luna',
      promptVersion: 'reflection-staged-v1',
      responseId: null,
      clientRequestId: run.clientRequestId,
      finishReason: null,
      bundleSchemaVersion: 'session_reflection_bundle.v4',
      resultSchemaVersion: 'staged_reflection_diagnosis_result.v1',
      diagnostic: {
        schemaVersion: 'reflection_generation_diagnostic.v1',
        phase: 'provider_transport',
        issues: [],
        rejectedOutput: null,
      },
      state: 'failed',
      failureCode: 'upstream_failure',
      eligibleItemCount: 1,
      includedItemCount: 1,
      usage: unavailableUsage(),
      pricingSnapshotId: null,
      pricingAsOf: null,
      pricingBasis: null,
      estimatedCostUsd: null,
      retryable: true,
    });
  });

  test('a contract-invalid result preserves study state and records provider usage', async () => {
    const before = completedStudyState();
    const provider = createLunaReflectionProvider({
      environment: { OPENAI_API_KEY: 'test-only-key' },
      systemPrompt: 'Test reflection prompt.',
      fetchImplementation: providerFetch(responseEnvelope({
        schemaVersion: 'staged_reflection_diagnosis_result.v1',
        itemResults: [{
          kind: 'ordinary',
          itemId: 'unknown-item',
          diagnosisTags: ['ordinary_retrieval_noise'],
          learnerExplanation: 'This result does not correspond to the supplied item.',
          proposals: [],
          questions: [],
        }],
      })),
    });
    const service = createInitialReflectionGenerationService({
      provider,
      now: () => generatedAt,
    });

    await assert.rejects(
      service.generate('session-1', supplement()),
      (error: unknown) => (
        error instanceof LunaReflectionProviderError
        && error.code === 'domain_contract_invalid'
      ),
    );

    assert.deepEqual(completedStudyState(), before);
    assertNoArtifactRows();
    const [run] = dbModule.listReflectionGenerationRuns();
    assert.equal(run?.state, 'failed');
    assert.equal(run?.failureCode, 'domain_contract_invalid');
    assert.deepEqual(run?.usage, {
      inputTokens: 10,
      cachedInputTokens: null,
      cacheWriteInputTokens: null,
      outputTokens: 10,
      reasoningTokens: null,
      totalTokens: 20,
    });
    assert.equal(run?.estimatedCostUsd, 0.000014);
    assert.equal(run?.pricingAsOf, '2026-07-30');
  });

  test('a truncated response preserves study state and records its available usage', async () => {
    const before = completedStudyState();
    const provider = createLunaReflectionProvider({
      environment: { OPENAI_API_KEY: 'test-only-key' },
      systemPrompt: 'Test reflection prompt.',
      fetchImplementation: providerFetch({
        id: 'response-truncated',
        model: 'gpt-5.6-luna',
        choices: [{
          finish_reason: 'length',
          message: { content: '{"partial":' },
        }],
        usage: {
          prompt_tokens: 20,
          completion_tokens: 8,
          total_tokens: 28,
        },
      }),
    });
    const service = createInitialReflectionGenerationService({
      provider,
      now: () => generatedAt,
    });

    await assert.rejects(
      service.generate('session-1', supplement()),
      (error: unknown) => (
        error instanceof LunaReflectionProviderError
        && error.code === 'output_truncated'
      ),
    );

    assert.deepEqual(completedStudyState(), before);
    assertNoArtifactRows();
    const [run] = dbModule.listReflectionGenerationRuns();
    assert.equal(run?.state, 'failed');
    assert.equal(run?.failureCode, 'output_truncated');
    assert.equal(run?.responseId, 'response-truncated');
    assert.equal(run?.finishReason, 'length');
    assert.deepEqual(run?.usage, {
      inputTokens: 20,
      cachedInputTokens: null,
      cacheWriteInputTokens: null,
      outputTokens: 8,
      reasoningTokens: null,
      totalTokens: 28,
    });
    assert.equal(run?.estimatedCostUsd, 0.0000136);
  });

  test('does not promote an explicitly ordinary strict known-word lapse even with shared-axis tags', async () => {
    let promotionCalls = 0;
    const service = createInitialReflectionGenerationService({
      now: () => generatedAt,
      provider: {
        async generate() {
          throw new Error('new initial flow must use staged diagnosis');
        },
        async generateDiagnosis(bundle) {
          return {
            result: {
              schemaVersion: 'staged_reflection_diagnosis_result.v1',
              itemResults: bundle.items.map((item) => ({
                kind: 'ordinary' as const,
                itemId: item.itemId,
                diagnosisTags: ['production_cue_overloaded'] as const,
                learnerExplanation: 'Keep this as an ordinary item despite the diagnosis tag.',
                proposals: [],
                questions: [],
              })),
            },
            metadata: stagedMetadata('reflection-staged-v1'),
          };
        },
        async generatePromotion() {
          promotionCalls += 1;
          throw new Error('ordinary retrieval noise must not enter promotion');
        },
      },
    });

    const generated = await service.generate(
      'session-1',
      supplement(),
      'openai:gpt-5.6-luna-high',
    );
    const artifact = dbModule.getReflectionArtifactDetail(generated.artifactId);
    assert.equal(promotionCalls, 0);
    assert.equal(artifact.resultSchemaVersion, 'session_reflection_result.v8');
    assert.equal(
      artifact.result.itemResults[0]?.learnerExplanation,
      'Keep this as an ordinary item despite the diagnosis tag.',
    );
    assert.equal(
      artifact.result.itemResults.some((item) => item.proposals.some((proposal) => (
        proposal.operation.kind === 'promote_pure_elicitation'
      ))),
      false,
    );
  });

  test('a staged deferred second opinion persists both calls and sessionless selected-proposal provenance', async () => {
    const sourceDiagnosisEvidence = stagedSourceBundle();
    const sourceEvidence = {
      ...sourceDiagnosisEvidence,
      schemaVersion: 'session_reflection_bundle.v5' as const,
      items: sourceDiagnosisEvidence.items.map((item) => ({
        ...item,
        promotionEvidence: null,
      })),
    };
    const sourceArtifact = dbModule.materializeReflectionArtifact({
      sourceSessionId: 'session-1',
      reflectionFlowVersion: 'initial_post_session_reflection.v4',
      generatedAt,
      provider: 'openai',
      model: 'gpt-5.6-luna-high',
      promptVersion: 'reflection-staged-v1',
      evidenceBundle: sourceEvidence,
      result: {
        schemaVersion: 'session_reflection_result.v8',
        itemResults: [{
          itemId: 'source-item',
          diagnosisTags: ['production_cue_overloaded'],
          learnerExplanation: 'The broad cue hides a useful distinction.',
          proposals: [{
            proposalGroupKey: null,
            rationale: 'Review this cue policy again.',
            operation: { kind: 'suppress_definition_production', version: 1, wordId: 'target' },
          }],
          questions: [],
        }],
      },
    });
    const sourceProposalId = sourceArtifact.artifact.proposals[0]!.review.proposalId;
    dbModule.deferReflectionProposal(sourceProposalId, generatedAt);
    let diagnosisBundle: unknown;
    let promotionBundle: unknown;
    let deferredItemId = '';
    const service = createInitialReflectionGenerationService({
      now: () => generatedAt,
      provider: {
        async generate() {
          throw new Error('new deferred flow must use staged diagnosis');
        },
        async generateDiagnosis(bundle) {
          diagnosisBundle = bundle;
          deferredItemId = bundle.items[0]!.itemId;
          return {
            result: {
              schemaVersion: 'staged_reflection_diagnosis_result.v1',
              itemResults: bundle.items.map((item) => ({
                kind: 'shared_axis' as const,
                itemId: item.itemId,
                diagnosisTags: ['production_cue_overloaded'],
                handoff: sharedAxisHandoff(),
              })),
            },
            metadata: stagedMetadata('reflection-staged-v1'),
          };
        },
        async generatePromotion(bundle) {
          promotionBundle = bundle;
          return {
            result: {
              schemaVersion: 'pure_cue_promotion_result.v1',
              itemResults: bundle.items.map((item) => ({
                itemId: item.itemId,
                decision: {
                  kind: 'disagreement' as const,
                  learnerExplanation: 'On review, the two words should stay separate.',
                },
              })),
            },
            metadata: stagedMetadata('pure-cue-promotion-v1'),
          };
        },
      },
    });

    const generated = await service.generateDeferredSecondOpinion(
      [sourceProposalId],
      'openai:gpt-5.6-luna-high',
    );
    const artifact = dbModule.getReflectionArtifactDetail(generated.artifactId);
    assert.equal(artifact.sourceSessionId, null);
    assert.equal(artifact.reflectionFlowVersion, 'deferred_second_opinion.v3');
    assert.equal(artifact.evidenceBundle.schemaVersion, 'curated_reflection_bundle.v2');
    assert.equal('studyProfile' in artifact.evidenceBundle && artifact.evidenceBundle.studyProfile, 'mandarin');
    assert.equal(
      isRecord(diagnosisBundle) && diagnosisBundle.schemaVersion,
      'curated_reflection_diagnosis_bundle.v2',
    );
    assert.equal(isRecord(diagnosisBundle) && diagnosisBundle.studyProfile, 'mandarin');
    assert.equal(isRecord(promotionBundle) && promotionBundle.sourceSessionId, null);
    assert.deepEqual(artifact.result.itemResults[0], {
      itemId: deferredItemId,
      diagnosisTags: ['production_cue_overloaded'],
      learnerExplanation: 'On review, the two words should stay separate.',
      promotionOutcome: 'disagreement',
      proposals: [],
      questions: [],
    });

    const runs = dbModule.listReflectionGenerationRuns().filter((run) => (
      run.reflectionFlowVersion === 'deferred_second_opinion.v3'
    ));
    assert.equal(runs.length, 2);
    assert.deepEqual(new Set(runs.map((run) => run.resultSchemaVersion)), new Set([
      'staged_reflection_diagnosis_result.v1',
      'pure_cue_promotion_result.v1',
    ]));
    assert.ok(runs.every((run) => run.state === 'succeeded' && run.retryable === false));
    const provenance = sqlite.prepare(`
      SELECT source_proposal_ids_json
      FROM reflection_generation_runs
      WHERE reflection_flow_version = 'deferred_second_opinion.v3'
    `).all() as Array<{ source_proposal_ids_json: string | null }>;
    assert.deepEqual(
      provenance.map((row) => JSON.parse(row.source_proposal_ids_json ?? 'null')),
      [[sourceProposalId], [sourceProposalId]],
    );
    const continuation = sqlite.prepare(`
      SELECT source_session_id, source_proposal_ids_json, artifact_id
      FROM reflection_generation_continuations
    `).get() as {
      source_session_id: string | null;
      source_proposal_ids_json: string;
      artifact_id: string;
    };
    assert.equal(continuation.source_session_id, null);
    assert.deepEqual(JSON.parse(continuation.source_proposal_ids_json), [sourceProposalId]);
    assert.equal(continuation.artifact_id, generated.artifactId);
    assert.equal(
      dbModule.getReflectionArtifactDetail(sourceArtifact.artifact.artifactId)
        .proposals[0]!.review.disposition.kind,
      'requested_second_opinion',
    );
  });

  test('persists the shared-axis handoff and materializes a promotion beside a pair-disjoint ordinary item', async () => {
    insertProductionCue('target', 'broad-target', ['target'], 'goal or substitute');
    insertProductionCue('alternate', 'broad-alternate', ['alternate'], 'goal or substitute');
    insertProductionCue('third', 'third-only', ['third'], 'third only');
    const evidence = stagedPromotionBundle();
    const service = createInitialReflectionGenerationService({
      now: () => generatedAt,
      buildBundle: () => evidence,
      provider: {
        async generate() {
          throw new Error('new initial flow must use staged diagnosis');
        },
        async generateDiagnosis(bundle) {
          return {
            result: {
              schemaVersion: 'staged_reflection_diagnosis_result.v1',
              itemResults: [{
                kind: 'shared_axis' as const,
                itemId: bundle.items[0]!.itemId,
                diagnosisTags: ['production_cue_overloaded'],
                handoff: sharedAxisHandoff(),
              }, {
                kind: 'ordinary' as const,
                itemId: bundle.items[1]!.itemId,
                diagnosisTags: ['ordinary_retrieval_noise'],
                learnerExplanation: 'Keep the unrelated owner policy adjustment only.',
                proposals: [{
                  proposalGroupKey: null,
                  rationale: 'This unrelated third-word proposal remains valid.',
                  operation: {
                    kind: 'suppress_definition_production' as const,
                    version: 1 as const,
                    wordId: 'third',
                  },
                }],
                questions: [],
              }],
            },
            metadata: stagedMetadata('reflection-staged-v1'),
          };
        },
        async generatePromotion(bundle) {
          assert.equal(bundle.items.length, 1);
          assert.equal(bundle.items[0]!.sourceAttemptId, 'attempt-1');
          assert.deepEqual(bundle.items[0]!.handoff, sharedAxisHandoff());
          assert.equal('learnerExplanation' in bundle.items[0]!, false);
          assert.deepEqual(
            bundle.items[0]!.promotionEvidence.words.map((word) => word.wordId),
            ['target', 'alternate'],
          );
          return {
            result: {
              schemaVersion: 'pure_cue_promotion_result.v1',
              itemResults: [{
                itemId: bundle.items[0]!.itemId,
                decision: {
                  kind: 'promote' as const,
                  rationale: 'Practice the shared axis directly.',
                  learnerExplanation: 'Practice a shared cue, then use owner-only cues for the distinction.',
                  operation: {
                    destination: {
                      kind: 'create' as const,
                      stimulus: 'goal or substitute',
                      axisNote: 'Choose the word that matches the intended role.',
                    },
                    wordPlans: [{
                      wordId: 'target',
                      deactivateCueIds: ['broad-target'],
                      distinctiveCueDrafts: [{
                        cueType: 'minimal_context' as const,
                        text: 'An intended outcome to work toward.',
                      }],
                    }, {
                      wordId: 'alternate',
                      deactivateCueIds: ['broad-alternate'],
                      distinctiveCueDrafts: [],
                    }],
                  },
                },
              }],
            },
            metadata: stagedMetadata('pure-cue-promotion-v1'),
          };
        },
      },
    });

    const generated = await service.generate(
      'session-1',
      { schemaVersion: 'session_reflection_evidence_supplement.v1', items: [] },
      'openai:gpt-5.6-luna-high',
    );
    const artifact = dbModule.getReflectionArtifactDetail(generated.artifactId);
    assert.equal(artifact.bundleSchemaVersion, 'session_reflection_bundle.v5');
    assert.equal(artifact.resultSchemaVersion, 'session_reflection_result.v8');
    assert.equal(
      artifact.result.itemResults.find((item) => item.itemId === 'promotion-item')?.learnerExplanation,
      'Practice a shared cue, then use owner-only cues for the distinction.',
    );
    assert.equal(
      artifact.result.itemResults.find((item) => item.itemId === 'promotion-item')?.promotionOutcome,
      'promoted',
    );
    const savedContinuation = sqlite.prepare(`
      SELECT diagnosis_result_json, promotion_bundle_json
      FROM reflection_generation_continuations
      WHERE artifact_id = ?
    `).get(generated.artifactId) as {
      diagnosis_result_json: string;
      promotion_bundle_json: string;
    };
    const savedDiagnosis = JSON.parse(savedContinuation.diagnosis_result_json) as {
      itemResults: Array<Record<string, unknown>>;
    };
    const savedPromotion = JSON.parse(savedContinuation.promotion_bundle_json) as {
      items: Array<Record<string, unknown>>;
    };
    assert.deepEqual(savedDiagnosis.itemResults[0], {
      kind: 'shared_axis',
      itemId: 'promotion-item',
      diagnosisTags: ['production_cue_overloaded'],
      handoff: sharedAxisHandoff(),
    });
    assert.deepEqual(savedPromotion.items[0]?.handoff, sharedAxisHandoff());
    const operations = artifact.result.itemResults.flatMap((item) => (
      item.proposals.map((proposal) => proposal.operation)
    ));
    assert.deepEqual(
      operations.map((operation) => operation.kind),
      ['promote_pure_elicitation', 'suppress_definition_production'],
    );
    const promotion = operations[0]!;
    assert.equal(promotion.kind, 'promote_pure_elicitation');
    if (promotion.kind !== 'promote_pure_elicitation') return;
    assert.deepEqual({
      sourceAttemptId: promotion.sourceAttemptId,
      targetWordId: promotion.targetWordId,
      responseWordId: promotion.responseWordId,
    }, {
      sourceAttemptId: 'attempt-1',
      targetWordId: 'target',
      responseWordId: 'alternate',
    });
    assert.equal(
      operations.some((operation) => (
        operation.kind === 'suppress_definition_production'
        && operation.wordId === 'third'
      )),
      true,
    );

    const promotionProposal = artifact.proposals.find((proposal) => (
      proposal.proposal.operation.kind === 'promote_pure_elicitation'
    ));
    assert.ok(promotionProposal);
    const accepted = dbModule.acceptReflectionProposal({
      proposalId: promotionProposal.review.proposalId,
      invocationId: 'generated-promotion-invocation',
      createdAt: generatedAt,
      operation: promotion,
    });
    assert.equal(accepted.invocation.application.state.kind, 'pending');
    const applied = dbModule.applyReflectionInvocation('generated-promotion-invocation', generatedAt);
    assert.equal(applied.application.state.kind, 'applied');
    assert.ok(dbModule.getActivePureCuesAcceptingAny(['target', 'alternate']).some((cue) => (
      cue.stimulus === 'goal or substitute'
      && cue.acceptedWordIds.includes('target')
      && cue.acceptedWordIds.includes('alternate')
    )));
    assert.equal(dbModule.getActiveProductionCuesForWord('target').some((cue) => (
      cue.cueId === 'broad-target'
    )), false);
    assert.equal(dbModule.getActiveProductionCuesForWord('alternate').some((cue) => (
      cue.cueId === 'broad-alternate'
    )), false);
  });

});

function stagedSourceBundle() {
  return {
    schemaVersion: 'session_reflection_bundle.v4' as const,
    generatedAt,
    session: {
      sessionId: 'session-1',
      startedAt,
      endedAt: completedAt,
      studyProfile: 'mandarin' as const,
    },
    items: [{
      itemId: 'source-item',
      source: 'production_mistake' as const,
      sourceActionKind: 'production' as const,
      sourceAttemptId: 'attempt-1',
      sessionActionId: 'action-1',
      occurredAt: completedAt,
      targetWord: { wordId: 'target', hanzi: '目标', pinyin: 'mùbiāo', meanings: ['goal'] },
      sessionNote: null,
      existingContent: { contrastClusters: [], knownAcceptedAlternates: [] },
      servedCue: {
        cueId: 'legacy-broad-cue',
        cueType: 'definition_gloss' as const,
        text: 'goal or substitute',
        acceptedWordIds: ['target'],
        supplement: null,
      },
      rawResponse: '替代',
      submittedWord: { wordId: 'alternate', hanzi: '替代', pinyin: 'tìdài', meanings: ['substitute'] },
      responseKind: 'matched_known_word' as const,
    }],
  };
}

function stagedPromotionBundle(): SessionReflectionBundleV4 {
  const first = stagedSourceBundle().items[0]!;
  return {
    schemaVersion: 'session_reflection_bundle.v4',
    generatedAt,
    session: stagedSourceBundle().session,
    items: [{
      ...first,
      itemId: 'promotion-item',
      servedCue: {
        cueId: 'broad-target',
        cueType: 'definition_gloss',
        text: 'goal or substitute',
        acceptedWordIds: ['target'],
        supplement: null,
      },
    }, {
      ...first,
      itemId: 'unrelated-item',
      sourceAttemptId: 'synthetic-reflection-attempt:unrelated-item',
      sessionActionId: null,
      targetWord: { wordId: 'third', hanzi: '第三', pinyin: 'dìsān', meanings: ['third'] },
      rawResponse: null,
      submittedWord: null,
      responseKind: 'no_clue',
      servedCue: {
        cueId: 'third-only',
        cueType: 'minimal_context',
        text: 'third only',
        acceptedWordIds: ['third'],
        supplement: null,
      },
    }],
  };
}

function stagedMetadata(promptVersion: string) {
  return {
    provider: 'openai',
    modelConfig: 'gpt-5.6-luna-high',
    providerModel: 'gpt-5.6-luna',
    promptVersion,
    responseId: `response-${promptVersion}`,
    finishReason: 'stop',
    usage: {
      inputTokens: 10,
      cachedInputTokens: null,
      cacheWriteInputTokens: null,
      outputTokens: 5,
      reasoningTokens: 2,
      totalTokens: 15,
    },
  };
}

function sharedAxisHandoff() {
  return {
    axis: 'Choosing between an intended goal and a substitute.',
    boundaries: 'Use 目标 for the intended outcome and 替代 for what takes its place.',
    responseValidity: '替代 was valid for the overly broad served cue.',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function insertCompletedStudyState() {
  sqlite.prepare(`
    INSERT INTO words (
      id, hanzi, traditional, pinyin, meaning, meanings_json,
      personal_notes, examples_json, status, priority, created_at,
      learning_streak, last_learning_success_on, last_learning_covered_on
    ) VALUES
      (
        'target', '目标', '目標', 'mùbiāo', 'goal', '["goal","objective"]',
        '', '[]', 'review', 0, ?, 0, NULL, NULL
      ),
      (
        'alternate', '替代', NULL, 'tìdài', 'substitute', '["substitute"]',
        '', '[]', 'review', 0, ?, 0, NULL, NULL
      ),
      (
        'third', '第三', NULL, 'dìsān', 'third', '["third"]',
        '', '[]', 'review', 0, ?, 0, NULL, NULL
      )
  `).run(startedAt, startedAt, startedAt);
  sqlite.prepare(`
    INSERT INTO word_meanings (
      id, word_id, position, text, show_on_production_prompt, created_at, updated_at
    ) VALUES
      ('target-1', 'target', 0, 'goal', 1, ?, ?),
      ('target-2', 'target', 1, 'objective', 1, ?, ?),
      ('alternate-1', 'alternate', 0, 'substitute', 1, ?, ?),
      ('third-1', 'third', 0, 'third', 1, ?, ?)
  `).run(
    startedAt, startedAt,
    startedAt, startedAt,
    startedAt, startedAt,
    startedAt, startedAt,
  );
  sqlite.prepare(`
    INSERT INTO study_sessions (
      id, started_at, ended_at, processing_state, processed_at
    ) VALUES ('session-1', ?, ?, 'processed', ?)
  `).run(startedAt, completedAt, completedAt);
  dbModule.recordReviewSessionSummary({
    sessionId: 'session-1',
    completedAt,
    completedReviewActionCount: 1,
    failedReviewActionCount: 1,
    activeDurationMs: 1_200_000,
  });
  sqlite.prepare(`
    INSERT INTO study_attempt_events (
      id, occurred_at, session_id, session_action_id, session_event_sequence,
      action_attempt_sequence, action_kind, target_word_id,
      sampled_skill_ids_json, response, outcome, rating,
      content_ref_json, metadata_json, projected_at
    ) VALUES
      (
        'attempt-1', '2026-07-29T08:05:00.000Z', 'session-1', 'action-1', 1,
        1, 'production', 'target', '["production"]', '替代', 'incorrect', 'forgot',
        NULL, ?, '2026-07-29T08:10:00.000Z'
      ),
      (
        'attempt-2', '2026-07-29T08:06:00.000Z', 'session-1', 'action-1', 2,
        2, 'production', 'target', '["production"]', '目标', 'correct', 'good',
        NULL, '{}', '2026-07-29T08:10:00.000Z'
      )
  `).run(JSON.stringify({
    production: {
      taskId: 'production-task:target:default_production',
      cueId: null,
      cueType: 'definition_gloss',
      text: 'goal; objective',
      acceptedWordIds: ['target'],
      supplement: null,
      anchorWordId: 'target',
      submittedText: '替代',
      submittedWordId: 'alternate',
      result: 'rejected',
    },
  }));
}

function insertProductionCue(
  wordId: string,
  cueId: string,
  acceptedWordIds: string[],
  text: string,
) {
  const taskId = `production-task:${wordId}:default_production`;
  const eventId = `activate:${cueId}`;
  sqlite.prepare(`
    INSERT INTO production_cues (
      cue_id, task_id, cue_type, cue_text, created_at, origin_kind, origin_invocation_id
    ) VALUES (?, ?, 'minimal_context', ?, ?, 'manual', NULL)
  `).run(cueId, taskId, text, startedAt);
  const insertAccepted = sqlite.prepare(`
    INSERT INTO production_cue_accepted_words (cue_id, word_id, position)
    VALUES (?, ?, ?)
  `);
  acceptedWordIds.forEach((acceptedWordId, position) => {
    insertAccepted.run(cueId, acceptedWordId, position);
  });
  sqlite.prepare(`
    INSERT INTO production_cue_lifecycle_events (
      event_id, cue_id, task_id, lifecycle_kind, occurred_at, invocation_id
    ) VALUES (?, ?, ?, 'activated', ?, NULL)
  `).run(eventId, cueId, taskId, startedAt);
  sqlite.prepare(`
    INSERT INTO production_cue_activation_state (
      cue_id, active, latest_lifecycle_event_id, updated_at
    ) VALUES (?, 1, ?, ?)
  `).run(cueId, eventId, startedAt);
}

function supplement(): SessionReflectionEvidenceSupplementV1 {
  return {
    schemaVersion: 'session_reflection_evidence_supplement.v1',
    items: [{
      itemId: 'production-mistake:action-1',
      sessionActionId: 'action-1',
      targetWordId: 'target',
      cuesAsShown: [{
        cueId: null,
        cueType: 'definition_gloss',
        displayOrder: 0,
        text: 'goal; objective',
        displayedMeanings: ['goal', 'objective'],
      }],
      rawResponse: '替代',
      responseKind: 'typed',
      attemptIds: ['attempt-1', 'attempt-2'],
    }],
  };
}

function completedStudyState() {
  return {
    session: sqlite.prepare(`
      SELECT id, started_at, ended_at, processing_state, processed_at
      FROM study_sessions
      WHERE id = 'session-1'
    `).get(),
    summary: sqlite.prepare(`
      SELECT
        session_id,
        completed_at,
        day_key,
        completed_count,
        failed_count,
        active_duration_ms
      FROM review_session_summaries
      WHERE session_id = 'session-1'
    `).get(),
    attempts: sqlite.prepare(`
      SELECT
        id,
        occurred_at,
        session_id,
        session_action_id,
        session_event_sequence,
        action_attempt_sequence,
        action_kind,
        target_word_id,
        sampled_skill_ids_json,
        response,
        outcome,
        rating,
        content_ref_json,
        metadata_json,
        projected_at
      FROM study_attempt_events
      WHERE session_id = 'session-1'
      ORDER BY session_event_sequence, id
    `).all(),
  };
}

function assertNoArtifactRows() {
  const counts = sqlite.prepare(`
      SELECT
        (SELECT COUNT(*) FROM reflection_artifacts) AS artifact_count,
        (SELECT COUNT(*) FROM reflection_proposal_reviews) AS review_count,
        (SELECT COUNT(*) FROM reflection_operation_invocations) AS invocation_count
    `).get() as {
      artifact_count: number;
      review_count: number;
      invocation_count: number;
    };
  assert.equal(counts.artifact_count, 0);
  assert.equal(counts.review_count, 0);
  assert.equal(counts.invocation_count, 0);
}

function unavailableUsage() {
  return {
    inputTokens: null,
    cachedInputTokens: null,
    cacheWriteInputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    totalTokens: null,
  };
}

function providerFetch(body: JsonValue, status = 200): typeof globalThis.fetch {
  return (async (_input: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    const bundle = JSON.parse(request.messages[1]?.content ?? 'null') as {
      session?: { sessionId?: string };
      items?: unknown[];
    };
    assert.equal(bundle.session, undefined);
    assert.equal(bundle.items?.length, 1);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
}

function responseEnvelope(result: JsonValue): JsonValue {
  return {
    id: 'response-invalid-result',
    model: 'gpt-5.6-luna',
    choices: [{
      finish_reason: 'stop',
      message: { content: JSON.stringify(result) },
    }],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 10,
      total_tokens: 20,
    },
  };
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
