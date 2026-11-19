import { randomUUID } from 'node:crypto';
import { parseBackupReceipt } from '../../server/backups/client.ts';
import { isRecord, parseJsonValue, sanitizeHostedOutput } from './hosted-json.ts';
import { assertRehearsalPassed, readRehearsalRecord } from './hosted-rehearsal.ts';
import {
  captureReleaseBackup,
  confirmDeployedRelease,
  declareRelease,
  flyCommandEnv,
  inspectHostedService,
  parseHostedCommandJson,
  quiesceHostedService,
  readAppliedSchemaMigrations,
  readMachineEnvNames,
  assertConfigKeepsMachineEnv,
  readFlyDeploymentIdentity,
  reopenHostedService,
  requireFullGitSha,
  smokeHostedService,
  ssh,
  type FlyDeploymentIdentity,
  type HostedUpgradeDeps,
  type PlannedReleaseIdentity,
} from './hosted-upgrade.ts';

export const HOSTED_MIGRATION_RELEASE_STAGES = [
  'declare',
  'quiesce',
  'backup',
  'idle',
  'migrate',
  'start',
  'confirm',
  'smoke',
  'reopen',
  'post-backup',
] as const;

export type HostedMigrationReleaseStage = (typeof HOSTED_MIGRATION_RELEASE_STAGES)[number];

/** Long enough for a large rewrite; rehearsal timing should predict the real duration. */
export const MIGRATION_TIMEOUT_MS = 60 * 60_000;

export type HostedMigrationReleaseInput = {
  repoRoot: string;
  app: string;
  actorId: string;
  confirmSourceRevision: string;
  targetSchemaMigrationIds: readonly string[];
  /** The digest-qualified image the rehearsal migrated. */
  image: string;
  rehearsalRunDir: string;
  flyConfigPath?: string;
  /** false stops after smoke with the service closed, for checks before the agent reopens it. */
  reopen?: boolean;
  /** Escape hatch, used only with Justin's approval: release a revision not on origin/main. */
  allowUnmergedRevision?: boolean;
  /** Env names the deploy may intentionally remove from the running Machine. */
  allowDroppedEnv?: readonly string[];
};

export type HostedMigrationReleaseResult = {
  type: 'migration-release-result';
  status: 'ok' | 'failed';
  operator: string;
  app: string;
  startedAt: string;
  finishedAt: string;
  plannedRelease: PlannedReleaseIdentity | null;
  pendingMigrations: string[] | null;
  /** The image serving before this run, to restore alongside the pre-release backup. */
  previousDeployment: FlyDeploymentIdentity | null;
  preReleaseBackup: unknown | null;
  /**
   * unchanged: the previous image can serve this database. migrated: it cannot;
   * roll back by restoring preReleaseBackup with previousDeployment. unknown: the
   * migration's outcome was not observed; read db:migrate status before acting.
   */
  databaseState: 'unchanged' | 'unknown' | 'migrated';
  stages: Array<{ type: 'stage'; stage: HostedMigrationReleaseStage; status: 'ok' | 'failed'; at: string; detail?: unknown }>;
  failedStage: HostedMigrationReleaseStage | null;
  failure: string | null;
  reopened: boolean;
};

/**
 * Migration release: verify a passed rehearsal of the same image, close the
 * service, capture the pre-release backup, idle the Machine on the target image,
 * migrate, start the target, verify, smoke, reopen, then capture an online
 * post-release backup. A failure stops where it is and never reopens.
 */
export async function runHostedMigrationRelease(
  input: HostedMigrationReleaseInput,
  deps: HostedUpgradeDeps,
): Promise<HostedMigrationReleaseResult> {
  const startedAt = deps.now().toISOString();
  const stages: HostedMigrationReleaseResult['stages'] = [];
  let currentStage: HostedMigrationReleaseStage = 'declare';
  let plannedRelease: PlannedReleaseIdentity | null = null;
  let pendingMigrations: string[] | null = null;
  let previousDeployment: FlyDeploymentIdentity | null = null;
  let preReleaseBackup: unknown | null = null;
  let databaseState: HostedMigrationReleaseResult['databaseState'] = 'unchanged';
  let reopened = false;

  const record = (stage: HostedMigrationReleaseStage, status: 'ok' | 'failed', detail?: unknown) => {
    const event = { type: 'stage' as const, stage, status, at: deps.now().toISOString(), ...(detail === undefined ? {} : { detail }) };
    stages.push(event);
    deps.emit(event);
  };
  const finish = (status: 'ok' | 'failed', failure: string | null, failedStage: HostedMigrationReleaseStage | null) => {
    const result: HostedMigrationReleaseResult = {
      type: 'migration-release-result', status, operator: input.actorId, app: input.app, startedAt,
      finishedAt: deps.now().toISOString(), plannedRelease, pendingMigrations, previousDeployment, preReleaseBackup,
      databaseState, stages, failedStage, failure, reopened,
    };
    deps.emit(result);
    return result;
  };

  try {
    currentStage = 'declare';
    const declared = declareRelease(input, deps);
    const { actorId, app, flyConfig } = declared;
    plannedRelease = declared.plannedRelease;
    const image = declared.promotedImage;
    if (!image) throw new Error('A migration release requires --image with the rehearsed digest.');
    const inspectBefore = await inspectHostedService(app, deps);
    const oldIdentity = isRecord(inspectBefore.releaseIdentity) ? inspectBefore.releaseIdentity : inspectBefore;
    const outgoingRevision = requireFullGitSha(String(oldIdentity.sourceRevision));
    const applied = await readAppliedSchemaMigrations(app, deps);
    pendingMigrations = pendingTargetMigrations(applied, input.targetSchemaMigrationIds);
    const rehearsal = assertRehearsalPassed(readRehearsalRecord(input.rehearsalRunDir), {
      image, sourceApp: app, pendingIds: pendingMigrations,
    });
    previousDeployment = await readFlyDeploymentIdentity(app, deps);
    // The start stage deploys from the config, replacing the Machine's env.
    assertConfigKeepsMachineEnv(flyConfig.envNames, await readMachineEnvNames(app, deps), input.allowDroppedEnv);
    record('declare', 'ok', { plannedRelease, outgoingRevision, pendingMigrations, previousDeployment, rehearsal });

    currentStage = 'quiesce';
    record('quiesce', 'ok', await quiesceHostedService(app, actorId, flyConfig.publicOrigin, deps));

    currentStage = 'backup';
    // Captured after writes stop: restoring it is this migration's rollback.
    const releaseId = `release-${plannedRelease.sourceRevision.slice(0, 12)}-${randomUUID()}`;
    const receipt = await captureReleaseBackup(app, deps, outgoingRevision, releaseId);
    preReleaseBackup = receipt;
    record('backup', 'ok', receipt);

    currentStage = 'idle';
    await deps.run('fly', [
      'machine', 'update', '--app', app, '--image', image, '--command', 'sleep infinity',
      '--skip-health-checks', '--wait-timeout', '300', '--yes', previousDeployment.machineId,
    ], { timeoutMs: 360_000, env: flyCommandEnv() });
    const idled = await readMachineCommand(app, deps);
    if (!idled.idle) throw new Error('Machine did not report the idle command after update.');
    if (idled.imageDigest !== digestOf(image)) throw new Error('Idle Machine image digest does not match the release image.');
    record('idle', 'ok', idled);

    currentStage = 'migrate';
    databaseState = 'unknown';
    const migration = parseHostedCommandJson(await ssh(app, [
      'sh /app/deploy/fly/migrate-with-litestream.sh --confirm-app-stopped=true',
      `--pre-release-backup-id=${receipt.id}`,
      `--release-id=${releaseId}`,
      `--previous-revision=${outgoingRevision}`,
    ].join(' '), deps, MIGRATION_TIMEOUT_MS));
    const appliedThisRun = isRecord(migration) && isRecord(migration.migration) && Array.isArray(migration.migration.appliedThisRun)
      ? migration.migration.appliedThisRun : null;
    if (!appliedThisRun || appliedThisRun.join('\n') !== pendingMigrations.join('\n')) {
      throw new Error('Migration output does not report exactly the pending migrations as applied; inspect migration status before acting.');
    }
    databaseState = 'migrated';
    record('migrate', 'ok', { appliedThisRun });

    currentStage = 'start';
    await deps.run('fly', [
      'deploy', '--app', app, '--config', flyConfig.configPath, '--image', image,
      '--ha=false', '--strategy', 'immediate', '--wait-timeout', '5m', '--yes',
    ], { cwd: input.repoRoot, timeoutMs: 600_000, env: flyCommandEnv() });
    const deployment = await readFlyDeploymentIdentity(app, deps);
    if (deployment.imageDigest !== digestOf(image)) throw new Error('Started Machine image digest does not match the release image.');
    record('start', 'ok', { deployment });

    currentStage = 'confirm';
    const confirmed = await confirmDeployedRelease(app, flyConfig.publicOrigin, plannedRelease, deployment, deps);
    const appliedAfter = await readAppliedSchemaMigrations(app, deps);
    if (appliedAfter.join('\n') !== input.targetSchemaMigrationIds.join('\n')) {
      throw new Error('Running database does not report exactly the target migrations as applied.');
    }
    record('confirm', 'ok', confirmed);

    currentStage = 'smoke';
    record('smoke', 'ok', await smokeHostedService(app, flyConfig.publicOrigin, deps));

    if (input.reopen !== false) {
      currentStage = 'reopen';
      const reopenedState = await reopenHostedService(app, actorId, deps);
      reopened = true;
      record('reopen', 'ok', { controls: reopenedState.controls, banner: reopenedState.banner });
    }

    currentStage = 'post-backup';
    record('post-backup', 'ok', await capturePostReleaseBackup(app, plannedRelease.sourceRevision, deps));

    return finish('ok', null, null);
  } catch (error) {
    const failure = sanitizeHostedOutput(error instanceof Error ? error.message : 'Hosted migration release failed.');
    record(currentStage, 'failed', { failure });
    return finish('failed', failure, currentStage);
  }
}

/** The target's migrations production lacks; refuses a ledger the target does not extend. */
export function pendingTargetMigrations(applied: readonly string[], target: readonly string[]): string[] {
  if (applied.length > target.length || applied.some((id, index) => target[index] !== id)) {
    throw new Error('Production migration ledger is not a prefix of the target migrations; the target does not extend the running schema.');
  }
  const pending = target.slice(applied.length);
  if (pending.length === 0) throw new Error('Target has no pending migrations; use the code-only release.');
  return pending;
}

async function capturePostReleaseBackup(app: string, revision: string, deps: HostedUpgradeDeps) {
  const id = randomUUID();
  const requestedAt = deps.now().getTime();
  const receipt = parseBackupReceipt(parseHostedCommandJson(await ssh(app,
    `node --import tsx scripts/manage-hosted-backup.ts --action=create --kind=hourly --id=${id} --source-app=${app} --source-revision=${revision}`,
    deps, 16 * 60_000)));
  if (receipt.id !== id || receipt.sourceRevision !== revision || receipt.sourceApp !== app
    || Date.parse(receipt.startedAt) < requestedAt - 5000) throw new Error('Post-release backup receipt does not match the request.');
  return receipt;
}

export async function readMachineCommand(app: string, deps: HostedUpgradeDeps): Promise<{
  machineId: string;
  idle: boolean;
  imageDigest: string | null;
}> {
  const result = await deps.run('fly', ['machines', 'list', '--app', app, '--json'], { timeoutMs: 30_000, env: flyCommandEnv() });
  const value = parseJsonValue(result.stdout);
  const rows = Array.isArray(value) ? value.filter(isRecord).filter((row) => row.state !== 'destroyed') : [];
  const row = rows.length === 1 ? rows[0] : null;
  if (!row || typeof row.id !== 'string') throw new Error(`Expected exactly one Fly Machine; found ${rows.length}.`);
  const config = isRecord(row.config) ? row.config : null;
  const init = config && isRecord(config.init) ? config.init : null;
  const command = Array.isArray(init?.cmd) ? init.cmd.join(' ') : typeof init?.cmd === 'string' ? init.cmd : '';
  const imageRef = isRecord(row.image_ref) ? row.image_ref : null;
  return {
    machineId: row.id,
    idle: command === 'sleep infinity' || command.endsWith('/sleep infinity'),
    imageDigest: imageRef && typeof imageRef.digest === 'string' ? imageRef.digest : null,
  };
}

function digestOf(image: string): string {
  return image.slice(image.indexOf('@') + 1);
}
