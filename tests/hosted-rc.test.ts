import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import {
  calculateRestoreTimestamp,
  readRcFlyConfig,
  runHostedRcDeploy,
  toDigestQualifiedImage,
} from '../scripts/lib/hosted-rc.ts';
import type { CommandResult, HostedUpgradeDeps } from '../scripts/lib/hosted-upgrade.ts';

const APP = 'chinese-study-rc-test';
const SOURCE_REVISION = '1234567890abcdef1234567890abcdef12345678';
const CONFIG = `
app = "${APP}"
primary_region = "sin"
[env]
  APP_DEPLOYMENT_TIER = "release_candidate"
  APP_ALLOWED_CLERK_USER_IDS = "user_manual,user_smoke"
  CLERK_AUTHORIZED_PARTY = "https://${APP}.fly.dev"
  LITESTREAM_BUCKET = "rc-backups"
[mounts]
  source = "app_data_rc"
  destination = "/data"
[http_service]
  auto_stop_machines = "stop"
  [[http_service.checks]]
    path = "/healthz"
[[vm]]
  size = "shared-cpu-1x"
`;

describe('hosted release candidate workflow', () => {
  test('computes the default point in time and immutable image reference deterministically', () => {
    assert.equal(
      calculateRestoreTimestamp(new Date('2026-09-20T12:30:00.000Z')),
      '2026-09-19T12:30:00.000Z',
    );
    assert.equal(
      toDigestQualifiedImage(`registry.fly.io/${APP}:rc-${SOURCE_REVISION}`, 'sha256:abc123'),
      `registry.fly.io/${APP}@sha256:abc123`,
    );
  });

  test('requires an explicitly isolated RC config before mutation', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hosted-rc-config-'));
    const configPath = path.join(root, 'fly.toml');
    fs.writeFileSync(configPath, CONFIG);
    const deps = {
      fileExists: fs.existsSync,
      readFile: (filePath: string) => fs.readFileSync(filePath, 'utf8'),
    };
    assert.equal(readRcFlyConfig(configPath, APP, deps).targetBucket, 'rc-backups');
    fs.writeFileSync(configPath, CONFIG.replace('release_candidate', 'beta'));
    assert.throws(() => readRcFlyConfig(configPath, APP, deps), /APP_DEPLOYMENT_TIER=release_candidate/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('restores and activates a schema-unchanged candidate in strict order', async () => {
    const harness = createHarness('unchanged');
    const result = await runHostedRcDeploy(harness.input, harness.deps);
    assert.equal(result.status, 'ok', result.failure ?? '');
    assert.equal(result.restoreRequestedAt, '2026-09-19T12:30:00.000Z');
    assert.equal(result.activated, true);
    assert.equal(result.immutableImage, `registry.fly.io/${APP}@sha256:rc123`);
    assert.deepEqual(result.stages.map((stage) => `${stage.stage}:${stage.status}`), [
      'declare:ok',
      'build:ok',
      'quiesce:ok',
      'idle:ok',
      'restore:ok',
      'schema:ok',
      'promote-database:ok',
      'activate:ok',
    ]);
    assert.ok(harness.events.indexOf('control:provider-work:false') < harness.events.indexOf('control:maintenance:true'));
    assert.ok(harness.events.indexOf('machine:idle') < harness.events.indexOf('restore'));
    assert.ok(harness.events.indexOf('restore') < harness.events.indexOf('database:promote'));
    assert.ok(harness.events.indexOf('database:promote') < harness.events.indexOf('deploy:activate'));
    assert.equal(harness.events.includes('migration:apply'), false);
    assert.equal(JSON.stringify(result).includes('prod-secret'), false);
    harness.cleanup();
  });

  test('applies a declared schema migration while idle before normal startup', async () => {
    const harness = createHarness('migrate');
    const result = await runHostedRcDeploy(harness.input, harness.deps);
    assert.equal(result.status, 'ok', result.failure ?? '');
    assert.ok(harness.events.indexOf('machine:idle') < harness.events.indexOf('migration:apply'));
    assert.ok(harness.events.indexOf('migration:apply') < harness.events.indexOf('deploy:activate'));
    harness.cleanup();
  });

  test('fails closed when an app-only candidate contains a pending migration', async () => {
    const harness = createHarness('unchanged', true);
    const result = await runHostedRcDeploy(harness.input, harness.deps);
    assert.equal(result.status, 'failed');
    assert.equal(result.failedStage, 'schema');
    assert.match(result.failure ?? '', /declared schema-unchanged/);
    assert.equal(result.activated, false);
    assert.equal(harness.events.includes('deploy:activate'), false);
    harness.cleanup();
  });
});

function createHarness(schemaMode: 'unchanged' | 'migrate', forcePending = false) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hosted-rc-repo-'));
  fs.writeFileSync(path.join(repoRoot, 'package.json'), JSON.stringify({ version: '2.3.0' }));
  const configPath = path.join(repoRoot, 'deploy/fly/.generated/rc.fly.toml');
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, CONFIG);
  const sourceEnv = path.join(repoRoot, 'source.env');
  fs.writeFileSync(sourceEnv, [
    'LITESTREAM_ACCESS_KEY_ID=prod-reader',
    'LITESTREAM_SECRET_ACCESS_KEY=prod-secret',
    'LITESTREAM_BUCKET=prod-backups',
    'LITESTREAM_REGION=ap-southeast-1',
  ].join('\n'), { mode: 0o600 });

  let idle = false;
  let activated = false;
  let migrated = false;
  let maintenance = false;
  let providerWork = true;
  const events: string[] = [];
  const emitted: unknown[] = [];
  let nowMs = Date.parse('2026-09-20T12:30:00.000Z');

  const deps: HostedUpgradeDeps = {
    now: () => new Date(nowMs),
    sleep: async () => { nowMs += 2_000; },
    readFile: (filePath) => fs.readFileSync(filePath, 'utf8'),
    fileExists: fs.existsSync,
    gitHead: () => SOURCE_REVISION,
    gitStatusPorcelain: () => '',
    run: async (_file, args) => handle(args),
    fetch: async (input) => {
      const url = String(input);
      if (url.endsWith('/healthz')) {
        return jsonResponse(200, {
          status: 'ok',
          maintenanceMode: maintenance,
          providerWorkEnabled: providerWork,
          activeProviderWorkCount: 0,
        });
      }
      return new Response('<!doctype html><div id="root"></div>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    },
    emit: (event) => emitted.push(event),
  };

  function handle(args: readonly string[]): CommandResult {
    if (args[0] === 'deploy' && args.includes('--build-only')) {
      events.push('build');
      return ok();
    }
    if (args[0] === 'deploy' && args.includes('--image')) {
      activated = true;
      idle = false;
      events.push('deploy:activate');
      return ok();
    }
    if (args[0] === 'machine' && args[1] === 'update') {
      idle = true;
      events.push('machine:idle');
      return ok();
    }
    if (args[0] === 'machines') return { stdout: machineJson(), stderr: '' };
    if (args[0] === 'releases') {
      return { stdout: JSON.stringify([{ Version: 9, ImageRef: `registry.fly.io/${APP}:rc-${SOURCE_REVISION}` }]), stderr: '' };
    }
    if (args[0] === 'ssh' && args[1] === 'sftp') return ok();
    const command = args[args.indexOf('--command') + 1] ?? '';
    if (command.includes('hosted:control') && command.includes('provider-work')) {
      providerWork = command.includes('--enabled=true');
      events.push(`control:provider-work:${providerWork}`);
      return json({ status: 'updated' });
    }
    if (command.includes('hosted:control') && command.includes('maintenance')) {
      maintenance = command.includes('--enabled=true');
      events.push(`control:maintenance:${maintenance}`);
      return json({ status: 'updated' });
    }
    if (command.includes('litestream sync')) return json({ status: 'ok' });
    if (command.includes('litestream restore')) {
      events.push('restore');
      return json({ db_path: '/data/staged/app.db', replica: 's3', txid: '0001', integrity_check: 'full' });
    }
    if (command.includes('hosted:rc:verify-source')) {
      return json({ status: 'valid-source', learnerCount: 2, sentinelCount: 3 });
    }
    if (command.includes('db:migrate') && command.includes('--status=true')) {
      const pending = migrated ? [] : (schemaMode === 'migrate' || forcePending ? ['app_schema:9999_test'] : []);
      return json({ database: '/data/staged/app.db', appliedThisRun: [], applied: [], pending });
    }
    if (command.includes('db:migrate') && command.includes('--confirm-app-stopped=true')) {
      migrated = true;
      events.push('migration:apply');
      return json({ appliedThisRun: ['app_schema:9999_test'], applied: ['app_schema:9999_test'], pending: [] });
    }
    if (command.includes('hosted:verify-restore')) return json({ status: 'valid' });
    if (command.includes('hosted:rc:promote-db')) {
      events.push('database:promote');
      return json({ status: 'promoted' });
    }
    if (command.includes('hosted:inspect')) {
      return json({
        status: 'ok',
        releaseIdentity: { appVersion: '2.3.0', sourceRevision: SOURCE_REVISION },
        diagnostics: { controls: { maintenanceMode: maintenance, providerWorkEnabled: providerWork } },
      });
    }
    if (command.includes('hosted:smoke')) return json({ status: 'ok' });
    if (command.includes('hosted:banner')) return json({ status: 'updated' });
    throw new Error(`unexpected command: ${args.join(' ')}`);
  }

  function machineJson(): string {
    return JSON.stringify([{
      id: 'rc-machine-1',
      state: 'started',
      version: 9,
      instance_id: 'rc-instance-1',
      config: {
        image: activated ? `registry.fly.io/${APP}:rc-${SOURCE_REVISION}` : 'registry.fly.io/old:old',
        init: { cmd: idle ? ['sleep', 'infinity'] : [] },
      },
      image_ref: {
        registry: 'registry.fly.io',
        repository: APP,
        tag: `rc-${SOURCE_REVISION}`,
        digest: 'sha256:rc123',
      },
    }]);
  }

  return {
    events,
    emitted,
    input: {
      repoRoot,
      app: APP,
      actorId: 'operator-test',
      confirmSourceRevision: SOURCE_REVISION,
      confirmDisposableRcData: true,
      schemaMode,
      sourceBackupEnvFile: sourceEnv,
      flyConfigPath: configPath,
    },
    deps,
    cleanup: () => fs.rmSync(repoRoot, { recursive: true, force: true }),
  };
}

function ok(): CommandResult {
  return { stdout: '', stderr: '' };
}

function json(value: unknown): CommandResult {
  return { stdout: JSON.stringify(value), stderr: '' };
}

function jsonResponse(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
