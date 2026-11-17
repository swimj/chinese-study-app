import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runReplicatedMigration } from '../scripts/lib/hosted-migration.ts';
import type { CommandRunner } from '../scripts/lib/hosted-upgrade.ts';

const input = { databasePath: '/data/app.db', socketPath: '/data/litestream.sock', confirmAppStopped: true };
function harness(failure?: 'before' | 'migration' | 'after') {
  const calls: string[] = [];
  const run: CommandRunner = async (file) => {
    const stage = file === 'litestream' ? calls.length === 0 ? 'before' : 'after' : 'migration';
    calls.push(stage);
    if (stage === failure) throw new Error('simulated failure');
    return { stdout: JSON.stringify(stage === 'migration' ? { appliedThisRun: ['migration'], pending: [] }
      : { db_path: '/data/app.db', txid: stage === 'before' ? 10 : 11, replica_txid: stage === 'before' ? 10 : 11 }), stderr: '' };
  };
  return { run, calls };
}
test('migration waits for WAL attachment and then verifies the committed backup', async () => {
  const h = harness();
  const result = await runReplicatedMigration(input, h.run);
  assert.deepEqual(h.calls, ['before', 'migration', 'after']);
  assert.equal(result.replication.after.txid, 11);
});
test('migration refuses without the stopped-app confirmation', async () => {
  const h = harness();
  await assert.rejects(runReplicatedMigration({ ...input, confirmAppStopped: false }, h.run), /Stop the app/);
  assert.deepEqual(h.calls, []);
});
for (const failure of ['before', 'migration', 'after'] as const) {
  test(`migration fails closed at ${failure}`, async () => {
    const h = harness(failure);
    await assert.rejects(runReplicatedMigration(input, h.run), failure === 'after' ? /may have committed/ : /simulated failure/);
    assert.deepEqual(h.calls, failure === 'before' ? ['before'] : failure === 'migration' ? ['before', 'migration'] : ['before', 'migration', 'after']);
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
