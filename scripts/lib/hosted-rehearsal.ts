import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { flyCommandEnv, parseHostedCommandJson, type HostedUpgradeDeps } from './hosted-upgrade.ts';
import { isRecord, sanitizeHostedOutput } from './hosted-json.ts';

type Deps = Pick<HostedUpgradeDeps, 'run' | 'now' | 'emit'>;
export type RehearsalManifest = {
  version: 1; app: string; sourceApp: string; image: string; schema: 'unchanged' | 'migrate';
  name: string; volumeName: string; machineId: string | null; volumeId: string | null;
  region: string; vmSize: string; createdAt: string;
  state: 'creating' | 'restored' | 'checking' | 'migrating' | 'migrated' | 'failed' | 'destroyed';
  /** Every check run against this copy, in order. Survives destroy as release evidence. */
  checks?: RehearsalCheckRecord[];
  /** Set once the migration succeeds; the production migration pipeline requires it. */
  migration?: { appliedIds: string[]; completedAt: string };
};
export type RehearsalCheckRecord = {
  sequence: number;
  /** author: shipped with the migration; operator: supplied by the release agent. */
  origin: 'author' | 'operator';
  name: string;
  phase: 'before-migration' | 'after-migration';
  status: 'running' | 'passed' | 'failed';
  sha256: string;
  /** Local evidence copy for operator scripts; image path for author scripts. */
  source: string;
  at: string;
};
/** Shared by every check on one rehearsal, so a before check can save state an after check compares. */
export const REHEARSAL_WORK_DIR = '/data/rehearsal-work';
/** Optional author check shipped beside a migration's SQL: server/db/migrations/<NNNN_name>.rehearsal.sh. */
export function authorCheckPath(migrationId: string): string {
  const match = /^app_schema:(\d{4}_[a-z0-9_]+)$/.exec(migrationId);
  if (!match) throw new Error(`Invalid migration id: ${migrationId}`);
  return `server/db/migrations/${match[1]}.rehearsal.sh`;
}
export type PrepareRehearsalInput = {
  app: string; sourceApp: string; image: string; schema: 'unchanged' | 'migrate';
  backupProvider?: 'sqlite' | 'litestream'; sourceRevision?: string; backupCapture?: 'retained' | 'fresh'; backupId?: string;
  sourceBackupEnvFile: string; runDir: string; region?: string; vmSize?: string; volumeSizeGb?: number;
};
const manifestPath = (dir: string) => path.join(dir, 'manifest.json');
const shellSingleQuote = (value: string): string => `'${value.replaceAll("'", `'"'"'`)}'`;
const redactions = new Map<string, string[]>();
function lock(dir: string): () => void {
  const file = path.join(dir, 'operation.lock');
  fs.writeFileSync(file, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
  return () => fs.unlinkSync(file);
}
function save(dir: string, manifest: RehearsalManifest): void {
  const temporary = `${manifestPath(dir)}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temporary, manifestPath(dir));
}
function load(dir: string): RehearsalManifest {
  if (!path.isAbsolute(dir)) throw new Error('--run-dir must be absolute.');
  const m: unknown = JSON.parse(fs.readFileSync(manifestPath(dir), 'utf8'));
  if (!isRecord(m) || m.version !== 1 || typeof m.app !== 'string' || m.app === m.sourceApp
    || typeof m.name !== 'string' || !/^rehearsal-[a-f0-9]{20}$/.test(m.name)
    || m.volumeName !== m.name.replaceAll('-', '_')) throw new Error('Invalid rehearsal manifest.');
  return m as RehearsalManifest;
}
async function stage<T>(dir: string, name: string, deps: Deps, work: () => Promise<T>): Promise<T> {
  const start = deps.now().getTime();
  const record = (status: string, detail?: unknown) => {
    const event = { stage: name, status, at: deps.now().toISOString(), elapsedMs: deps.now().getTime() - start, detail };
    fs.appendFileSync(path.join(dir, 'events.jsonl'), JSON.stringify(event) + '\n', { mode: 0o600 });
    deps.emit(event);
  };
  record('started');
  try { const value = await work(); record('ok', value); return value; }
  catch (error) {
    let diagnostic = sanitizeHostedOutput(error instanceof Error ? error.message : String(error));
    for (const value of redactions.get(dir) ?? []) if (value) diagnostic = diagnostic.replaceAll(value, '[redacted]');
    record('failed', { diagnostic });
    throw new Error(`Rehearsal stage ${name} failed: ${diagnostic}; resources are retained. Use status/destroy with ${dir}.`);
  }
}
async function fly(deps: Deps, args: string[], timeoutMs = 120_000): Promise<string> {
  return (await deps.run('fly', args, { env: flyCommandEnv(), timeoutMs })).stdout;
}
async function rows(deps: Deps, app: string, kind: 'machines' | 'volumes' | 'secrets'): Promise<Record<string, unknown>[]> {
  const value: unknown = JSON.parse(await fly(deps, [kind, 'list', '--app', app, '--json']));
  if (!Array.isArray(value) || !value.every(isRecord)) throw new Error(`Invalid Fly ${kind} inventory.`);
  return value;
}
async function reconcile(dir: string, m: RehearsalManifest, deps: Deps): Promise<void> {
  const machines = (await rows(deps, m.app, 'machines')).filter(row => row.name === m.name && row.state !== 'destroyed');
  const volumes = (await rows(deps, m.app, 'volumes')).filter(row => row.name === m.volumeName);
  if (machines.length > 1 || volumes.length > 1) throw new Error('Ambiguous rehearsal resource ownership; inspect manually.');
  if (machines[0]) {
    const config = machines[0].config;
    if (!isRecord(config) || !isRecord(config.metadata) || config.metadata.rehearsal_run !== m.name) throw new Error('Machine is missing rehearsal ownership metadata.');
  }
  for (const [row, key] of [[machines[0], 'machineId'], [volumes[0], 'volumeId']] as const) {
    if (row && typeof row.id !== 'string') throw new Error('Resource missing ID.');
    if (row && m[key] && row.id !== m[key]) throw new Error('Rehearsal resource ID changed.');
    m[key] = row ? String(row.id) : null;
  }
  save(dir, m);
}
async function remote(m: RehearsalManifest, deps: Deps, command: string): Promise<string> {
  if (!m.machineId) throw new Error('Rehearsal Machine is missing.');
  return fly(deps, ['ssh', 'console', '--app', m.app, '--machine', m.machineId, '--user', 'root', '--quiet', '--command',
    `sh -lc ${shellSingleQuote(`cd /app; export APP_DATA_DIR=/data APP_DEPLOYMENT_TIER=release_candidate REHEARSAL_WORK_DIR=${REHEARSAL_WORK_DIR}; mkdir -p ${REHEARSAL_WORK_DIR}; ${command}`)}`], 1_200_000);
}
function beginCheck(dir: string, m: RehearsalManifest, check: Omit<RehearsalCheckRecord, 'sequence' | 'status' | 'phase' | 'at'>, deps: Deps): RehearsalCheckRecord {
  const record: RehearsalCheckRecord = { ...check, sequence: (m.checks?.length ?? 0) + 1, status: 'running',
    phase: m.migration ? 'after-migration' : 'before-migration', at: deps.now().toISOString() };
  m.checks = [...(m.checks ?? []), record]; save(dir, m);
  return record;
}
function finishCheck(dir: string, m: RehearsalManifest, record: RehearsalCheckRecord, status: 'passed' | 'failed'): void {
  record.status = status; save(dir, m);
}
async function runAuthorChecks(dir: string, m: RehearsalManifest, ids: readonly string[], deps: Deps): Promise<unknown[]> {
  const paths = ids.map(authorCheckPath);
  const listing = await remote(m, deps, `for f in ${paths.join(' ')}; do if [ -f "$f" ]; then sha256sum "$f"; fi; done`);
  const results: unknown[] = [];
  for (const line of listing.split('\n').map(x => x.trim()).filter(Boolean)) {
    const [sha256, file] = line.split(/\s+/);
    if (!sha256 || !file || !paths.includes(file)) throw new Error('Unexpected author check listing.');
    const record = beginCheck(dir, m, { origin: 'author', name: path.basename(file), sha256, source: `image:/app/${file}` }, deps);
    const phase = record.phase === 'after-migration' ? 'after' : 'before';
    try {
      const output = sanitizeHostedOutput(await remote(m, deps, `REHEARSAL_PHASE=${phase} sh -eu ${file}`));
      finishCheck(dir, m, record, 'passed');
      results.push({ check: record.name, phase, output });
    } catch (error) {
      finishCheck(dir, m, record, 'failed');
      throw error;
    }
  }
  return results;
}
function pending(output: string): string[] {
  const value = parseHostedCommandJson(output);
  if (!isRecord(value) || !Array.isArray(value.pending) || !value.pending.every(x => typeof x === 'string')) throw new Error('Invalid migration status.');
  return value.pending as string[];
}
function credentials(file: string, provider: 'sqlite' | 'litestream'): string {
  if (!path.isAbsolute(file)) throw new Error('--source-backup-env-file must be absolute.');
  const values = new Map<string, string>();
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Z_]+)=(.*)$/.exec(line.trim());
    if (!match) throw new Error('Invalid backup environment assignment.');
    let value = match[2]!;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (/[\r\n\0]/.test(value)) throw new Error('Invalid backup credential value.');
    values.set(match[1]!, value);
  }
  if (provider === 'sqlite') {
    return ['APP_BACKUP_RECEIVER_URL', 'APP_BACKUP_RECEIVER_TOKEN'].map(key => {
      if (!values.get(key)) throw new Error(`Backup source requires ${key}.`);
      return `export ${key}=${shellSingleQuote(values.get(key)!)}`;
    }).join('\n') + '\n';
  }
  for (const key of ['LITESTREAM_ACCESS_KEY_ID', 'LITESTREAM_SECRET_ACCESS_KEY', 'LITESTREAM_BUCKET', 'LITESTREAM_REGION']) {
    if (!values.get(key)) throw new Error(`Backup source requires ${key}.`);
  }
  values.set('LITESTREAM_REPLICA_PATH', values.get('LITESTREAM_REPLICA_PATH') || 'chinese-study-app/hosted-beta');
  values.set('AWS_ACCESS_KEY_ID', values.get('LITESTREAM_ACCESS_KEY_ID')!);
  values.set('AWS_SECRET_ACCESS_KEY', values.get('LITESTREAM_SECRET_ACCESS_KEY')!);
  values.set('AWS_REGION', values.get('LITESTREAM_REGION')!);
  const allowed = ['LITESTREAM_ACCESS_KEY_ID', 'LITESTREAM_SECRET_ACCESS_KEY', 'LITESTREAM_BUCKET', 'LITESTREAM_REGION', 'LITESTREAM_REPLICA_PATH', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION', 'AWS_SESSION_TOKEN'];
  return allowed.filter(key => values.has(key)).map(key => `export ${key}=${shellSingleQuote(values.get(key)!)}`).join('\n') + '\n';
}

export async function prepareRehearsal(input: PrepareRehearsalInput, deps: Deps): Promise<RehearsalManifest> {
  if (!/^[a-z0-9][a-z0-9-]+$/.test(input.app) || !/^[a-z0-9][a-z0-9-]+$/.test(input.sourceApp) || input.app === input.sourceApp) throw new Error('Rehearsal and source must be distinct valid apps.');
  if (!/^registry\.fly\.io\/[a-z0-9-]+(?::[A-Za-z0-9_][A-Za-z0-9_.-]*)?@sha256:[a-f0-9]{64}$/.test(input.image)) throw new Error('--image must be an immutable Fly registry digest (optionally retaining its release tag).');
  if (!['unchanged', 'migrate'].includes(input.schema)) throw new Error('--schema must be unchanged or migrate.');
  if (!path.isAbsolute(input.runDir) || fs.existsSync(input.runDir)) throw new Error('--run-dir must be a new absolute directory.');
  const volumeSize = input.volumeSizeGb ?? 3;
  if (!Number.isInteger(volumeSize) || volumeSize < 1) throw new Error('--volume-size-gb must be a positive integer.');
  const provider = input.backupProvider ?? 'sqlite';
  if (!['sqlite', 'litestream'].includes(provider)) throw new Error('Invalid backup provider.');
  const capture = input.backupCapture ?? 'retained';
  if (!['retained', 'fresh'].includes(capture)) throw new Error('Invalid backup capture policy.');
  if (input.backupId !== undefined) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(input.backupId)) throw new Error('Invalid --backup-id.');
    if (provider !== 'sqlite' || capture !== 'retained') throw new Error('--backup-id requires retained SQLite backups.');
  }
  if (provider !== 'sqlite' && capture === 'fresh') throw new Error('Fresh capture requires the SQLite backup provider.');
  if (provider === 'sqlite' && capture === 'fresh' && !/^[a-f0-9]{40}$/.test(input.sourceRevision ?? '')) throw new Error('--source-revision must identify the source app revision with a full Git SHA.');
  const sourceEnv = credentials(input.sourceBackupEnvFile, provider);
  fs.mkdirSync(input.runDir, { recursive: true, mode: 0o700 });
  const unlock = lock(input.runDir);
  redactions.set(input.runDir, sourceEnv.split('\n').map(line => line.slice(line.indexOf('=') + 2, -1)));
  const name = `rehearsal-${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  const m: RehearsalManifest = { version: 1, app: input.app, sourceApp: input.sourceApp, image: input.image,
    schema: input.schema, name, volumeName: name.replaceAll('-', '_'), machineId: null, volumeId: null,
    region: input.region ?? 'sin', vmSize: input.vmSize ?? 'performance-1x', createdAt: deps.now().toISOString(), state: 'creating' };
  save(input.runDir, m);
  try {
    await stage(input.runDir, 'preflight', deps, async () => {
      if ((await rows(deps, m.app, 'machines')).length || (await rows(deps, m.app, 'volumes')).length || (await rows(deps, m.app, 'secrets')).length) throw new Error('Rehearsal app must have no Machines, volumes, or secrets.');
    });
    await stage(input.runDir, 'create-volume', deps, async () => {
      await fly(deps, ['volumes', 'create', m.volumeName, '--app', m.app, '--region', m.region, '--size', String(volumeSize), '--vm-size', m.vmSize, '--scheduled-snapshots=false', '--yes', '--json']);
      await reconcile(input.runDir, m, deps);
      if (!m.volumeId) throw new Error('New volume not found.');
    });
    await stage(input.runDir, 'create-machine', deps, async () => {
      const config = path.join(input.runDir, 'machine.json');
      fs.writeFileSync(config, JSON.stringify({ init: { exec: ['/bin/sleep', 'infinity'] }, services: [], env: { APP_DEPLOYMENT_TIER: 'release_candidate', APP_DATA_DIR: '/data' } }), { mode: 0o600 });
      const flyConfig = path.join(input.runDir, 'fly.toml');
      fs.writeFileSync(flyConfig, `app = "${m.app}"\n`, { mode: 0o600 });
      await fly(deps, ['machine', 'run', m.image, '--app', m.app, '--name', m.name, '--region', m.region, '--vm-size', m.vmSize,
        '--volume', `${m.volumeId}:/data`, '--machine-config', config, '--config', flyConfig, '--metadata', `rehearsal_run=${m.name}`, '--restart', 'no']);
      await reconcile(input.runDir, m, deps);
      if (!m.machineId) throw new Error('New Machine not found.');
    });
    await stage(input.runDir, 'restore', deps, async () => {
      const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rehearsal-source-'));
      const local = path.join(temp, 'source.env');
      fs.writeFileSync(local, sourceEnv, { mode: 0o600 });
      try {
        await fly(deps, ['ssh', 'sftp', 'put', '--app', m.app, '--machine', m.machineId!, '--user', 'root', '--mode', '0600', local, '/tmp/rehearsal-source.env']);
        let restoreAction = 'litestream restore -json -integrity-check full -o /data/app.db "s3://${LITESTREAM_BUCKET}/${LITESTREAM_REPLICA_PATH}"';
        if (provider === 'sqlite') {
          const receipt = await stage(input.runDir, 'source-backup', deps, async () => {
            if (capture === 'fresh') {
              const id = `rehearsal-${randomUUID()}`;
              const output = await remote(m, deps, `set -eu; . /tmp/rehearsal-source.env; node --import tsx scripts/manage-hosted-backup.ts --action=create --kind=hourly --id=${id} --source-revision=${input.sourceRevision} --source-app=${m.sourceApp}`);
              const value = parseHostedCommandJson(output);
              if (!isRecord(value) || value.id !== id || value.sourceRevision !== input.sourceRevision || value.sourceApp !== m.sourceApp) throw new Error('Source backup receipt does not match the requested capture.');
              return value;
            }
            const output = await remote(m, deps, 'set -eu; . /tmp/rehearsal-source.env; node --import tsx scripts/manage-hosted-backup.ts --action=status');
            const status = parseHostedCommandJson(output);
            if (!isRecord(status) || !Array.isArray(status.backups)) throw new Error('Invalid backup receiver status.');
            const receipt = status.backups.filter(isRecord)
              .filter(r => r.sourceApp === m.sourceApp && typeof r.id === 'string'
                && (input.backupId === undefined || r.id === input.backupId))
              .filter(r => typeof r.completedAt === 'string' && Number.isFinite(Date.parse(r.completedAt)))
              .sort((a, b) => Date.parse(String(b.completedAt)) - Date.parse(String(a.completedAt)))[0];
            if (!receipt) throw new Error(input.backupId === undefined
              ? 'No retained backup for the source app; request a fresh capture explicitly if needed.'
              : 'Requested backup id is not retained for the source app.');
            return receipt;
          });
          restoreAction = `node --import tsx scripts/manage-hosted-backup.ts --action=restore --id=${shellSingleQuote(String(receipt.id))} --output=/data/app.db`;
        }
        const restored = await remote(m, deps, `set -eu; trap 'rm -f /tmp/rehearsal-source.env' EXIT; . /tmp/rehearsal-source.env; test ! -e /data/app.db; ${restoreAction}`);
        const restoreSummary = parseHostedCommandJson(restored);
        if (!isRecord(restoreSummary) || restoreSummary.integrity_check !== 'full') throw new Error('Restore did not confirm full integrity checking.');
        fs.writeFileSync(path.join(input.runDir, 'restore.json'), sanitizeHostedOutput(JSON.stringify(restoreSummary, null, 2)), { mode: 0o600 });
      } finally {
        fs.rmSync(temp, { recursive: true });
        await remote(m, deps, 'rm -f /tmp/rehearsal-source.env');
      }
      return { restoredAt: deps.now().toISOString(), policy: 'latest available coherent backup; full integrity check' };
    });
    await stage(input.runDir, 'source-integrity', deps, async () => {
      const script = `const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync('/data/app.db',{readOnly:true}); const quick=db.prepare('PRAGMA quick_check').all(); const fk=db.prepare('PRAGMA foreign_key_check').all(); if(quick.length!==1||quick[0].quick_check!=='ok'||fk.length) throw new Error('Restored SQLite integrity failed'); db.close(); console.log(JSON.stringify({quickCheck:'ok',foreignKeyViolations:0,revision:process.env.APP_REVISION}));`;
      return parseHostedCommandJson(await remote(m, deps, `node -e ${shellSingleQuote(script)}`));
    });
    await stage(input.runDir, 'schema-status', deps, async () => {
      const list = pending(await remote(m, deps, 'npm run --silent db:migrate -- --database=/data/app.db --status=true'));
      if (m.schema === 'unchanged' && list.length) throw new Error('Schema declared unchanged has pending migrations.');
      if (m.schema === 'migrate' && !list.length) throw new Error('Schema declared migrate has no pending migrations.');
      return { pending: list };
    });
    m.state = 'restored'; save(input.runDir, m); return m;
  } catch (error) { m.state = 'failed'; save(input.runDir, m); throw error; }
  finally { redactions.delete(input.runDir); unlock(); }
}

export async function operateRehearsal(action: 'check' | 'migrate' | 'status' | 'destroy', dir: string, deps: Deps, script?: string): Promise<RehearsalManifest> {
  if (!path.isAbsolute(dir)) throw new Error('--run-dir must be absolute.');
  if (action === 'status') {
    const m = load(dir);
    await stage(dir, 'status', deps, async () => ({
      ...m, operationLocked: fs.existsSync(path.join(dir, 'operation.lock')),
      machines: (await rows(deps, m.app, 'machines')).filter(row => row.name === m.name).map(row => ({ id: row.id, state: row.state })),
      volumes: (await rows(deps, m.app, 'volumes')).filter(row => row.name === m.volumeName).map(row => ({ id: row.id, sizeGb: row.size_gb })),
      logs: `fly logs --app ${m.app}`, metrics: `fly dashboard --app ${m.app}`,
      resources: m.machineId ? await remote(m, deps, 'date -u; df -h /data; cat /proc/meminfo; cat /proc/loadavg').then(sanitizeHostedOutput).catch(() => 'Resource snapshot unavailable; inspect Machine state and Fly metrics.') : 'Machine identity not recorded yet',
    }));
    return m;
  }
  const unlock = lock(dir);
  try { return await operateLocked(action, dir, deps, script); }
  finally { unlock(); }
}

async function operateLocked(action: 'check' | 'migrate' | 'destroy', dir: string, deps: Deps, script?: string): Promise<RehearsalManifest> {
  const m = load(dir);
  await reconcile(dir, m, deps);
  await stage(dir, action, deps, async () => {
    if (action === 'destroy') {
      if (m.machineId) {
        await fly(deps, ['machine', 'destroy', m.machineId, '--app', m.app, '--force']);
        m.machineId = null; save(dir, m);
      }
      if (m.volumeId) {
        await fly(deps, ['volumes', 'destroy', m.volumeId, '--app', m.app, '--yes']);
        m.volumeId = null; save(dir, m);
      }
      m.state = 'destroyed'; save(dir, m); return { state: m.state };
    }
    if (!m.machineId || !m.volumeId || !['restored', 'migrated'].includes(m.state)) throw new Error('Rehearsal is not ready.');
    if (action === 'migrate') {
      if (m.schema !== 'migrate' || m.state !== 'restored') throw new Error('Migration requires a restored schema=migrate rehearsal.');
      const ids = pending(await remote(m, deps, 'npm run --silent db:migrate -- --database=/data/app.db --status=true'));
      if (!ids.length) throw new Error('No pending migrations to rehearse.');
      // Author checks are optional; the release agent can add any of its own with --action=check.
      const before = await runAuthorChecks(dir, m, ids, deps);
      m.state = 'migrating'; save(dir, m);
      const result = parseHostedCommandJson(await remote(m, deps, 'npm run --silent db:migrate -- --database=/data/app.db --confirm-app-stopped=true'));
      if (pending(await remote(m, deps, 'npm run --silent db:migrate -- --database=/data/app.db --status=true')).length) throw new Error('Pending migrations remain.');
      m.migration = { appliedIds: ids, completedAt: deps.now().toISOString() };
      m.state = 'migrated'; save(dir, m);
      const after = await runAuthorChecks(dir, m, ids, deps);
      return { result, authorChecks: { before, after } };
    }
    if (!script || !path.isAbsolute(script) || !fs.statSync(script).isFile()) throw new Error('--script must be an absolute shell script file.');
    const priorState = m.state;
    const content = fs.readFileSync(script);
    fs.mkdirSync(path.join(dir, 'checks'), { recursive: true, mode: 0o700 });
    const evidence = path.join(dir, 'checks', `${String((m.checks?.length ?? 0) + 1).padStart(3, '0')}-${path.basename(script)}`);
    fs.writeFileSync(evidence, content, { mode: 0o600 });
    const record = beginCheck(dir, m, { origin: 'operator', name: path.basename(script),
      sha256: createHash('sha256').update(content).digest('hex'), source: evidence }, deps);
    m.state = 'checking'; save(dir, m);
    await fly(deps, ['ssh', 'sftp', 'put', '--app', m.app, '--machine', m.machineId, '--user', 'root', '--mode', '0600', script, '/tmp/rehearsal-check.sh']);
    try {
      const output = sanitizeHostedOutput(await remote(m, deps, 'sh -eu /tmp/rehearsal-check.sh'));
      finishCheck(dir, m, record, 'passed');
      return { check: record.name, phase: record.phase, output };
    } catch (error) {
      // A failed check disqualifies the rehearsal but leaves the copy available for investigation.
      finishCheck(dir, m, record, 'failed');
      throw error;
    } finally {
      m.state = priorState; save(dir, m);
      await remote(m, deps, 'rm -f /tmp/rehearsal-check.sh');
    }
  });
  return m;
}

/** Reads a rehearsal run record, including one whose resources were destroyed. */
export function readRehearsalRecord(dir: string): RehearsalManifest {
  return load(dir);
}

/**
 * The production migration gate: the same image digest, rehearsed against this
 * source app, applied exactly the migrations production has pending, and no
 * check run against the copy failed. It does not prescribe which checks ran.
 */
export function assertRehearsalPassed(m: RehearsalManifest, expected: { image: string; sourceApp: string; pendingIds: readonly string[] }) {
  const digest = (image: string) => image.slice(image.indexOf('@') + 1);
  if (m.schema !== 'migrate') throw new Error('Rehearsal was not a migration rehearsal.');
  if (!expected.image.includes('@sha256:') || digest(m.image) !== digest(expected.image)) {
    throw new Error('Rehearsal image digest does not match the release image.');
  }
  if (m.sourceApp !== expected.sourceApp) throw new Error(`Rehearsal restored ${m.sourceApp}, not ${expected.sourceApp}.`);
  if (!m.migration) throw new Error('Rehearsal has no successful migration.');
  if (m.migration.appliedIds.join('\n') !== expected.pendingIds.join('\n')) {
    throw new Error(`Rehearsal applied ${m.migration.appliedIds.join(', ')}; production has pending ${expected.pendingIds.join(', ')}.`);
  }
  const unresolved = (m.checks ?? []).filter(check => check.status !== 'passed');
  if (unresolved.length) throw new Error(`Rehearsal checks did not pass: ${unresolved.map(check => `${check.sequence}:${check.name}:${check.status}`).join(', ')}.`);
  return { migratedAt: m.migration.completedAt, appliedIds: m.migration.appliedIds,
    checks: (m.checks ?? []).map(({ sequence, origin, name, phase, sha256 }) => ({ sequence, origin, name, phase, sha256 })) };
}
