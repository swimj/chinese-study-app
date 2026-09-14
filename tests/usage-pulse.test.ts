import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  isOperatorSubject,
  parseOperatorAllowlist,
  resolveOperatorSubject,
  TRUSTED_LOCAL_OPERATOR_SENTINEL,
} from '../server/operator-access.ts';

describe('operator allowlist helpers', () => {
  test('parses comma-separated clerk ids and ignores blanks', () => {
    assert.deepEqual(
      [...parseOperatorAllowlist(' user_a, ,user_b ')].sort(),
      ['user_a', 'user_b'],
    );
  });

  test('trusted_local sentinel grants local operator access', () => {
    const allowlist = new Set([TRUSTED_LOCAL_OPERATOR_SENTINEL]);
    assert.equal(
      isOperatorSubject('dogfood-local', allowlist, 'trusted_local'),
      true,
    );
    assert.equal(
      isOperatorSubject('user_a', allowlist, 'clerk'),
      false,
    );
  });

  test('resolveOperatorSubject uses learner id locally and clerk id hosted', () => {
    assert.equal(
      resolveOperatorSubject({
        authMode: 'trusted_local',
        trustedLocalLearnerId: 'dogfood-local',
        clerkUserId: 'user_ignored',
      }),
      'dogfood-local',
    );
    assert.equal(
      resolveOperatorSubject({
        authMode: 'clerk',
        trustedLocalLearnerId: 'dogfood-local',
        clerkUserId: 'user_a',
      }),
      'user_a',
    );
  });
});

describe('usage pulse snapshots', { concurrency: false }, () => {
  let dataDir = '';
  let previousMode: string | undefined;
  let previousDataDir: string | undefined;
  let previousLearnerId: string | undefined;
  let previousOperatorAllowlist: string | undefined;
  let dbModule: typeof import('../server/db.ts');
  let usagePulse: typeof import('../server/db/usage-pulse.ts');
  let getDb: typeof import('../server/db/connection.ts').getDb;
  let PRIORITY_TIER_REGULAR: number;
  let PRIORITY_TIER_TOP: number;
  let createStudyCommitDiagnosticSink: typeof import('../server/study-commit-diagnostics.ts').createStudyCommitDiagnosticSink;
  let describeStudyCommitFailure: typeof import('../server/study-commit-diagnostics.ts').describeStudyCommitFailure;

  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-usage-pulse-'));
    previousMode = process.env.APP_MODE;
    previousDataDir = process.env.APP_DATA_DIR;
    previousLearnerId = process.env.APP_LEARNER_ID;
    previousOperatorAllowlist = process.env.APP_OPERATOR_CLERK_USER_IDS;
    process.env.APP_MODE = 'study';
    process.env.APP_DATA_DIR = dataDir;
    process.env.APP_LEARNER_ID = 'test-learner';
    process.env.APP_OPERATOR_CLERK_USER_IDS = 'trusted_local';
    dbModule = await import(`${pathToFileURL(path.resolve('server/db.ts')).href}?usage-pulse=${Date.now()}`);
    usagePulse = await import('../server/db/usage-pulse.ts');
    ({ getDb } = await import('../server/db/connection.ts'));
    ({ PRIORITY_TIER_REGULAR, PRIORITY_TIER_TOP } = await import('../server/db/types.ts'));
    ({ createStudyCommitDiagnosticSink, describeStudyCommitFailure } = await import('../server/study-commit-diagnostics.ts'));
  });

  after(() => {
    restoreEnv('APP_MODE', previousMode);
    restoreEnv('APP_DATA_DIR', previousDataDir);
    restoreEnv('APP_LEARNER_ID', previousLearnerId);
    restoreEnv('APP_OPERATOR_CLERK_USER_IDS', previousOperatorAllowlist);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('medianOf handles empty, odd, and even lists', () => {
    assert.equal(usagePulse.medianOf([]), null);
    assert.equal(usagePulse.medianOf([3]), 3);
    assert.equal(usagePulse.medianOf([1, 3, 2]), 2);
    assert.equal(usagePulse.medianOf([4, 1, 2, 3]), 2.5);
  });

  test('computes cohort metrics, sparse counts, and persists idempotent daily snapshots', () => {
    const dayKey = '2026-09-10';
    const earlierDay = '2026-09-09';
    dbModule.bootstrapLearner({ learnerId: 'learner-a' });
    dbModule.bootstrapLearner({ learnerId: 'learner-b' });
    dbModule.bootstrapLearner({ learnerId: 'learner-c' });

    insertLexicalWord('word-a');
    insertLexicalWord('word-b');
    insertLexicalWord('word-c');

    dbModule.runWithLearnerId('learner-a', () => {
      insertPriorityOverlay('word-a', PRIORITY_TIER_REGULAR, 1);
      insertPriorityOverlay('word-b', PRIORITY_TIER_TOP, 0);
      insertSessionSummary({
        sessionId: 'session-a1',
        dayKey,
        completedAt: `${dayKey}T12:00:00.000Z`,
        activeDurationMs: 120_000,
      });
      insertNewWordIntake(dayKey, 2);
      insertReflectionSpend({
        runId: 'run-a',
        completedAt: `${dayKey}T13:00:00.000Z`,
        costUsd: 0.25,
      });
    });

    dbModule.runWithLearnerId('learner-b', () => {
      insertPriorityOverlay('word-c', PRIORITY_TIER_REGULAR, 1);
      insertStudySession({
        sessionId: 'session-b-abandoned',
        startedAt: `${dayKey}T10:00:00.000Z`,
      });
      insertReflectionSpend({
        runId: 'run-b',
        completedAt: `${dayKey}T11:00:00.000Z`,
        costUsd: 0.5,
      });
      insertSessionSummary({
        sessionId: 'session-b1',
        dayKey: earlierDay,
        completedAt: `${earlierDay}T12:00:00.000Z`,
        activeDurationMs: 60_000,
      });
    });

    createStudyCommitDiagnosticSink(dataDir).record(describeStudyCommitFailure({
      route: '/api/review-session-summaries',
      responseStatus: 500,
      learnerId: 'learner-a',
      params: {},
      body: { sessionId: 'broken' },
      error: new Error('commit failed'),
      diagnosticId: 'diag-1',
      at: `${dayKey}T15:00:00.000Z`,
    }));

    const computed = usagePulse.computeUsagePulseDay({
      dayKey,
      capturedAt: `${dayKey}T23:59:00.000Z`,
      dataDir,
    });

    assert.equal(computed.dau, 1);
    assert.equal(computed.sessionsCompleted, 1);
    assert.equal(computed.newWords, 2);
    assert.equal(computed.modelSpendUsd, 0.75);
    assert.equal(computed.medianSessionActiveMs, 120_000);
    assert.equal(computed.medianStashSize, 0.5);
    assert.equal(computed.sessionsAbandoned, 1);
    assert.equal(computed.learnersSpendWithoutAccepts, 2);
    assert.equal(computed.studyCommitFailures, 1);
    assert.equal(computed.learnersInactive7d, 2);

    usagePulse.captureUsagePulseDay({
      dayKey,
      dataDir,
      capturedAt: `${dayKey}T23:59:00.000Z`,
    });
    usagePulse.captureUsagePulseDay({
      dayKey,
      dataDir,
      capturedAt: `${dayKey}T23:59:30.000Z`,
    });
    const stored = usagePulse.listUsageDailySnapshots([dayKey]);
    assert.equal(stored.length, 1);
    assert.equal(stored[0]?.capturedAt, `${dayKey}T23:59:30.000Z`);
    assert.equal(stored[0]?.dau, 1);
  });

  test('ensureUsagePulseSnapshots backfills missing historical days once', () => {
    const today = '2026-09-14';
    const first = usagePulse.ensureUsagePulseSnapshots({
      todayDayKey: today,
      windowDays: 3,
      dataDir,
      now: new Date(`${today}T08:00:00.000Z`),
    });
    assert.deepEqual(first.capturedDayKeys, [
      usagePulse.addUtcDays(today, -3),
      usagePulse.addUtcDays(today, -2),
      usagePulse.addUtcDays(today, -1),
    ]);
    const second = usagePulse.ensureUsagePulseSnapshots({
      todayDayKey: today,
      windowDays: 3,
      dataDir,
      now: new Date(`${today}T09:00:00.000Z`),
    });
    assert.deepEqual(second.capturedDayKeys, []);
  });

  test('getUsagePulse returns live today plus persisted historical days', () => {
    const now = new Date('2026-09-14T10:00:00.000Z');
    const pulse = usagePulse.getUsagePulse({ dataDir, now, windowDays: 3 });
    assert.equal(pulse.today.dayKey, usagePulse.utcDayKey(now));
    assert.equal(pulse.days.length, 3);
    assert.equal(pulse.days.at(-1)?.dayKey, usagePulse.addUtcDays(usagePulse.utcDayKey(now), -1));
  });

  function insertLexicalWord(wordId: string): void {
    getDb().prepare(`
      INSERT INTO lexical_words (
        id, hanzi, traditional, pinyin, meaning, meanings_json, examples_json, priority, created_at
      ) VALUES (?, ?, NULL, 'ma', 'test', '[]', '[]', 1, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(wordId, wordId, '2026-01-01T00:00:00.000Z');
  }

  function insertPriorityOverlay(wordId: string, priorityTier: number, bumpCount: number): void {
    getDb().prepare(`
      INSERT INTO user_word_priority (
        word_id, bump_count, force_top, priority_tier, required_for_next_session, updated_at
      ) VALUES (?, ?, ?, ?, 0, ?)
    `).run(
      wordId,
      bumpCount,
      priorityTier === PRIORITY_TIER_TOP ? 1 : 0,
      priorityTier,
      '2026-09-10T00:00:00.000Z',
    );
  }

  function insertSessionSummary(input: {
    sessionId: string;
    dayKey: string;
    completedAt: string;
    activeDurationMs: number;
  }): void {
    getDb().prepare(`
      INSERT INTO review_session_summaries (
        session_id, completed_at, day_key, completed_count, failed_count, active_duration_ms
      ) VALUES (?, ?, ?, 1, 0, ?)
    `).run(input.sessionId, input.completedAt, input.dayKey, input.activeDurationMs);
  }

  function insertStudySession(input: { sessionId: string; startedAt: string }): void {
    getDb().prepare(`
      INSERT INTO study_sessions (
        id, started_at, ended_at, processing_state, processed_at
      ) VALUES (?, ?, NULL, 'open', NULL)
    `).run(input.sessionId, input.startedAt);
  }

  function insertNewWordIntake(dayKey: string, count: number): void {
    getDb().prepare(`
      INSERT INTO learner_owned_daily_new_word_intake (
        day_key,
        new_study_count
      ) VALUES (?, ?)
      ON CONFLICT(learner_id, day_key) DO UPDATE SET
        new_study_count = excluded.new_study_count
    `).run(dayKey, count);
  }

  function insertReflectionSpend(input: {
    runId: string;
    completedAt: string;
    costUsd: number;
  }): void {
    getDb().prepare(`
      INSERT INTO reflection_generation_runs (
        run_id, source_session_id, reflection_flow_version, started_at, completed_at,
        provider, model, provider_model, prompt_version, response_id, finish_reason,
        client_request_id, state, failure_code, eligible_item_count, included_item_count,
        pricing_snapshot_id, pricing_as_of, pricing_basis_json, estimated_cost_usd,
        evidence_bundle_json
      ) VALUES (
        ?, NULL, 'v1', ?, ?,
        'openai', 'test-model', 'test-model', 'v0', NULL, 'stop',
        NULL, 'succeeded', NULL, 1, 1,
        'price-1', ?, '{"source":"test"}', ?,
        '{}'
      )
    `).run(
      input.runId,
      input.completedAt,
      input.completedAt,
      input.completedAt,
      input.costUsd,
    );
  }
});

describe('operator usage pulse API', { concurrency: false }, () => {
  let dataDir = '';
  let server: http.Server;
  let baseUrl = '';
  let previousMode: string | undefined;
  let previousDataDir: string | undefined;
  let previousLearnerId: string | undefined;
  let previousOperatorAllowlist: string | undefined;
  let previousAuthMode: string | undefined;

  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-usage-pulse-api-'));
    previousMode = process.env.APP_MODE;
    previousDataDir = process.env.APP_DATA_DIR;
    previousLearnerId = process.env.APP_LEARNER_ID;
    previousOperatorAllowlist = process.env.APP_OPERATOR_CLERK_USER_IDS;
    previousAuthMode = process.env.APP_AUTH_MODE;
    process.env.APP_MODE = 'study';
    process.env.APP_DATA_DIR = dataDir;
    process.env.APP_LEARNER_ID = 'operator-local';
    process.env.APP_AUTH_MODE = 'trusted_local';
    process.env.APP_OPERATOR_CLERK_USER_IDS = 'trusted_local';

    const indexModule = await import(
      `${pathToFileURL(path.resolve('server/index.ts')).href}?usage-pulse-api=${Date.now()}`
    );
    const app = indexModule.createApp({ frontendDistPath: null });
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const address = server.address();
    assert(address && typeof address === 'object');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    restoreEnv('APP_MODE', previousMode);
    restoreEnv('APP_DATA_DIR', previousDataDir);
    restoreEnv('APP_LEARNER_ID', previousLearnerId);
    restoreEnv('APP_OPERATOR_CLERK_USER_IDS', previousOperatorAllowlist);
    restoreEnv('APP_AUTH_MODE', previousAuthMode);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('allows trusted_local operators and rejects empty allowlist', async () => {
    const allowed = await fetch(`${baseUrl}/api/operator/usage-pulse`);
    assert.equal(allowed.status, 200);
    const body = await allowed.json() as { today: { dayKey: string }; days: unknown[] };
    assert.match(body.today.dayKey, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(Array.isArray(body.days), true);

    process.env.APP_OPERATOR_CLERK_USER_IDS = '';
    const denied = await fetch(`${baseUrl}/api/operator/usage-pulse`);
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), {
      error: 'Operator access required.',
      code: 'OPERATOR_FORBIDDEN',
    });
    process.env.APP_OPERATOR_CLERK_USER_IDS = 'trusted_local';
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
