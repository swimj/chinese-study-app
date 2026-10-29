import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { buildObservationCommand, observeHosted, validateRequest } from '../scripts/lib/cloud-hosted-observation.ts';

const app = 'fixture-app';
const machine = 'abcdef123456';
const revision = 'a'.repeat(40);
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-observe-'));
  const file = path.join(dir, 'app.db');
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE schema_migrations (migration_id TEXT, applied_at TEXT); INSERT INTO schema_migrations VALUES ('app_schema:0060_fixture', '2026-01-01'); CREATE TABLE evidence (id INTEGER, text TEXT); INSERT INTO evidence VALUES (1, '真实内容'), (2, 'second');");
  db.close();
  return { dir, file };
}
function execute(command: string) {
  return spawnSync('sh', ['-c', command], { encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, APP_REVISION: revision, FLY_MACHINE_ID: machine, FLY_APP_NAME: app } });
}

test('cloud orchestration uses release history and selected Machine, running real payload on fixture', () => {
  const { dir, file } = fixture();
  try {
    const before = fs.readFileSync(file);
    const calls: string[][] = [];
    const request = validateRequest({ databasePath: file, queries: [{ name: 'cases', sql: 'SELECT * FROM evidence WHERE id = ?', params: [1] }] });
    const report = observeHosted(app, machine, request, (args) => {
      calls.push(args);
      if (args[0] === 'releases') return '[{"Version":65}]';
      const result = execute(args.at(-1)!);
      assert.equal(result.status, 0, result.stderr);
      return result.stdout;
    });
    assert.deepEqual(calls[0], ['releases', '--app', app, '--json']);
    assert.deepEqual(calls[1].slice(0, -1), ['ssh', 'console', '--app', app, '--machine', machine, '--user', 'node', '--quiet', '--command']);
    assert.equal(report.observation.runtime.sourceRevision, revision);
    assert.deepEqual(report.request, request);
    assert.match(report.observerPayloadSha256, /^[a-f0-9]{64}$/);
    assert.equal(report.observation.migrations[0].migration_id, 'app_schema:0060_fixture');
    assert.deepEqual(report.observation.results[0].rows, [{ id: '1', text: '真实内容' }]);
    assert.deepEqual(fs.readFileSync(file), before);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('SQL and parameters survive shell characters without executing them', () => {
  const { dir, file } = fixture();
  try {
    const text = "' $(touch /should-not-exist) `echo x` \" \\ \n 你好";
    const result = execute(buildObservationCommand(validateRequest({ databasePath: file,
      queries: [{ name: 'quoted', sql: 'SELECT ? AS value', params: [text] }] })));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).results[0].rows[0].value, text);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('writes, creation, ATTACH and WITH mutation fail without changing fixture', () => {
  const { dir, file } = fixture();
  try {
    const before = fs.readFileSync(file);
    for (const sql of ['DELETE FROM evidence', 'CREATE TABLE surprise (x)', "ATTACH ':memory:' AS other", 'WITH ids AS (SELECT 1) DELETE FROM evidence']) {
      const result = execute(buildObservationCommand(validateRequest({ databasePath: file, queries: [{ name: 'bad', sql }] })));
      assert.notEqual(result.status, 0);
      assert.equal(result.stdout, '');
      assert.deepEqual(fs.readFileSync(file), before);
    }
    const missing = path.join(dir, 'missing.db');
    assert.notEqual(execute(buildObservationCommand(validateRequest({ databasePath: missing }))).status, 0);
    assert.equal(fs.existsSync(missing), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('row, output and remote query deadline limits fail instead of reporting partial evidence', () => {
  const { dir, file } = fixture();
  try {
    for (const request of [
      { maxResultBytes: 1, queries: [] },
      { maxRows: 1, queries: [{ name: 'rows', sql: 'SELECT * FROM evidence' }] },
      { maxResultBytes: 100, queries: [{ name: 'bytes', sql: "SELECT printf('%1000s', 'x') AS value" }] },
      { queryTimeoutMs: 100, queries: [{ name: 'slow', sql: 'WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n) SELECT sum(x) FROM n' }] },
    ]) {
      const result = execute(buildObservationCommand(validateRequest({ databasePath: file, ...request })));
      assert.notEqual(result.status, 0, result.stderr);
      assert.equal(result.error, undefined, 'remote deadline must fire before transport timeout');
      assert.equal(result.stdout, '');
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('invalid inputs and wrong runtime identity fail closed', () => {
  for (const value of [null, { maxRows: 0 }, { queries: [{ name: 'x', sql: 'SELECT ?', params: [true] }] }, { extra: 1 }]) {
    assert.throws(() => validateRequest(value));
  }
  assert.throws(() => observeHosted('bad;app', machine, validateRequest({}), () => { throw new Error('must not run'); }));
  assert.throws(() => observeHosted(app, machine, validateRequest({}), (args) => args[0] === 'releases' ? '[]' : JSON.stringify({ status: 'ok', runtime: { sourceRevision: revision, flyMachineId: 'another', flyAppName: app } })), /identity/);
  assert.throws(() => observeHosted(app, machine, validateRequest({}), () => { throw new Error('unavailable'); }), /unavailable/);
});

test('Machines exec transports the real payload over API and handles omitted zero exit code', () => {
  const { dir, file } = fixture();
  try {
    const request = validateRequest({ databasePath: file, queries: [{ name: 'count', sql: 'SELECT count(*) AS n FROM evidence' }] });
    const before = fs.readFileSync(file);
    for (const code of [undefined, 0]) {
      const calls: string[][] = [];
      const report = observeHosted(app, machine, request, (args) => {
        calls.push(args);
        if (args[0] === 'releases') return '[]';
        assert.deepEqual(args.slice(0, 3), ['machine', 'exec', machine]);
        assert.deepEqual(args.slice(4), ['--app', app, '--json', '--timeout', '20']);
        const result = execute(args[3]);
        assert.equal(result.status, 0, result.stderr);
        return JSON.stringify({ stdout: result.stdout, exit_code: code });
      }, 'machine-exec');
      assert.equal(calls.length, 2);
      assert.equal(report.transport, 'machine-exec');
      assert.deepEqual(report.observation.results[0].rows, [{ n: '2' }]);
      assert.deepEqual(fs.readFileSync(file), before);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Machines exec rejects failed or malformed remote results even when CLI exits successfully', () => {
  for (const response of [
    { exit_code: 1, stdout: '{}' }, { exit_code: null, stdout: '{}' },
    { exit_code: '0', stdout: '{}' }, { exit_code: 0 }, { stdout: 'not JSON' },
  ]) {
    assert.throws(() => observeHosted(app, machine, validateRequest({}),
      args => args[0] === 'releases' ? '[]' : JSON.stringify(response), 'machine-exec'));
  }
});
