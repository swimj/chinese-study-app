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
  let previousSmokeClerkUserId: string | undefined;
  let dbModule: typeof import('../server/db.ts');
  let usagePulse: typeof import('../server/db/usage-pulse.ts');
  let getDb: typeof import('../server/db/connection.ts').getDb;
  let PRIORITY_TIER_REGULAR: number;
  let PRIORITY_TIER_TOP: number;

  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-usage-pulse-'));
    previousMode = process.env.APP_MODE;
    previousDataDir = process.env.APP_DATA_DIR;
    previousLearnerId = process.env.APP_LEARNER_ID;
    previousOperatorAllowlist = process.env.APP_OPERATOR_CLERK_USER_IDS;
    previousSmokeClerkUserId = process.env.APP_SMOKE_CLERK_USER_ID;
    process.env.APP_MODE = 'study';
    process.env.APP_DATA_DIR = dataDir;
    process.env.APP_LEARNER_ID = 'test-learner';
    process.env.APP_OPERATOR_CLERK_USER_IDS = 'trusted_local';
    dbModule = await import(`${pathToFileURL(path.resolve('server/db.ts')).href}?usage-pulse=${Date.now()}`);
    usagePulse = await import('../server/db/usage-pulse.ts');
    ({ getDb } = await import('../server/db/connection.ts'));
    ({ PRIORITY_TIER_REGULAR, PRIORITY_TIER_TOP } = await import('../server/db/types.ts'));
  });

  after(() => {
    restoreEnv('APP_MODE', previousMode);
    restoreEnv('APP_DATA_DIR', previousDataDir);
    restoreEnv('APP_LEARNER_ID', previousLearnerId);
    restoreEnv('APP_OPERATOR_CLERK_USER_IDS', previousOperatorAllowlist);
    restoreEnv('APP_SMOKE_CLERK_USER_ID', previousSmokeClerkUserId);
    fs.rmSync(dataDir, { recursive: true, force: true });
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
      insertNewWordIntake(dayKey, 9); // admission totals are independent of Usage
      getDb().prepare("UPDATE review_session_summaries SET new_word_count = 2 WHERE session_id = 'session-a1'").run();
    });

    dbModule.runWithLearnerId('learner-b', () => {
      insertPriorityOverlay('word-c', PRIORITY_TIER_REGULAR, 1);
      insertStudySession({
        sessionId: 'session-b-abandoned',
        startedAt: `${dayKey}T10:00:00.000Z`,
      });
      insertSessionSummary({
        sessionId: 'session-b1',
        dayKey: earlierDay,
        completedAt: `${earlierDay}T12:00:00.000Z`,
        activeDurationMs: 60_000,
      });
    });

    const computed = usagePulse.computeUsagePulseDay({
      dayKey,
      capturedAt: `${dayKey}T23:59:00.000Z`,
    });

    assert.equal(computed.dau, 1);
    assert.equal(computed.sessionsCompleted, 1);
    assert.equal(computed.newWords, 2);
    assert.equal(computed.practiceCompleted, 0);
    assert.equal(computed.reviewCorrect, 1);
    assert.equal(computed.reviewWrong, 0);
    assert.equal(computed.sessionActiveMs, 120_000);
    assert.equal(computed.meanStashSize, 0.75);
    assert.equal(computed.sessionsAbandoned, 1);
    assert.equal(computed.learnersInactive7d, 2);

    usagePulse.captureUsagePulseDay({
      dayKey,
      capturedAt: `${dayKey}T23:59:00.000Z`,
    });
    getDb().prepare(`
      UPDATE usage_daily_snapshots SET proposals_accepted = 5, learners_spend_without_accepts = 3,
        study_commit_failures = 7 WHERE day_key = ?
    `).run(dayKey);
    usagePulse.captureUsagePulseDay({
      dayKey,
      capturedAt: `${dayKey}T23:59:30.000Z`,
    });
    const stored = usagePulse.listUsageDailySnapshots([dayKey]);
    assert.equal(stored.length, 1);
    assert.equal(stored[0]?.capturedAt, `${dayKey}T23:59:30.000Z`);
    assert.equal(stored[0]?.dau, 1);
    const counters = getDb().prepare(`
      SELECT proposals_accepted, learners_spend_without_accepts, study_commit_failures
      FROM usage_daily_snapshots WHERE day_key = ?
    `).get(dayKey);
    assert.deepEqual({ ...counters }, {
      proposals_accepted: 5, learners_spend_without_accepts: 3, study_commit_failures: 7,
    });
  });

  test('sums completed exercises and time; practice counts known records as a lower bound for partial legacy days', () => {
    const dayKey = '2026-10-05';
    const summary = { sessionId: 'totals-a', completedAt: `${dayKey}T12:00:00.000Z`,
      completedReviewActionCount: 5, failedReviewActionCount: 2,
      activeDurationMs: 120_000, completedLearningWordCount: 3 };
    dbModule.runWithLearnerId('learner-a', () => {
      dbModule.recordReviewSessionSummary(summary);
      dbModule.recordReviewSessionSummary(summary);
      const { completedLearningWordCount, ...legacy } = summary;
      dbModule.recordReviewSessionSummary(legacy);
      assert.equal(getDb().prepare(`SELECT learning_completed_count AS count FROM review_session_summaries
        WHERE session_id = ?`).get(summary.sessionId)?.count, 3);
      dbModule.recordReviewSessionSummary({ ...summary, sessionId: 'totals-b',
        completedReviewActionCount: 2, failedReviewActionCount: 1, activeDurationMs: 30_000,
        completedLearningWordCount: 4 });
      assert.throws(() => dbModule.recordReviewSessionSummary({ ...summary, completedLearningWordCount: -1 }), /completedLearningWordCount/);
    });
    let totals = usagePulse.computeUsagePulseDay({ dayKey });
    assert.equal(totals.reviewCorrect, 4);
    assert.equal(totals.reviewWrong, 3);
    assert.equal(totals.sessionActiveMs, 150_000);
    assert.equal(totals.practiceCompleted, 7);
    dbModule.runWithLearnerId('learner-a', () => insertSessionSummary({
      sessionId: 'legacy-totals', dayKey, completedAt: `${dayKey}T13:00:00.000Z`, activeDurationMs: 10_000,
    }));
    totals = usagePulse.computeUsagePulseDay({ dayKey });
    assert.equal(totals.practiceCompleted, 7);
    assert.equal(totals.sessionActiveMs, 160_000);
    usagePulse.captureUsagePulseDay({ dayKey });
    getDb().prepare('UPDATE usage_daily_snapshots SET practice_completed = NULL WHERE day_key = ?').run(dayKey);
    assert.equal(usagePulse.listUsageDailySnapshots([dayKey])[0]?.practiceCompleted, 7);
    usagePulse.captureUsagePulseDay({ dayKey: '2026-10-04' });
    getDb().prepare('UPDATE usage_daily_snapshots SET practice_completed = NULL WHERE day_key = ?').run('2026-10-04');
    assert.equal(usagePulse.listUsageDailySnapshots(['2026-10-04'])[0]?.practiceCompleted, 0);
    assert.equal(usagePulse.computeUsagePulseDay({ dayKey: '2026-10-04' }).practiceCompleted, 0);
    // Existing cohort sizes are [0, 2, 1, 0]; empty stashes participate in the mean.
    assert.equal(totals.meanStashSize, 0.75);
  });

  test('persists three evening EDT new words on the UTC session day, independent of admission', (t) => {
    // Production-shaped case: Oct 21, 9 p.m. EDT is Oct 22 UTC. Admission
    // uses the client's local study day; Usage displays UTC calendar days.
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-22T01:07:31.534Z') });
    const admissionDay = '2026-10-21';
    const reportingDay = '2026-10-22';
    usagePulse.captureUsagePulseDay({ dayKey: admissionDay });
    usagePulse.captureUsagePulseDay({ dayKey: reportingDay });
    const savedCapture = usagePulse.listUsageDailySnapshots([admissionDay])[0]!.capturedAt;
    getDb().prepare('UPDATE usage_daily_snapshots SET mean_stash_size = 42 WHERE day_key = ?').run(admissionDay);
    dbModule.runWithLearnerId('learner-a', () => {
      for (const id of ['evening-a', 'evening-b', 'evening-c']) {
        insertSessionWordOutcome('learner-a', 'evening', id, '2026-10-22T01:07:31.534Z');
      }
      insertNewWordIntake(admissionDay, 3);
      assert.equal(usagePulse.computeUsagePulseDay({ dayKey: reportingDay }).newWords, 0);
      completeUsageSession('evening', '2026-10-22T02:12:41.686Z', 11);
      completeUsageSession('evening', '2026-10-22T02:12:41.686Z', 11);
      assert.equal(getDb().prepare("SELECT new_word_count FROM review_session_summaries WHERE session_id = 'evening'").get()?.new_word_count, 3);
    });
    const today = usagePulse.computeUsagePulseDay({ dayKey: reportingDay });
    assert.equal(today.newWords, 3);
    assert.equal(today.sessionsCompleted, 1);
    assert.equal(today.practiceCompleted, 11);
    assert.equal(usagePulse.computeUsagePulseDay({ dayKey: admissionDay }).newWords, 0);
    assert.equal(usagePulse.listUsageDailySnapshots([reportingDay])[0]?.newWords, 3);

    // The three new words remain three after later Practice.
    t.mock.timers.setTime(new Date('2026-10-23T16:00:00.000Z').getTime());
    dbModule.runWithLearnerId('learner-a', () => {
      insertSessionWordOutcome('learner-a', 'later-practice', 'evening-a', '2026-10-23T16:00:00.000Z', {
        kind: 'learning', beforeStatus: 'learning', afterStatus: 'learning',
      });
      completeUsageSession('later-practice', '2026-10-23T16:00:00.000Z', 1);
    });
    assert.equal(usagePulse.computeUsagePulseDay({ dayKey: reportingDay }).newWords, 3);
    assert.equal(usagePulse.computeUsagePulseDay({ dayKey: '2026-10-23' }).newWords, 0);

    // Summary writes refresh persisted totals; panel reads preserve capture-time data.
    const historical = usagePulse.listUsageDailySnapshots([admissionDay])[0]!;
    assert.equal(historical.newWords, 0);
    assert.equal(historical.capturedAt, savedCapture);
    assert.equal(historical.meanStashSize, 42);
    assert.equal(getDb().prepare('SELECT new_words FROM usage_daily_snapshots WHERE day_key = ?')
      .get(admissionDay)?.new_words, 0);
    const pulse = usagePulse.getUsagePulse({ now: new Date('2026-10-23T18:00:00.000Z'), windowDays: 2 });
    assert.deepEqual(pulse.days.map((day) => day.newWords), [0, 3]);
  });

  test('counts a whole session on its UTC completion day, with retries and cohort aggregation', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-01T17:00:00.000Z') });
    dbModule.runWithLearnerId('learner-a', () => {
      insertSessionWordOutcome('learner-a', 'normal-session', 'normal-day', '2026-11-01T17:00:00.000Z');
      completeUsageSession('normal-session', '2026-11-01T17:00:00.000Z');
      // A sessionless legacy commit has intake evidence but no outcome timestamp.
      insertNewWordIntake('2026-11-01', 4);
      t.mock.timers.setTime(new Date('2026-11-01T23:59:59.999Z').getTime());
      insertSessionWordOutcome('learner-a', 'midnight-session', 'before-midnight', '2026-11-01T23:59:59.999Z');
      t.mock.timers.setTime(new Date('2026-11-02T00:00:00.000Z').getTime());
      insertSessionWordOutcome('learner-a', 'midnight-session', 'at-midnight', '2026-11-02T00:00:00.000Z');
      assert.equal(usagePulse.computeUsagePulseDay({ dayKey: '2026-11-02' }).newWords, 0);
      completeUsageSession('midnight-session', '2026-11-02T00:10:00.000Z');
      completeUsageSession('midnight-session', '2026-11-02T00:10:00.000Z');
    });
    dbModule.runWithLearnerId('learner-b', () => {
      // Same lexical identity for another learner is a separate new-word event.
      insertSessionWordOutcome('learner-b', 'midnight-session', 'at-midnight', '2026-11-02T00:00:00.000Z');
      insertNewWordIntake('2026-11-01', 3); // admission evidence does not supply Usage totals
      completeUsageSession('midnight-session', '2026-11-02T00:12:00.000Z');
    });
    assert.equal(usagePulse.computeUsagePulseDay({ dayKey: '2026-10-31' }).newWords, 0);
    assert.equal(usagePulse.computeUsagePulseDay({ dayKey: '2026-11-01' }).newWords, 1);
    assert.equal(usagePulse.computeUsagePulseDay({ dayKey: '2026-11-02' }).newWords, 3);
    assert.equal(usagePulse.computeUsagePulseDay({ dayKey: '2026-11-03' }).newWords, 0);
    usagePulse.captureUsagePulseDay({ dayKey: '2026-11-01' });
    usagePulse.captureUsagePulseDay({ dayKey: '2026-11-02' });
    assert.deepEqual(usagePulse.listUsageDailySnapshots(['2026-11-01', '2026-11-02'])
      .map((day) => day.newWords), [1, 3]);
  });

  test('a Usage snapshot write failure rolls back the summary write and can be retried exactly once', (t) => {
    const at = '2026-12-05T12:00:00.000Z';
    t.mock.timers.enable({ apis: ['Date'], now: new Date(at) });
    usagePulse.captureUsagePulseDay({ dayKey: '2026-12-05' });
    dbModule.runWithLearnerId('learner-a', () => {
      insertSessionWordOutcome('learner-a', 'usage-write-failure', 'usage-write-failure', at);
      getDb().exec(`CREATE TEMP TRIGGER fail_usage_snapshot BEFORE UPDATE ON usage_daily_snapshots
        WHEN NEW.day_key = '2026-12-05' BEGIN SELECT RAISE(ABORT, 'test snapshot failure'); END`);
      try {
        assert.throws(() => completeUsageSession('usage-write-failure', at), /test snapshot failure/);
        assert.equal(getDb().prepare("SELECT new_word_count FROM review_session_summaries WHERE session_id = 'usage-write-failure'").get(), undefined);
        assert.equal(usagePulse.listUsageDailySnapshots(['2026-12-05'])[0]?.newWords, 0);
      } finally {
        getDb().exec('DROP TRIGGER fail_usage_snapshot');
      }
      completeUsageSession('usage-write-failure', at);
      completeUsageSession('usage-write-failure', at);
      assert.equal(getDb().prepare("SELECT new_word_count FROM review_session_summaries WHERE session_id = 'usage-write-failure'").get()?.new_word_count, 1);
    });
    assert.equal(usagePulse.listUsageDailySnapshots(['2026-12-05'])[0]?.newWords, 1);
  });

  test('summary retries preserve confirmed report-only history and refresh both days when moved', () => {
    usagePulse.captureUsagePulseDay({ dayKey: '2026-12-06' });
    usagePulse.captureUsagePulseDay({ dayKey: '2026-12-07' });
    dbModule.runWithLearnerId('learner-a', () => {
      // Same evidence as a migrated report-only summary: no individual outcomes.
      getDb().prepare(`INSERT INTO learner_session_completions
        (learner_id,session_id,revision_id,staged_at,close_at,input_json,report_json,status,closed_at)
        VALUES (?, 'report-only-usage', 'r1', 'now', 'now', '{}', ?, 'closed', 'now')`)
        .run('learner-a', JSON.stringify({ newWords: [{ id: 'a' }, { id: 'b' }], graduatedWords: [] }));
      completeUsageSession('report-only-usage', '2026-12-06T12:00:00.000Z');
      assert.equal(usagePulse.listUsageDailySnapshots(['2026-12-06'])[0]?.newWords, 2);
      completeUsageSession('report-only-usage', '2026-12-07T12:00:00.000Z');
      completeUsageSession('report-only-usage', '2026-12-07T12:00:00.000Z');
      assert.equal(getDb().prepare("SELECT new_word_count FROM review_session_summaries WHERE session_id = 'report-only-usage'").get()?.new_word_count, 2);
    });
    assert.deepEqual(usagePulse.listUsageDailySnapshots(['2026-12-06', '2026-12-07'])
      .map(day => day.newWords), [0, 2]);
  });

  test('excludes the configured smoke learner from inactive 7d count', () => {
    const dayKey = '2026-09-15';
    const smokeClerkUserId = 'user_smokePulse1';
    dbModule.bootstrapLearner({
      learnerId: 'learner-smoke-pulse',
      provider: dbModule.CLERK_AUTH_PROVIDER,
      providerSubject: smokeClerkUserId,
    });

    const included = usagePulse.computeUsagePulseDay({
      dayKey,
      capturedAt: `${dayKey}T12:00:00.000Z`,
      smokeClerkUserId: null,
    });
    const excluded = usagePulse.computeUsagePulseDay({
      dayKey,
      capturedAt: `${dayKey}T12:00:00.000Z`,
      smokeClerkUserId,
    });
    assert.equal(excluded.learnersInactive7d, included.learnersInactive7d - 1);

    process.env.APP_SMOKE_CLERK_USER_ID = smokeClerkUserId;
    const fromEnv = usagePulse.computeUsagePulseDay({
      dayKey,
      capturedAt: `${dayKey}T12:00:00.000Z`,
    });
    assert.equal(fromEnv.learnersInactive7d, excluded.learnersInactive7d);
    restoreEnv('APP_SMOKE_CLERK_USER_ID', previousSmokeClerkUserId);
  });

  test('ensureUsagePulseSnapshots backfills missing historical days once', () => {
    const today = '2026-09-14';
    const first = usagePulse.ensureUsagePulseSnapshots({
      todayDayKey: today,
      windowDays: 3,
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
      now: new Date(`${today}T09:00:00.000Z`),
    });
    assert.deepEqual(second.capturedDayKeys, []);
  });

  test('getUsagePulse returns live today plus persisted historical days', () => {
    const now = new Date('2026-09-14T10:00:00.000Z');
    const pulse = usagePulse.getUsagePulse({ now, windowDays: 3 });
    assert.equal(pulse.today.dayKey, usagePulse.utcDayKey(now));
    assert.equal(pulse.days.length, 3);
    assert.equal(pulse.days.at(-1)?.dayKey, usagePulse.addUtcDays(usagePulse.utcDayKey(now), -1));
  });

  function completeUsageSession(sessionId: string, completedAt: string, practice = 0): void {
    dbModule.recordReviewSessionSummary({ sessionId, completedAt, completedReviewActionCount: 1,
      failedReviewActionCount: 0, activeDurationMs: 1000, completedLearningWordCount: practice });
  }

  function insertLexicalWord(wordId: string): void {
    getDb().prepare(`
      INSERT INTO lexical_words (
        id, hanzi, traditional, pinyin, meaning, meanings_json, examples_json, priority, created_at
      ) VALUES (?, ?, NULL, 'ma', 'test', '[]', '[]', 1, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(wordId, wordId, '2026-01-01T00:00:00.000Z');
  }

  function insertSessionWordOutcome(
    learnerId: string,
    sessionId: string,
    wordId: string,
    committedAt: string,
    transition: { kind: 'introduction' | 'learning'; beforeStatus: string; afterStatus: string } = {
      kind: 'introduction', beforeStatus: 'unstudied', afterStatus: 'learning',
    },
  ): void {
    insertLexicalWord(wordId);
    getDb().prepare(`
      INSERT INTO learner_session_word_outcomes (
        learner_id, session_id, word_id, kind, before_status, after_status, word_json, committed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      learnerId,
      sessionId,
      wordId,
      transition.kind,
      transition.beforeStatus,
      transition.afterStatus,
      JSON.stringify({ id: wordId, hanzi: wordId, traditional: null, pinyin: 'ma', meaning: 'test' }),
      committedAt,
    );
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

  test('preparation diagnostics and retries are operator-only and audit the authenticated actor', async () => {
    const { getDb } = await import('../server/db/connection.ts');
    const { enqueueWordPreparation } = await import('../server/db/preparation-work.ts');
    const sql = getDb();
    sql.prepare(`INSERT INTO lexical_words (id, hanzi, traditional, pinyin, meaning, meanings_json, examples_json, priority, created_at)
      VALUES ('operator-word', '词', NULL, 'cí', 'word', '["word"]', '[]', 1, '2026-10-01T00:00:00.000Z')`).run();
    const work = enqueueWordPreparation('operator-word', 'bootstrap');
    sql.prepare(`UPDATE word_preparation_work SET status = 'paused', attempt_count = 3, last_error = 'Invalid output' WHERE work_id = ?`).run(work.workId);
    const endpoint = `${baseUrl}/api/operator/word-preparation`;
    const retry = (body: object) => fetch(`${endpoint}/${work.workId}/retry`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    process.env.APP_OPERATOR_CLERK_USER_IDS = '';
    assert.equal((await fetch(`${endpoint}/failures`)).status, 403);
    assert.equal((await retry({})).status, 403);
    process.env.APP_OPERATOR_CLERK_USER_IDS = 'trusted_local';
    const listed = await fetch(`${endpoint}/failures`);
    assert.equal(listed.status, 200);
    assert.equal((await listed.json()).failures[0].workId, work.workId);
    assert.equal((await retry({ actorId: 'spoofed' })).status, 400);
    assert.equal((await retry({})).status, 200);
    assert.equal((await retry({})).status, 409);
    assert.equal(sql.prepare('SELECT actor_id FROM word_preparation_retry_events WHERE work_id = ?').get(work.workId)!.actor_id, 'operator-local');
    assert.equal(sql.prepare('SELECT attempt_count FROM word_preparation_work WHERE work_id = ?').get(work.workId)!.attempt_count, 0);
  });

  test('model invocation ledger is operator-only and validates UTC date filters', async () => {
    const endpoint = `${baseUrl}/api/operator/model-invocations`;
    process.env.APP_OPERATOR_CLERK_USER_IDS = '';
    assert.equal((await fetch(endpoint)).status, 403);
    process.env.APP_OPERATOR_CLERK_USER_IDS = 'trusted_local';
    const allowed = await fetch(endpoint);
    assert.equal(allowed.status, 200);
    assert.deepEqual(await allowed.json(), { rows: [] });
    assert.equal((await fetch(`${endpoint}?from=2026-02-30`)).status, 400);
    assert.equal((await fetch(`${endpoint}?from=2026-02-01&to=2026-01-01`)).status, 400);
    assert.equal((await fetch(`${endpoint}?from=2026-01-01&to=2026-01-01`)).status, 200);
  });

  test('service banner read, set, and clear are operator-only and attribute the authenticated actor', async () => {
    const endpoint = `${baseUrl}/api/operator/service-banner`;
    process.env.APP_OPERATOR_CLERK_USER_IDS = '';
    assert.equal((await fetch(endpoint)).status, 403);
    assert.equal((await fetch(endpoint, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Planned downtime', expiresAt: '2099-10-08T08:00:00.000Z' }),
    })).status, 403);
    process.env.APP_OPERATOR_CLERK_USER_IDS = 'trusted_local';

    assert.deepEqual(await (await fetch(endpoint)).json(), { serviceBanner: null });
    const set = await fetch(endpoint, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Planned downtime', expiresAt: '2099-10-08T08:00:00.000Z' }),
    });
    assert.equal(set.status, 200);
    const posted = await set.json() as { serviceBanner: { message: string; postedAt: string; expiresAt: string } };
    assert.equal(posted.serviceBanner.message, 'Planned downtime');
    assert.match(posted.serviceBanner.postedAt, /^\d{4}-\d\d-\d\dT/);
    assert.equal(posted.serviceBanner.expiresAt, '2099-10-08T08:00:00.000Z');
    const { getDb } = await import('../server/db/connection.ts');
    assert.equal(getDb().prepare('SELECT actor_id FROM service_banner WHERE singleton = 1').get()!.actor_id, 'operator-local');
    assert.equal((await fetch(endpoint, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: ' '.repeat(1) }),
    })).status, 400);
    for (const payload of [
      { kickoffAt: 'invalid' }, { kickoffAt: '2099-02-30T00:30:00Z' }, { kickoffAt: 42 }, { kickoffAt: '2020-01-01T00:00:00Z' },
      { kickoffAt: '2099-07-02T00:30:00' }, { kickoffAt: '2099-07-02T00:30:00Z', message: 'conflicting' },
      { kickoffAt: '2099-07-02T00:30:00Z', expiresAt: '2099-07-05T00:00:00Z' },
    ]) {
      assert.equal((await fetch(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })).status, 400);
    }
    const plannedResponse = await fetch(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kickoffAt: '2099-07-02T00:30:00Z' }) });
    assert.equal(plannedResponse.status, 200);
    const planned = await plannedResponse.json() as { serviceBanner: { kickoffAt: string; postedAt: string; expiresAt: string } };
    assert.equal(planned.serviceBanner.kickoffAt, '2099-07-02T00:30:00.000Z');
    assert.equal(planned.serviceBanner.expiresAt, '2099-07-03T00:30:00.000Z');
    assert.notEqual(planned.serviceBanner.postedAt, planned.serviceBanner.kickoffAt);
    assert.deepEqual(await (await fetch(endpoint)).json(), planned);
    assert.equal((await fetch(endpoint, { method: 'DELETE' })).status, 200);
    assert.deepEqual(await (await fetch(endpoint)).json(), { serviceBanner: null });
  });

  test('allows trusted_local operators and rejects empty allowlist', async () => {
    const allowed = await fetch(`${baseUrl}/api/operator/usage-pulse`);
    assert.equal(allowed.status, 200);
    const body = await allowed.json() as import('../server/db/usage-pulse.ts').UsagePulsePayload;
    assert.match(body.today.dayKey, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(body.days.length, 7);
    const fields = [
      'dayKey', 'capturedAt', 'dau', 'sessionsCompleted', 'newWords', 'practiceCompleted',
      'reviewCorrect', 'reviewWrong', 'meanStashSize', 'sessionActiveMs', 'learnersInactive7d', 'sessionsAbandoned',
    ].sort();
    for (const day of [body.today, ...body.days]) assert.deepEqual(Object.keys(day).sort(), fields);

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
