import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { ClientTransportIncident } from '../src/domain/client-incidents.ts';
import {
  readStudyCommitDiagnostics,
  STUDY_COMMIT_DIAGNOSTICS_FILENAME,
  type StudyCommitFailureDiagnostic,
} from '../server/study-commit-diagnostics.ts';

type IndexModule = typeof import('../server/index.ts');
type ExpressApp = ReturnType<IndexModule['createApp']>;

test('reads retained study commit failures, filtering by diagnostic id and counting malformed records', () => {
  const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-commit-record-'));
  try {
    const diagnostic = storedFailure({
      diagnosticId: 'diagnostic-1',
      response: '保留这份失败答案',
      error: {
        name: 'Error',
        message: 'failed to persist exact attempt payload',
        stack: 'Error: failed to persist exact attempt payload',
        details: {},
        cause: {
          name: 'Error',
          message: 'constraint detail',
          stack: null,
          details: { code: 'SQLITE_CONSTRAINT' },
          cause: null,
        },
      },
    });
    const other = storedFailure({ diagnosticId: 'diagnostic-2', response: 'other' });
    fs.writeFileSync(
      path.join(isolatedDir, STUDY_COMMIT_DIAGNOSTICS_FILENAME),
      [
        JSON.stringify(diagnostic),
        'not json',
        JSON.stringify({ schemaVersion: 'something-else' }),
        JSON.stringify(other),
      ].join('\n') + '\n',
    );

    const stored = readStudyCommitDiagnostics({ dataDir: isolatedDir, limit: 10 });
    assert.equal(stored.totalRecordCount, 2);
    assert.equal(stored.malformedRecordCount, 2);
    assert.deepEqual(stored.diagnostics.map((item) => item.diagnosticId), ['diagnostic-1', 'diagnostic-2']);
    assert.equal(JSON.stringify(stored.diagnostics[0]?.request.body).includes('保留这份失败答案'), true);
    assert.equal(stored.diagnostics[0]?.error.cause?.message, 'constraint detail');
    assert.equal(stored.diagnostics[0]?.error.cause?.details.code, 'SQLITE_CONSTRAINT');
    assert.match(stored.diagnostics[0]?.error.stack ?? '', /failed to persist exact attempt payload/);
    assert.deepEqual(
      readStudyCommitDiagnostics({ dataDir: isolatedDir, limit: 1 }).diagnostics.map((item) => item.diagnosticId),
      ['diagnostic-2'],
    );
    assert.equal(readStudyCommitDiagnostics({
      dataDir: isolatedDir,
      diagnosticId: 'diagnostic-1',
    }).diagnostics[0]?.diagnosticId, 'diagnostic-1');
    assert.equal(readStudyCommitDiagnostics({
      dataDir: isolatedDir,
      diagnosticId: 'missing-diagnostic',
    }).diagnostics.length, 0);
  } finally {
    fs.rmSync(isolatedDir, { recursive: true, force: true });
  }
});

test('reads an absent diagnostics file as empty', () => {
  const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-commit-record-'));
  try {
    const stored = readStudyCommitDiagnostics({ dataDir: isolatedDir });
    assert.equal(stored.totalRecordCount, 0);
    assert.equal(stored.malformedRecordCount, 0);
    assert.deepEqual(stored.diagnostics, []);
  } finally {
    fs.rmSync(isolatedDir, { recursive: true, force: true });
  }
});

describe('client incident route', { concurrency: false }, () => {
  let dataDir = '';
  let indexModule: IndexModule;

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
    } finally {
      restoreEnv('APP_MODE', previousMode);
      restoreEnv('APP_DATA_DIR', previousDataDir);
    }
  });

  after(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('accepts authenticated bounded client incident batches and rejects malformed records', async () => {
    const recorded: Array<{ learnerId: string; incident: ClientTransportIncident }> = [];
    const app = indexModule.createApp({
      clientIncidentDiagnosticSink: {
        record(input) {
          recorded.push(input);
        },
      },
    });
    const incident: ClientTransportIncident = {
      schemaVersion: 'client_transport_incident.v1',
      event: 'client_transport.failed',
      diagnosticId: 'client-incident-route-test',
      at: '2026-09-11T02:00:00.000Z',
      appVersion: '2.3.0',
      route: '/api/study-sessions/:sessionId/accepted-review-attempt-batch',
      method: 'POST',
      phase: 'fetch',
      elapsedMs: 200,
      correlation: {
        sessionId: 'session-route-test',
        sessionActionId: 'review/word-1/recognition',
        eventIds: ['attempt-route-test'],
      },
      browser: { online: false, visibilityState: 'visible' },
      error: { name: 'TypeError', message: 'Failed to fetch' },
    };

    const accepted = await request(app, '/api/client-incidents', {
      method: 'POST',
      body: { incidents: [incident] },
    });
    assert.equal(accepted.status, 204);
    assert.deepEqual(recorded, [{ learnerId: 'test-learner', incident }]);

    const rejected = await request(app, '/api/client-incidents', {
      method: 'POST',
      body: { incidents: [{ ...incident, route: '/api/arbitrary' }] },
    });
    assert.equal(rejected.status, 400);
    assert.equal(recorded.length, 1);

    const rejectedExtraField = await request(app, '/api/client-incidents', {
      method: 'POST',
      body: { incidents: [{ ...incident, extraSecret: 'must not be accepted' }] },
    });
    assert.equal(rejectedExtraField.status, 400);
    assert.equal(recorded.length, 1);
  });
});

function storedFailure(input: {
  diagnosticId: string;
  response: string;
  error?: StudyCommitFailureDiagnostic['error'];
}): StudyCommitFailureDiagnostic {
  return {
    schemaVersion: 'study_commit_failure.v1',
    event: 'study_commit.failed',
    diagnosticId: input.diagnosticId,
    at: '2026-09-05T04:00:00.000Z',
    route: '/api/study-sessions/:sessionId/accepted-review-attempt-batch',
    responseStatus: 500,
    elapsedMs: 7,
    learnerId: 'learner-1',
    correlation: {
      sessionId: 'session-1',
      sessionActionId: 'review/word-1/production',
      targetWordId: 'word-1',
      actionKind: 'production',
      promptTargetWordId: null,
      selectedWordId: null,
      eventIds: ['attempt-1'],
    },
    request: {
      params: { sessionId: 'session-1' },
      body: { events: [{ id: 'attempt-1', response: input.response }] },
    },
    error: input.error ?? { name: 'Error', message: 'failed', stack: null, details: {}, cause: null },
    runtime: { appVersion: null, appRevision: null, flyMachineId: null, processId: 1 },
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
