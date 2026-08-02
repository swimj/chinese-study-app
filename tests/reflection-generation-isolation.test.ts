import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, beforeEach, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { SessionReflectionEvidenceSupplementV1 } from '../src/domain/reflection-evidence.ts';
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
    sqlite.exec('PRAGMA foreign_keys = ON;');
  });

  beforeEach(() => {
    sqlite.exec(`
      PRAGMA defer_foreign_keys = ON;
      BEGIN;
      DELETE FROM reflection_proposal_reviews;
      DELETE FROM reflection_operation_invocations;
      DELETE FROM reflection_generation_runs;
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
      reflectionFlowVersion: 'initial_post_session_reflection.v1',
      startedAt: generatedAt,
      completedAt: generatedAt,
      provider: 'openai',
      model: 'gpt-5.6-luna-high',
      providerModel: 'gpt-5.6-luna',
      promptVersion: 'reflection-v2',
      responseId: null,
      finishReason: null,
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
        schemaVersion: 'session_reflection_result.v4',
        itemResults: [{
          itemId: 'unknown-item',
          diagnosisTags: ['ordinary_retrieval_noise'],
          observation: 'This result does not correspond to the supplied item.',
          learnerExplanation: null,
          proposals: [],
          questions: [],
          unhandledNeeds: [],
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
});

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
      )
  `).run(startedAt, startedAt);
  sqlite.prepare(`
    INSERT INTO word_meanings (
      id, word_id, position, text, show_on_production_prompt, created_at, updated_at
    ) VALUES
      ('target-1', 'target', 0, 'goal', 1, ?, ?),
      ('target-2', 'target', 1, 'objective', 1, ?, ?),
      ('alternate-1', 'alternate', 0, 'substitute', 1, ?, ?)
  `).run(startedAt, startedAt, startedAt, startedAt, startedAt, startedAt);
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
        NULL, '{}', '2026-07-29T08:10:00.000Z'
      ),
      (
        'attempt-2', '2026-07-29T08:06:00.000Z', 'session-1', 'action-1', 2,
        2, 'production', 'target', '["production"]', '目标', 'correct', 'good',
        NULL, '{}', '2026-07-29T08:10:00.000Z'
      )
  `).run();
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
    assert.equal(bundle.session?.sessionId, 'session-1');
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
