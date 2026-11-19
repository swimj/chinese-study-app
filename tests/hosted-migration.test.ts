import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runBackedUpMigration } from '../scripts/lib/hosted-migration.ts';
import type { CommandRunner } from '../scripts/lib/hosted-upgrade.ts';

const input = { databasePath: '/data/app.db', confirmAppStopped: true, preReleaseBackupId: 'pre', releaseId: 'release-1',
  previousRevision: 'a'.repeat(40), sourceApp: 'production' };
const now = Date.parse('2026-11-17T00:00:00Z');
function harness(failure?: 'before' | 'migration', receiptChange = {}) {
  const calls: string[] = [];
  const before = {version: 1, id: 'pre', kind: 'release', releaseId: 'release-1', sourceRevision: input.previousRevision,
    sourceApp: input.sourceApp, startedAt: new Date(now - 1000).toISOString(), receivedAt: new Date(now).toISOString(), ...receiptChange};
  const run: CommandRunner = async (_file, argv) => {
    const stage = argv.includes('--action=status') ? 'before' : argv.includes('--action=create') ? 'capture' : 'migration';
    calls.push(stage);
    if (stage === failure) throw new Error('simulated failure');
    return { stdout: JSON.stringify(stage === 'before' ? { backups: [before] } : { appliedThisRun: ['migration'], pending: [] }), stderr: '' };
  };
  return { run, calls };
}
test('migration verifies the pre-release recovery point, then migrates without capturing while stopped', async () => {
  const h = harness();
  const result = await runBackedUpMigration(input, h.run, () => now);
  assert.deepEqual(h.calls, ['before', 'migration']);
  assert.equal(result.backup.before.id, 'pre');
});
test('migration refuses without stopped-app confirmation', async () => {
  const h = harness();
  await assert.rejects(runBackedUpMigration({ ...input, confirmAppStopped: false }, h.run, () => now), /Stop the app/);
  assert.deepEqual(h.calls, []);
});
for (const change of [{ startedAt: new Date(now - 3600001).toISOString() }, { sourceApp: 'rehearsal' },
  { sourceRevision: 'b'.repeat(40) }, {releaseId: 'wrong'}, {kind: 'hourly'}, {id: 'other'}, {startedAt: 'invalid'}]) {
  test(`migration refuses wrong or stale recovery point ${JSON.stringify(change)}`, async () => {
    const h = harness(undefined, change);
    await assert.rejects(runBackedUpMigration(input, h.run, () => now), /retained verified pre-release/);
    assert.deepEqual(h.calls, ['before']);
  });
}
for (const failure of ['before', 'migration'] as const) {
  test(`migration fails closed at ${failure}`, async () => {
    const h = harness(failure);
    await assert.rejects(runBackedUpMigration(input, h.run, () => now), /simulated failure/);
    assert.deepEqual(h.calls, failure === 'before' ? ['before'] : ['before', 'migration']);
  });
}

test('cancellation remains failed even when the active child exits successfully', async () => {
  const { createMigrationCommandRunner } = await import('../scripts/lib/migration-command-runner.ts');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { setTimeout: delay } = await import('node:timers/promises');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-cancel-'));
  const ready = path.join(dir, 'ready'), forbidden = path.join(dir, 'forbidden');
  const runner = createMigrationCommandRunner();
  try {
    const pending = runner.run(process.execPath, ['-e', `process.on('SIGTERM',()=>process.exit(0));require('node:fs').writeFileSync(process.argv[1],'ready');setInterval(()=>{},1000);`, ready]);
    const rejected = assert.rejects(pending, /interrupted by SIGTERM/);
    const deadline = Date.now() + 5000;
    while (!fs.existsSync(ready)) { assert.ok(Date.now() < deadline, 'child must become ready'); await delay(10); }
    runner.interrupt('SIGTERM');
    await rejected;
    await assert.rejects(runner.run(process.execPath, ['-e', `require('node:fs').writeFileSync(process.argv[1],'unexpected')`, forbidden]), /interrupted/);
    assert.equal(fs.existsSync(forbidden), false);
  } finally { runner.interrupt('SIGKILL'); fs.rmSync(dir, { recursive: true, force: true }); }
});
