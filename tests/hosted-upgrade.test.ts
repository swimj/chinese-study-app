import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import {
  assertConfigKeepsMachineEnv,
  imageSourcePathsFromGitStatus,
  parseFlyMachinesList,
  parseFlyReleases,
  readPreparedFlyConfig,
  readTomlTableKeys,
  runHostedUpgrade,
  type CommandResult,
  type HostedUpgradeDeps,
} from '../scripts/lib/hosted-upgrade.ts';

const SOURCE_REVISION = '0123456789abcdef0123456789abcdef01234567';
const APP = 'chinese-study-beta-swimj';
const FLY_TOML = `
app = "${APP}"
primary_region = "sin"

[build]
  dockerfile = "../../../deploy/fly/Dockerfile"

[env]
  CLERK_AUTHORIZED_PARTY = "https://${APP}.fly.dev"
  PORT = "5174"

[mounts]
  source = "app_data"
  destination = "/data"

[http_service]
  [[http_service.checks]]
    path = "/healthz"

[[vm]]
  size = "shared-cpu-1x"
`;

const BUILT_DIGEST = `sha256:${'b'.repeat(64)}`;

const MACHINE_LIST = JSON.stringify([{
  id: 'd8d123abc',
  state: 'started',
  instance_id: '01HINSTANCE',
  version: 12,
  image_ref: {
    registry: 'registry.fly.io',
    repository: APP,
    tag: 'deployment-01HNEW',
    digest: 'sha256:abc123def456',
  },
  config: { image: `registry.fly.io/${APP}:deployment-01HNEW` },
}]);

const APPLIED_SCHEMA = [
  'app_schema:0000_baseline',
  'app_schema:0001_first_change',
  'app_schema:0002_second_change',
];

const RELEASE_LIST = JSON.stringify([{
  Version: 12,
  Status: 'complete',
  ImageRef: `registry.fly.io/${APP}:deployment-01HNEW`,
}]);

describe('hosted upgrade pipeline', () => {
  test('refuses a mismatched SHA or dirty image sources before mutation', async () => {
    const harness = createHarness();
    const mismatched = await runHostedUpgrade({
      ...harness.input,
      confirmSourceRevision: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    }, harness.deps);
    assert.match(mismatched.failure ?? '', /does not match --confirm-source-revision/);
    assert.equal(harness.mutations.length, 0);

    harness.gitStatus = ' M src/App.tsx\n';
    const dirty = await runHostedUpgrade(harness.input, harness.deps);
    assert.match(dirty.failure ?? '', /uncommitted image-source changes/);
    assert.equal(harness.mutations.length, 0);
  });

  test('refuses a target with pending migrations before any capture or control change', async () => {
    const harness = createHarness();
    const result = await runHostedUpgrade({
      ...harness.input,
      targetSchemaMigrationIds: [...APPLIED_SCHEMA, 'app_schema:0003_next_change'],
    }, harness.deps);
    assert.equal(result.status, 'failed');
    assert.equal(result.failedStage, 'declare');
    assert.match(result.failure ?? '', /pending schema migrations \(app_schema:0003_next_change\).*offline migration procedure/);
    assert.deepEqual(harness.mutations, []);
  });

  test('refuses a target older than the running schema', async () => {
    const harness = createHarness();
    const result = await runHostedUpgrade({
      ...harness.input,
      targetSchemaMigrationIds: APPLIED_SCHEMA.slice(0, 2),
    }, harness.deps);
    assert.equal(result.failedStage, 'declare');
    assert.match(result.failure ?? '', /target is older than the running schema/);
    assert.deepEqual(harness.mutations, []);
  });

  test('refuses a revision that is not on origin/main unless the escape hatch is set', async () => {
    const harness = createHarness();
    harness.onMainline = false;
    const refused = await runHostedUpgrade(harness.input, harness.deps);
    assert.equal(refused.failedStage, 'declare');
    assert.match(refused.failure ?? '', /not on origin\/main/);
    assert.deepEqual(harness.mutations, []);
    const allowed = await runHostedUpgrade({ ...harness.input, allowUnmergedRevision: true }, harness.deps);
    assert.equal(allowed.status, 'ok', allowed.failure ?? '');
    const declare = allowed.stages.find((stage) => stage.stage === 'declare')?.detail as Record<string, unknown>;
    assert.equal(declare.unmergedRevisionAllowed, true);
  });

  test('refuses a config that would drop env the running Machine has, unless each drop is allowed', async () => {
    const harness = createHarness({ machineEnv: ['CLERK_AUTHORIZED_PARTY', 'PORT', 'APP_BACKUP_RECEIVER_URL', 'FLY_PROCESS_GROUP', 'PRIMARY_REGION'] });
    const refused = await runHostedUpgrade(harness.input, harness.deps);
    assert.equal(refused.failedStage, 'declare');
    assert.match(refused.failure ?? '', /would remove env settings the running Machine has: APP_BACKUP_RECEIVER_URL\./);
    assert.deepEqual(harness.mutations, []);
    const allowed = await runHostedUpgrade({ ...harness.input, allowDroppedEnv: ['APP_BACKUP_RECEIVER_URL'] }, harness.deps);
    assert.equal(allowed.status, 'ok', allowed.failure ?? '');
  });

  test('reads [env] keys and ignores Fly-managed names', () => {
    assert.deepEqual(readTomlTableKeys(FLY_TOML, 'env'), ['CLERK_AUTHORIZED_PARTY', 'PORT']);
    assert.doesNotThrow(() => assertConfigKeepsMachineEnv(['PORT'], ['PORT', 'FLY_PROCESS_GROUP', 'PRIMARY_REGION']));
    assert.throws(() => assertConfigKeepsMachineEnv(['PORT'], ['PORT', 'B', 'A']), /: A, B\./);
  });

  test('a failed build leaves the service open and untouched', async () => {
    const harness = createHarness({ buildFailure: true });
    const result = await runHostedUpgrade(harness.input, harness.deps);
    assert.equal(result.failedStage, 'build');
    assert.deepEqual(harness.mutations, ['build']);
  });

  test('builds before the window, backs up online, then quiesces, deploys the built digest, confirms, smokes, and reopens', async () => {
    const harness = createHarness();
    const result = await runHostedUpgrade(harness.input, harness.deps);
    assert.equal(result.status, 'ok', result.failure ?? '');
    assert.equal(result.reopened, true);
    assert.deepEqual(result.plannedRelease, {
      appVersion: '2.3.0',
      sourceRevision: SOURCE_REVISION,
    });
    assert.equal(result.actualBuild?.imageDigest, BUILT_DIGEST);
    assert.equal(result.actualDeployment?.machineId, 'd8d123abc');
    assert.deepEqual(result.stages.map((stage) => `${stage.stage}:${stage.status}`), [
      'declare:ok',
      'build:ok',
      'backup:ok',
      'quiesce:ok',
      'deploy:ok',
      'confirm:ok',
      'smoke:ok',
      'reopen:ok',
    ]);
    assert.deepEqual(harness.mutations, [
      'build',
      'provider-work:false',
      'maintenance:true',
      'deploy',
      'maintenance:false',
      'provider-work:true',
      'banner:clear',
    ]);
    const build = harness.commands.find((command) => command.args[0] === 'deploy' && command.args.includes('--build-only'));
    assert.deepEqual(build?.args.slice(-2), ['--build-arg', `APP_REVISION=${SOURCE_REVISION}`]);
    assert.ok(build?.args.includes(`release-${SOURCE_REVISION}`));
    const deploy = harness.commands.find((command) => command.args[0] === 'deploy' && !command.args.includes('--build-only'));
    assert.deepEqual(deploy?.args.slice(-2), ['--image', `registry.fly.io/${APP}:release-${SOURCE_REVISION}@${BUILT_DIGEST}`]);
    assert.equal(JSON.stringify(harness.events).includes('fly-token'), false);
    assert.equal(JSON.stringify(result).includes('smoke-token'), false);
    assert.equal(JSON.stringify(harness.events).includes('sk_test'), false);
    const backup = result.stages.find(stage => stage.stage === 'backup')?.detail as { source: string; ageSeconds: number; receipt: Record<string, unknown> };
    assert.equal(backup.source, 'scheduled');
    assert.equal(backup.ageSeconds, 3600);
    assert.equal(backup.receipt.kind, 'hourly');
    assert.equal(JSON.stringify(result).includes('secret-bucket'), false);
    assert.equal(result.previousDeployment?.machineId, 'd8d123abc');
  });

  test('--fresh-backup captures an online release backup of the outgoing revision', async () => {
    const harness = createHarness();
    const result = await runHostedUpgrade({ ...harness.input, freshBackup: true }, harness.deps);
    assert.equal(result.status, 'ok', result.failure ?? '');
    assert.deepEqual(harness.mutations.slice(0, 3), ['build', 'backup', 'provider-work:false']);
    const backup = result.stages.find(stage => stage.stage === 'backup')?.detail as { source: string; receipt: Record<string, unknown> };
    assert.equal(backup.source, 'fresh');
    assert.equal(backup.receipt.kind, 'release');
    assert.equal(backup.receipt.sourceRevision, 'a'.repeat(40));
  });

  for (const [label, scheduled, pattern] of [
    ['missing', null, /No scheduled backup is recorded/],
    ['stale', { ageSeconds: 6 * 3600 + 16 * 60 }, /beyond the 22500s limit/],
    ['manual', { captureOrigin: 'manual' }, /does not belong/],
    ['another app', { sourceApp: 'other-app' }, /does not belong/],
  ] as const) {
    test(`a ${label} scheduled backup stops the release before touching the service`, async () => {
      const harness = createHarness({ scheduled });
      const result = await runHostedUpgrade(harness.input, harness.deps);
      assert.equal(result.failedStage, 'backup');
      assert.match(result.failure ?? '', pattern);
      assert.deepEqual(harness.mutations, ['build']);
    });
  }

  for (const backupFailure of ['timeout', 'wrong-revision', 'malformed'] as const) {
    test(`a ${backupFailure} pre-release capture prevents deployment and leaves controls closed`, async () => {
      const harness = createHarness({ backupFailure });
      const result = await runHostedUpgrade({ ...harness.input, freshBackup: true }, harness.deps);
      assert.equal(result.status, 'failed');
      assert.equal(result.failedStage, 'backup');
      assert.equal(result.reopened, false);
      assert.deepEqual(harness.mutations, ['build', 'backup'], 'a failed capture leaves the service open and untouched');
    });
  }

  test('promotes a digest-qualified RC image without rebuilding and confirms its digest', async () => {
    const digest = `sha256:${'a'.repeat(64)}`;
    const harness = createHarness({ imageDigest: digest });
    const image = `registry.fly.io/chinese-study-rc:release-tested@${digest}`;
    const result = await runHostedUpgrade({ ...harness.input, image }, harness.deps);
    assert.equal(result.status, 'ok', result.failure ?? '');
    const deploy = harness.commands.find((command) => command.args[0] === 'deploy');
    assert.ok(deploy?.args.includes('--image'));
    assert.ok(deploy?.args.includes(image));
    assert.equal(deploy?.args.includes('--build-arg'), false);
    assert.equal(harness.mutations.includes('build'), false);
  });

  test('rejects a mutable promotion image before touching Fly', async () => {
    const harness = createHarness();
    const result = await runHostedUpgrade({
      ...harness.input,
      image: `registry.fly.io/chinese-study-rc:latest`,
    }, harness.deps);
    assert.equal(result.status, 'failed');
    assert.equal(result.failedStage, 'declare');
    assert.match(result.failure ?? '', /digest-qualified/);
    assert.equal(harness.mutations.length, 0);
  });

  test('leaves maintenance and provider work disabled after a smoke failure', async () => {
    const harness = createHarness({ smokeStatus: 'failed' });
    const result = await runHostedUpgrade(harness.input, harness.deps);
    assert.equal(result.status, 'failed');
    assert.equal(result.failedStage, 'smoke');
    assert.equal(result.reopened, false);
    assert.deepEqual(harness.mutations, [
      'build',
      'provider-work:false',
      'maintenance:true',
      'deploy',
    ]);
    assert.ok(result.previousDeployment, 'the result names the image to redeploy for rollback');
    assert.equal(harness.mutations.includes('maintenance:false'), false);
    assert.equal(harness.mutations.includes('provider-work:true'), false);
  });

  test('fails confirmation when the running image still reports an unknown revision', async () => {
    const harness = createHarness({ postDeployRevision: 'unknown' });
    const result = await runHostedUpgrade(harness.input, harness.deps);
    assert.equal(result.status, 'failed');
    assert.equal(result.failedStage, 'confirm');
    assert.match(result.failure ?? '', /unknown/);
    assert.equal(result.reopened, false);
  });

  test('parses Fly Machine and release identity without exposing replica URLs', () => {
    const identity = parseFlyMachinesList(MACHINE_LIST, '2026-09-04T00:00:00.000Z');
    assert.equal(identity.machineId, 'd8d123abc');
    assert.equal(identity.imageDigest, 'sha256:abc123def456');
    assert.equal(identity.releaseVersion, 12);
    assert.deepEqual(parseFlyReleases(RELEASE_LIST), {
      version: 12,
      imageRef: `registry.fly.io/${APP}:deployment-01HNEW`,
    });
    assert.deepEqual(imageSourcePathsFromGitStatus(' M notes/README.md\n?? docs/ops/hosted-beta-deployment.md\n'), []);
    assert.deepEqual(imageSourcePathsFromGitStatus(' M server/index.ts\n'), ['server/index.ts']);
  });

  test('requires the prepared Fly config to be a single-machine /data topology', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hosted-upgrade-fly-'));
    const configPath = path.join(tmp, 'fly.toml');
    fs.writeFileSync(configPath, FLY_TOML);
    const config = readPreparedFlyConfig(configPath, {
      fileExists: (filePath) => fs.existsSync(filePath),
      readFile: (filePath) => fs.readFileSync(filePath, 'utf8'),
    });
    assert.equal(config.app, APP);
    assert.equal(config.publicOrigin, `https://${APP}.fly.dev`);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('Dockerfile fails closed unless APP_REVISION is supplied at build time', () => {
    const dockerfile = fs.readFileSync('deploy/fly/Dockerfile', 'utf8');
    assert.match(dockerfile, /ARG APP_REVISION\nRUN test -n "\$APP_REVISION" && test "\$APP_REVISION" != "unknown"/);
    assert.doesNotMatch(dockerfile, /ARG APP_REVISION=unknown/);
  });
});

function createHarness(options: {
  smokeStatus?: 'ok' | 'failed';
  postDeployRevision?: string;
  imageDigest?: string;
  backupFailure?: 'timeout' | 'wrong-revision' | 'malformed';
  scheduled?: { ageSeconds?: number; captureOrigin?: string; sourceApp?: string } | null;
  buildFailure?: boolean;
  machineEnv?: string[];
} = {}) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hosted-upgrade-repo-'));
  fs.writeFileSync(path.join(repoRoot, 'package.json'), JSON.stringify({ version: '2.3.0' }));
  const flyConfigPath = path.join(repoRoot, 'deploy/fly/.generated/fly.toml');
  fs.mkdirSync(path.dirname(flyConfigPath), { recursive: true });
  fs.writeFileSync(flyConfigPath, FLY_TOML);

  let deployed = false;
  let maintenance = false;
  let providerWork = true;
  const mutations: string[] = [];
  const commands: Array<{ file: string; args: readonly string[] }> = [];
  const events: unknown[] = [];
  let nowMs = Date.parse('2026-09-04T07:00:00.000Z');
  const harness = {
    repoRoot,
    gitStatus: '',
    onMainline: true,
    mutations,
    commands,
    events,
    input: {
      repoRoot,
      app: APP,
      actorId: 'operator-test',
      confirmSourceRevision: SOURCE_REVISION,
      targetSchemaMigrationIds: APPLIED_SCHEMA,
      flyConfigPath: 'deploy/fly/.generated/fly.toml',
    },
    deps: null as unknown as HostedUpgradeDeps,
  };

  const inspect = () => inspectJson({
    maintenance,
    providerWork,
    sourceRevision: deployed
      ? (options.postDeployRevision ?? SOURCE_REVISION)
      : 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    appVersion: '2.3.0',
  });

  harness.deps = {
    now: () => new Date(nowMs),
    sleep: async () => {
      nowMs += 2_000;
    },
    readFile: (filePath) => fs.readFileSync(filePath, 'utf8'),
    fileExists: (filePath) => fs.existsSync(filePath),
    gitHead: () => SOURCE_REVISION,
    gitStatusPorcelain: () => harness.gitStatus,
    gitRevisionOnMainline: () => harness.onMainline,
    run: async (file, args) => {
      commands.push({ file, args });
      return handleCommand(args);
    },
    fetch: async (input, init) => {
      const url = String(input);
      if (url.startsWith('https://registry.fly.io/v2/')) {
        assert.equal(init?.method, 'HEAD');
        assert.equal(new Headers(init?.headers).get('authorization'), `Basic ${Buffer.from('x:fly-token').toString('base64')}`);
        return new Response(null, { status: 200, headers: { 'docker-content-digest': BUILT_DIGEST } });
      }
      if (url.endsWith('/healthz')) {
        return jsonResponse(200, {
          status: 'ok',
          maintenanceMode: maintenance,
          providerWorkEnabled: providerWork,
          activeProviderWorkCount: 0,
        });
      }
      if (url.endsWith('/')) {
        return new Response('<!DOCTYPE html><div id="root"></div>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    },
    emit: (event) => {
      events.push(event);
    },
  };

  function handleCommand(args: readonly string[]): CommandResult {
    if (args[0] === 'auth' && args[1] === 'token') return { stdout: 'fly-token\n', stderr: '' };
    if (args[0] === 'deploy' && args.includes('--build-only')) {
      mutations.push('build');
      if (options.buildFailure) throw new Error('remote builder failed');
      return { stdout: '', stderr: '' };
    }
    if (args[0] === 'deploy') {
      deployed = true;
      mutations.push('deploy');
      return { stdout: 'image: registry.fly.io/chinese-study-beta-swimj:deployment-01HNEW\n', stderr: '' };
    }
    if (args[0] === 'machines') {
      return {
        stdout: JSON.stringify(JSON.parse(MACHINE_LIST.replace('sha256:abc123def456', options.imageDigest ?? BUILT_DIGEST)).map(
          (machine: { config: Record<string, unknown> }) => ({ ...machine, config: { ...machine.config, env: Object.fromEntries((options.machineEnv ?? []).map((name) => [name, 'x'])) } }),
        )),
        stderr: '',
      };
    }
    if (args[0] === 'releases') return { stdout: RELEASE_LIST, stderr: '' };
    const command = args[args.indexOf('--command') + 1] ?? '';
    if (command.includes('db:migrate') && command.includes('--status=true')) {
      return { stdout: JSON.stringify({ database: '/data/app.db', appliedThisRun: [], applied: APPLIED_SCHEMA, pending: [] }), stderr: '' };
    }
    if (command.includes('hosted:inspect')) {
      return { stdout: JSON.stringify(inspect(), null, 2), stderr: '' };
    }
    if (command.includes('hosted:control') && command.includes('provider-work')) {
      providerWork = command.includes('--enabled=true');
      mutations.push(`provider-work:${providerWork}`);
      return { stdout: JSON.stringify({ status: 'updated', control: { key: 'provider_work_enabled', enabled: providerWork } }), stderr: '' };
    }
    if (command.includes('hosted:control') && command.includes('maintenance')) {
      maintenance = command.includes('--enabled=true');
      mutations.push(`maintenance:${maintenance}`);
      return { stdout: JSON.stringify({ status: 'updated', control: { key: 'maintenance_mode', enabled: maintenance } }), stderr: '' };
    }
    if (command.includes('hosted:banner') && command.includes('--clear=true')) {
      mutations.push('banner:clear');
      return { stdout: JSON.stringify({ status: 'noop' }), stderr: '' };
    }
    if (command.includes('scripts/manage-hosted-backup.ts') && command.includes('--action=status')) {
      const scheduled = options.scheduled === undefined ? {} : options.scheduled;
      const startedAt = new Date(nowMs - (scheduled?.ageSeconds ?? 3600) * 1000).toISOString();
      return { stdout: JSON.stringify({ lastScheduledBackup: scheduled === null ? null : {
        version: 1, id: 'hourly-scheduled', kind: 'hourly', captureOrigin: scheduled.captureOrigin ?? 'scheduled',
        sourceRevision: 'a'.repeat(40), sourceApp: scheduled.sourceApp ?? APP, startedAt, completedAt: startedAt, receivedAt: startedAt,
        bytes: 4096, sha256: 'c'.repeat(64), fileName: 'hourly-scheduled.sqlite',
      } }), stderr: '' };
    }
    if (command.includes('scripts/manage-hosted-backup.ts')) {
      mutations.push('backup');
      if (options.backupFailure === 'timeout') throw new Error('capture timed out');
      const option = (name: string) => command.match(new RegExp(`--${name}=([^ ]+)`))?.[1]?.replaceAll("'", '');
      const id = option('id');
      const result = options.backupFailure === 'malformed' ? { ok: true } : {
        version: 1, id, kind: option('kind'), releaseId: option('release-id'),
        sourceRevision: options.backupFailure === 'wrong-revision' ? 'b'.repeat(40) : option('source-revision'),
        sourceApp: APP, startedAt: new Date(nowMs).toISOString(), completedAt: new Date(nowMs).toISOString(),
        receivedAt: new Date(nowMs).toISOString(), bytes: 4096, sha256: 'a'.repeat(64), fileName: `${id}.sqlite`,
      };
      return { stdout: JSON.stringify(result), stderr: '' };
    }
    if (command.includes('hosted:smoke')) {
      const status = options.smokeStatus ?? 'ok';
      return {
        stdout: JSON.stringify({
          status,
          endpoint: '/api/vocabulary/statistics',
          httpStatus: status === 'ok' ? 200 : 500,
          sessionRevoked: true,
          failure: status === 'ok' ? null : 'unexpected payload',
        }),
        stderr: '',
      };
    }
    throw new Error(`unexpected command ${args.join(' ')}`);
  }

  return harness;
}

function inspectJson(input: {
  maintenance: boolean;
  providerWork: boolean;
  sourceRevision: string;
  appVersion: string;
}) {
  return {
    status: 'ok',
    releaseIdentity: {
      appVersion: input.appVersion,
      sourceRevision: input.sourceRevision,
      flyAppName: APP,
      flyImageRef: `registry.fly.io/${APP}:deployment-01HNEW`,
      flyMachineId: 'd8d123abc',
      flyMachineVersion: '01HINSTANCE',
      flyRegion: 'sin',
    },
    diagnostics: {
      controls: {
        maintenanceMode: input.maintenance,
        providerWorkEnabled: input.providerWork,
      },
      schemaMigrationCount: 4,
      contentImportCount: 1,
    },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
