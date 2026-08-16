import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, beforeEach, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import type {
  ReflectionOperation,
  SessionReflectionBundleV1,
  SessionReflectionResultV4,
} from '../src/domain/reflection.ts';
import type { InitialReflectionGenerationService } from '../server/reflection/generation.ts';
import { ReflectionEvidenceError } from '../server/reflection/evidence.ts';
import { LunaReflectionProviderError } from '../server/reflection/luna-provider.ts';
import type { ReflectionLifecycleEvent } from '../server/reflection/lifecycle-log.ts';

type DbModule = typeof import('../server/db.ts');
type IndexModule = typeof import('../server/index.ts');
type ExpressApp = ReturnType<IndexModule['createApp']>;

const generatedAt = '2026-07-29T12:00:00.000Z';
let dataDir = '';
let sqlite: DatabaseSync;
let dbModule: DbModule;
let indexModule: IndexModule;
let app: ExpressApp;
let receivedGenerationRequest: {
  sessionId: string;
  evidenceSupplement: unknown;
} | null = null;
let generationImplementation: InitialReflectionGenerationService['generate'];
let retryImplementation: InitialReflectionGenerationService['retry'];
let receivedRetryRunId: string | null = null;
let lifecycleEvents: ReflectionLifecycleEvent[];

describe('reflection HTTP API', { concurrency: false }, () => {
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
    sqlite.exec('PRAGMA foreign_keys = ON;');
    const generationService: InitialReflectionGenerationService = {
      generate(sessionId, evidenceSupplement) {
        receivedGenerationRequest = { sessionId, evidenceSupplement };
        return generationImplementation(sessionId, evidenceSupplement);
      },
      retry(runId) {
        receivedRetryRunId = runId;
        return retryImplementation(runId);
      },
    };
    app = indexModule.createApp({
      reflectionGenerationService: generationService,
      reflectionLifecycleLogger: {
        emit(event) {
          lifecycleEvents.push(event);
        },
      },
    });
  });

  beforeEach(() => {
    sqlite.exec(`
      PRAGMA defer_foreign_keys = ON;
      BEGIN;
      DELETE FROM reflection_quality_annotations;
      DELETE FROM reflection_proposal_reviews;
      DELETE FROM reflection_operation_invocations;
      DELETE FROM reflection_generation_runs;
      DELETE FROM reflection_artifacts;
      DELETE FROM contrast_prompts;
      DELETE FROM contrast_cluster_members;
      DELETE FROM contrast_clusters;
      DELETE FROM contrast_candidate_intake;
      DELETE FROM word_skill_relevance;
      DELETE FROM review_session_summaries;
      DELETE FROM study_attempt_events;
      DELETE FROM study_events;
      DELETE FROM study_sessions;
      DELETE FROM word_meanings;
      DELETE FROM words;
      COMMIT;
    `);
    insertWord('target', '目标');
    insertWord('alternate', '替代');
    receivedGenerationRequest = null;
    receivedRetryRunId = null;
    lifecycleEvents = [];
    generationImplementation = async () => ({
      artifactId: 'generated-artifact',
      proposalCount: 1,
      status: 'created',
    });
    retryImplementation = async () => ({
      artifactId: 'retried-artifact',
      proposalCount: 2,
      status: 'created',
    });
  });

  after(() => {
    sqlite.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('posts the supplement directly and uses created/existing generation statuses', async () => {
    const supplement = {
      schemaVersion: 'session_reflection_evidence_supplement.v1',
      items: [],
    };
    const created = await request(
      '/api/study-sessions/session-1/reflections',
      { method: 'POST', body: supplement },
    );
    assert.equal(created.status, 201);
    assert.deepEqual(created.json, {
      artifactId: 'generated-artifact',
      proposalCount: 1,
      status: 'created',
    });
    assert.deepEqual(receivedGenerationRequest, {
      sessionId: 'session-1',
      evidenceSupplement: supplement,
    });
    assert.equal(lifecycleEvents[0]?.event, 'reflection.generation_requested');
    assert.deepEqual(lifecycleEvents[0], {
      event: 'reflection.generation_requested',
      sessionId: 'session-1',
    });
    assert.equal(lifecycleEvents[1]?.event, 'reflection.generation_succeeded');
    assert.deepEqual(lifecycleEvents[1], {
      event: 'reflection.generation_succeeded',
      sessionId: 'session-1',
      artifactId: 'generated-artifact',
      proposalCount: 1,
      status: 'created',
      elapsedMs: lifecycleEvents[1]?.elapsedMs,
    });

    generationImplementation = async () => ({
      artifactId: 'existing-artifact',
      proposalCount: 2,
      status: 'existing',
    });
    const existing = await request(
      '/api/study-sessions/session-1/reflections',
      { method: 'POST', body: supplement },
    );
    assert.equal(existing.status, 200);
    assert.deepEqual(existing.json, {
      artifactId: 'existing-artifact',
      proposalCount: 2,
      status: 'existing',
    });
  });

  test('maps evidence, configuration, provider, and internal generation failures safely', async () => {
    generationImplementation = async () => {
      throw new ReflectionEvidenceError('session_not_found', 'Study session not found.');
    };
    assert.deepEqual(
      await request('/api/study-sessions/missing/reflections', { method: 'POST', body: {} }),
      {
        status: 404,
        json: { error: 'Study session not found.', code: 'session_not_found' },
      },
    );

    generationImplementation = async () => {
      throw new LunaReflectionProviderError('missing_config');
    };
    assert.deepEqual(
      await request('/api/study-sessions/session-1/reflections', { method: 'POST', body: {} }),
      {
        status: 503,
        json: {
          error: 'Reflection provider credentials are not configured.',
          code: 'missing_config',
        },
      },
    );

    generationImplementation = async () => {
      throw new LunaReflectionProviderError('schema_invalid', 3);
    };
    assert.deepEqual(
      await request('/api/study-sessions/session-1/reflections', { method: 'POST', body: {} }),
      {
        status: 502,
        json: {
          error: 'The reflection provider response did not match the required schema.',
          code: 'schema_invalid',
        },
      },
    );

    generationImplementation = async () => {
      throw new Error('database path and private provider output');
    };
    const internal = await request(
      '/api/study-sessions/session-1/reflections',
      { method: 'POST', body: {} },
    );
    assert.deepEqual(internal, {
      status: 500,
      json: { error: 'Failed to generate reflection' },
    });
    assert.equal(JSON.stringify(internal).includes('private provider output'), false);
    assert.deepEqual(lifecycleEvents.at(-1), {
      event: 'reflection.generation_failed',
      sessionId: 'session-1',
      failure: 'internal',
      code: null,
      clientRequestId: null,
      elapsedMs: lifecycleEvents.at(-1)?.elapsedMs,
    });
  });

  test('serves open queue, recent history, and reconstructed artifact detail', async () => {
    const openArtifact = materialize('open-session', suppressOperation('target')).artifact;
    const informational = materializationInput(
      'informational-session',
      suppressOperation('target'),
    );
    informational.result.itemResults[0] = {
      ...informational.result.itemResults[0]!,
      proposals: [],
    };
    const informationalArtifact = dbModule.materializeReflectionArtifact(informational).artifact;

    const open = await request('/api/reflection-artifacts?review=open');
    assert.equal(open.status, 200);
    assert.deepEqual(
      (open.json as { artifacts: Array<{ artifactId: string }> }).artifacts
        .map(({ artifactId }) => artifactId),
      [openArtifact.artifactId],
    );

    const all = await request('/api/reflection-artifacts?review=all');
    assert.equal(all.status, 200);
    assert.deepEqual(
      new Set(
        (all.json as { artifacts: Array<{ artifactId: string }> }).artifacts
          .map(({ artifactId }) => artifactId),
      ),
      new Set([openArtifact.artifactId, informationalArtifact.artifactId]),
    );

    const detail = await request(`/api/reflection-artifacts/${openArtifact.artifactId}`);
    assert.equal(detail.status, 200);
    assert.equal(
      (detail.json as { proposals: Array<{ review: { disposition: { kind: string } } }> })
        .proposals[0]?.review.disposition.kind,
      'pending',
    );
    assert.equal(
      (detail.json as { result: SessionReflectionResultV4 }).result.itemResults[0]?.observation,
      'The production goal is not useful.',
    );

    assert.equal((await request('/api/reflection-artifacts')).status, 400);
    assert.equal((await request('/api/reflection-artifacts?review=unknown')).status, 400);
    assert.equal((await request('/api/reflection-artifacts/missing')).status, 404);
  });

  test('isolates an unreadable artifact instead of failing the artifact list', async () => {
    const artifact = materialize('unreadable-session', suppressOperation('target')).artifact;
    sqlite.exec('DROP TRIGGER reflection_artifacts_immutable;');
    try {
      sqlite.prepare(`
        UPDATE reflection_artifacts
        SET result_json = '{}'
        WHERE artifact_id = ?
      `).run(artifact.artifactId);
    } finally {
      dbModule.ensureReflectionSchema();
    }

    const response = await request('/api/reflection-artifacts?review=all');
    assert.equal(response.status, 200);
    assert.deepEqual(response.json, {
      artifacts: [{
        artifactId: artifact.artifactId,
        sourceSessionId: 'unreadable-session',
        reflectionFlowVersion: 'initial_post_session_reflection.v1',
        generatedAt,
        provider: 'openai',
        model: 'gpt-5.6-luna-high',
        promptVersion: 'reflection-v2',
        bundleSchemaVersion: 'session_reflection_bundle.v1',
        resultSchemaVersion: 'session_reflection_result.v4',
        proposalCount: 1,
        openProposalCount: 1,
        readState: 'unreadable',
        itemCount: null,
      }],
    });
    assert.equal(
      (await request(`/api/reflection-artifacts/${artifact.artifactId}`)).status,
      500,
    );
  });

  test('serves the compact reflection generation run log independently of artifacts', async () => {
    materializationInput('run-session', suppressOperation('target'));
    dbModule.recordReflectionGenerationRun({
      runId: 'failed-run',
      sourceSessionId: 'run-session',
      reflectionFlowVersion: 'initial_post_session_reflection.v1',
      startedAt: generatedAt,
      completedAt: '2026-07-29T12:00:01.000Z',
      provider: 'openai',
      model: 'gpt-5.6-luna-high',
      providerModel: 'gpt-5.6-luna',
      promptVersion: 'reflection-v2',
      responseId: 'response-failed',
      finishReason: 'length',
      state: 'failed',
      failureCode: 'output_truncated',
      eligibleItemCount: 4,
      includedItemCount: 2,
      usage: {
        inputTokens: 100,
        cachedInputTokens: 40,
        cacheWriteInputTokens: null,
        outputTokens: 20,
        reasoningTokens: 10,
        totalTokens: 120,
      },
      pricingSnapshotId: 'price-v1',
      pricingAsOf: '2026-07-30',
      pricingBasis: { id: 'price-v1' },
      estimatedCostUsd: 0.00005,
      evidenceBundle: bundle('run-session'),
    });

    const response = await request('/api/reflection-generation-runs');
    assert.equal(response.status, 200);
    assert.deepEqual(response.json, {
      runs: [dbModule.listReflectionGenerationRuns()[0]],
    });
  });

  test('retries a failed generation run through the dedicated endpoint', async () => {
    const response = await request(
      '/api/reflection-generation-runs/failed-run/retry',
      { method: 'POST' },
    );
    assert.equal(response.status, 201);
    assert.equal(receivedRetryRunId, 'failed-run');
    assert.deepEqual(response.json, {
      artifactId: 'retried-artifact',
      proposalCount: 2,
      status: 'created',
    });

    retryImplementation = async () => {
      throw new Error('Reflection generation run is not retryable.');
    };
    assert.equal((await request(
      '/api/reflection-generation-runs/succeeded-run/retry',
      { method: 'POST' },
    )).status, 409);
  });

  test('strictly reviews proposals and immediately applies supported acceptance', async () => {
    const deferredArtifact = materialize(
      'deferred-session',
      suppressOperation('target'),
    ).artifact;
    const deferredId = deferredArtifact.proposals[0]!.review.proposalId;
    const deferred = await request(
      `/api/reflection-proposals/${deferredId}/review`,
      { method: 'POST', body: { action: 'defer' } },
    );
    assert.equal(deferred.status, 200);
    assert.equal(
      (deferred.json as { review: { disposition: { kind: string } } }).review.disposition.kind,
      'deferred',
    );

    const dismissedArtifact = materialize(
      'dismissed-session',
      suppressOperation('target'),
    ).artifact;
    const dismissedId = dismissedArtifact.proposals[0]!.review.proposalId;
    const dismissed = await request(
      `/api/reflection-proposals/${dismissedId}/review`,
      { method: 'POST', body: { action: 'dismiss', reason: 'Not useful.' } },
    );
    assert.equal(dismissed.status, 200);
    assert.deepEqual(
      (dismissed.json as { review: { disposition: unknown } }).review.disposition,
      { kind: 'dismissed', reason: 'Not useful.' },
    );

    const acceptedArtifact = materialize(
      'accepted-session',
      suppressOperation('target'),
    ).artifact;
    const acceptedId = acceptedArtifact.proposals[0]!.review.proposalId;
    const accepted = await request(
      `/api/reflection-proposals/${acceptedId}/review`,
      {
        method: 'POST',
        body: { action: 'accept', operation: suppressOperation('target') },
      },
    );
    assert.equal(accepted.status, 200);
    assert.equal(
      (accepted.json as { review: { disposition: { kind: string; acceptanceMode: string } } })
        .review.disposition.acceptanceMode,
      'exact',
    );
    assert.deepEqual(
      (accepted.json as { application: { state: unknown } }).application.state,
      {
        kind: 'applied',
        appliedAt: assertIsoString(
          (accepted.json as {
            application: { state: { kind: 'applied'; appliedAt: string } };
          }).application.state.appliedAt,
        ),
        effectRefs: [{ type: 'word_skill_relevance', id: 'target/production' }],
      },
    );
    assert.equal(dbModule.getWordSkillRelevance('target', 'production')?.relevanceState, 'suppressed');

    assert.equal(
      (await request(`/api/reflection-proposals/${deferredId}/review`, {
        method: 'POST',
        body: { action: 'defer', unexpected: true },
      })).status,
      400,
    );
    assert.equal(
      (await request('/api/reflection-proposals/missing/review', {
        method: 'POST',
        body: { action: 'defer' },
      })).status,
      404,
    );
  });

  test('upserts quality annotations, dismisses with reasonCode, and serves model-arm stats', async () => {
    const artifact = materialize('quality-api-session', suppressOperation('target')).artifact;
    const proposalId = artifact.proposals[0]!.review.proposalId;

    const praise = await request('/api/reflection-quality', {
      method: 'PUT',
      body: {
        subject: { kind: 'proposal', proposalId },
        polarity: 'praise',
      },
    });
    assert.equal(praise.status, 200);
    assert.equal((praise.json as { polarity: string }).polarity, 'praise');

    const dismissed = await request(`/api/reflection-proposals/${proposalId}/review`, {
      method: 'POST',
      body: {
        action: 'dismiss',
        reason: 'Wrong handle.',
        reasonCode: 'wrong_intervention',
      },
    });
    assert.equal(dismissed.status, 200);

    const detail = await request(`/api/reflection-artifacts/${artifact.artifactId}`);
    assert.equal(detail.status, 200);
    const annotations = (detail.json as {
      qualityAnnotations: Array<{ polarity: string; reasonCode: string | null }>;
    }).qualityAnnotations;
    assert.equal(annotations.length, 1);
    assert.equal(annotations[0]!.polarity, 'critique');
    assert.equal(annotations[0]!.reasonCode, 'wrong_intervention');

    const stats = await request('/api/reflection-quality-stats');
    assert.equal(stats.status, 200);
    const arms = (stats.json as {
      arms: Array<{ modelArm: string; dismissCount: number; dismissalReasons: Record<string, number> }>;
    }).arms;
    const arm = arms.find((entry) => entry.modelArm === 'gpt-5.6-luna-high');
    assert(arm);
    assert.equal(arm.dismissCount, 1);
    assert.equal(arm.dismissalReasons.wrong_intervention, 1);

    const cleared = await request('/api/reflection-quality', {
      method: 'DELETE',
      body: { subject: { kind: 'proposal', proposalId } },
    });
    assert.equal(cleared.status, 200);
    assert.deepEqual(cleared.json, { cleared: true });

    assert.equal((await request('/api/reflection-quality', {
      method: 'PUT',
      body: {
        subject: { kind: 'proposal', proposalId },
        polarity: 'critique',
        reasonCode: 'missed_intervention',
      },
    })).status, 400);
  });

  test('replaces a proposal with a different handle and applies the replacement lifecycle', async () => {
    const artifact = materialize('replacement-session', suppressOperation('target')).artifact;
    const proposalId = artifact.proposals[0]!.review.proposalId;
    const replacement = repairOperation('target');
    const response = await request(`/api/reflection-proposals/${proposalId}/review`, {
      method: 'POST',
      body: { action: 'replace', operation: replacement },
    });

    assert.equal(response.status, 200);
    const payload = response.json as {
      review: { disposition: {
        kind: string;
        supersession: { replacementInvocationId: string; source: string; actor: string };
      } };
      invocation: { invocationId: string; origin: unknown; operation: unknown };
      application: { state: { kind: string } };
    };
    assert.deepEqual(
      payload.review.disposition,
      {
        kind: 'superseded',
        supersession: {
          source: 'user_replacement',
          actor: 'user',
          reason: 'The user authorized a different operation during proposal review.',
          replacementProposalId: null,
          replacementInvocationId: payload.invocation.invocationId,
          satisfyingEffectRefs: [],
        },
      },
    );
    assert.deepEqual(payload.invocation.origin, {
      kind: 'user_replacement',
      supersededProposalId: proposalId,
    });
    assert.deepEqual(payload.invocation.operation, replacement);
    assert.equal(payload.application.state.kind, 'unsupported');
    assert.equal(
      (await request(`/api/reflection-proposals/${proposalId}/review`, {
        method: 'POST',
        body: { action: 'replace', operation: suppressOperation('target') },
      })).status,
      400,
    );
  });

  test('preserves unsupported standing authorization and withdraws only its application', async () => {
    const artifact = materialize('unsupported-session', repairOperation('target')).artifact;
    const proposalId = artifact.proposals[0]!.review.proposalId;
    const accepted = await request(
      `/api/reflection-proposals/${proposalId}/review`,
      {
        method: 'POST',
        body: { action: 'accept', operation: repairOperation('target') },
      },
    );
    assert.equal(accepted.status, 200);
    assert.equal(
      (accepted.json as { application: { state: { kind: string } } }).application.state.kind,
      'unsupported',
    );
    const invocationId = (
      accepted.json as { invocation: { invocationId: string } }
    ).invocation.invocationId;

    const withdrawn = await request(
      `/api/reflection-invocations/${invocationId}/withdraw-authorization`,
      { method: 'POST' },
    );
    assert.equal(withdrawn.status, 200);
    assert.deepEqual(
      (withdrawn.json as { application: { state: unknown } }).application.state,
      { kind: 'authorization_withdrawn' },
    );
    const detail = await request(`/api/reflection-artifacts/${artifact.artifactId}`);
    assert.equal(
      (detail.json as {
        proposals: Array<{ review: { disposition: { kind: string } } }>;
      }).proposals[0]?.review.disposition.kind,
      'accepted',
    );
    assert.equal(
      (detail.json as {
        proposals: Array<{ invocation: { application: { state: { kind: string } } } }>;
      }).proposals[0]?.invocation.application.state.kind,
      'authorization_withdrawn',
    );

    assert.equal(
      (await request(
        `/api/reflection-invocations/${invocationId}/withdraw-authorization`,
        { method: 'POST' },
      )).status,
      400,
    );
    assert.equal(
      (await request(
        '/api/reflection-invocations/missing/withdraw-authorization',
        { method: 'POST' },
      )).status,
      404,
    );
  });

  test('keeps compound item proposals independently reviewable', async () => {
    const input = materializationInput(
      'compound-session',
      suppressOperation('target'),
    );
    input.result.itemResults[0]!.proposals.push({
      proposalGroupKey: 'compound-intervention',
      rationale: 'Draft a fairer cue independently.',
      operation: repairOperation('target'),
    });
    input.result.itemResults[0]!.proposals[0]!.proposalGroupKey = 'compound-intervention';
    const artifact = dbModule.materializeReflectionArtifact(input).artifact;
    assert.equal(artifact.proposals.length, 2);

    const firstProposalId = artifact.proposals[0]!.review.proposalId;
    const secondProposalId = artifact.proposals[1]!.review.proposalId;
    assert.equal(
      (await request(`/api/reflection-proposals/${firstProposalId}/review`, {
        method: 'POST',
        body: { action: 'defer' },
      })).status,
      200,
    );
    assert.equal(
      (await request(`/api/reflection-proposals/${secondProposalId}/review`, {
        method: 'POST',
        body: { action: 'accept', operation: repairOperation('target') },
      })).status,
      200,
    );

    const detail = await request(`/api/reflection-artifacts/${artifact.artifactId}`);
    const proposals = (
      detail.json as {
        proposals: Array<{
          review: { disposition: { kind: string } };
          invocation: null | { application: { state: { kind: string } } };
        }>;
      }
    ).proposals;
    assert.equal(proposals[0]?.review.disposition.kind, 'deferred');
    assert.equal(proposals[0]?.invocation, null);
    assert.equal(proposals[1]?.review.disposition.kind, 'accepted');
    assert.equal(proposals[1]?.invocation?.application.state.kind, 'unsupported');
    assert.equal(
      ((
        await request('/api/reflection-artifacts?review=open')
      ).json as { artifacts: Array<{ artifactId: string }> }).artifacts
        .some(({ artifactId }) => artifactId === artifact.artifactId),
      true,
    );
  });

  test('exposes an explicit startup recovery seam for durable pending applications', () => {
    insertPendingInvocation('pending-recovery', suppressOperation('alternate'));
    const recovered = indexModule.recoverPendingReflectionApplicationsAtStartup();
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0]?.application.state.kind, 'applied');
    assert.equal(dbModule.getWordSkillRelevance('alternate', 'production')?.relevanceState, 'suppressed');
    assert.deepEqual(indexModule.recoverPendingReflectionApplicationsAtStartup(), []);
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
    reflectionFlowVersion: 'initial_post_session_reflection.v1',
    generatedAt,
    provider: 'openai',
    model: 'gpt-5.6-luna-high',
    promptVersion: 'reflection-v2',
    evidenceBundle: bundle(sessionId),
    result: result(operation),
  };
}

function bundle(sessionId: string): SessionReflectionBundleV1 {
  return {
    schemaVersion: 'session_reflection_bundle.v1',
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
      cuesAsShown: [{
        cueId: null,
        cueType: 'definition_gloss',
        displayOrder: 0,
        text: 'target',
        displayedMeanings: ['target'],
      }],
      rawResponse: '替代',
      responseKind: 'typed',
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

function result(operation: ReflectionOperation): SessionReflectionResultV4 {
  return {
    schemaVersion: 'session_reflection_result.v4',
    itemResults: [{
      itemId: 'item-1',
      diagnosisTags: ['persistent_confusion'],
      observation: 'The production goal is not useful.',
      learnerExplanation: null,
      proposals: [{
        proposalGroupKey: null,
        rationale: 'Apply the bounded operation.',
        operation,
      }],
      questions: [],
      unhandledNeeds: [],
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

function repairOperation(wordId: string): ReflectionOperation {
  return {
    kind: 'repair_production_cue',
    version: 1,
    wordId,
    proposedCues: [{
      cueType: 'minimal_context',
      text: 'A distinguishing context.',
    }],
    repairIntent: 'add_distinguishing_anchor',
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

function insertPendingInvocation(invocationId: string, operation: ReflectionOperation): void {
  sqlite.prepare(`
    INSERT INTO reflection_operation_invocations (
      invocation_id,
      created_at,
      origin_kind,
      origin_proposal_id,
      origin_superseded_proposal_id,
      operation_kind,
      operation_version,
      operation_json,
      application_state,
      application_updated_at,
      unsupported_reason,
      applied_at,
      application_error,
      stale_reason,
      effect_refs_json,
      satisfying_effect_refs_json
    ) VALUES (?, ?, 'manual', NULL, NULL, ?, ?, ?, 'pending', ?, NULL, NULL, NULL, NULL, '[]', '[]')
  `).run(
    invocationId,
    generatedAt,
    operation.kind,
    operation.version,
    JSON.stringify(operation),
    generatedAt,
  );
}

function assertIsoString(value: string): string {
  assert.equal(new Date(value).toISOString(), value);
  return value;
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
