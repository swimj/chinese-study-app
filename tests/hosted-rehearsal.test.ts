import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareRehearsal, operateRehearsal, type PrepareRehearsalInput } from '../scripts/lib/hosted-rehearsal.ts';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rehearsal-test-'));
  const env = path.join(root, 'backup.env');
  fs.writeFileSync(env, 'LITESTREAM_ACCESS_KEY_ID=source-id\nLITESTREAM_SECRET_ACCESS_KEY=private-secret\nLITESTREAM_BUCKET=backup\nLITESTREAM_REGION=us-east-1\nCLERK_SECRET_KEY=must-not-transfer\n');
  const input: PrepareRehearsalInput = { app: 'app-rehearsal', sourceApp: 'app-beta', image: `registry.fly.io/app-beta@sha256:${'a'.repeat(64)}`, schema: 'migrate', runDir: path.join(root, 'run'), sourceBackupEnvFile: env };
  let machines: Record<string, unknown>[] = [];
  let volumes: Record<string, unknown>[] = [];
  let pending = ['0061-test'];
  let failMachine = false;
  let secrets = false;
  let failMigration = false;
  const commands: string[][] = [];
  const deps = { now: () => new Date('2026-10-29T00:00:00Z'), emit: (_event: unknown) => {},
    run: async (_file: string, args: readonly string[]) => {
      commands.push([...args]);
      let out: unknown = {};
      if (args[1] === 'list') out = args[0] === 'machines' ? machines : args[0] === 'volumes' ? volumes : secrets ? [{ name: 'SECRET' }] : [];
      if (args[0] === 'volumes' && args[1] === 'create') volumes = [{ id: 'vol_123', name: args[2] }];
      if (args[0] === 'machine' && args[1] === 'run') {
        const name = args[args.indexOf('--name') + 1];
        machines = [{ id: 'machine123', name, state: 'started', config: { metadata: { rehearsal_run: name } } }];
        if (failMachine) throw new Error('transport disconnected after successful create');
      }
      if (args[0] === 'machine' && args[1] === 'destroy') machines = [];
      if (args[0] === 'volumes' && args[1] === 'destroy') volumes = [];
      if (args.includes('put') && args.at(-1) === '/tmp/rehearsal-source.env') {
        const content = fs.readFileSync(args.at(-2)!, 'utf8');
        assert.ok(content.includes('private-secret'));
        assert.ok(!content.includes('must-not-transfer'));
      }
      const command = args.at(-1) ?? '';
      if (command.includes('litestream restore')) out = { integrity_check: 'full', txid: 'test-txid' };
      if (command.includes('db:migrate')) {
        if (command.includes('confirm-app-stopped') && failMigration) throw new Error('migration lost transport; verify remote process');
        if (command.includes('confirm-app-stopped')) pending = [];
        out = { pending, appliedThisRun: [] };
      }
      return { stdout: JSON.stringify(out), stderr: '' };
    } };
  return { root, input, deps, commands, clean: () => fs.rmSync(root, { recursive: true }), failMigration: () => { failMigration = true; }, failMachine: () => { failMachine = true; }, secrets: () => { secrets = true; }, unchanged: () => { pending = []; input.schema = 'unchanged'; } };
}

test('rehearsal restores isolated digest Machine, accepts pre/post checks, migrates, and destroys both resources', async () => {
  const f = fixture();
  try {
    const m = await prepareRehearsal(f.input, f.deps);
    assert.equal(m.state, 'restored');
    assert.equal(m.vmSize, 'performance-1x');
    assert.ok(!f.commands.some(args => args.at(-1)?.includes('confirm-app-stopped')));
    const script = path.join(f.root, 'check.sh'); fs.writeFileSync(script, 'test -f /data/app.db\n');
    await operateRehearsal('check', f.input.runDir, f.deps, script);
    await operateRehearsal('migrate', f.input.runDir, f.deps);
    await operateRehearsal('check', f.input.runDir, f.deps, script);
    await operateRehearsal('status', f.input.runDir, f.deps);
    await operateRehearsal('destroy', f.input.runDir, f.deps);
    await operateRehearsal('destroy', f.input.runDir, f.deps);
    assert.equal(f.commands.filter(args => args[1] === 'destroy').length, 2);
    assert.ok(f.commands.filter(args => args[1] === 'destroy').every(args => args.includes('app-rehearsal')));
    const evidence = fs.readFileSync(path.join(f.input.runDir, 'events.jsonl'), 'utf8');
    assert.ok(evidence.includes('elapsedMs'));
    assert.ok(!evidence.includes('private-secret'));
    assert.ok(!f.commands.flat().join(' ').includes('private-secret'));
    const config = JSON.parse(fs.readFileSync(path.join(f.input.runDir, 'machine.json'), 'utf8'));
    assert.deepEqual(config.services, []);
    assert.deepEqual(config.init.exec, ['/bin/sleep', 'infinity']);
  } finally { f.clean(); }
});

test('preserves the release tag alongside the immutable digest for Fly image resolution', async () => {
  const f = fixture();
  try {
    f.input.image = f.input.image.replace('@sha256:', ':release-e960db93@sha256:');
    await prepareRehearsal(f.input, f.deps);
    assert.equal(f.commands.find(args => args[0] === 'machine' && args[1] === 'run')?.[2], f.input.image);
  } finally { f.clean(); }
});

test('failed create is recovered by recorded unique names for explicit cleanup', async () => {
  const f = fixture();
  try {
    f.failMachine();
    await assert.rejects(prepareRehearsal(f.input, f.deps), /create-machine failed/);
    await operateRehearsal('destroy', f.input.runDir, f.deps);
    assert.equal(f.commands.filter(args => args[1] === 'destroy').length, 2);
  } finally { f.clean(); }
});

test('rejects production target, mutable images, and existing apps with secrets', async () => {
  const f = fixture();
  try {
    await assert.rejects(prepareRehearsal({ ...f.input, app: f.input.sourceApp }, f.deps), /distinct/);
    await assert.rejects(prepareRehearsal({ ...f.input, image: 'registry.fly.io/app:latest' }, f.deps), /immutable/);
    f.secrets();
    await assert.rejects(prepareRehearsal(f.input, f.deps), /preflight failed/);
    assert.ok(!f.commands.some(args => args[1] === 'create' || args[1] === 'run'));
  } finally { f.clean(); }
});

test('unchanged declaration refuses pending migrations; unchanged rehearsal cannot migrate', async () => {
  const f = fixture();
  try {
    await assert.rejects(prepareRehearsal({ ...f.input, schema: 'unchanged' }, f.deps), /schema-status failed/);
  } finally { f.clean(); }
  const g = fixture();
  try {
    g.unchanged();
    await prepareRehearsal(g.input, g.deps);
    await assert.rejects(operateRehearsal('migrate', g.input.runDir, g.deps), /migrate failed/);
    assert.ok(!g.commands.some(args => args.at(-1)?.includes('confirm-app-stopped')));
  } finally { g.clean(); }
});

test('operation lock rejects overlap; uncertain migrations cannot be retried and retain diagnostics', async () => {
  const f = fixture();
  try {
    await prepareRehearsal(f.input, f.deps);
    const lock = path.join(f.input.runDir, 'operation.lock');
    fs.writeFileSync(lock, '{}');
    await operateRehearsal('status', f.input.runDir, f.deps);
    await assert.rejects(operateRehearsal('destroy', f.input.runDir, f.deps), /EEXIST/);
    assert.ok(!f.commands.some(args => args[1] === 'destroy'));
    fs.unlinkSync(lock);
    f.failMigration();
    await assert.rejects(operateRehearsal('migrate', f.input.runDir, f.deps), /lost transport/);
    await assert.rejects(operateRehearsal('migrate', f.input.runDir, f.deps), /not ready/);
    assert.equal(f.commands.filter(args => args.at(-1)?.includes('confirm-app-stopped')).length, 1);
    assert.ok(fs.readFileSync(path.join(f.input.runDir, 'events.jsonl'), 'utf8').includes('lost transport'));
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.input.runDir, 'manifest.json'), 'utf8')).state, 'migrating');
    assert.ok(!fs.existsSync(path.join(f.input.runDir, 'manifest.json.tmp')));
    await operateRehearsal('destroy', f.input.runDir, f.deps);
  } finally { f.clean(); }
});
