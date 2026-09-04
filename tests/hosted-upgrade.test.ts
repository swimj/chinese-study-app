import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import {
  imageSourcePathsFromGitStatus,
  parseFlyMachinesList,
  parseFlyReleases,
  readPreparedFlyConfig,
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

const RELEASE_LIST = JSON.stringify([{
  Version: 12,
  Status: 'complete',
  ImageRef: `registry.fly.io/${APP}:deployment-01HNEW`,
}]);

describe('hosted upgrade pipeline', () => {
  test('refuses a mismatched SHA, dirty image sources, or missing confirmation before mutation', async () => {
    const harness = createHarness();
    const missingConfirm = await runHostedUpgrade({
      ...harness.input,
      confirmEligibleRelease: false,
    }, harness.deps);
    assert.equal(missingConfirm.status, 'failed');
    assert.equal(missingConfirm.failedStage, 'declare');
    assert.equal(harness.mutations.length, 0);

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

  test('drives quiesce, deploy with APP_REVISION, confirm, smoke, and reopen', async () => {
    const harness = createHarness();
    const result = await runHostedUpgrade(harness.input, harness.deps);
    assert.equal(result.status, 'ok', result.failure ?? '');
    assert.equal(result.reopened, true);
    assert.deepEqual(result.plannedRelease, {
      appVersion: '2.3.0',
      sourceRevision: SOURCE_REVISION,
    });
    assert.equal(result.actualBuild?.imageDigest, 'sha256:abc123def456');
    assert.equal(result.actualDeployment?.machineId, 'd8d123abc');
    assert.deepEqual(result.stages.map((stage) => `${stage.stage}:${stage.status}`), [
      'declare:ok',
      'quiesce:ok',
      'backup-sync:ok',
      'build-deploy:ok',
      'confirm:ok',
      'smoke:ok',
      'reopen:ok',
    ]);
    assert.deepEqual(harness.mutations, [
      'provider-work:false',
      'maintenance:true',
      'deploy',
      'maintenance:false',
      'provider-work:true',
    ]);
    const deploy = harness.commands.find((command) => command.args[0] === 'deploy');
    assert.deepEqual(deploy?.args.slice(-2), ['--build-arg', `APP_REVISION=${SOURCE_REVISION}`]);
    assert.equal(JSON.stringify(result).includes('smoke-token'), false);
    assert.equal(JSON.stringify(harness.events).includes('sk_test'), false);
  });

  test('leaves maintenance and provider work disabled after a smoke failure', async () => {
    const harness = createHarness({ smokeStatus: 'failed' });
    const result = await runHostedUpgrade(harness.input, harness.deps);
    assert.equal(result.status, 'failed');
    assert.equal(result.failedStage, 'smoke');
    assert.equal(result.reopened, false);
    assert.deepEqual(harness.mutations, [
      'provider-work:false',
      'maintenance:true',
      'deploy',
    ]);
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
    mutations,
    commands,
    events,
    input: {
      repoRoot,
      app: APP,
      actorId: 'operator-test',
      confirmSourceRevision: SOURCE_REVISION,
      confirmEligibleRelease: true,
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
    run: async (file, args) => {
      commands.push({ file, args });
      return handleCommand(args);
    },
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
    if (args[0] === 'deploy') {
      deployed = true;
      mutations.push('deploy');
      return { stdout: 'image: registry.fly.io/chinese-study-beta-swimj:deployment-01HNEW\n', stderr: '' };
    }
    if (args[0] === 'machines') return { stdout: MACHINE_LIST, stderr: '' };
    if (args[0] === 'releases') return { stdout: RELEASE_LIST, stderr: '' };
    const command = args[args.indexOf('--command') + 1] ?? '';
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
    if (command.includes('litestream sync')) {
      return { stdout: JSON.stringify({ replica: 's3://secret-bucket/secret-prefix', ok: true }), stderr: '' };
    }
    if (command.includes('hosted:smoke')) {
      const status = options.smokeStatus ?? 'ok';
      return {
        stdout: JSON.stringify({
          status,
          endpoint: '/api/session-payload',
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
