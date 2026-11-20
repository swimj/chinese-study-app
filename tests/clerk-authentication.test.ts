import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { NextFunction, Request, Response } from 'express';
import { getDb } from '../server/db/connection.ts';

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

  test('accepts backend-minted session claims that omit azp and rejects a mismatched origin', () => {
    const party = 'https://chinese-study-beta-swimj.fly.dev';
    assert.equal(
      authenticationModule.clerkUserIdFromAuth({ userId: 'user_smoke' }, party),
      'user_smoke',
    );
    assert.equal(
      authenticationModule.clerkUserIdFromAuth({ userId: 'user_smoke', sessionClaims: {} }, party),
      'user_smoke',
    );
    assert.equal(
      authenticationModule.clerkUserIdFromAuth({ userId: 'user_smoke', sessionClaims: { azp: '' } }, party),
      'user_smoke',
    );
    assert.equal(
      authenticationModule.clerkUserIdFromAuth({ userId: 'user_browser', sessionClaims: { azp: party } }, party),
      'user_browser',
    );
    assert.equal(
      authenticationModule.clerkUserIdFromAuth({
        userId: 'user_browser',
        sessionClaims: { azp: 'https://other.example' },
      }, party),
      null,
    );
    assert.equal(authenticationModule.clerkUserIdFromAuth({ userId: null }, party), null);
  });

  test('parses an optional environment access allowlist strictly', () => {
    assert.deepEqual(
      [...authenticationModule.parseClerkUserAllowlist(' user_alpha,user_beta,user_alpha ')],
      ['user_alpha', 'user_beta'],
    );
    assert.throws(() => authenticationModule.parseClerkUserAllowlist(''), /at least one Clerk user id/);
    assert.throws(() => authenticationModule.parseClerkUserAllowlist('learner-not-clerk'), /invalid Clerk user id/);
  });

  test('rejects a valid Clerk identity outside an environment access allowlist', () => {
    const handler = authenticationModule.createLearnerContextMiddleware(
      () => 'user_not_allowed',
      new Set(['user_allowed']),
    );
    let statusCode = 200;
    let body: unknown;
    handler({} as Request, {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(value: unknown) {
        body = value;
        return this;
      },
    } as Response, (() => {
      throw new Error('disallowed learner work must not run');
    }) as NextFunction);
    assert.equal(statusCode, 403);
    assert.deepEqual(body, {
      error: 'Account is not allowed in this environment.',
      code: 'ACCOUNT_NOT_ALLOWED',
    });
    assert.equal(dbModule.resolveLearnerId(dbModule.CLERK_AUTH_PROVIDER, 'user_not_allowed'), null);
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

    let aRuns: Array<{ runId: string; sourceSessionId: string }> = [];
    let cRuns: Array<{ runId: string; sourceSessionId: string }> = [];
    const listRuns = () => getDb().prepare(`
      SELECT run_id AS runId, source_session_id AS sourceSessionId FROM reflection_generation_runs ORDER BY run_id
    `).all() as Array<{ runId: string; sourceSessionId: string }>;
    let aFailed: string[] = [];
    let cFailed: string[] = [];
    invokeForSubject('user_clerk_a', () => { aRuns = listRuns(); aFailed = dbModule.listFailedReflectionRunIds(); });
    invokeForSubject('user_clerk_c', () => { cRuns = listRuns(); cFailed = dbModule.listFailedReflectionRunIds(); });

    assert.deepEqual(aRuns.map((run) => run.runId), ['a-run']);
    assert.deepEqual(cRuns.map((run) => run.runId), ['c-run']);
    assert.equal(aRuns[0]?.sourceSessionId, 'a-session');
    assert.equal(cRuns[0]?.sourceSessionId, 'c-session');
    assert.deepEqual(aFailed, ['a-run']);
    assert.deepEqual(cFailed, ['c-run']);
  });
});

/** Inserts the session and failed run rows a recorded generation run leaves, in the current learner context. */
function recordFixtureReflectionRun(runId: string, sessionId: string): void {
  const at = '2026-08-23T00:00:00.000Z';
  getDb().prepare(`
    INSERT INTO study_sessions (id, started_at, ended_at, processing_state, processed_at)
    VALUES (?, ?, ?, 'processed', ?)
  `).run(sessionId, at, at, at);
  getDb().prepare(`
    INSERT INTO reflection_generation_runs (
      run_id, source_session_id, reflection_flow_version, started_at, completed_at,
      provider, model, provider_model, prompt_version, bundle_schema_version, result_schema_version,
      state, failure_code, eligible_item_count, included_item_count, evidence_bundle_json
    ) VALUES (?, ?, 'clerk-fixture-flow.v1', ?, ?, 'fixture', 'fixture-model', 'fixture-model', 'fixture-v1',
      'session_reflection_bundle.v1', 'session_reflection_result.v4', 'failed', 'fixture_failure', 1, 1, ?)
  `).run(runId, sessionId, at, at, JSON.stringify(fixtureBundle(sessionId)));
}

function fixtureBundle(sessionId: string) {
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
