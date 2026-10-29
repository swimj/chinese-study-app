import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';

let db: typeof import('../server/db.ts');
let server: Server;
let baseUrl: string;
let dataDir: string;
const previousAllowlist = process.env.APP_OPERATOR_CLERK_USER_IDS;
before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'operator-only-'));
  process.env.APP_MODE = 'dev';
  process.env.APP_AUTH_MODE = 'clerk';
  process.env.APP_DATA_DIR = dataDir;
  process.env.APP_SEED_DATA_PATH = path.resolve('server/seeds/mandarin-dev.json');
  process.env.APP_OPERATOR_CLERK_USER_IDS = 'user_operator';
  db = await import('../server/db.ts');
  const { createApp } = await import('../server/index.ts');
  server = createApp({
    frontendDistPath: null,
    resolveClerkProviderSubject: (request) => request.get('x-test-verified-subject') ?? null,
  }).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  baseUrl = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  fs.rmSync(dataDir, { recursive: true, force: true });
  if (previousAllowlist === undefined) delete process.env.APP_OPERATOR_CLERK_USER_IDS;
  else process.env.APP_OPERATOR_CLERK_USER_IDS = previousAllowlist;
});
function request(route: string, subject?: string, method = 'GET') {
  return fetch(`${baseUrl}${route}`, { method, headers: subject ? { 'x-test-verified-subject': subject } : {} });
}
function restrict(enabled: boolean) {
  db.setHostedServiceControl({ key: 'operator_only', enabled, actorId: 'test' });
}

test('access probe never bootstraps learners, and unrestricted anonymous APIs still require authentication', async () => {
  for (const subject of [undefined, 'user_new_probe']) {
    const response = await request('/api/service-access', subject);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { allowed: true });
  }
  assert.equal(db.resolveLearnerId(db.CLERK_AUTH_PROVIDER, 'user_new_probe'), null);
  assert.equal((await request('/api/status?studyDayKey=2026-10-27')).status, 401);
});

test('restriction blocks reads and writes before bootstrap, including anonymous and existing learners', async () => {
  db.resolveOrBootstrapExternalLearner({ provider: db.CLERK_AUTH_PROVIDER, providerSubject: 'user_existing' });
  restrict(true);
  try {
    for (const subject of [undefined, 'user_new_blocked', 'user_existing']) {
      for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
        const response = await request('/api/not-real', subject, method);
        assert.equal(response.status, 503);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await response.json(), { code: 'OPERATOR_ONLY', error: 'The service is temporarily unavailable.' });
      }
      assert.deepEqual(await (await request('/api/service-access', subject)).json(), { allowed: false });
    }
    assert.equal(db.resolveLearnerId(db.CLERK_AUTH_PROVIDER, 'user_new_blocked'), null);
    assert.equal((await request('/healthz')).status, 200);
    assert.deepEqual(await (await request('/api/service-access', 'user_operator')).json(), { allowed: true });
    assert.equal(db.resolveLearnerId(db.CLERK_AUTH_PROVIDER, 'user_operator'), null);
    assert.equal((await request('/api/status?studyDayKey=2026-10-27', 'user_operator')).status, 200);
    assert.ok(db.resolveLearnerId(db.CLERK_AUTH_PROVIDER, 'user_operator'));
    assert.equal(db.getHostedServiceControls().maintenanceMode, false);
    assert.equal(db.getHostedServiceControls().providerWorkEnabled, true);
  } finally { restrict(false); }
  assert.equal((await request('/api/status?studyDayKey=2026-10-27', 'user_existing')).status, 200);
});

test('operator access does not bypass disabled accounts or maintenance writes', async () => {
  const id = db.resolveLearnerId(db.CLERK_AUTH_PROVIDER, 'user_operator');
  assert.ok(id);
  restrict(true);
  db.setLearnerDisabled(id, true);
  try {
    const response = await request('/api/status?studyDayKey=2026-10-27', 'user_operator');
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'ACCOUNT_DISABLED');
    db.setLearnerDisabled(id, false);
    db.setHostedServiceControl({ key: 'maintenance_mode', enabled: true, actorId: 'test' });
    assert.equal((await request('/api/not-real', 'user_operator', 'POST')).status, 503);
  } finally {
    restrict(false);
    db.setLearnerDisabled(id, false);
    db.setHostedServiceControl({ key: 'maintenance_mode', enabled: false, actorId: 'test' });
  }
});

test('restriction fails closed with an empty allowlist and ignores client role headers', async () => {
  restrict(true);
  process.env.APP_OPERATOR_CLERK_USER_IDS = '';
  try {
    assert.deepEqual(await (await request('/api/service-access', 'user_operator')).json(), { allowed: false });
    const response = await fetch(`${baseUrl}/api/status?studyDayKey=2026-10-27`, {
      headers: { 'x-operator': 'true', 'x-user-role': 'operator', 'x-clerk-user-id': 'user_operator' },
    });
    assert.equal(response.status, 503);
    process.env.APP_OPERATOR_CLERK_USER_IDS = 'trusted_local';
    assert.equal((await request('/api/status?studyDayKey=2026-10-27', 'user_operator')).status, 503);
  } finally {
    restrict(false);
    process.env.APP_OPERATOR_CLERK_USER_IDS = 'user_operator';
  }
});
