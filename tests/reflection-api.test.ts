import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, beforeEach, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
type IndexModule = typeof import('../server/index.ts');
type ExpressApp = ReturnType<IndexModule['createApp']>;

const generatedAt = '2026-07-29T12:00:00.000Z';
let dataDir = '';
let sqlite: DatabaseSync;
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
    const withProposals = seedProposalArtifact('attention-api-pending');
    seedExplanationArtifact('attention-api-explanation');
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
      body: { kind: 'proposal', proposalId: withProposals.proposalId },
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
    insertSession('failed-run-api');
    insertFailedRun('failed-run-api', 'api-failed-old', '2026-07-29T12:00:01.000Z');

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

function insertSession(sessionId: string): void {
  sqlite.prepare(`
    INSERT INTO study_sessions (
      id, started_at, ended_at, processing_state, processed_at
    ) VALUES (?, '2026-07-29T11:30:00.000Z', ?, 'processed', ?)
  `).run(sessionId, generatedAt, generatedAt);
}

function insertArtifact(sessionId: string, resultValue: unknown): string {
  insertSession(sessionId);
  const artifactId = `artifact:${sessionId}`;
  sqlite.prepare(`
    INSERT INTO reflection_artifacts (
      artifact_id, source_session_id, source_run_id, reflection_flow_version, generated_at,
      provider, model, prompt_version, bundle_schema_version, result_schema_version,
      evidence_bundle_json, result_json
    ) VALUES (?, ?, NULL, 'initial_post_session_reflection.v6', ?, 'openai', 'gpt-6-luna-high',
      'reflection-staged-v4', 'session_reflection_bundle.v6', 'session_reflection_result.v10', ?, ?)
  `).run(artifactId, sessionId, generatedAt, JSON.stringify(bundle(sessionId)), JSON.stringify(resultValue));
  return artifactId;
}

/** Seeds the rows a materialized artifact with one pending proposal leaves. */
function seedProposalArtifact(sessionId: string): { artifactId: string; proposalId: string } {
  const artifactId = insertArtifact(sessionId, {
    schemaVersion: 'session_reflection_result.v10',
    itemResults: [{
      itemId: 'item-1',
      diagnosisTags: ['persistent_confusion'],
      learnerExplanation: 'The production goal is not useful.',
      proposals: [{
        proposalGroupKey: null,
        rationale: 'Apply the bounded operation.',
        operation: { kind: 'suppress_definition_production', version: 1, wordId: 'target' },
      }],
      questions: [],
    }],
  });
  const proposalId = `proposal:${sessionId}`;
  sqlite.prepare(`
    INSERT INTO reflection_proposal_reviews (
      proposal_id, artifact_id, item_id, proposal_index, disposition, updated_at
    ) VALUES (?, ?, 'item-1', 0, 'pending', ?)
  `).run(proposalId, artifactId, generatedAt);
  return { artifactId, proposalId };
}

/** Seeds the rows a materialized explanation-only artifact leaves. */
function seedExplanationArtifact(sessionId: string): { artifactId: string } {
  const artifactId = insertArtifact(sessionId, {
    schemaVersion: 'session_reflection_result.v10',
    itemResults: [{
      itemId: 'item-1',
      diagnosisTags: ['ordinary_retrieval_noise'],
      learnerExplanation: 'Ordinary retrieval noise; no durable change.',
      proposals: [],
      questions: [],
    }],
  });
  sqlite.prepare(`
    INSERT INTO reflection_help_inbox (inbox_id, artifact_id, item_id, opened_at)
    VALUES (?, ?, 'item-1', ?)
  `).run(`inbox:${sessionId}`, artifactId, generatedAt);
  return { artifactId };
}

function insertFailedRun(sessionId: string, runId: string, completedAt: string): void {
  sqlite.prepare(`
    INSERT INTO reflection_generation_runs (
      run_id, source_session_id, reflection_flow_version, started_at, completed_at,
      provider, model, provider_model, prompt_version, bundle_schema_version, result_schema_version,
      state, failure_code, eligible_item_count, included_item_count, evidence_bundle_json
    ) VALUES (?, ?, 'initial_post_session_reflection.v1', ?, ?, 'openai', 'gpt-6-luna-high',
      'gpt-6-luna', 'reflection-v2', 'session_reflection_bundle.v6', 'session_reflection_result.v4',
      'failed', 'upstream_failure', 1, 1, ?)
  `).run(runId, sessionId, generatedAt, completedAt, JSON.stringify(bundle(sessionId)));
}

function bundle(sessionId: string) {
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
      targetWord: { wordId: 'target', hanzi: '目标', pinyin: 'mùbiāo', meanings: ['target'] },
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
      submittedWord: { wordId: 'alternate', hanzi: '替代', pinyin: 'tìdài', meanings: ['alternate'] },
      responseKind: 'matched_known_word',
    }],
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
