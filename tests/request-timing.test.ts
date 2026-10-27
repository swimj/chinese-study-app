import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, afterEach, before, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { getDb, setDb } from '../server/db/connection.ts';
import { instrumentDatabase } from '../server/db/statement-timing.ts';
import { createServiceMetrics, type ServiceOperationalMetrics } from '../server/observability.ts';
import {
  createRequestTimingMiddleware,
  createSlowRequestLogger,
  finishRequestTiming,
  fingerprintSql,
  readSlowRequestThresholdMs,
  readSqliteTimingTotals,
  readTransactionHoldHistogram,
  runWithRequestTiming,
  startRequestTiming,
  timeProviderCall,
  type RequestTimingSummary,
} from '../server/request-timing.ts';

type IndexModule = typeof import('../server/index.ts');

const finishInput = {
  method: 'GET',
  route: '/api/test',
  status: '200',
  outcome: 'completed' as const,
  responseBytes: null,
};

function steppingClock(stepMs: number): { clockMs: () => number; advance: (ms: number) => void } {
  let nowMs = 0;
  return {
    clockMs: () => {
      nowMs += stepMs;
      return nowMs;
    },
    advance: (ms) => {
      nowMs += ms;
    },
  };
}

function memoryDatabase(): DatabaseSync {
  const database = instrumentDatabase(new DatabaseSync(':memory:'));
  database.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT NOT NULL)');
  return database;
}

describe('request timing', () => {
  const servers: Server[] = [];

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('fingerprints collapse literals, whitespace, and placeholder-list length', () => {
    const short = fingerprintSql('SELECT * FROM items WHERE id IN (?, ?) AND label = \'secret answer\'');
    const long = fingerprintSql(`SELECT *
      FROM items
      WHERE id IN (?, ?, ?, ?)   AND label = 'another learner answer'`);
    assert.equal(short.fingerprint, long.fingerprint);
    assert.equal(short.sql, "SELECT * FROM items WHERE id IN (?…) AND label = '?'");
    assert.equal(long.sql.includes('learner answer'), false);
    assert.notEqual(fingerprintSql('SELECT id FROM items').fingerprint, short.fingerprint);
  });

  test('attributes statements to the active request and the rest to background work', () => {
    const database = memoryDatabase();
    const clock = steppingClock(1);
    const timing = startRequestTiming({ clockMs: clock.clockMs });
    const before = readSqliteTimingTotals();

    runWithRequestTiming(timing, () => {
      const insert = database.prepare('INSERT INTO items (label) VALUES (?)');
      insert.run('one');
      insert.run('two');
      assert.equal((database.prepare('SELECT COUNT(*) AS total FROM items').get() as { total: number }).total, 2);
      assert.deepEqual([...database.prepare('SELECT label FROM items ORDER BY id').iterate()].map((row) => (
        (row as { label: string }).label
      )), ['one', 'two']);
    });
    database.prepare('SELECT 1').get();

    const summary = finishRequestTiming(timing, finishInput);
    const afterTotals = readSqliteTimingTotals();
    // Three prepares, two inserts, one get, one iterate start, and three iterator steps.
    assert.equal(summary.sqlite.statements, 10);
    assert.equal(afterTotals.requestStatements - before.requestStatements, 10);
    assert.equal(afterTotals.backgroundStatements - before.backgroundStatements, 2);
    const insertStats = summary.sqlite.topStatements.find((statement) => statement.sql.startsWith('INSERT'));
    assert.equal(insertStats?.count, 3);
    assert.equal(summary.phasesMs.sqlite, summary.sqlite.topStatements.reduce((sum, statement) => sum + statement.totalMs, 0));
  });

  test('records transaction hold time across statements, including savepoints', () => {
    const database = memoryDatabase();
    const clock = steppingClock(1);
    const timing = startRequestTiming({ clockMs: clock.clockMs });
    const holdBefore = readTransactionHoldHistogram().count;

    runWithRequestTiming(timing, () => {
      database.exec('BEGIN IMMEDIATE');
      database.prepare('INSERT INTO items (label) VALUES (?)').run('held');
      clock.advance(40);
      database.exec('COMMIT');
      database.exec('SAVEPOINT nested_work');
      database.exec('RELEASE nested_work');
    });

    const summary = finishRequestTiming(timing, finishInput);
    assert.equal(summary.sqlite.transactions, 2);
    assert.ok(summary.sqlite.maxTransactionMs >= 40, `hold ${summary.sqlite.maxTransactionMs}`);
    assert.equal(readTransactionHoldHistogram().count - holdBefore, 2);
  });

  test('keeps phases exclusive: overlapping provider calls count once and nested SQLite stays in sqlite', async () => {
    const database = memoryDatabase();
    let nowMs = 0;
    database.function('advance_clock', (ms: unknown) => {
      nowMs += Number(ms);
      return 1;
    });
    const timing = startRequestTiming({ clockMs: () => nowMs });

    await runWithRequestTiming(timing, async () => {
      let release: () => void = () => {};
      const upstream = new Promise<void>((resolve) => {
        release = resolve;
      });
      const calls = Promise.all([
        timeProviderCall(() => upstream),
        timeProviderCall(() => upstream),
      ]);
      nowMs += 100;
      database.prepare('SELECT advance_clock(30)').get();
      nowMs += 70;
      release();
      await calls;
    });
    nowMs += 50;

    const summary = finishRequestTiming(timing, finishInput);
    assert.equal(summary.durationMs, 250);
    assert.equal(summary.phasesMs.sqlite, 30);
    assert.equal(summary.phasesMs.provider, 170);
    assert.equal(summary.phasesMs.other, 50);
    assert.equal(summary.localMs, 80);
  });

  test('keeps request context through body parsing and reports timing through header, summary, and metrics', async () => {
    const database = memoryDatabase();
    const summaries: RequestTimingSummary[] = [];
    const slowLines: string[] = [];
    const logSlow = createSlowRequestLogger({ thresholdMs: 1, logLine: (line) => slowLines.push(line) });
    const metrics = createServiceMetrics({
      eventLoopHistogram: { enable() {}, disable() {}, reset() {}, percentile: () => 0, max: 0 },
    });
    const timing = createRequestTimingMiddleware({
      onSummary: (summary) => {
        summaries.push(summary);
        metrics.observeRequestTiming(summary, logSlow(summary));
      },
    });
    const app = express();
    app.use(timing.begin);
    app.use(express.json());
    app.use(timing.resume);
    app.use('/api', timing.authStarted);
    app.use('/api', (_request, _response, next) => {
      database.prepare('SELECT 1 AS authenticated').get();
      next();
    });
    app.use('/api', timing.authFinished(() => 'learner-under-test'));
    app.post('/api/items/:itemId', (request, response) => {
      database.prepare('INSERT INTO items (label) VALUES (?)').run(String(request.body.label));
      const started = Date.now();
      while (Date.now() - started < 5) {
        // Hold the event loop so the request reliably crosses the 1 ms threshold.
      }
      response.json({ ok: true });
    });
    const server = app.listen(0, '127.0.0.1');
    servers.push(server);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const address = server.address();
    assert.ok(address && typeof address === 'object');

    const response = await fetch(`http://127.0.0.1:${address.port}/api/items/private-item-id`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'learner content' }),
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('server-timing') ?? '', /sqlite;dur=[\d.]+;desc="4 statements", auth;dur=[\d.]+/);
    await waitFor(() => summaries.length === 1);

    const [summary] = summaries;
    assert.equal(summary?.route, '/api/items/:itemId');
    assert.equal(summary?.learnerId, 'learner-under-test');
    assert.equal(summary?.sqlite.statements, 4);
    assert.ok((summary?.phasesMs.other ?? 0) >= 4);
    assert.equal(slowLines.length, 1);
    const slowEvent = JSON.parse(slowLines[0]!) as Record<string, unknown>;
    assert.equal(slowEvent.event, 'request.slow');
    assert.equal(slowLines[0]!.includes('learner content'), false);
    assert.equal(slowLines[0]!.includes('private-item-id'), false);

    const rendered = metrics.render(operationalMetrics);
    assert.match(
      rendered,
      /chinese_study_http_request_phase_seconds_total\{method="POST",route="\/api\/items\/:itemId",phase="sqlite"\} /,
    );
    assert.match(
      rendered,
      /chinese_study_http_request_sqlite_statements_total\{method="POST",route="\/api\/items\/:itemId"\} 4/,
    );
    assert.match(rendered, /chinese_study_http_slow_requests_total\{method="POST",route="\/api\/items\/:itemId"\} 1/);
    assert.match(rendered, /chinese_study_sqlite_seconds_total\{context="background"\} /);
    assert.match(rendered, /chinese_study_sqlite_transaction_hold_seconds_count /);
    assert.equal(rendered.includes('learner-under-test'), false);
    metrics.dispose();
  });

  test('setDb instruments a connection once and clears it with null', () => {
    const raw = new DatabaseSync(':memory:');
    setDb(raw);
    const live = getDb();
    assert.notEqual(live, raw);
    setDb(live);
    assert.equal(getDb(), live);
    setDb(null);
    assert.throws(() => getDb(), /Database not initialized/);
    raw.close();
  });

  test('validates the slow-request threshold configuration', () => {
    assert.equal(readSlowRequestThresholdMs(undefined), 500);
    assert.equal(readSlowRequestThresholdMs(' '), 500);
    assert.equal(readSlowRequestThresholdMs('250'), 250);
    assert.throws(() => readSlowRequestThresholdMs('0'), /APP_SLOW_REQUEST_MS/);
    assert.throws(() => readSlowRequestThresholdMs('fast'), /APP_SLOW_REQUEST_MS/);
  });
});

describe('request timing in the application', { concurrency: false }, () => {
  let dataDir = '';
  let indexModule: IndexModule;

  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-request-timing-'));
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

  test('attributes route SQLite work and the learner to a slow-request event', async () => {
    const slowLines: string[] = [];
    const app = indexModule.createApp({
      frontendDistPath: null,
      requestTiming: {
        clockMs: steppingClock(1).clockMs,
        slowRequestThresholdMs: 1,
        logSlowRequest: (line) => slowLines.push(line),
      },
    });
    const server = app.listen(0, '127.0.0.1');
    try {
      await new Promise<void>((resolve) => server.once('listening', () => resolve()));
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      const response = await fetch(`http://127.0.0.1:${address.port}/api/my-words`);
      assert.equal(response.status, 200);
      const serverTiming = response.headers.get('server-timing') ?? '';
      const statementCount = Number(/sqlite;dur=[\d.]+;desc="(\d+) statements"/.exec(serverTiming)?.[1]);
      assert.ok(statementCount > 0, serverTiming);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await waitFor(() => slowLines.length > 0);
    const event = JSON.parse(slowLines.at(-1)!) as { route: string; learnerId: string | null; sqlite: { statements: number } };
    assert.equal(event.route, '/api/my-words');
    assert.ok(event.learnerId);
    assert.ok(event.sqlite.statements > 0);
  });
});

const operationalMetrics: ServiceOperationalMetrics = {
  databaseBytes: 1,
  walBytes: 1,
  backupReplicationAgeSeconds: 1,
  maintenanceMode: false,
  providerWorkEnabled: true,
  activeProviderWorkCount: 0,
};

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('Timed out waiting for request timing summary.');
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
