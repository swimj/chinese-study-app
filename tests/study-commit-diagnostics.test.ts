import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import {
  createStudyCommitDiagnosticSink,
  describeStudyCommitFailure,
  readStudyCommitDiagnostics,
  STUDY_COMMIT_DIAGNOSTICS_FILENAME,
  type StudyCommitFailureDiagnostic,
  type StudyCommitSuccessEvent,
} from '../server/study-commit-diagnostics.ts';

type IndexModule = typeof import('../server/index.ts');
type ExpressApp = ReturnType<IndexModule['createApp']>;

describe('study commit diagnostics', { concurrency: false }, () => {
  let dataDir = '';
  let indexModule: IndexModule;
  let sqlite: DatabaseSync;

  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-commit-diagnostics-'));
    const previousMode = process.env.APP_MODE;
    const previousDataDir = process.env.APP_DATA_DIR;
    try {
      process.env.APP_MODE = 'study';
      process.env.APP_DATA_DIR = dataDir;
      indexModule = await import(
        `${pathToFileURL(path.resolve('server/index.ts')).href}?test=${Date.now()}`
      );
      sqlite = (await import('../server/db/connection.ts')).getDb();
    } finally {
      restoreEnv('APP_MODE', previousMode);
      restoreEnv('APP_DATA_DIR', previousDataDir);
    }
  });

  after(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('retains the full failed request and error chain while logging a compact correlation event', () => {
    const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-commit-record-'));
    const loggedLines: string[] = [];
    try {
      const cause = Object.assign(new Error('constraint detail'), { code: 'SQLITE_CONSTRAINT' });
      const error = new Error('failed to persist exact attempt payload', { cause });
      const diagnostic = describeStudyCommitFailure({
        route: '/api/study-sessions/:sessionId/accepted-review-attempt-batch',
        responseStatus: 500,
        learnerId: 'learner-1',
        params: { sessionId: 'session-1' },
        body: {
          events: [{
            id: 'attempt-1',
            sessionId: 'session-1',
            sessionActionId: 'review/word-1/production',
            targetWordId: 'word-1',
            actionKind: 'production',
            response: '保留这份失败答案',
          }],
          commitIntent: {
            sessionActionId: 'review/word-1/production',
            targetWordId: 'word-1',
            actionKind: 'production',
          },
        },
        error,
        elapsedMs: 7,
        diagnosticId: 'diagnostic-1',
        at: '2026-09-05T04:00:00.000Z',
      });
      const expiredDiagnostic = describeStudyCommitFailure({
        route: '/api/review-session-summaries',
        responseStatus: 500,
        learnerId: 'learner-1',
        params: {},
        body: { sessionId: 'expired-session' },
        error: new Error('expired failure'),
        diagnosticId: 'expired-diagnostic',
        at: '2026-07-01T00:00:00.000Z',
      });
      fs.writeFileSync(
        path.join(isolatedDir, STUDY_COMMIT_DIAGNOSTICS_FILENAME),
        `${JSON.stringify(expiredDiagnostic)}\n`,
      );
      createStudyCommitDiagnosticSink(isolatedDir, {
        logLine(line) {
          loggedLines.push(line);
        },
      }).record(diagnostic);

      const logEvent = JSON.parse(loggedLines[0]!) as Record<string, unknown>;
      assert.equal(logEvent.event, 'study_commit.failed');
      assert.equal(logEvent.diagnosticId, 'diagnostic-1');
      assert.equal(logEvent.elapsedMs, 7);
      assert.equal(logEvent.sessionActionId, 'review/word-1/production');
      assert.equal(logEvent.errorMessage, 'failed to persist exact attempt payload');
      assert.equal(loggedLines[0]!.includes('保留这份失败答案'), false);

      const stored = readStudyCommitDiagnostics({ dataDir: isolatedDir, limit: 10 });
      assert.equal(stored.totalRecordCount, 1);
      assert.equal(stored.malformedRecordCount, 0);
      assert.equal(stored.diagnostics[0]?.request.body && JSON.stringify(stored.diagnostics[0]?.request.body).includes('保留这份失败答案'), true);
      assert.equal(stored.diagnostics[0]?.error.cause?.message, 'constraint detail');
      assert.equal(stored.diagnostics[0]?.error.cause?.details.code, 'SQLITE_CONSTRAINT');
      assert.match(stored.diagnostics[0]?.error.stack ?? '', /failed to persist exact attempt payload/);
      assert.equal(readStudyCommitDiagnostics({
        dataDir: isolatedDir,
        diagnosticId: 'diagnostic-1',
      }).diagnostics[0]?.diagnosticId, 'diagnostic-1');
      assert.equal(readStudyCommitDiagnostics({
        dataDir: isolatedDir,
        diagnosticId: 'missing-diagnostic',
      }).diagnostics.length, 0);
      assert.equal(
        fs.existsSync(path.join(isolatedDir, STUDY_COMMIT_DIAGNOSTICS_FILENAME)),
        true,
      );
    } finally {
      fs.rmSync(isolatedDir, { recursive: true, force: true });
    }
  });

  test('returns a diagnostic id and records the exact payload for an unexpected review commit failure', async () => {
    const diagnostics: StudyCommitFailureDiagnostic[] = [];
    const app = indexModule.createApp({
      studyCommitDiagnosticSink: {
        record(diagnostic) {
          diagnostics.push(diagnostic);
        },
      },
    });
    const body = {
      events: [{
        id: 'session-failure/review/missing-word/recognition/attempt-1',
        occurredAt: '2026-09-05T04:05:00.000Z',
        sessionId: 'session-failure',
        sessionActionId: 'review/missing-word/recognition',
        sessionEventSequence: 1,
        actionAttemptSequence: 1,
        actionKind: 'recognition',
        targetWordId: 'missing-word',
        sampledSkillIds: ['recognition'],
        response: null,
        outcome: 'correct',
        rating: 'good',
        contentRef: null,
        metadata: {},
      }],
      commitIntent: {
        type: 'commit-review-action-session',
        sessionActionId: 'review/missing-word/recognition',
        targetWordId: 'missing-word',
        actionKind: 'recognition',
        sampledSkillIds: ['recognition'],
        failureCount: 0,
        terminalRating: 'good',
      },
    };

    const result = await request(
      app,
      '/api/study-sessions/session-failure/accepted-review-attempt-batch',
      { method: 'POST', body },
    );
    assert.equal(result.status, 500);
    assert.equal(typeof (result.json as { diagnosticId?: unknown }).diagnosticId, 'string');
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0]?.diagnosticId, (result.json as { diagnosticId: string }).diagnosticId);
    assert.equal(diagnostics[0]?.learnerId, 'test-learner');
    assert.deepEqual(diagnostics[0]?.request.body, body);
    assert.equal(diagnostics[0]?.correlation.sessionId, 'session-failure');
    assert.equal(diagnostics[0]?.correlation.sessionActionId, 'review/missing-word/recognition');
    assert.deepEqual(diagnostics[0]?.correlation.eventIds, [body.events[0]!.id]);
    assert.match(diagnostics[0]?.error.message ?? '', /FOREIGN KEY constraint failed/);
    assert.match(String(diagnostics[0]?.error.details.code), /SQLITE/);
  });

  test('correlates successful and failed contrast commits without letting success logging fail the request', async () => {
    insertReviewWordForContrast(sqlite, 'diagnostic-contrast-word');
    const diagnostics: StudyCommitFailureDiagnostic[] = [];
    const successes: StudyCommitSuccessEvent[] = [];
    const app = indexModule.createApp({
      studyCommitDiagnosticSink: {
        record(diagnostic) {
          diagnostics.push(diagnostic);
        },
        recordSuccess(event) {
          successes.push(event);
          throw new Error('success logger unavailable');
        },
      },
    });
    const successfulBody = contrastBody({
      sessionId: 'contrast-success',
      wordId: 'diagnostic-contrast-word',
      selectedWordId: 'diagnostic-contrast-word',
      promptTargetWordId: 'diagnostic-contrast-word',
    });
    const successful = await request(
      app,
      '/api/study-sessions/contrast-success/accepted-contrast-selection-attempt',
      { method: 'POST', body: successfulBody },
    );
    assert.equal(successful.status, 204, JSON.stringify(successful.json));
    assert.equal(successes.length, 1);
    assert.equal(successes[0]?.correlation.sessionId, 'contrast-success');
    assert.equal(successes[0]?.correlation.selectedWordId, 'diagnostic-contrast-word');
    assert.equal(successes[0]?.results[0]?.outcome, 'correct');
    assert.equal(successes[0]?.results[0]?.rating, 'good');
    assert.equal(typeof successes[0]?.elapsedMs, 'number');

    const failedBody = contrastBody({
      sessionId: 'contrast-failure',
      wordId: 'diagnostic-missing-word',
      selectedWordId: 'diagnostic-missing-word',
      promptTargetWordId: 'diagnostic-missing-word',
    });
    const failed = await request(
      app,
      '/api/study-sessions/contrast-failure/accepted-contrast-selection-attempt',
      { method: 'POST', body: failedBody },
    );
    assert.equal(failed.status, 500);
    assert.equal(typeof (failed.json as { diagnosticId?: unknown }).diagnosticId, 'string');
    assert.equal(diagnostics.length, 1);
    assert.deepEqual(diagnostics[0]?.request.body, failedBody);
    assert.equal(diagnostics[0]?.correlation.sessionId, 'contrast-failure');
    assert.equal(diagnostics[0]?.correlation.promptTargetWordId, 'diagnostic-missing-word');
    assert.equal(diagnostics[0]?.correlation.selectedWordId, 'diagnostic-missing-word');
    assert.deepEqual(diagnostics[0]?.correlation.eventIds, [failedBody.event.id]);
    assert.match(diagnostics[0]?.error.message ?? '', /FOREIGN KEY constraint failed/);
  });

  test('records rejected session summary statistics and keeps successful summary logging failure-isolated', async () => {
    const diagnostics: StudyCommitFailureDiagnostic[] = [];
    const app = indexModule.createApp({
      reflectionLifecycleLogger: {
        emit() {
          throw new Error('logger unavailable');
        },
      },
      studyCommitDiagnosticSink: {
        record(diagnostic) {
          diagnostics.push(diagnostic);
        },
      },
    });
    const invalidBody = {
      sessionId: 'summary-invalid',
      completedAt: '2026-09-05T04:10:00.000Z',
      completedReviewActionCount: 1,
      failedReviewActionCount: 2,
      activeDurationMs: 123_456,
    };
    const invalid = await request(app, '/api/review-session-summaries', {
      method: 'POST',
      body: invalidBody,
    });
    assert.equal(invalid.status, 400);
    assert.equal(typeof (invalid.json as { diagnosticId?: unknown }).diagnosticId, 'string');
    assert.equal(diagnostics[0]?.responseStatus, 400);
    assert.equal(diagnostics[0]?.correlation.sessionId, 'summary-invalid');
    assert.deepEqual(diagnostics[0]?.request.body, invalidBody);

    const successful = await request(app, '/api/review-session-summaries', {
      method: 'POST',
      body: {
        sessionId: 'summary-successful',
        completedAt: '2026-09-05T04:11:00.000Z',
        completedReviewActionCount: 2,
        failedReviewActionCount: 1,
        activeDurationMs: 234_567,
      },
    });
    assert.equal(successful.status, 204);
    assert.equal(diagnostics.length, 1);
  });
});

function insertReviewWordForContrast(sqlite: DatabaseSync, wordId: string): void {
  sqlite.prepare(`
    INSERT INTO words (
      id, hanzi, pinyin, meaning, examples_json, status, priority, created_at,
      learning_streak, last_learning_success_on, last_learning_covered_on
    ) VALUES (?, ?, ?, ?, '[]', 'review', 100, ?, 0, NULL, NULL)
  `).run(wordId, '诊断', 'zhen duan', 'diagnose', '2026-09-01T00:00:00.000Z');
  sqlite.prepare(`
    INSERT INTO word_study_admission_state (
      word_id, study_phase, earliest_next_study_at
    ) VALUES (?, 'review', NULL)
  `).run(wordId);
  sqlite.prepare(`
    INSERT INTO word_skill_state (
      word_id, skill_id, enabled, interval_hours, last_studied_at,
      next_due_at, ease_factor
    ) VALUES (?, 'contextual_selection', 1, 24, ?, ?, 2.5)
  `).run(wordId, '2026-09-03T00:00:00.000Z', '2026-09-04T00:00:00.000Z');
}

function contrastBody(input: {
  sessionId: string;
  wordId: string;
  selectedWordId: string;
  promptTargetWordId: string;
}) {
  const sessionActionId = `review/${input.wordId}/contextual_selection`;
  const eventId = `${sessionActionId}/attempt-1`;
  const choiceWordIds = [input.promptTargetWordId, `${input.wordId}-distractor`];
  return {
    event: {
      id: eventId,
      occurredAt: '2026-09-05T04:07:00.000Z',
      sessionId: input.sessionId,
      sessionActionId,
      sessionEventSequence: 1,
      actionAttemptSequence: 1,
      actionKind: 'contrast_selection',
      targetWordId: input.wordId,
      sampledSkillIds: ['contextual_selection'],
      response: input.selectedWordId,
      outcome: 'correct',
      rating: 'good',
      contentRef: { type: 'contrast_prompt', id: `${input.wordId}/prompt` },
      metadata: {
        promptTargetWordId: input.promptTargetWordId,
        choiceWordIds,
        practiceMore: false,
      },
    },
    commitIntent: {
      type: 'commit-contrast-selection-action-session',
      sessionActionId,
      targetWordId: input.wordId,
      actionKind: 'contrast_selection',
      sampledSkillIds: ['contextual_selection'],
      selectedWordId: input.selectedWordId,
      promptTargetWordId: input.promptTargetWordId,
      choiceWordIds,
      rating: 'good',
      practiceMore: false,
    },
  };
}

async function request(
  app: ExpressApp,
  pathname: string,
  options: { method?: string; body?: unknown } = {},
): Promise<{ status: number; json: unknown }> {
  const method = options.method ?? 'GET';
  const url = new URL(pathname, 'http://local.test');
  const matched = findRoute(app, method, url.pathname);
  assert(matched, `Missing ${method} route for ${url.pathname}`);
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
    if (!route?.methods[method.toLowerCase()] || typeof route.path !== 'string') continue;
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

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
