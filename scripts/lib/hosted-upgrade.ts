import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { isRecord, parseJsonValue, sanitizeHostedOutput } from './hosted-json.ts';

const execFileAsync = promisify(execFile);

export const HOSTED_UPGRADE_STAGES = [
  'declare',
  'quiesce',
  'backup-sync',
  'build-deploy',
  'confirm',
  'smoke',
  'reopen',
] as const;

export type HostedUpgradeStage = (typeof HOSTED_UPGRADE_STAGES)[number];

export const HOSTED_IMAGE_SOURCE_PATHS = [
  'package.json',
  'package-lock.json',
  'index.html',
  'tsconfig.json',
  'tsconfig.node.json',
  'vite.config.ts',
  'src',
  'server',
  'scripts',
  'deploy/fly/Dockerfile',
  'deploy/fly/litestream.yml',
] as const;

export const DEFAULT_FLY_CONFIG_PATH = 'deploy/fly/.generated/fly.toml';
export const PROVIDER_DRAIN_TIMEOUT_MS = 960_000;
export const HEALTH_POLL_INTERVAL_MS = 2_000;
export const POST_DEPLOY_HEALTH_TIMEOUT_MS = 180_000;
export const DEPLOY_TIMEOUT_MS = 1_200_000;

export type CommandResult = {
  stdout: string;
  stderr: string;
};

export type CommandRunner = (
  file: string,
  args: readonly string[],
  options?: { timeoutMs?: number; cwd?: string; env?: NodeJS.ProcessEnv },
) => Promise<CommandResult>;

export type HostedUpgradeDeps = {
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  readFile: (filePath: string) => string;
  fileExists: (filePath: string) => boolean;
  gitHead: () => string;
  gitStatusPorcelain: () => string;
  run: CommandRunner;
  fetch: typeof fetch;
  emit: (event: unknown) => void;
};

export type PreparedFlyConfig = {
  app: string;
  primaryRegion: string;
  configPath: string;
  publicOrigin: string;
};

export type FlyDeploymentIdentity = {
  releaseVersion: number | null;
  machineId: string;
  machineVersion: string | null;
  imageRef: string | null;
  imageDigest: string | null;
  observedAt: string;
};

export type HostedUpgradeStageEvent = {
  type: 'stage';
  stage: HostedUpgradeStage;
  status: 'ok' | 'failed';
  at: string;
  detail?: unknown;
};

export type PlannedReleaseIdentity = {
  appVersion: string;
  sourceRevision: string;
};

export type HostedUpgradeResult = {
  type: 'upgrade-result';
  status: 'ok' | 'failed';
  operator: string;
  app: string;
  startedAt: string;
  finishedAt: string;
  plannedRelease: PlannedReleaseIdentity | null;
  actualBuild: { imageRef: string | null; imageDigest: string | null } | null;
  actualDeployment: FlyDeploymentIdentity | null;
  stages: HostedUpgradeStageEvent[];
  failedStage: HostedUpgradeStage | null;
  failure: string | null;
  runningIdentity: unknown | null;
  reopened: boolean;
};

export type HostedUpgradeInput = {
  repoRoot: string;
  app: string;
  actorId: string;
  confirmSourceRevision: string;
  confirmEligibleRelease: boolean;
  flyConfigPath?: string;
};

export async function runHostedUpgrade(
  input: HostedUpgradeInput,
  deps: HostedUpgradeDeps,
): Promise<HostedUpgradeResult> {
  const startedAt = deps.now().toISOString();
  const stages: HostedUpgradeStageEvent[] = [];
  let currentStage: HostedUpgradeStage = 'declare';
  let plannedRelease: PlannedReleaseIdentity | null = null;
  let actualBuild: { imageRef: string | null; imageDigest: string | null } | null = null;
  let actualDeployment: FlyDeploymentIdentity | null = null;
  let runningIdentity: unknown | null = null;
  let preDeploySchemaMigrationCount: number | null = null;
  let mutated = false;
  let reopened = false;
  const flyConfigPath = path.resolve(input.repoRoot, input.flyConfigPath ?? DEFAULT_FLY_CONFIG_PATH);

  const finish = (
    status: 'ok' | 'failed',
    failure: string | null,
    failedStage: HostedUpgradeStage | null,
  ): HostedUpgradeResult => {
    const result: HostedUpgradeResult = {
      type: 'upgrade-result',
      status,
      operator: input.actorId,
      app: input.app,
      startedAt,
      finishedAt: deps.now().toISOString(),
      plannedRelease,
      actualBuild,
      actualDeployment,
      stages,
      failedStage,
      failure,
      runningIdentity,
      reopened,
    };
    deps.emit(result);
    return result;
  };

  const recordStage = (stage: HostedUpgradeStage, status: 'ok' | 'failed', detail?: unknown): void => {
    const event: HostedUpgradeStageEvent = {
      type: 'stage',
      stage,
      status,
      at: deps.now().toISOString(),
      ...(detail === undefined ? {} : { detail }),
    };
    stages.push(event);
    deps.emit(event);
  };

  try {
    currentStage = 'declare';
    if (input.confirmEligibleRelease !== true) {
      throw new Error('App-only upgrade requires --confirm-eligible-release=true.');
    }
    const actorId = requireNonEmpty(input.actorId, 'actor-id');
    const app = requireNonEmpty(input.app, 'app');
    const flyConfig = readPreparedFlyConfig(flyConfigPath, deps);
    if (flyConfig.app !== app) {
      throw new Error(`--app ${app} does not match prepared Fly config app ${flyConfig.app}.`);
    }
    const sourceRevision = requireFullGitSha(input.confirmSourceRevision);
    const headRevision = requireFullGitSha(deps.gitHead());
    if (headRevision !== sourceRevision) {
      throw new Error(`Checkout HEAD ${headRevision} does not match --confirm-source-revision.`);
    }
    const dirtyPaths = imageSourcePathsFromGitStatus(deps.gitStatusPorcelain());
    if (dirtyPaths.length > 0) {
      throw new Error(
        `Checkout has uncommitted image-source changes; refusing to bake APP_REVISION ${sourceRevision}: ${dirtyPaths.join(', ')}.`,
      );
    }
    const appVersion = readPackageVersion(input.repoRoot, deps);
    plannedRelease = { appVersion, sourceRevision };
    const publicOrigin = flyConfig.publicOrigin;
    const inspectBefore = await inspectHostedService(app, deps);
    runningIdentity = inspectBefore.releaseIdentity ?? inspectBefore;
    preDeploySchemaMigrationCount = readSchemaMigrationCount(inspectBefore);
    recordStage('declare', 'ok', {
      plannedRelease,
      currentReleaseIdentity: inspectBefore.releaseIdentity ?? null,
      schemaMigrationCount: preDeploySchemaMigrationCount,
    });

    currentStage = 'quiesce';
    mutated = true;
    await setHostedControl(app, actorId, 'provider-work', false, deps);
    await setHostedControl(app, actorId, 'maintenance', true, deps);
    const controls = await inspectHostedService(app, deps);
    assertPersistedControls(controls, { maintenanceMode: true, providerWorkEnabled: false });
    const drained = await pollHealthz(publicOrigin, deps, PROVIDER_DRAIN_TIMEOUT_MS, (health) => (
      health.maintenanceMode === true
      && health.providerWorkEnabled === false
      && health.activeProviderWorkCount === 0
        ? health
        : null
    ), 'Provider-work drain');
    recordStage('quiesce', 'ok', {
      maintenanceMode: true,
      providerWorkEnabled: false,
      activeProviderWorkCount: drained.activeProviderWorkCount,
    });

    currentStage = 'backup-sync';
    await ssh(app, 'litestream sync -wait -timeout 60 -socket /data/litestream.sock -json /data/app.db', deps, 90_000);
    recordStage('backup-sync', 'ok');

    currentStage = 'build-deploy';
    await deps.run('fly', [
      'deploy',
      '--app', app,
      '--config', flyConfig.configPath,
      '--remote-only',
      '--ha=false',
      '--build-arg', `APP_REVISION=${sourceRevision}`,
    ], {
      cwd: input.repoRoot,
      timeoutMs: DEPLOY_TIMEOUT_MS,
      env: flyCommandEnv(),
    });
    actualDeployment = await readFlyDeploymentIdentity(app, deps);
    actualBuild = {
      imageRef: actualDeployment.imageRef,
      imageDigest: actualDeployment.imageDigest,
    };
    if (!actualBuild.imageDigest && !actualBuild.imageRef) {
      throw new Error('Fly did not report an image reference or digest after deploy.');
    }
    recordStage('build-deploy', 'ok', { actualBuild, actualDeployment });

    currentStage = 'confirm';
    await pollHealthz(publicOrigin, deps, POST_DEPLOY_HEALTH_TIMEOUT_MS, (health) => (
      health.status === 'ok' ? health : null
    ), 'Post-deploy /healthz');
    const postDeployHealth = await readHealthz(publicOrigin, deps);
    if (postDeployHealth.maintenanceMode !== true || postDeployHealth.providerWorkEnabled !== false) {
      throw new Error('Post-deploy health check is not still in maintenance with provider work disabled.');
    }
    const inspectAfter = await inspectHostedService(app, deps);
    runningIdentity = inspectAfter.releaseIdentity ?? inspectAfter;
    assertReleaseIdentityMatch(inspectAfter, plannedRelease);
    const confirmedDeployment = await readFlyDeploymentIdentity(app, deps);
    assertDeploymentIdentityMatch(actualDeployment, confirmedDeployment);
    const postDeploySchemaMigrationCount = readSchemaMigrationCount(inspectAfter);
    if (
      preDeploySchemaMigrationCount !== null
      && postDeploySchemaMigrationCount !== preDeploySchemaMigrationCount
    ) {
      throw new Error('Schema migration count changed; this pipeline is not authorized for a schema-changing release.');
    }
    recordStage('confirm', 'ok', {
      releaseIdentity: inspectAfter.releaseIdentity ?? null,
      actualDeployment: confirmedDeployment,
      schemaMigrationCount: postDeploySchemaMigrationCount,
    });

    currentStage = 'smoke';
    await assertServedFrontend(publicOrigin, deps);
    const smoke = parseHostedCommandJson(
      await ssh(app, 'npm run --silent hosted:smoke -- --data-dir=/data', deps, 60_000),
    );
    if (!isRecord(smoke) || smoke.status !== 'ok') {
      throw new Error(readFailureDetail(smoke) ?? 'Hosted smoke failed.');
    }
    recordStage('smoke', 'ok', {
      endpoint: smoke.endpoint ?? '/api/session-payload',
      httpStatus: smoke.httpStatus ?? null,
      sessionRevoked: smoke.sessionRevoked === true,
    });

    currentStage = 'reopen';
    await setHostedControl(app, actorId, 'maintenance', false, deps);
    await setHostedControl(app, actorId, 'provider-work', true, deps);
    const reopenedInspect = await inspectHostedService(app, deps);
    assertPersistedControls(reopenedInspect, { maintenanceMode: false, providerWorkEnabled: true });
    runningIdentity = reopenedInspect.releaseIdentity ?? reopenedInspect;
    reopened = true;
    recordStage('reopen', 'ok', { controls: readControls(reopenedInspect) });

    return finish('ok', null, null);
  } catch (error) {
    const failure = sanitizeHostedOutput(error instanceof Error ? error.message : 'Hosted upgrade failed.');
    recordStage(currentStage, 'failed', { failure });
    return finish('failed', failure, currentStage);
  }
}

export function readPreparedFlyConfig(configPath: string, deps: Pick<HostedUpgradeDeps, 'fileExists' | 'readFile'>): PreparedFlyConfig {
  if (!deps.fileExists(configPath)) {
    throw new Error(`Prepared Fly config is missing: ${configPath}.`);
  }
  const text = deps.readFile(configPath);
  const app = matchTomlString(text, 'app');
  const primaryRegion = matchTomlString(text, 'primary_region');
  const authorizedParty = matchTomlAssignment(text, 'CLERK_AUTHORIZED_PARTY');
  if (!text.includes('destination = "/data"')) {
    throw new Error('Prepared Fly config must mount a volume at /data.');
  }
  if (!text.includes('path = "/healthz"')) {
    throw new Error('Prepared Fly config must health-check /healthz.');
  }
  const vmBlocks = text.match(/\[\[vm\]\]/g) ?? [];
  if (vmBlocks.length !== 1) {
    throw new Error(`Prepared Fly config must declare exactly one [[vm]]; found ${vmBlocks.length}.`);
  }
  return {
    app,
    primaryRegion,
    configPath,
    publicOrigin: authorizedParty ?? `https://${app}.fly.dev`,
  };
}

export function imageSourcePathsFromGitStatus(porcelain: string): string[] {
  const dirty: string[] = [];
  for (const line of porcelain.split('\n')) {
    if (line.trim() === '') continue;
    const entries = line.slice(3).split(' -> ');
    for (const entry of entries) {
      const filePath = entry.trim();
      if (filePath && affectsHostedImage(filePath)) dirty.push(filePath);
    }
  }
  return dirty;
}

export function parseFlyMachinesList(rawJson: string, observedAt: string): FlyDeploymentIdentity {
  const value = parseJsonValue(rawJson);
  const rows = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.machines) ? value.machines : null;
  if (!rows) throw new Error('Fly machines list did not return a JSON array.');
  const machines = rows.filter(isRecord).filter((row) => readMachineState(row) !== 'destroyed');
  const started = machines.filter((row) => readMachineState(row) === 'started');
  const selected = started.length > 0 ? started : machines;
  if (selected.length !== 1 || !isRecord(selected[0])) {
    throw new Error(`Expected exactly one Fly Machine; found ${selected.length}.`);
  }
  const machine = selected[0];
  const machineId = readStringField(machine, ['id', 'ID']);
  if (!machineId) throw new Error('Fly Machine is missing an id.');
  const imageRefObject = isRecord(machine.image_ref) ? machine.image_ref : isRecord(machine.imageRef) ? machine.imageRef : null;
  const digest = imageRefObject ? readStringField(imageRefObject, ['digest']) : null;
  const tag = imageRefObject ? readStringField(imageRefObject, ['tag']) : null;
  const repository = imageRefObject ? readStringField(imageRefObject, ['repository']) : null;
  const registry = imageRefObject ? readStringField(imageRefObject, ['registry']) : null;
  const composedRef = registry && repository && tag
    ? `${registry}/${repository}:${tag}`
    : readStringField(machine, ['image_ref', 'imageRef']);
  const configImage = isRecord(machine.config) ? readStringField(machine.config, ['image']) : null;
  return {
    releaseVersion: readNumberField(machine, ['version', 'Version']),
    machineId,
    machineVersion: readStringField(machine, ['instance_id', 'instanceId']),
    imageRef: configImage ?? composedRef,
    imageDigest: digest,
    observedAt,
  };
}

export function parseFlyReleases(rawJson: string): { version: number; imageRef: string | null } | null {
  const value = parseJsonValue(rawJson);
  const rows = Array.isArray(value) ? value : null;
  if (!rows || rows.length === 0 || !isRecord(rows[0])) return null;
  const latest = rows[0];
  const version = readNumberField(latest, ['Version', 'version']);
  if (version === null) return null;
  return {
    version,
    imageRef: readStringField(latest, ['ImageRef', 'imageRef', 'Image', 'image']),
  };
}

export function createDefaultHostedUpgradeDeps(repoRoot: string): HostedUpgradeDeps {
  return {
    now: () => new Date(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    readFile: (filePath) => fs.readFileSync(filePath, 'utf8'),
    fileExists: (filePath) => fs.existsSync(filePath),
    gitHead: () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
    gitStatusPorcelain: () => execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }),
    run: async (file, args, options) => {
      try {
        const { stdout, stderr } = await execFileAsync(file, [...args], {
          cwd: options?.cwd ?? repoRoot,
          timeout: options?.timeoutMs ?? 30_000,
          maxBuffer: 10 * 1024 * 1024,
          encoding: 'utf8',
          env: options?.env ?? process.env,
        });
        return { stdout, stderr };
      } catch (error) {
        const failed = error as { stdout?: string; stderr?: string; message?: string };
        throw new Error(sanitizeHostedOutput(
          `Command ${file} failed: ${(failed.stderr || failed.stdout || failed.message || 'unknown error').trim()}`,
        ));
      }
    },
    fetch,
    emit: (event) => console.log(JSON.stringify(event)),
  };
}

async function inspectHostedService(app: string, deps: HostedUpgradeDeps): Promise<Record<string, unknown>> {
  const raw = await ssh(
    app,
    'npm run --silent hosted:inspect -- --data-dir=/data --litestream-socket=/data/litestream.sock',
    deps,
    30_000,
  );
  const value = parseHostedCommandJson(raw);
  if (!isRecord(value)) throw new Error('hosted:inspect did not return a JSON object.');
  return value;
}

async function setHostedControl(
  app: string,
  actorId: string,
  control: 'maintenance' | 'provider-work',
  enabled: boolean,
  deps: HostedUpgradeDeps,
): Promise<void> {
  const raw = await ssh(
    app,
    `npm run --silent hosted:control -- --data-dir=/data --control=${control} --enabled=${enabled} --actor-id=${shellSingleQuote(actorId)}`,
    deps,
    30_000,
  );
  const value = parseHostedCommandJson(raw);
  if (!isRecord(value) || value.status !== 'updated') {
    throw new Error(`hosted:control ${control} did not report an updated status.`);
  }
}

async function ssh(
  app: string,
  command: string,
  deps: HostedUpgradeDeps,
  timeoutMs: number,
): Promise<string> {
  const result = await deps.run('fly', ['ssh', 'console', '--app', app, '--command', command], {
    timeoutMs,
    env: flyCommandEnv(),
  });
  return result.stdout;
}

async function readFlyDeploymentIdentity(app: string, deps: HostedUpgradeDeps): Promise<FlyDeploymentIdentity> {
  const machines = await deps.run('fly', ['machines', 'list', '--app', app, '--json'], {
    timeoutMs: 30_000,
    env: flyCommandEnv(),
  });
  const identity = parseFlyMachinesList(machines.stdout, deps.now().toISOString());
  try {
    const releases = await deps.run('fly', ['releases', '--app', app, '--json'], {
      timeoutMs: 30_000,
      env: flyCommandEnv(),
    });
    const latest = parseFlyReleases(releases.stdout);
    if (latest) {
      return {
        ...identity,
        releaseVersion: latest.version,
        imageRef: identity.imageRef ?? latest.imageRef,
      };
    }
  } catch {
    // Machine identity remains authoritative when release history is unavailable.
  }
  return identity;
}

async function pollHealthz<T>(
  origin: string,
  deps: HostedUpgradeDeps,
  timeoutMs: number,
  select: (health: HealthzResponse) => T | null,
  label: string,
): Promise<T> {
  const deadline = deps.now().getTime() + timeoutMs;
  let lastError: string | null = null;
  while (true) {
    try {
      const health = await readHealthz(origin, deps);
      const selected = select(health);
      if (selected !== null) return selected;
      lastError = `status=${health.status} maintenance=${health.maintenanceMode} providerWork=${health.providerWorkEnabled} activeProviderWork=${health.activeProviderWorkCount}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'health check failed';
    }
    if (deps.now().getTime() >= deadline) {
      throw new Error(`${label} timed out.${lastError ? ` Last error: ${sanitizeHostedOutput(lastError)}` : ''}`);
    }
    await deps.sleep(HEALTH_POLL_INTERVAL_MS);
  }
}

async function readHealthz(origin: string, deps: HostedUpgradeDeps): Promise<HealthzResponse> {
  const response = await deps.fetch(`${trimTrailingSlash(origin)}/healthz`);
  if (!response.ok) throw new Error(`/healthz returned HTTP ${response.status}.`);
  const body = await response.json();
  if (
    !isRecord(body)
    || typeof body.status !== 'string'
    || typeof body.maintenanceMode !== 'boolean'
    || typeof body.providerWorkEnabled !== 'boolean'
    || typeof body.activeProviderWorkCount !== 'number'
  ) {
    throw new Error('/healthz returned an unexpected payload.');
  }
  return {
    status: body.status,
    maintenanceMode: body.maintenanceMode,
    providerWorkEnabled: body.providerWorkEnabled,
    activeProviderWorkCount: body.activeProviderWorkCount,
  };
}

async function assertServedFrontend(origin: string, deps: HostedUpgradeDeps): Promise<void> {
  const response = await deps.fetch(`${trimTrailingSlash(origin)}/`);
  if (!response.ok) throw new Error(`Served frontend returned HTTP ${response.status}.`);
  const contentType = response.headers.get('content-type') ?? '';
  const body = await response.text();
  if (!contentType.includes('text/html') || !body.includes('id="root"')) {
    throw new Error('Served frontend entry point was not the expected HTML application shell.');
  }
}

function assertReleaseIdentityMatch(
  inspect: Record<string, unknown>,
  planned: PlannedReleaseIdentity,
): void {
  const identity = isRecord(inspect.releaseIdentity) ? inspect.releaseIdentity : null;
  if (!identity) throw new Error('hosted:inspect did not report release identity.');
  const sourceRevision = typeof identity.sourceRevision === 'string' ? identity.sourceRevision : '';
  const appVersion = typeof identity.appVersion === 'string' ? identity.appVersion : '';
  if (sourceRevision === 'unknown' || sourceRevision === '') {
    throw new Error('Running image source revision is unknown; APP_REVISION was not baked at build time.');
  }
  if (sourceRevision !== planned.sourceRevision) {
    throw new Error(`Running source revision ${sourceRevision} does not match planned ${planned.sourceRevision}.`);
  }
  if (appVersion !== planned.appVersion) {
    throw new Error(`Running app version ${appVersion} does not match planned ${planned.appVersion}.`);
  }
}

function assertDeploymentIdentityMatch(expected: FlyDeploymentIdentity, actual: FlyDeploymentIdentity): void {
  if (expected.machineId !== actual.machineId) {
    throw new Error(`Fly Machine id changed after deploy: ${expected.machineId} vs ${actual.machineId}.`);
  }
  if (expected.imageDigest && actual.imageDigest && expected.imageDigest !== actual.imageDigest) {
    throw new Error('Fly image digest reported after deploy does not match the post-deploy Machine.');
  }
  if (expected.imageRef && actual.imageRef && expected.imageRef !== actual.imageRef) {
    throw new Error('Fly image reference reported after deploy does not match the post-deploy Machine.');
  }
}

function assertPersistedControls(
  inspect: Record<string, unknown>,
  expected: { maintenanceMode: boolean; providerWorkEnabled: boolean },
): void {
  const controls = readControls(inspect);
  if (!controls) throw new Error('hosted:inspect did not report service controls.');
  if (controls.maintenanceMode !== expected.maintenanceMode) {
    throw new Error(`Persisted maintenance_mode is ${controls.maintenanceMode}, expected ${expected.maintenanceMode}.`);
  }
  if (controls.providerWorkEnabled !== expected.providerWorkEnabled) {
    throw new Error(`Persisted provider_work_enabled is ${controls.providerWorkEnabled}, expected ${expected.providerWorkEnabled}.`);
  }
}

function readControls(inspect: Record<string, unknown>): { maintenanceMode: boolean; providerWorkEnabled: boolean } | null {
  const diagnostics = isRecord(inspect.diagnostics) ? inspect.diagnostics : inspect;
  const controls = isRecord(diagnostics.controls) ? diagnostics.controls : null;
  if (
    !controls
    || typeof controls.maintenanceMode !== 'boolean'
    || typeof controls.providerWorkEnabled !== 'boolean'
  ) {
    return null;
  }
  return {
    maintenanceMode: controls.maintenanceMode,
    providerWorkEnabled: controls.providerWorkEnabled,
  };
}

function readSchemaMigrationCount(inspect: Record<string, unknown>): number | null {
  const diagnostics = isRecord(inspect.diagnostics) ? inspect.diagnostics : inspect;
  return typeof diagnostics.schemaMigrationCount === 'number' ? diagnostics.schemaMigrationCount : null;
}

function parseHostedCommandJson(stdout: string): unknown {
  return parseJsonValue(stdout);
}

function readFailureDetail(value: unknown): string | null {
  return isRecord(value) && typeof value.failure === 'string' ? value.failure : null;
}

function readPackageVersion(repoRoot: string, deps: Pick<HostedUpgradeDeps, 'readFile'>): string {
  const raw = JSON.parse(deps.readFile(path.join(repoRoot, 'package.json'))) as { version?: unknown };
  if (typeof raw.version !== 'string' || raw.version.trim() === '') {
    throw new Error('package.json is missing a version string.');
  }
  return raw.version.trim();
}

function requireFullGitSha(value: string): string {
  const normalized = value.trim();
  if (!/^[a-f0-9]{40}$/.test(normalized)) {
    throw new Error('Source revision must be the full 40-character Git SHA.');
  }
  return normalized;
}

function requireNonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Missing required ${label}.`);
  return normalized;
}

function matchTomlString(text: string, key: string): string {
  const match = text.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, 'm'));
  if (!match?.[1]) throw new Error(`Prepared Fly config is missing ${key}.`);
  return match[1];
}

function matchTomlAssignment(text: string, key: string): string | null {
  const match = text.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`, 'm'));
  return match?.[1] ?? null;
}

function affectsHostedImage(filePath: string): boolean {
  return HOSTED_IMAGE_SOURCE_PATHS.some((prefix) => (
    filePath === prefix || filePath.startsWith(`${prefix}/`)
  ));
}

function readMachineState(row: Record<string, unknown>): string | null {
  return readStringField(row, ['state', 'State']);
}

function readStringField(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function readNumberField(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && /^-?\d+$/.test(value)) return Number(value);
  }
  return null;
}

function flyCommandEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    FLY_NO_UPDATE_CHECK: '1',
    NO_COLOR: '1',
  };
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function shellSingleQuote(value: string): string {
  if (!/^[A-Za-z0-9._@-]+$/.test(value)) {
    throw new Error('actor-id contains characters that are not safe to pass through fly ssh.');
  }
  return value;
}

type HealthzResponse = {
  status: string;
  maintenanceMode: boolean;
  providerWorkEnabled: boolean;
  activeProviderWorkCount: number;
};
