import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assertPersistedControls,
  assertReleaseIdentityMatch,
  assertServedFrontend,
  createDefaultHostedUpgradeDeps,
  flyCommandEnv,
  HOSTED_IMAGE_SOURCE_PATHS,
  imageSourcePathsFromGitStatus,
  inspectHostedService,
  matchTomlAssignment,
  parseFlyMachinesList,
  parseHostedCommandJson,
  pollHealthz,
  readFlyDeploymentIdentity,
  readPackageVersion,
  readPreparedFlyConfig,
  requireFullGitSha,
  setHostedControl,
  shellSingleQuote,
  ssh,
  type FlyDeploymentIdentity,
  type HostedUpgradeDeps,
  type PlannedReleaseIdentity,
} from './hosted-upgrade.ts';
import { isRecord, parseJsonValue, sanitizeHostedOutput } from './hosted-json.ts';

export const DEFAULT_RC_FLY_CONFIG_PATH = 'deploy/fly/.generated/rc.fly.toml';
export const DEFAULT_RESTORE_AGE_HOURS = 24;
export const RC_DEPLOYMENT_TIER = 'release_candidate';
export const RC_REPLICA_ROOT = 'chinese-study-app/hosted-rc';

export type HostedRcSchemaMode = 'unchanged' | 'migrate';

export type HostedRcDeployInput = {
  repoRoot: string;
  app: string;
  actorId: string;
  confirmSourceRevision: string;
  confirmDisposableRcData: boolean;
  schemaMode: HostedRcSchemaMode;
  sourceBackupEnvFile: string;
  restoreAgeHours?: number;
  activateAfterPrepare?: boolean;
  flyConfigPath?: string;
};

export type HostedRcResult = {
  type: 'rc-deploy-result';
  status: 'ok' | 'failed';
  app: string;
  operator: string;
  schemaMode: HostedRcSchemaMode;
  sourceRevision: string | null;
  candidateImage: string | null;
  immutableImage: string | null;
  restoreRequestedAt: string | null;
  rcReplicaPath: string | null;
  machine: FlyDeploymentIdentity | null;
  stages: Array<{ stage: string; status: 'ok' | 'failed'; at: string; detail?: unknown }>;
  failedStage: string | null;
  failure: string | null;
  activated: boolean;
};

type RcFlyConfig = ReturnType<typeof readPreparedFlyConfig> & {
  deploymentTier: string;
  targetBucket: string;
  allowedUsers: string;
};

type SourceBackupCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string | null;
  bucket: string;
  region: string;
  replicaPath: string;
};

export async function runHostedRcDeploy(
  input: HostedRcDeployInput,
  deps: HostedUpgradeDeps,
): Promise<HostedRcResult> {
  const stages: HostedRcResult['stages'] = [];
  let currentStage = 'declare';
  let sourceRevision: string | null = null;
  let candidateImage: string | null = null;
  let immutableImage: string | null = null;
  let restoreRequestedAt: string | null = null;
  let rcReplicaPath: string | null = null;
  let machine: FlyDeploymentIdentity | null = null;
  let activated = false;
  let restoreCredentialPath: string | null = null;
  let remoteRestoreCredentialPath: string | null = null;
  let restoreMachineId: string | null = null;
  const configPath = path.resolve(input.repoRoot, input.flyConfigPath ?? DEFAULT_RC_FLY_CONFIG_PATH);

  const record = (stage: string, status: 'ok' | 'failed', detail?: unknown): void => {
    const event = { stage, status, at: deps.now().toISOString(), ...(detail === undefined ? {} : { detail }) };
    stages.push(event);
    deps.emit({ type: 'rc-stage', ...event });
  };
  const finish = (status: 'ok' | 'failed', failure: string | null): HostedRcResult => {
    const result: HostedRcResult = {
      type: 'rc-deploy-result',
      status,
      app: input.app,
      operator: input.actorId,
      schemaMode: input.schemaMode,
      sourceRevision,
      candidateImage,
      immutableImage,
      restoreRequestedAt,
      rcReplicaPath,
      machine,
      stages,
      failedStage: status === 'failed' ? currentStage : null,
      failure,
      activated,
    };
    deps.emit(result);
    return result;
  };

  try {
    currentStage = 'declare';
    if (!input.confirmDisposableRcData) {
      throw new Error('RC refresh requires --confirm-disposable-rc-data=true.');
    }
    if (input.schemaMode !== 'unchanged' && input.schemaMode !== 'migrate') {
      throw new Error('--schema must be unchanged or migrate.');
    }
    const actorId = shellSingleQuote(input.actorId);
    sourceRevision = requireFullGitSha(input.confirmSourceRevision);
    const head = requireFullGitSha(deps.gitHead());
    if (head !== sourceRevision) throw new Error(`Checkout HEAD ${head} does not match --confirm-source-revision.`);
    const dirty = imageSourcePathsFromGitStatus(deps.gitStatusPorcelain());
    if (dirty.length > 0) {
      throw new Error(`Checkout has uncommitted image-source changes: ${dirty.join(', ')}.`);
    }
    const flyConfig = readRcFlyConfig(configPath, input.app, deps);
    const source = readSourceBackupCredentials(input.sourceBackupEnvFile, deps);
    if (source.bucket === flyConfig.targetBucket) {
      throw new Error('Production restore source and RC runtime Litestream buckets must differ.');
    }
    const restoreAgeHours = input.restoreAgeHours ?? DEFAULT_RESTORE_AGE_HOURS;
    restoreRequestedAt = calculateRestoreTimestamp(deps.now(), restoreAgeHours);
    const packageVersion = readPackageVersion(input.repoRoot, deps);
    const imageLabel = `rc-${sourceRevision}`;
    candidateImage = `registry.fly.io/${flyConfig.app}:${imageLabel}`;
    const generationId = `${restoreRequestedAt.replace(/[^0-9]/g, '').slice(0, 14)}-${sourceRevision.slice(0, 12)}`;
    rcReplicaPath = `${RC_REPLICA_ROOT}/${generationId}`;
    record('declare', 'ok', {
      plannedRelease: { appVersion: packageVersion, sourceRevision },
      restoreRequestedAt,
      restoreAgeHours,
      schemaMode: input.schemaMode,
      rcReplicaPath,
      imageSourcePaths: HOSTED_IMAGE_SOURCE_PATHS.length,
    });

    currentStage = 'build';
    await deps.run('fly', [
      'deploy',
      '--app', flyConfig.app,
      '--config', flyConfig.configPath,
      '--remote-only',
      '--build-only',
      '--push',
      '--image-label', imageLabel,
      '--build-arg', `APP_REVISION=${sourceRevision}`,
    ], { cwd: input.repoRoot, timeoutMs: 1_200_000, env: flyCommandEnv() });
    record('build', 'ok', { candidateImage });

    currentStage = 'quiesce';
    const inventory = await readRcMachine(input.app, deps);
    if (!inventory.idle) {
      await setHostedControl(input.app, actorId, 'provider-work', false, deps);
      await setHostedControl(input.app, actorId, 'maintenance', true, deps);
      await pollHealthz(flyConfig.publicOrigin, deps, 960_000, (health) => (
        health.maintenanceMode && !health.providerWorkEnabled && health.activeProviderWorkCount === 0
          ? health
          : null
      ), 'RC provider-work drain');
      await ssh(
        input.app,
        'litestream sync -wait -timeout 60 -socket /data/litestream.sock -json /data/app.db',
        deps,
        90_000,
      );
    }
    record('quiesce', 'ok', { alreadyIdle: inventory.idle });

    currentStage = 'idle';
    await deps.run('fly', [
      'machine', 'update',
      '--app', input.app,
      '--image', candidateImage,
      '--command', 'sleep infinity',
      '--skip-health-checks',
      '--wait-timeout', '300',
      '--yes',
      inventory.machineId,
    ], { timeoutMs: 360_000, env: flyCommandEnv() });
    const idled = await readRcMachine(input.app, deps);
    if (!idled.idle) throw new Error('RC Machine did not report the idle command after update.');
    record('idle', 'ok', { machineId: idled.machineId });

    currentStage = 'restore';
    const stagingDir = `/data/rc-restore-${generationId}`;
    const stagingDatabase = `${stagingDir}/app.db`;
    restoreCredentialPath = writeRestoreCredentialFile(source);
    restoreMachineId = idled.machineId;
    remoteRestoreCredentialPath = `/tmp/hosted-rc-restore-${generationId}.env`;
    await deps.run('fly', [
      'ssh', 'sftp', 'put',
      '--app', input.app,
      '--machine', idled.machineId,
      '--user', 'node',
      '--mode', '0600',
      restoreCredentialPath,
      remoteRestoreCredentialPath,
    ], { timeoutMs: 60_000, env: flyCommandEnv() });
    const restoreCommand = [
      'set -eu',
      `trap 'rm -f ${remoteRestoreCredentialPath}' EXIT`,
      `set -a; . ${remoteRestoreCredentialPath}; set +a`,
      `mkdir -p ${stagingDir}`,
      `test ! -e ${stagingDatabase}`,
      `litestream restore -dry-run -json -timestamp ${restoreRequestedAt} -o ${stagingDatabase} \"s3://\${LITESTREAM_BUCKET}/\${LITESTREAM_REPLICA_PATH}\" >/tmp/hosted-rc-restore-plan.json`,
      `litestream restore -json -integrity-check full -timestamp ${restoreRequestedAt} -o ${stagingDatabase} \"s3://\${LITESTREAM_BUCKET}/\${LITESTREAM_REPLICA_PATH}\"`,
      'rm -f /tmp/hosted-rc-restore-plan.json',
    ].join('; ');
    const restored = await runRcSsh(input.app, idled.machineId, restoreCommand, deps, 600_000);
    const restoreSummary = parseHostedCommandJson(restored);
    if (!isRecord(restoreSummary) || restoreSummary.integrity_check !== 'full') {
      throw new Error('Litestream restore did not report a full integrity check.');
    }
    const sourceValidation = parseHostedCommandJson(await runRcSsh(
      input.app,
      idled.machineId,
      `npm run --silent hosted:rc:verify-source -- --database=${stagingDatabase} --minimum-learners=2 --minimum-sentinels=1`,
      deps,
      120_000,
    ));
    if (!isRecord(sourceValidation) || sourceValidation.status !== 'valid-source') {
      throw new Error('RC source validation did not report success.');
    }
    record('restore', 'ok', {
      restoreRequestedAt,
      restoredTxid: typeof restoreSummary.txid === 'string' ? restoreSummary.txid : null,
      learnerCount: sourceValidation.learnerCount ?? null,
      sentinelCount: sourceValidation.sentinelCount ?? null,
    });

    currentStage = 'schema';
    const beforeStatus = parseHostedCommandJson(await runRcSsh(
      input.app,
      idled.machineId,
      `npm run --silent db:migrate -- --database=${stagingDatabase} --status=true`,
      deps,
      120_000,
    ));
    const pendingBefore = readPendingMigrations(beforeStatus);
    if (input.schemaMode === 'unchanged' && pendingBefore.length > 0) {
      throw new Error(`RC release was declared schema-unchanged but has pending migrations: ${pendingBefore.join(', ')}.`);
    }
    if (input.schemaMode === 'migrate' && pendingBefore.length === 0) {
      throw new Error('RC release was declared schema-migrate but the restored database has no pending migrations.');
    }
    let applied: string[] = [];
    if (input.schemaMode === 'migrate') {
      const migration = parseHostedCommandJson(await runRcSsh(
        input.app,
        idled.machineId,
        `npm run --silent db:migrate -- --database=${stagingDatabase} --confirm-app-stopped=true`,
        deps,
        300_000,
      ));
      applied = readStringArrayField(migration, 'appliedThisRun');
      const afterStatus = parseHostedCommandJson(await runRcSsh(
        input.app,
        idled.machineId,
        `npm run --silent db:migrate -- --database=${stagingDatabase} --status=true`,
        deps,
        120_000,
      ));
      if (readPendingMigrations(afterStatus).length > 0) {
        throw new Error('RC database still has pending migrations after migration.');
      }
    }
    const postValidation = parseHostedCommandJson(await runRcSsh(
      input.app,
      idled.machineId,
      `npm run --silent hosted:verify-restore -- --data-dir=${stagingDir} --minimum-learners=2 --minimum-sentinels=1`,
      deps,
      120_000,
    ));
    if (!isRecord(postValidation) || postValidation.status !== 'valid') {
      throw new Error('Post-migration RC restore validation did not report success.');
    }
    record('schema', 'ok', { pendingBefore, applied });

    currentStage = 'promote-database';
    const promotion = parseHostedCommandJson(await runRcSsh(
      input.app,
      idled.machineId,
      `npm run --silent hosted:rc:promote-db -- --data-dir=/data --incoming-db=${stagingDatabase} --confirm-disposable-rc-data=true`,
      deps,
      60_000,
    ));
    if (!isRecord(promotion) || promotion.status !== 'promoted') {
      throw new Error('RC database promotion did not report success.');
    }
    await runRcSsh(
      input.app,
      idled.machineId,
      `npm run --silent hosted:control -- --data-dir=/data --control=provider-work --enabled=false --actor-id=${actorId}`,
      deps,
      30_000,
    );
    await runRcSsh(
      input.app,
      idled.machineId,
      `npm run --silent hosted:control -- --data-dir=/data --control=maintenance --enabled=true --actor-id=${actorId}`,
      deps,
      30_000,
    );
    record('promote-database', 'ok');

    if (input.activateAfterPrepare === false) {
      machine = await readFlyDeploymentIdentity(input.app, deps);
      record('prepared', 'ok', { machineId: machine.machineId, candidateImage, rcReplicaPath });
      return finish('ok', null);
    }

    currentStage = 'activate';
    await deps.run('fly', [
      'deploy',
      '--app', input.app,
      '--config', flyConfig.configPath,
      '--image', candidateImage,
      '--env', `LITESTREAM_REPLICA_PATH=${rcReplicaPath}`,
      '--ha=false',
      '--strategy', 'immediate',
      '--wait-timeout', '5m',
      '--yes',
    ], { cwd: input.repoRoot, timeoutMs: 600_000, env: flyCommandEnv() });
    await pollHealthz(flyConfig.publicOrigin, deps, 180_000, (health) => health.status === 'ok' ? health : null, 'RC health');
    const plannedRelease: PlannedReleaseIdentity = { appVersion: packageVersion, sourceRevision };
    const inspected = await inspectHostedService(input.app, deps);
    assertReleaseIdentityMatch(inspected, plannedRelease);
    assertPersistedControls(inspected, { maintenanceMode: true, providerWorkEnabled: false });
    await assertServedFrontend(flyConfig.publicOrigin, deps);
    const smoke = parseHostedCommandJson(await ssh(
      input.app,
      'npm run --silent hosted:smoke -- --data-dir=/data',
      deps,
      60_000,
    ));
    if (!isRecord(smoke) || smoke.status !== 'ok') throw new Error('RC authenticated smoke failed.');
    machine = await readFlyDeploymentIdentity(input.app, deps);
    immutableImage = toDigestQualifiedImage(machine.imageRef ?? candidateImage, machine.imageDigest);
    await ssh(
      input.app,
      `npm run --silent hosted:banner -- --data-dir=/data --actor-id=${actorId} --message='RELEASE CANDIDATE - disposable copy; changes do not affect beta'`,
      deps,
      30_000,
    );
    await setHostedControl(input.app, actorId, 'maintenance', false, deps);
    await setHostedControl(input.app, actorId, 'provider-work', true, deps);
    const openInspect = await inspectHostedService(input.app, deps);
    assertPersistedControls(openInspect, { maintenanceMode: false, providerWorkEnabled: true });
    activated = true;
    record('activate', 'ok', { machine, immutableImage });
    return finish('ok', null);
  } catch (error) {
    const failure = sanitizeHostedOutput(error instanceof Error ? error.message : 'RC deployment failed.');
    record(currentStage, 'failed', { failure });
    return finish('failed', failure);
  } finally {
    if (remoteRestoreCredentialPath && restoreMachineId) {
      try {
        await runRcSsh(
          input.app,
          restoreMachineId,
          `rm -f ${remoteRestoreCredentialPath}`,
          deps,
          30_000,
        );
      } catch { /* the in-command trap is the primary cleanup */ }
    }
    if (restoreCredentialPath) {
      try { fs.rmSync(path.dirname(restoreCredentialPath), { recursive: true, force: true }); } catch { /* already removed */ }
    }
  }
}

export async function activateHostedRc(input: {
  repoRoot: string;
  app: string;
  actorId: string;
  sourceRevision: string;
  image: string;
  replicaPath: string;
  flyConfigPath: string;
}, deps: HostedUpgradeDeps): Promise<{ machine: FlyDeploymentIdentity; immutableImage: string | null }> {
  const config = readRcFlyConfig(input.flyConfigPath, input.app, deps);
  const sourceRevision = requireFullGitSha(input.sourceRevision);
  if (!/^registry\.fly\.io\/[A-Za-z0-9._/@:-]+$/.test(input.image)) {
    throw new Error('--image must be a registry.fly.io image reference.');
  }
  if (!input.replicaPath.startsWith(`${RC_REPLICA_ROOT}/`) || input.replicaPath.includes('..')) {
    throw new Error(`--replica-path must be a unique child of ${RC_REPLICA_ROOT}.`);
  }
  const inventory = await readRcMachine(input.app, deps);
  if (!inventory.idle) throw new Error('RC Machine must be idle before activation.');
  await deps.run('fly', [
    'deploy', '--app', input.app, '--config', config.configPath, '--image', input.image,
    '--env', `LITESTREAM_REPLICA_PATH=${input.replicaPath}`, '--ha=false', '--strategy', 'immediate',
    '--wait-timeout', '5m', '--yes',
  ], { cwd: input.repoRoot, timeoutMs: 600_000, env: flyCommandEnv() });
  await pollHealthz(config.publicOrigin, deps, 180_000, (health) => health.status === 'ok' ? health : null, 'RC health');
  const inspect = await inspectHostedService(input.app, deps);
  assertReleaseIdentityMatch(inspect, {
    appVersion: readPackageVersion(input.repoRoot, deps),
    sourceRevision,
  });
  assertPersistedControls(inspect, { maintenanceMode: true, providerWorkEnabled: false });
  await assertServedFrontend(config.publicOrigin, deps);
  const smoke = parseHostedCommandJson(await ssh(
    input.app,
    'npm run --silent hosted:smoke -- --data-dir=/data',
    deps,
    60_000,
  ));
  if (!isRecord(smoke) || smoke.status !== 'ok') throw new Error('RC authenticated smoke failed.');
  const actorId = shellSingleQuote(input.actorId);
  await ssh(
    input.app,
    `npm run --silent hosted:banner -- --data-dir=/data --actor-id=${actorId} --message='RELEASE CANDIDATE - disposable copy; changes do not affect beta'`,
    deps,
    30_000,
  );
  await setHostedControl(input.app, actorId, 'maintenance', false, deps);
  await setHostedControl(input.app, actorId, 'provider-work', true, deps);
  const openInspect = await inspectHostedService(input.app, deps);
  assertPersistedControls(openInspect, { maintenanceMode: false, providerWorkEnabled: true });
  const machine = await readFlyDeploymentIdentity(input.app, deps);
  return { machine, immutableImage: toDigestQualifiedImage(machine.imageRef ?? input.image, machine.imageDigest) };
}

export async function quiesceHostedRc(
  app: string,
  actorId: string,
  configPath: string,
  deps: HostedUpgradeDeps,
): Promise<void> {
  const config = readRcFlyConfig(configPath, app, deps);
  const inventory = await readRcMachine(app, deps);
  if (inventory.idle) return;
  const safeActor = shellSingleQuote(actorId);
  await setHostedControl(app, safeActor, 'provider-work', false, deps);
  await setHostedControl(app, safeActor, 'maintenance', true, deps);
  await pollHealthz(config.publicOrigin, deps, 960_000, (health) => (
    health.maintenanceMode && !health.providerWorkEnabled && health.activeProviderWorkCount === 0 ? health : null
  ), 'RC provider-work drain');
  await ssh(app, 'litestream sync -wait -timeout 60 -socket /data/litestream.sock -json /data/app.db', deps, 90_000);
}

export async function idleHostedRc(
  app: string,
  actorId: string,
  configPath: string,
  deps: HostedUpgradeDeps,
): Promise<void> {
  await quiesceHostedRc(app, actorId, configPath, deps);
  const inventory = await readRcMachine(app, deps);
  await deps.run('fly', [
    'machine', 'update', '--app', app, '--command', 'sleep infinity', '--skip-health-checks',
    '--wait-timeout', '300', '--yes', inventory.machineId,
  ], { timeoutMs: 360_000, env: flyCommandEnv() });
}

export async function inspectHostedRc(app: string, configPath: string, deps: HostedUpgradeDeps): Promise<unknown> {
  const config = readRcFlyConfig(configPath, app, deps);
  const inventory = await readRcMachine(app, deps);
  let service: unknown = null;
  if (!inventory.idle && inventory.state === 'started') {
    try { service = await inspectHostedService(app, deps); } catch { service = null; }
  }
  return { app, origin: config.publicOrigin, ...inventory, service };
}

export function readRcFlyConfig(
  configPath: string,
  expectedApp: string,
  deps: Pick<HostedUpgradeDeps, 'fileExists' | 'readFile'>,
): RcFlyConfig {
  const base = readPreparedFlyConfig(configPath, deps);
  if (base.app !== expectedApp) throw new Error(`--app ${expectedApp} does not match RC Fly config app ${base.app}.`);
  const text = deps.readFile(configPath);
  const deploymentTier = matchTomlAssignment(text, 'APP_DEPLOYMENT_TIER') ?? '';
  const targetBucket = matchTomlAssignment(text, 'LITESTREAM_BUCKET') ?? '';
  const allowedUsers = matchTomlAssignment(text, 'APP_ALLOWED_CLERK_USER_IDS') ?? '';
  if (deploymentTier !== RC_DEPLOYMENT_TIER) {
    throw new Error(`RC Fly config must set APP_DEPLOYMENT_TIER=${RC_DEPLOYMENT_TIER}.`);
  }
  if (!targetBucket || targetBucket.includes('REPLACE_WITH')) {
    throw new Error('RC Fly config must set a non-placeholder LITESTREAM_BUCKET.');
  }
  if (!allowedUsers || allowedUsers.includes('REPLACE_WITH')) {
    throw new Error('RC Fly config must set APP_ALLOWED_CLERK_USER_IDS.');
  }
  if (!text.includes('source = "app_data_rc"')) throw new Error('RC Fly config must use the app_data_rc volume.');
  if (!text.includes('auto_stop_machines = "stop"')) throw new Error('RC Fly config must enable Machine auto-stop.');
  return { ...base, deploymentTier, targetBucket, allowedUsers };
}

export function calculateRestoreTimestamp(now: Date, ageHours = DEFAULT_RESTORE_AGE_HOURS): string {
  if (!Number.isFinite(ageHours) || ageHours <= 0) throw new Error('Restore age must be greater than zero.');
  return new Date(now.getTime() - ageHours * 60 * 60 * 1000).toISOString();
}

export function toDigestQualifiedImage(imageRef: string | null, digest: string | null): string | null {
  if (!imageRef || !digest) return null;
  const repository = imageRef.replace(/@sha256:[a-f0-9]+$/i, '').replace(/:[^/:]+$/, '');
  return `${repository}@${digest}`;
}

function readSourceBackupCredentials(
  filePath: string,
  deps: Pick<HostedUpgradeDeps, 'fileExists' | 'readFile'>,
): SourceBackupCredentials {
  if (!path.isAbsolute(filePath)) throw new Error('--source-backup-env-file must be an absolute path.');
  if (!deps.fileExists(filePath)) throw new Error('Production backup source environment file is missing.');
  const values = parseEnvFile(deps.readFile(filePath));
  const required = (name: string): string => {
    const value = values.get(name)?.trim();
    if (!value) throw new Error(`Production backup source environment is missing ${name}.`);
    return value;
  };
  const replicaPath = values.get('LITESTREAM_REPLICA_PATH')?.trim() || 'chinese-study-app/hosted-beta';
  if (!/^[A-Za-z0-9._/-]+$/.test(replicaPath) || replicaPath.includes('..') || replicaPath.startsWith('/')) {
    throw new Error('Production LITESTREAM_REPLICA_PATH is invalid.');
  }
  return {
    accessKeyId: required('LITESTREAM_ACCESS_KEY_ID'),
    secretAccessKey: required('LITESTREAM_SECRET_ACCESS_KEY'),
    sessionToken: values.get('AWS_SESSION_TOKEN')?.trim() || null,
    bucket: required('LITESTREAM_BUCKET'),
    region: required('LITESTREAM_REGION'),
    replicaPath,
  };
}

function parseEnvFile(text: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const normalized = line.startsWith('export ') ? line.slice(7).trim() : line;
    const separator = normalized.indexOf('=');
    if (separator <= 0) throw new Error(`Invalid environment assignment on line ${index + 1}.`);
    const key = normalized.slice(0, separator).trim();
    let value = normalized.slice(separator + 1).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error(`Invalid environment key on line ${index + 1}.`);
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values.set(key, value);
  }
  return values;
}

function writeRestoreCredentialFile(source: SourceBackupCredentials): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hosted-rc-restore-'));
  const filePath = path.join(dir, 'source.env');
  const entries: Array<[string, string]> = [
    ['AWS_ACCESS_KEY_ID', source.accessKeyId],
    ['AWS_SECRET_ACCESS_KEY', source.secretAccessKey],
    ['LITESTREAM_ACCESS_KEY_ID', source.accessKeyId],
    ['LITESTREAM_SECRET_ACCESS_KEY', source.secretAccessKey],
    ['LITESTREAM_BUCKET', source.bucket],
    ['LITESTREAM_REGION', source.region],
    ['LITESTREAM_REPLICA_PATH', source.replicaPath],
  ];
  if (source.sessionToken) entries.push(['AWS_SESSION_TOKEN', source.sessionToken]);
  fs.writeFileSync(filePath, entries.map(([key, value]) => `export ${key}=${quoteShellSecret(value)}`).join('\n') + '\n', {
    mode: 0o600,
  });
  return filePath;
}

function quoteShellSecret(value: string): string {
  if (value.includes('\n') || value.includes('\r') || value.includes('\0')) {
    throw new Error('Backup credential values must be single-line strings.');
  }
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

async function readRcMachine(app: string, deps: HostedUpgradeDeps): Promise<{
  machineId: string;
  state: string | null;
  idle: boolean;
}> {
  const result = await deps.run('fly', ['machines', 'list', '--app', app, '--json'], {
    timeoutMs: 30_000,
    env: flyCommandEnv(),
  });
  const value = parseJsonValue(result.stdout);
  const rows = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.machines) ? value.machines : null;
  if (!rows) throw new Error('Fly machines list did not return an array.');
  const active = rows.filter(isRecord).filter((row) => String(row.state ?? row.State ?? '') !== 'destroyed');
  if (active.length !== 1 || !active[0]) throw new Error(`Expected exactly one RC Fly Machine; found ${active.length}.`);
  const identity = parseFlyMachinesList(result.stdout, deps.now().toISOString());
  const row = active[0];
  const config = isRecord(row.config) ? row.config : null;
  const init = config && isRecord(config.init) ? config.init : null;
  const rawCommand = init?.cmd;
  const command = Array.isArray(rawCommand) ? rawCommand.join(' ') : typeof rawCommand === 'string' ? rawCommand : '';
  return {
    machineId: identity.machineId,
    state: typeof row.state === 'string' ? row.state : typeof row.State === 'string' ? row.State : null,
    idle: command === 'sleep infinity' || command.endsWith('/sleep infinity'),
  };
}

async function runRcSsh(
  app: string,
  machineId: string,
  command: string,
  deps: HostedUpgradeDeps,
  timeoutMs: number,
): Promise<string> {
  const result = await deps.run('fly', [
    'ssh', 'console', '--app', app, '--machine', machineId, '--user', 'node', '--quiet', '--command', command,
  ], { timeoutMs, env: flyCommandEnv() });
  return result.stdout;
}

function readPendingMigrations(value: unknown): string[] {
  return readStringArrayField(value, 'pending');
}

function readStringArrayField(value: unknown, key: string): string[] {
  if (!isRecord(value) || !Array.isArray(value[key]) || !value[key].every((entry) => typeof entry === 'string')) {
    throw new Error(`Expected ${key} string array from hosted command.`);
  }
  return value[key] as string[];
}

export function createDefaultHostedRcDeps(repoRoot: string): HostedUpgradeDeps {
  return createDefaultHostedUpgradeDeps(repoRoot);
}
