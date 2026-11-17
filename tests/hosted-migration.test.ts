import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runBackedUpMigration } from '../scripts/lib/hosted-migration.ts';
import type { CommandRunner } from '../scripts/lib/hosted-upgrade.ts';

const input = { databasePath: '/data/app.db', confirmAppStopped: true, preReleaseBackupId: 'pre', releaseId: 'release-1',
  previousRevision: 'a'.repeat(40), sourceRevision: 'b'.repeat(40), sourceApp: 'production' };
const now = Date.parse('2026-11-17T00:00:00Z');
function harness(failure?: 'before' | 'migration' | 'after' | 'start', receiptChange = {}) {
  const calls: string[] = [];
  const before = {version: 1, id: 'pre', kind: 'release', releaseId: 'release-1', sourceRevision: input.previousRevision,
    sourceApp: input.sourceApp, startedAt: new Date(now - 1000).toISOString(), receivedAt: new Date(now).toISOString(), ...receiptChange};
  const run: CommandRunner = async (_file, argv) => {
    const stage = argv.includes('--action=status') ? 'before' : argv.includes('--action=create') ? 'after' : 'migration';
    calls.push(stage);
    if (stage === failure) throw new Error('simulated failure');
    return { stdout: JSON.stringify(stage === 'before' ? { backups: [before] } : stage === 'migration' ? { appliedThisRun: ['migration'], pending: [] }
      : { id: argv.find(a => a.startsWith('--id='))!.slice(5), kind: 'hourly', sourceRevision: input.sourceRevision,
        sourceApp: input.sourceApp, startedAt: new Date(now).toISOString() }), stderr: '' };
  };
  const source = { async start() { calls.push('start'); if (failure === 'start') throw new Error('simulated failure'); return async () => { calls.push('stop'); }; } };
  return { run, calls, source };
}
test('migration verifies recovery point, migrates offline, captures hourly and closes source', async () => {
  const h = harness();
  const result = await runBackedUpMigration(input, h.run, h.source, () => now);
  assert.deepEqual(h.calls, ['before', 'migration', 'start', 'after', 'stop']);
  assert.equal(result.backup.after.kind, 'hourly');
});
test('migration refuses without stopped-app confirmation', async () => {
  const h = harness();
  await assert.rejects(runBackedUpMigration({ ...input, confirmAppStopped: false }, h.run, h.source, () => now), /Stop the app/);
  assert.deepEqual(h.calls, []);
});
for (const change of [{ startedAt: new Date(now - 3600001).toISOString() }, { sourceApp: 'rehearsal' },
  { sourceRevision: input.sourceRevision }, {releaseId: 'wrong'}, {kind: 'hourly'}, {id: 'other'}, {startedAt: 'invalid'}]) {
  test(`migration refuses wrong or stale recovery point ${JSON.stringify(change)}`, async () => {
    const h = harness(undefined, change);
    await assert.rejects(runBackedUpMigration(input, h.run, h.source, () => now), /retained verified pre-release/);
    assert.deepEqual(h.calls, ['before']);
  });
}
for (const failure of ['before', 'migration', 'start', 'after'] as const) {
  test(`migration fails closed at ${failure}`, async () => {
    const h = harness(failure);
    await assert.rejects(runBackedUpMigration(input, h.run, h.source, () => now), ['after', 'start'].includes(failure) ? /may have committed/ : /simulated failure/);
    assert.deepEqual(h.calls, failure === 'before' ? ['before'] : failure === 'migration' ? ['before', 'migration'] : failure === 'start' ? ['before', 'migration', 'start'] : ['before', 'migration', 'start', 'after', 'stop']);
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
