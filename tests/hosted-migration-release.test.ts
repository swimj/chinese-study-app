import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { pendingTargetMigrations, runHostedMigrationRelease } from '../scripts/lib/hosted-migration-release.ts';
import type { RehearsalManifest } from '../scripts/lib/hosted-rehearsal.ts';
import type { CommandResult, HostedUpgradeDeps } from '../scripts/lib/hosted-upgrade.ts';

const APP = 'chinese-study-beta-swimj';
const TARGET = 'f'.repeat(40);
const OUTGOING = 'a'.repeat(40);
const DIGEST = `sha256:${'d'.repeat(64)}`;
const OLD_DIGEST = `sha256:${'0'.repeat(64)}`;
const IMAGE = `registry.fly.io/chinese-study-rehearsal:rehearsal-${TARGET}@${DIGEST}`;
const APPLIED = ['app_schema:0000_baseline', 'app_schema:0001_first'];
const PENDING = ['app_schema:0002_second'];
const TARGET_IDS = [...APPLIED, ...PENDING];
const FLY_TOML = `app = "${APP}"\nprimary_region = "sin"\n[env]\n  CLERK_AUTHORIZED_PARTY = "https://${APP}.fly.dev"\n[mounts]\n  destination = "/data"\n[[http_service.checks]]\n  path = "/healthz"\n[[vm]]\n  size = "shared-cpu-1x"\n`;

type Failure = 'migrate' | 'migrate-lost' | 'smoke' | 'post-backup';

function createHarness(options: { failure?: Failure; manifest?: Partial<RehearsalManifest> } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-release-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '3.0.0' }));
  fs.mkdirSync(path.join(root, 'deploy/fly/.generated'), { recursive: true });
  fs.writeFileSync(path.join(root, 'deploy/fly/.generated/fly.toml'), FLY_TOML);
  const runDir = path.join(root, 'rehearsal');
  fs.mkdirSync(runDir);
  const manifest: RehearsalManifest = {
    version: 1, app: 'chinese-study-rehearsal', sourceApp: APP, image: IMAGE, schema: 'migrate',
    name: 'rehearsal-0123456789abcdef0123', volumeName: 'rehearsal_0123456789abcdef0123', machineId: null, volumeId: null,
    region: 'sin', vmSize: 'performance-1x', createdAt: '2026-11-18T00:00:00Z', state: 'destroyed',
    migration: { appliedIds: PENDING, completedAt: '2026-11-18T00:10:00Z' },
    checks: [{ sequence: 1, origin: 'operator', name: 'compare.sh', phase: 'after-migration', status: 'passed', sha256: 'e'.repeat(64), source: '/x', at: '2026-11-18T00:11:00Z' }],
    ...options.manifest,
  };
  fs.writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify(manifest));

  let maintenance = false;
  let providerWork = true;
  let idle = false;
  let digest = OLD_DIGEST;
  let revision = OUTGOING;
  let applied = [...APPLIED];
  let nowMs = Date.parse('2026-11-18T01:00:00Z');
  const steps: string[] = [];
  const commands: string[] = [];

  const machines = () => JSON.stringify([{
    id: 'machine1', state: 'started', version: 3,
    image_ref: { registry: 'registry.fly.io', repository: 'chinese-study-rehearsal', tag: `rehearsal-${TARGET}`, digest },
    config: { image: 'registry.fly.io/chinese-study-rehearsal', ...(idle ? { init: { cmd: ['sleep', 'infinity'] } } : {}) },
  }]);

  const handle = (args: readonly string[]): CommandResult => {
    const out = (value: unknown) => ({ stdout: JSON.stringify(value), stderr: '' });
    if (args[0] === 'machines') return { stdout: machines(), stderr: '' };
    if (args[0] === 'releases') return out([]);
    if (args[0] === 'machine' && args[1] === 'update') {
      steps.push('idle');
      idle = args.includes('sleep infinity');
      digest = args[args.indexOf('--image') + 1]!.split('@')[1]!;
      return out({});
    }
    if (args[0] === 'deploy') {
      steps.push('start');
      idle = false;
      revision = TARGET;
      return out({});
    }
    const command = args[args.indexOf('--command') + 1] ?? '';
    commands.push(command);
    if (command.includes('hosted:inspect')) {
      return out({ releaseIdentity: { appVersion: revision === TARGET ? '3.0.0' : '2.0.0', sourceRevision: revision },
        diagnostics: { controls: { maintenanceMode: maintenance, providerWorkEnabled: providerWork } } });
    }
    if (command.includes('db:migrate') && command.includes('--status=true')) return out({ applied, pending: [] });
    if (command.includes('hosted:control')) {
      const enabled = command.includes('--enabled=true');
      if (command.includes('provider-work')) providerWork = enabled; else maintenance = enabled;
      steps.push(`${command.includes('provider-work') ? 'provider-work' : 'maintenance'}:${enabled}`);
      return out({ status: 'updated' });
    }
    if (command.includes('hosted:banner')) return out({ status: 'noop' });
    if (command.includes('manage-hosted-backup.ts --action=create')) {
      const kind = /--kind=(\w+)/.exec(command)![1]!;
      steps.push(kind === 'release' ? 'backup' : 'post-backup');
      if (kind !== 'release' && options.failure === 'post-backup') throw new Error('receiver unavailable');
      const id = /--id=([\w-]+)/.exec(command)![1]!;
      const at = new Date(nowMs).toISOString();
      return out({ version: 1, id, kind, releaseId: /--release-id=([\w-]+)/.exec(command)?.[1], sourceApp: APP,
        sourceRevision: /--source-revision=(\w+)/.exec(command)![1], startedAt: at, completedAt: at, receivedAt: at,
        bytes: 4096, sha256: 'a'.repeat(64), fileName: `${id}.sqlite` });
    }
    if (command.includes('migrate-with-litestream.sh')) {
      steps.push('migrate');
      assert.ok(idle, 'migration must run on the idle Machine');
      if (options.failure === 'migrate-lost') throw new Error('ssh session lost');
      if (options.failure === 'migrate') throw new Error('Foreign key check failed');
      applied = [...TARGET_IDS];
      return out({ migration: { appliedThisRun: PENDING, applied, pending: [] }, backup: { before: {} } });
    }
    if (command.includes('hosted:smoke')) {
      steps.push('smoke');
      return out(options.failure === 'smoke' ? { status: 'failed', failure: 'unexpected payload' } : { status: 'ok', httpStatus: 200 });
    }
    throw new Error(`unexpected command ${args.join(' ')}`);
  };

  const deps: HostedUpgradeDeps = {
    now: () => new Date(nowMs),
    sleep: async () => { nowMs += 2000; },
    readFile: (file) => fs.readFileSync(file, 'utf8'),
    fileExists: (file) => fs.existsSync(file),
    gitHead: () => TARGET,
    gitStatusPorcelain: () => '',
    run: async (_file, args) => handle(args),
    fetch: async (url) => String(url).endsWith('/healthz')
      ? new Response(JSON.stringify({ status: 'ok', maintenanceMode: maintenance, providerWorkEnabled: providerWork, activeProviderWorkCount: 0 }))
      : new Response('<div id="root"></div>', { headers: { 'content-type': 'text/html' } }),
    emit: () => {},
  };
  const input = {
    repoRoot: root, app: APP, actorId: 'operator', confirmSourceRevision: TARGET,
    targetSchemaMigrationIds: TARGET_IDS, image: IMAGE, rehearsalRunDir: runDir,
  };
  return { input, deps, steps, commands, clean: () => fs.rmSync(root, { recursive: true, force: true }) };
}

describe('hosted migration release', () => {
  test('runs quiesce, backup, idle, migrate, start, confirm, smoke, reopen, then an online post-release backup', async () => {
    const h = createHarness();
    try {
      const result = await runHostedMigrationRelease(h.input, h.deps);
      assert.equal(result.status, 'ok', result.failure ?? '');
      assert.deepEqual(h.steps, [
        'provider-work:false', 'maintenance:true', 'backup', 'idle', 'migrate', 'start', 'smoke',
        'maintenance:false', 'provider-work:true', 'post-backup',
      ]);
      assert.equal(result.databaseState, 'migrated');
      assert.equal(result.reopened, true);
      assert.deepEqual(result.pendingMigrations, PENDING);
      assert.equal(result.previousDeployment?.imageDigest, OLD_DIGEST);
      const wrapper = h.commands.find((command) => command.includes('migrate-with-litestream.sh'))!;
      const receipt = result.preReleaseBackup as { id: string; releaseId: string };
      assert.ok(wrapper.includes(`--pre-release-backup-id=${receipt.id}`));
      assert.ok(wrapper.includes(`--release-id=${receipt.releaseId}`));
      assert.ok(wrapper.includes(`--previous-revision=${OUTGOING}`));
    } finally { h.clean(); }
  });

  for (const [label, manifest, pattern] of [
    ['a different image digest', { image: `registry.fly.io/x:tag@sha256:${'b'.repeat(64)}` }, /digest/],
    ['a rehearsal of a different source app', { sourceApp: 'other-app' }, /restored other-app/],
    ['no successful migration', { migration: undefined }, /no successful migration/],
    ['different migrations', { migration: { appliedIds: ['app_schema:0003_other'], completedAt: 'x' } }, /pending/],
    ['a failed check', { checks: [{ sequence: 1, origin: 'author', name: 'x.rehearsal.sh', phase: 'after-migration', status: 'failed', sha256: '', source: '', at: '' }] }, /did not pass/],
  ] as const) {
    test(`refuses before touching production when the rehearsal has ${label}`, async () => {
      const h = createHarness({ manifest: manifest as Partial<RehearsalManifest> });
      try {
        const result = await runHostedMigrationRelease(h.input, h.deps);
        assert.equal(result.failedStage, 'declare');
        assert.match(result.failure ?? '', pattern);
        assert.deepEqual(h.steps, []);
      } finally { h.clean(); }
    });
  }

  test('a failed migration leaves the database unknown, the Machine idle, and the service closed', async () => {
    for (const failure of ['migrate', 'migrate-lost'] as const) {
      const h = createHarness({ failure });
      try {
        const result = await runHostedMigrationRelease(h.input, h.deps);
        assert.equal(result.failedStage, 'migrate');
        assert.equal(result.databaseState, 'unknown');
        assert.equal(result.reopened, false);
        assert.ok(result.preReleaseBackup);
        assert.deepEqual(h.steps, ['provider-work:false', 'maintenance:true', 'backup', 'idle', 'migrate']);
      } finally { h.clean(); }
    }
  });

  test('a smoke failure after migrating stays closed and reports the migrated database', async () => {
    const h = createHarness({ failure: 'smoke' });
    try {
      const result = await runHostedMigrationRelease(h.input, h.deps);
      assert.equal(result.failedStage, 'smoke');
      assert.equal(result.databaseState, 'migrated');
      assert.equal(result.reopened, false);
      assert.ok(!h.steps.includes('maintenance:false'));
    } finally { h.clean(); }
  });

  test('reopen=false stops after smoke and still captures the post-release backup', async () => {
    const h = createHarness();
    try {
      const result = await runHostedMigrationRelease({ ...h.input, reopen: false }, h.deps);
      assert.equal(result.status, 'ok');
      assert.equal(result.reopened, false);
      assert.deepEqual(h.steps.slice(-2), ['smoke', 'post-backup']);
    } finally { h.clean(); }
  });

  test('a post-release backup failure is reported after the service reopened', async () => {
    const h = createHarness({ failure: 'post-backup' });
    try {
      const result = await runHostedMigrationRelease(h.input, h.deps);
      assert.equal(result.status, 'failed');
      assert.equal(result.failedStage, 'post-backup');
      assert.equal(result.reopened, true);
    } finally { h.clean(); }
  });

  test('requires the rehearsed image and a target that extends the production ledger', async () => {
    const h = createHarness();
    try {
      const noImage = await runHostedMigrationRelease({ ...h.input, image: undefined as unknown as string }, h.deps);
      assert.match(noImage.failure ?? '', /requires --image/);
      assert.deepEqual(h.steps, []);
    } finally { h.clean(); }
    assert.deepEqual(pendingTargetMigrations(APPLIED, TARGET_IDS), PENDING);
    assert.throws(() => pendingTargetMigrations(TARGET_IDS, TARGET_IDS), /code-only release/);
    assert.throws(() => pendingTargetMigrations(['app_schema:0000_baseline', 'app_schema:0001_other'], TARGET_IDS), /not a prefix/);
  });
});
