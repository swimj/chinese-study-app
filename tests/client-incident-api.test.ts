import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { ClientTransportIncident } from '../src/domain/client-incidents.ts';

type IndexModule = typeof import('../server/index.ts');
type ExpressApp = ReturnType<IndexModule['createApp']>;

describe('client incident route', { concurrency: false }, () => {
  let dataDir = '';
  let indexModule: IndexModule;

  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-client-incident-api-'));
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
