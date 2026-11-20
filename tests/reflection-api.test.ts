import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, beforeEach, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import type {
  ReflectionOperation,
  SessionReflectionBundleV6,
  SessionReflectionResultV10,
} from '../src/domain/reflection.ts';

type DbModule = typeof import('../server/db.ts');
type IndexModule = typeof import('../server/index.ts');
type ExpressApp = ReturnType<IndexModule['createApp']>;

const generatedAt = '2026-07-29T12:00:00.000Z';
let dataDir = '';
let sqlite: DatabaseSync;
let dbModule: DbModule;
let indexModule: IndexModule;
let app: ExpressApp;

describe('reflection attention HTTP API', { concurrency: false }, () => {
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-reflection-api-'));
    const previousMode = process.env.APP_MODE;
    const previousDataDir = process.env.APP_DATA_DIR;
    try {
      process.env.APP_MODE = 'study';
      process.env.APP_DATA_DIR = dataDir;
      indexModule = await import(
        `${pathToFileURL(path.resolve('server/index.ts')).href}?test=${Date.now()}`
      );
      dbModule = await import('../server/db.ts');
    } finally {
      restoreEnv('APP_MODE', previousMode);
      restoreEnv('APP_DATA_DIR', previousDataDir);
    }

    sqlite = new DatabaseSync(path.join(dataDir, 'app.db'));
    sqlite.function('current_learner_id', () => 'test-learner');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    app = indexModule.createApp();
  });

  beforeEach(() => {
    sqlite.exec(`
      PRAGMA defer_foreign_keys = ON;
      BEGIN;
      DELETE FROM reflection_help_inbox;
      DELETE FROM reflection_quality_annotations;
      DELETE FROM reflection_proposal_reviews;
      DELETE FROM reflection_operation_invocations;
      DELETE FROM reflection_generation_runs;
      DELETE FROM reflection_artifacts;
      DELETE FROM contrast_prompts;
      DELETE FROM contrast_cluster_members;
      DELETE FROM contrast_clusters;
      DELETE FROM word_skill_relevance;
      DELETE FROM review_session_summaries;
      DELETE FROM study_attempt_events;
      DELETE FROM study_events;
      DELETE FROM study_sessions;
      DELETE FROM word_meanings;
      DELETE FROM words;
      DELETE FROM learner_params;
      COMMIT;
    `);
    insertWord('target', '目标');
    insertWord('alternate', '替代');
  });

  after(() => {
    sqlite.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('attention badges count unseen help cards and mark one proposal seen', async () => {
    const withProposals = materialize('attention-api-pending', suppressOperation('target')).artifact;
    materializeInformational('attention-api-explanation');
    const listed = await request('/api/attention-badges');
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.json, {
      reflectionUnseenCount: 2,
      reflectionGenerating: false,
      failedReflectionRunIds: [],
      failedReflectionRunsSeenThroughAt: null,
      whatsNewSeenThroughDate: null,
      whatsNewSeenThroughSequence: null,
    });

    const marked = await request('/api/reflection-inbox-seen', {
      method: 'POST',
      body: { kind: 'proposal', proposalId: withProposals.proposals[0]!.review.proposalId },
    });
    assert.equal(marked.status, 200);
    assert.equal((marked.json as { reflectionUnseenCount: number }).reflectionUnseenCount, 1);

    assert.equal((await request('/api/reflection-inbox-seen', {
      method: 'POST',
      body: { kind: 'proposal', proposalId: 'missing' },
    })).status, 404);
    assert.equal((await request('/api/whats-new-seen', {
      method: 'POST',
      body: { mode: 'ensure', throughDate: '2026-09-16' },
    })).status, 200);
  });

  test('acknowledges failed reflection runs durably across a later badges read', async () => {
    materializationInput('failed-run-api', suppressOperation('target'));
    dbModule.recordReflectionGenerationRun({
      runId: 'api-failed-old',
      sourceSessionId: 'failed-run-api',
      reflectionFlowVersion: 'initial_post_session_reflection.v1',
      startedAt: generatedAt,
      completedAt: '2026-07-29T12:00:01.000Z',
      provider: 'openai',
      model: 'gpt-6-luna-high',
      providerModel: 'gpt-6-luna',
      promptVersion: 'reflection-v2',
      responseId: null,
      finishReason: null,
      state: 'failed',
      failureCode: 'upstream_failure',
      eligibleItemCount: 1,
      includedItemCount: 1,
      usage: {
        inputTokens: null,
        cachedInputTokens: null,
        cacheWriteInputTokens: null,
        outputTokens: null,
        reasoningTokens: null,
        totalTokens: null,
      },
      pricingSnapshotId: null,
      pricingAsOf: null,
      pricingBasis: null,
      estimatedCostUsd: null,
      evidenceBundle: bundle('failed-run-api'),
    });

    const listed = await request('/api/attention-badges');
    assert.equal(listed.status, 200);
    assert.deepEqual(
      (listed.json as { failedReflectionRunIds: string[] }).failedReflectionRunIds,
      ['api-failed-old'],
    );

    const marked = await request('/api/failed-reflection-runs-seen', {
      method: 'POST',
      body: { seenThroughAt: '2026-07-29T12:00:01.000Z' },
    });
    assert.equal(marked.status, 200);
    assert.deepEqual(marked.json, {
      failedReflectionRunIds: [],
      failedReflectionRunsSeenThroughAt: '2026-07-29T12:00:01.000Z',
    });

    const reloaded = await request('/api/attention-badges');
    assert.equal(reloaded.status, 200);
    const reloadedPayload = reloaded.json as {
      failedReflectionRunIds: string[];
      failedReflectionRunsSeenThroughAt: string | null;
    };
    assert.deepEqual(reloadedPayload.failedReflectionRunIds, []);
    assert.equal(
      reloadedPayload.failedReflectionRunsSeenThroughAt,
      '2026-07-29T12:00:01.000Z',
    );
    assert.equal((await request('/api/failed-reflection-runs-seen', {
      method: 'POST',
      body: { seenThroughAt: 'not-a-timestamp' },
    })).status, 400);
  });

});

async function request(
  pathname: string,
  options: { method?: string; body?: unknown } = {},
): Promise<{ status: number; json: unknown }> {
  const method = options.method ?? 'GET';
  const url = new URL(pathname, 'http://local.test');
  const matched = findRoute(app, method, url.pathname);
  assert(matched, `Missing ${method} route for ${url.pathname}`);
  const query = Object.fromEntries(url.searchParams.entries());
  let status = 200;

  return new Promise((resolve, reject) => {
    const response = {
      status(nextStatus: number) {
        status = nextStatus;
        return response;
      },
      json(value: unknown) {
        resolve({ status, json: value });
        return response;
      },
      send(value?: unknown) {
        resolve({ status, json: value ?? null });
        return response;
      },
      end() {
        resolve({ status, json: null });
        return response;
      },
    };
    try {
      const returned = matched.handler({
        params: matched.params,
        query,
        body: options.body,
      }, response);
      Promise.resolve(returned).catch(reject);
    } catch (error) {
      reject(error);
    }
  });
}

function findRoute(
  targetApp: ExpressApp,
  method: string,
  pathname: string,
): {
  params: Record<string, string>;
  handler: (request: unknown, response: unknown) => unknown;
} | null {
  type RouteLayer = {
    route?: {
      path: string;
      methods: Record<string, boolean>;
      stack: Array<{ handle: (request: unknown, response: unknown) => unknown }>;
    };
  };
  const stack = (
    targetApp as unknown as { _router: { stack: RouteLayer[] } }
  )._router.stack;
  const actualSegments = pathname.split('/').filter(Boolean);
  for (const layer of stack) {
    const route = layer.route;
    if (!route?.methods[method.toLowerCase()]) continue;
    const patternSegments = route.path.split('/').filter(Boolean);
    if (patternSegments.length !== actualSegments.length) continue;
    const params: Record<string, string> = {};
    let matches = true;
    for (const [index, patternSegment] of patternSegments.entries()) {
      const actualSegment = actualSegments[index]!;
      if (patternSegment.startsWith(':')) {
        params[patternSegment.slice(1)] = decodeURIComponent(actualSegment);
      } else if (patternSegment !== actualSegment) {
        matches = false;
        break;
      }
    }
    if (matches) {
      const handler = route.stack[0]?.handle;
      assert(handler, `Route ${route.path} has no handler`);
      return { params, handler };
    }
  }
  return null;
}

function materialize(
  sessionId: string,
  operation: ReflectionOperation,
): ReturnType<DbModule['materializeReflectionArtifact']> {
  return dbModule.materializeReflectionArtifact(materializationInput(sessionId, operation));
}

function materializeInformational(
  sessionId: string,
): ReturnType<DbModule['materializeReflectionArtifact']> {
  sqlite.prepare(`
    INSERT INTO study_sessions (
      id, started_at, ended_at, processing_state, processed_at
    ) VALUES (?, '2026-07-29T11:30:00.000Z', ?, 'processed', ?)
  `).run(sessionId, generatedAt, generatedAt);
  return dbModule.materializeReflectionArtifact({
    sourceSessionId: sessionId,
    reflectionFlowVersion: 'initial_post_session_reflection.v6',
    generatedAt,
    provider: 'openai',
    model: 'gpt-6-luna-high',
    promptVersion: 'reflection-staged-v4',
    evidenceBundle: bundle(sessionId),
    result: {
      schemaVersion: 'session_reflection_result.v10',
      itemResults: [{
        itemId: 'item-1',
        diagnosisTags: ['ordinary_retrieval_noise'],
      learnerExplanation: 'Ordinary retrieval noise; no durable change.',
        proposals: [],
        questions: [],
        }],
    },
  });
}

function materializationInput(
  sessionId: string,
  operation: ReflectionOperation,
): Parameters<DbModule['materializeReflectionArtifact']>[0] {
  sqlite.prepare(`
    INSERT INTO study_sessions (
      id, started_at, ended_at, processing_state, processed_at
    ) VALUES (?, '2026-07-29T11:30:00.000Z', ?, 'processed', ?)
  `).run(sessionId, generatedAt, generatedAt);
  return {
    sourceSessionId: sessionId,
    reflectionFlowVersion: 'initial_post_session_reflection.v6',
    generatedAt,
    provider: 'openai',
    model: 'gpt-6-luna-high',
    promptVersion: 'reflection-staged-v4',
    evidenceBundle: bundle(sessionId),
    result: result(operation),
  };
}

function bundle(sessionId: string): SessionReflectionBundleV6 {
  return {
    schemaVersion: 'session_reflection_bundle.v6',
    generatedAt,
    session: {
      sessionId,
      startedAt: '2026-07-29T11:30:00.000Z',
      endedAt: generatedAt,
      studyProfile: 'mandarin',
    },
    items: [{
      itemId: 'item-1',
      source: 'production_mistake',
      sourceActionKind: 'production',
      sessionActionId: 'action-1',
      occurredAt: '2026-07-29T11:59:00.000Z',
      targetWord: {
        wordId: 'target',
        hanzi: '目标',
        pinyin: 'mùbiāo',
        meanings: ['target'],
      },
      sessionNote: null,
      existingContent: { contrastClusters: [], knownAcceptedAlternates: [] },
      sourceAttemptId: 'attempt-1',
      promotionEvidence: null,
      servedCue: {
        cueId: null,
        cueType: 'definition_gloss',
        text: 'target',
        acceptedWordIds: ['target'],
        supplement: null,
      },
      rawResponse: '替代',
      submittedWord: {
        wordId: 'alternate',
        hanzi: '替代',
        pinyin: 'tìdài',
        meanings: ['alternate'],
      },
      responseKind: 'matched_known_word',
    }],
  };
}

function result(operation: ReflectionOperation): SessionReflectionResultV10 {
  return {
    schemaVersion: 'session_reflection_result.v10',
    itemResults: [{
      itemId: 'item-1',
      diagnosisTags: ['persistent_confusion'],
      learnerExplanation: 'The production goal is not useful.',
      proposals: [{
        proposalGroupKey: null,
        rationale: 'Apply the bounded operation.',
        operation,
      }],
      questions: [],
    }],
  };
}

function suppressOperation(wordId: string): ReflectionOperation {
  return {
    kind: 'suppress_definition_production',
    version: 1,
    wordId,
  };
}

function insertWord(wordId: string, hanzi: string): void {
  sqlite.prepare(`
    INSERT INTO words (
      id,
      hanzi,
      pinyin,
      meaning,
      meanings_json,
      personal_notes,
      examples_json,
      status,
      priority,
      created_at,
      learning_streak,
      last_learning_success_on,
      last_learning_covered_on
    ) VALUES (?, ?, 'pin1yin1', 'meaning', '["meaning"]', '', '[]', 'review', 1, ?, 0, NULL, NULL)
  `).run(wordId, hanzi, generatedAt);
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
