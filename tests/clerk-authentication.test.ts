import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { NextFunction, Request, Response } from 'express';
import type { SessionReflectionBundleV1 } from '../src/domain/reflection.ts';

type DbModule = typeof import('../server/db.ts');
type AuthenticationModule = typeof import('../server/authentication.ts');

let dataDir = '';
let dbModule: DbModule;
let authenticationModule: AuthenticationModule;

describe('Clerk learner authentication', { concurrency: false }, () => {
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-clerk-auth-'));
    const previousMode = process.env.APP_MODE;
    const previousAuthMode = process.env.APP_AUTH_MODE;
    const previousDataDir = process.env.APP_DATA_DIR;
    const previousSeedPath = process.env.APP_SEED_DATA_PATH;
    try {
      process.env.APP_MODE = 'dev';
      process.env.APP_AUTH_MODE = 'clerk';
      process.env.APP_DATA_DIR = dataDir;
      process.env.APP_SEED_DATA_PATH = path.resolve('server/seeds/mandarin-dev.json');
      dbModule = await import(`${pathToFileURL(path.resolve('server/db.ts')).href}?clerk-auth=${Date.now()}`);
      authenticationModule = await import(
        `${pathToFileURL(path.resolve('server/authentication.ts')).href}?clerk-auth=${Date.now()}`
      );
    } finally {
      restoreEnv('APP_MODE', previousMode);
      restoreEnv('APP_AUTH_MODE', previousAuthMode);
      restoreEnv('APP_DATA_DIR', previousDataDir);
      restoreEnv('APP_SEED_DATA_PATH', previousSeedPath);
    }
  });

  after(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('bootstraps stable fresh learners with separate state over shared fixture content', () => {
    const first = invokeForSubject('user_clerk_a', () => {
      assert.ok(dbModule.getWords().length > 0);
      dbModule.updateWordPersonalNotes('hc-鼓舞-gǔu5fwǔ', 'Only learner A can see this.');
    });
    const second = invokeForSubject('user_clerk_b', () => {
      assert.equal(
        dbModule.getWords().find((word) => word.id === 'hc-鼓舞-gǔu5fwǔ')?.personalNotes,
        '',
      );
    });
    const repeatFirst = invokeForSubject('user_clerk_a', () => undefined);

    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    assert.equal(repeatFirst.statusCode, 200);
    const a = dbModule.resolveLearnerId(dbModule.CLERK_AUTH_PROVIDER, 'user_clerk_a');
    const b = dbModule.resolveLearnerId(dbModule.CLERK_AUTH_PROVIDER, 'user_clerk_b');
    assert.ok(a);
    assert.ok(b);
    assert.notEqual(a, b);
  });

  test('rejects unauthenticated and disabled Clerk subjects before private work', () => {
    const unauthenticated = invokeForSubject(null, () => {
      throw new Error('private work must not run');
    });
    assert.equal(unauthenticated.statusCode, 401);
    assert.deepEqual(unauthenticated.body, { error: 'Authentication required.', code: 'AUTH_REQUIRED' });

    const learnerId = dbModule.resolveLearnerId(dbModule.CLERK_AUTH_PROVIDER, 'user_clerk_b');
    assert.ok(learnerId);
    dbModule.setLearnerDisabled(learnerId, true, '2026-08-23T00:00:00.000Z');
    const disabled = invokeForSubject('user_clerk_b', () => {
      throw new Error('private work must not run');
    });
    assert.equal(disabled.statusCode, 403);
    assert.deepEqual(disabled.body, { error: 'Account disabled.', code: 'ACCOUNT_DISABLED' });
  });

  test('keeps two authenticated learners reflection-run ledgers separate', () => {
    invokeForSubject('user_clerk_a', () => recordFixtureReflectionRun('a-run', 'a-session'));
    invokeForSubject('user_clerk_c', () => recordFixtureReflectionRun('c-run', 'c-session'));

    let aRuns: ReturnType<DbModule['listReflectionGenerationRuns']> = [];
    let cRuns: ReturnType<DbModule['listReflectionGenerationRuns']> = [];
    invokeForSubject('user_clerk_a', () => { aRuns = dbModule.listReflectionGenerationRuns(); });
    invokeForSubject('user_clerk_c', () => { cRuns = dbModule.listReflectionGenerationRuns(); });

    assert.deepEqual(aRuns.map((run) => run.runId), ['a-run']);
    assert.deepEqual(cRuns.map((run) => run.runId), ['c-run']);
    assert.equal(aRuns[0]?.sourceSessionId, 'a-session');
    assert.equal(cRuns[0]?.sourceSessionId, 'c-session');
  });
});

function recordFixtureReflectionRun(runId: string, sessionId: string): void {
  const at = '2026-08-23T00:00:00.000Z';
  dbModule.upsertStudySessionRecord({
    id: sessionId,
    startedAt: at,
    endedAt: at,
    processingState: 'processed',
    processedAt: at,
  });
  dbModule.recordReflectionGenerationRun({
    runId,
    sourceSessionId: sessionId,
    reflectionFlowVersion: 'clerk-fixture-flow.v1',
    startedAt: at,
    completedAt: at,
    provider: 'fixture',
    model: 'fixture-model',
    providerModel: 'fixture-model',
    promptVersion: 'fixture-v1',
    responseId: null,
    clientRequestId: null,
    finishReason: null,
    bundleSchemaVersion: 'session_reflection_bundle.v1',
    resultSchemaVersion: 'session_reflection_result.v4',
    diagnostic: null,
    state: 'failed',
    failureCode: 'fixture_failure',
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
    evidenceBundle: fixtureBundle(sessionId),
  });
}

function fixtureBundle(sessionId: string): SessionReflectionBundleV1 {
  return {
    schemaVersion: 'session_reflection_bundle.v1',
    generatedAt: '2026-08-23T00:00:00.000Z',
    session: {
      sessionId,
      startedAt: '2026-08-23T00:00:00.000Z',
      endedAt: '2026-08-23T00:00:00.000Z',
      studyProfile: 'mandarin',
    },
    items: [{
      itemId: 'fixture-item',
      sessionActionId: 'fixture-action',
      occurredAt: '2026-08-23T00:00:00.000Z',
      source: 'production_mistake',
      sourceActionKind: 'production',
      targetWord: { wordId: 'fixture-target', hanzi: '目标', pinyin: 'mùbiāo', meanings: ['target'] },
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
      submittedWord: { wordId: 'fixture-alternate', hanzi: '替代', pinyin: 'tìdài', meanings: ['alternate'] },
      responseKind: 'matched_known_word',
    }],
  };
}

function invokeForSubject(subject: string | null, operation: () => void): { statusCode: number; body: unknown } {
  const middleware = authenticationModule.createLearnerContextMiddleware(
    () => subject,
  );
  const result = { statusCode: 200, body: undefined as unknown };
  const response = {
    status(code: number) {
      result.statusCode = code;
      return response;
    },
    json(body: unknown) {
      result.body = body;
      return response;
    },
  } as unknown as Response;
  const next: NextFunction = (error?: unknown) => {
    if (error) throw error;
    operation();
  };
  middleware({} as Request, response, next);
  return result;
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
