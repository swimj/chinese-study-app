import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import type { Server } from 'node:http';
import { after, before, test } from 'node:test';
import express from 'express';
import { setDb } from '../server/db/connection.ts';
import { registerSenseContentReconciliationRoutes } from '../server/vocabulary/reconciliation-routes.ts';
import type { SenseContentReconciliationDraft, SenseContentReconciliationWorkspace } from '../src/domain/sense-content-reconciliation.ts';

let dataDir: string, database: DatabaseSync, server: Server, base: string;
let wakes = 0;
const environment = ['APP_MODE', 'APP_AUTH_MODE', 'APP_OPERATOR_CLERK_USER_IDS', 'APP_LEARNER_ID', 'APP_DATA_DIR'] as const;
const previous = new Map(environment.map(key => [key, process.env[key]]));
before(async () => {
  dataDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reconciliation-http-')), 'data');
  Object.assign(process.env, { APP_DATA_DIR: dataDir, APP_MODE: 'study', APP_AUTH_MODE: 'trusted_local', APP_OPERATOR_CLERK_USER_IDS: 'trusted_local', APP_LEARNER_ID: 'dev-learner' });
  for (const script of ['scripts/prepare-vocabulary-fixtures.ts', 'scripts/testbed/prepare-reconciliation.ts']) {
    const result = spawnSync(process.execPath, ['--import', 'tsx', script, `--data-dir=${dataDir}`], {
      env: { ...process.env, APP_DATA_DIR: dataDir, APP_STUDY_PROFILE: 'mandarin' }, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
  }
  database = new DatabaseSync(path.join(dataDir, 'app.db'));
  database.exec('PRAGMA foreign_keys=ON');
  database.function('current_learner_id', () => 'dev-learner');
  setDb(database);
  const app = express(); app.use(express.json());
  registerSenseContentReconciliationRoutes(app, { wake: () => { wakes++; } });
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  base = `http://127.0.0.1:${address.port}/api/operator/vocabulary/reconciliation`;
});
after(async () => {
  if (server?.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  setDb(null); database?.close();
  if (dataDir) fs.rmSync(path.dirname(dataDir), { recursive: true, force: true });
  for (const key of environment) { const value = previous.get(key); if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});
const word = '/testbed%3A%E6%8C%82%E9%92%A9';
function post(suffix: string, body: unknown) {
  return fetch(`${base}${suffix}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
async function workspace(): Promise<SenseContentReconciliationWorkspace> {
  const response = await fetch(`${base}${word}`); assert.equal(response.status, 200);
  return response.json() as Promise<SenseContentReconciliationWorkspace>;
}
function decision(state: SenseContentReconciliationWorkspace): SenseContentReconciliationDraft {
  const selected = state.senses.map(sense => sense.senseId);
  return { defaultSenseIds: selected, rationale: 'Retain canonical distinctions; association is an existing linking sense.', unsupportedChanges: [],
    uses: state.teaching!.uses.map((use, index) => ({ useId: use.id, decision: 'map', senseId: selected[Math.min(index, 2)], rationale: 'Same intended meaning.' })) };
}

test('every reconciliation endpoint denies non-operators before touching data', async () => {
  process.env.APP_OPERATOR_CLERK_USER_IDS = '';
  try {
    for (const suffix of ['', word]) assert.equal((await fetch(`${base}${suffix}`)).status, 403);
    for (const suffix of [word, `${word}/apply`, `${word}/retry`]) {
      const response = await post(suffix, {}); assert.equal(response.status, 403);
      assert.equal((await response.json()).code, 'OPERATOR_FORBIDDEN');
    }
    assert.equal(database.prepare('SELECT count(*) n FROM sense_content_reconciliations').get()!.n, 0);
  } finally { process.env.APP_OPERATOR_CLERK_USER_IDS = 'trusted_local'; }
});

test('HTTP validation rejects malformed writes and reports an unknown word', async () => {
  assert.equal((await fetch(`${base}/missing-word`)).status, 404);
  for (const body of [[], {}, { expectedVersion: 0, status: 'draft', draft: {} },
    { expectedVersion: null, status: 'applied', draft: {} }, { expectedVersion: null, status: 'draft', draft: {}, extra: true },
    { expectedVersion: null, status: 'draft', draft: { uses: 'bad' } }]) {
    assert.equal((await post(word, body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await post(`${word}/apply`, { expectedVersion: 1, planFingerprint: '' })).status, 400);
  assert.equal((await post(`${word}/retry`, { extra: true })).status, 400);
  assert.equal(database.prepare('SELECT count(*) n FROM sense_content_reconciliations').get()!.n, 0);
});

test('saved blocked decisions persist, stale writes conflict, and supported apply queues replacement once', async () => {
  const listing = await fetch(base); assert.equal(listing.status, 200);
  assert.ok((await listing.json()).some((item: { wordId: string }) => item.wordId === 'testbed:挂钩'));
  const initial = await workspace(), draft = decision(initial);
  const blocked = { ...draft, unsupportedChanges: ['Split the figurative linking sense.'] };
  let response = await post(word, { expectedVersion: null, status: 'resolved', draft: blocked });
  assert.equal(response.status, 200);
  const saved = await response.json() as SenseContentReconciliationWorkspace;
  assert.deepEqual((await workspace()).resolution!.draft, blocked);
  assert.equal(saved.resolution!.status, 'resolved'); assert.ok(saved.plan!.blockers.length);
  assert.equal((await post(word, { expectedVersion: null, status: 'draft', draft })).status, 409);
  assert.equal((await post(`${word}/apply`, { expectedVersion: saved.resolution!.version, planFingerprint: saved.plan!.fingerprint })).status, 409);
  assert.equal(wakes, 0);
  response = await post(word, { expectedVersion: saved.resolution!.version, status: 'resolved', draft });
  assert.equal(response.status, 200);
  const ready = await response.json() as SenseContentReconciliationWorkspace;
  assert.deepEqual(ready.plan!.blockers, []);
  assert.equal((await post(`${word}/apply`, { expectedVersion: ready.resolution!.version, planFingerprint: 'stale-plan' })).status, 409);
  const applyBody = { expectedVersion: ready.resolution!.version, planFingerprint: ready.plan!.fingerprint };
  response = await post(`${word}/apply`, applyBody); assert.equal(response.status, 200);
  const applied = await response.json() as SenseContentReconciliationWorkspace;
  assert.equal(applied.resolution!.status, 'applied'); assert.equal(applied.progress.status, 'pending');
  assert.equal((await workspace()).resolution!.resolutionId, applied.resolution!.resolutionId);
  const historyCount = database.prepare('SELECT count(*) n FROM sense_content_reconciliation_history').get()!.n;
  assert.equal((await post(`${word}/apply`, applyBody)).status, 200);
  assert.equal(database.prepare('SELECT count(*) n FROM sense_content_reconciliation_history').get()!.n, historyCount);
  assert.equal(database.prepare("SELECT count(*) n FROM word_preparation_work WHERE word_id='testbed:挂钩' AND stage IN ('bootstrap','teaching') AND status='queued'").get()!.n, 2);
  assert.equal(wakes, 2, 'Both successful requests wake work; duplicate application creates no new work or history');
});
