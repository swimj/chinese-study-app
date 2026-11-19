import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  applyUpgradeEvent,
  initialState,
  latestReleaseId,
  listReleases,
  readRelease,
  setStage,
  writeRelease,
} from '../scripts/lib/release-tracker.ts';

const T0 = '2026-11-19T05:00:00.000Z';
const stage = (name: string, status: string, detail: unknown = {}) => JSON.stringify({ type: 'stage', stage: name, status, at: T0, detail });

test('plans differ by mode and start pending', () => {
  const code = initialState({ id: 'r1', mode: 'code', title: 'Code', commit: 'a'.repeat(40) }, T0);
  const migrate = initialState({ id: 'r2', mode: 'migrate', title: 'Migrate' }, T0);
  assert.ok(code.stages['p-build'] && code.stages['p-deploy'] && !code.stages['p-idle'] && !code.stages['r-prepare']);
  assert.ok(migrate.stages['p-idle'] && migrate.stages['r-migrate'] && migrate.stages['cleanup'] && !migrate.stages['p-deploy']);
  assert.ok(Object.values(code.stages).every((s) => s.status === 'pending'));
  assert.equal(code.outcome, 'in-progress');
  assert.throws(() => initialState({ id: 'Bad Id', mode: 'code', title: 'x' }, T0), /Release id/);
});

test('stage timing records start and end', () => {
  const s = initialState({ id: 'r1', mode: 'code', title: 'x' }, T0);
  setStage(s, 'sync', 'running', T0);
  setStage(s, 'sync', 'ok', '2026-11-19T05:00:30.000Z', 'done');
  assert.deepEqual(s.stages['sync'], { status: 'ok', startedAt: T0, endedAt: '2026-11-19T05:00:30.000Z', detail: 'done' });
  assert.throws(() => setStage(s, 'nope', 'ok', T0), /Unknown tracker stage/);
});

test('upgrade events advance production stages and settle the outcome', () => {
  const s = initialState({ id: 'r1', mode: 'migrate', title: 'x' }, T0);
  assert.equal(applyUpgradeEvent(s, stage('declare', 'ok'), T0), false);
  assert.equal(s.stages['p-declare']?.status, 'ok');
  assert.equal(s.stages['p-quiesce']?.status, 'running');
  applyUpgradeEvent(s, 'not json', T0);
  applyUpgradeEvent(s, stage('quiesce', 'failed', { failure: 'drain timed out' }), T0);
  assert.equal(s.stages['p-quiesce']?.detail, 'drain timed out');
  assert.equal(applyUpgradeEvent(s, JSON.stringify({ type: 'migration-release-result', status: 'failed', failedStage: 'quiesce', reopened: false, databaseState: 'unchanged' }), T0), true);
  assert.equal(s.outcome, 'failed');
  assert.match(s.phase, /failed at quiesce.*databaseState=unchanged/);

  const ok = initialState({ id: 'r2', mode: 'code', title: 'x' }, T0);
  applyUpgradeEvent(ok, JSON.stringify({ type: 'upgrade-result', status: 'ok', reopened: true }), T0);
  assert.equal(ok.outcome, 'released');

  const lateFailure = initialState({ id: 'r3', mode: 'migrate', title: 'x' }, T0);
  applyUpgradeEvent(lateFailure, JSON.stringify({ type: 'migration-release-result', status: 'failed', failedStage: 'post-backup', reopened: true }), T0);
  assert.equal(lateFailure.outcome, 'in-progress', 'a failure after reopening leaves the outcome to the agent');
});

test('history lists releases newest first and skips unreadable files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-history-'));
  try {
    writeRelease(root, initialState({ id: 'older', mode: 'code', title: 'Older' }, '2026-11-01T00:00:00.000Z'));
    writeRelease(root, initialState({ id: 'newer', mode: 'migrate', title: 'Newer' }, '2026-11-19T00:00:00.000Z'));
    fs.writeFileSync(path.join(root, 'broken.json'), '{');
    assert.deepEqual(listReleases(root).map((r) => r.id), ['newer', 'older']);
    assert.equal(latestReleaseId(root), 'newer');
    assert.equal(readRelease(root, 'older').title, 'Older');
    assert.equal(fs.statSync(path.join(root, 'newer.json')).mode & 0o777, 0o600);
    assert.throws(() => readRelease(root, '../etc'), /Invalid release id/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  assert.deepEqual(listReleases(path.join(os.tmpdir(), 'missing-release-root-xyz')), []);
});
