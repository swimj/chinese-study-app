import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';

type IndexModule = typeof import('../server/index.ts');

describe('hosted application runtime', { concurrency: false }, () => {
  let indexModule: IndexModule;
  let server: Server;
  let baseUrl = '';
  let dataDir = '';
  let frontendDistPath = '';
  let authenticationCount = 0;
  const loggedErrors: Array<{ message: string; metadata: Record<string, string> }> = [];

  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-hosted-runtime-'));
    frontendDistPath = path.join(dataDir, 'dist');
    fs.mkdirSync(path.join(frontendDistPath, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(frontendDistPath, 'index.html'), '<main>hosted app</main>');
    fs.writeFileSync(path.join(frontendDistPath, 'assets', 'app.js'), 'window.hosted = true;');

    const previousMode = process.env.APP_MODE;
    const previousAuthMode = process.env.APP_AUTH_MODE;
    const previousDataDir = process.env.APP_DATA_DIR;
    try {
      process.env.APP_MODE = 'study';
      process.env.APP_AUTH_MODE = 'clerk';
      process.env.APP_DATA_DIR = dataDir;
      indexModule = await import(
        `${pathToFileURL(path.resolve('server/index.ts')).href}?hosted-runtime=${Date.now()}`
      );
    } finally {
      restoreEnv('APP_MODE', previousMode);
      restoreEnv('APP_AUTH_MODE', previousAuthMode);
      restoreEnv('APP_DATA_DIR', previousDataDir);
    }

    const app = indexModule.createApp({
      frontendDistPath,
      resolveClerkProviderSubject: () => {
        authenticationCount += 1;
        return 'hosted-test-user';
      },
      logError(message, metadata) {
        loggedErrors.push({ message, metadata });
      },
    });
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
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
    const { closeDbConnection } = await import('../server/db/connection.ts');
    closeDbConnection();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('keeps health, assets, and SPA navigation public while authenticating API requests', async () => {
    const health = await fetch(`${baseUrl}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      status: 'ok',
      maintenanceMode: false,
      providerWorkEnabled: true,
      activeProviderWorkCount: 0,
    });
    assert.equal(authenticationCount, 0);

    const asset = await fetch(`${baseUrl}/assets/app.js`);
    assert.equal(asset.status, 200);
    assert.equal(await asset.text(), 'window.hosted = true;');
    assert.equal(authenticationCount, 0);

    const navigation = await fetch(`${baseUrl}/study/today`);
    assert.equal(navigation.status, 200);
    assert.equal(await navigation.text(), '<main>hosted app</main>');
    assert.equal(authenticationCount, 0);

    const api = await fetch(`${baseUrl}/api/not-real`);
    assert.equal(api.status, 404);
    assert.deepEqual(await api.json(), { error: 'API endpoint not found' });
    assert.equal(authenticationCount, 1);
    assert.equal(api.headers.get('x-powered-by'), null);
  });

  test('bounds JSON bodies and returns sanitized final errors', async () => {
    const secret = 'secret-that-must-not-be-logged';
    const oversized = await fetch(`${baseUrl}/api/not-real`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret, padding: 'x'.repeat(110_000) }),
    });
    assert.equal(oversized.status, 413);
    assert.deepEqual(await oversized.json(), { error: 'Request body too large' });

    const malformed = await fetch(`${baseUrl}/api/not-real`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not-json',
    });
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), { error: 'Invalid JSON request body' });

    assert.equal(loggedErrors.length, 2);
    assert.equal(JSON.stringify(loggedErrors).includes(secret), false);
    assert.deepEqual(loggedErrors.map((entry) => entry.metadata.status), ['413', '400']);
  });

  test('blocks writes in maintenance and independently disables provider work', async () => {
    const dbModule = await import('../server/db.ts');
    dbModule.setHostedServiceControl({
      key: 'maintenance_mode',
      enabled: true,
      actorId: 'runtime-test',
    });
    const blockedWrite = await fetch(`${baseUrl}/api/not-real`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(blockedWrite.status, 503);
    assert.deepEqual(await blockedWrite.json(), {
      error: 'The service is in maintenance mode.',
      code: 'MAINTENANCE_MODE',
    });

    dbModule.setHostedServiceControl({
      key: 'maintenance_mode',
      enabled: false,
      actorId: 'runtime-test',
    });
    dbModule.setHostedServiceControl({
      key: 'provider_work_enabled',
      enabled: false,
      actorId: 'runtime-test',
    });
    const blockedProvider = await fetch(`${baseUrl}/api/study-sessions/runtime-test/reflections`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(blockedProvider.status, 503);
    assert.deepEqual(await blockedProvider.json(), {
      error: 'Provider work is temporarily disabled.',
      code: 'PROVIDER_WORK_DISABLED',
    });
    dbModule.setHostedServiceControl({
      key: 'provider_work_enabled',
      enabled: true,
      actorId: 'runtime-test',
    });
  });

  test('closes the HTTP server and database hook through one idempotent shutdown', async () => {
    const disposableServer = createServer((_req, response) => response.end());
    await new Promise<void>((resolve, reject) => {
      disposableServer.listen(0, '127.0.0.1', resolve);
      disposableServer.once('error', reject);
    });
    let databaseCloseCount = 0;
    const shutdown = indexModule.installGracefulShutdown(disposableServer, () => {
      databaseCloseCount += 1;
    });

    await Promise.all([shutdown(), shutdown()]);

    assert.equal(disposableServer.listening, false);
    assert.equal(databaseCloseCount, 1);
  });
});

test('product SQLite connections use WAL and a five-second busy timeout', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-sqlite-runtime-'));
  const dbPath = path.join(dataDir, 'runtime.db');
  const { openDatabase } = await import('../server/db/connection.ts');
  const database = openDatabase(dbPath);
  try {
    const journalMode = database.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    const busyTimeout = database.prepare('PRAGMA busy_timeout').get() as { timeout: number };
    assert.equal(journalMode.journal_mode, 'wal');
    assert.equal(busyTimeout.timeout, 5_000);
  } finally {
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
