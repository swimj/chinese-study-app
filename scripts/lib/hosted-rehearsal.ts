import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { flyCommandEnv, parseHostedCommandJson, type HostedUpgradeDeps } from './hosted-upgrade.ts';
import { isRecord, sanitizeHostedOutput } from './hosted-json.ts';

type Deps = Pick<HostedUpgradeDeps, 'run' | 'now' | 'emit'>;
export type RehearsalManifest = {
  version: 1; app: string; sourceApp: string; image: string; schema: 'unchanged' | 'migrate';
  name: string; volumeName: string; machineId: string | null; volumeId: string | null;
  region: string; vmSize: string; createdAt: string;
  state: 'creating' | 'restored' | 'checking' | 'migrating' | 'migrated' | 'failed' | 'destroyed';
};
export type PrepareRehearsalInput = {
  app: string; sourceApp: string; image: string; schema: 'unchanged' | 'migrate';
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
    `sh -lc ${shellSingleQuote(`cd /app; export APP_DATA_DIR=/data APP_DEPLOYMENT_TIER=release_candidate; ${command}`)}`], 1_200_000);
}
function pending(output: string): string[] {
  const value = parseHostedCommandJson(output);
  if (!isRecord(value) || !Array.isArray(value.pending) || !value.pending.every(x => typeof x === 'string')) throw new Error('Invalid migration status.');
  return value.pending as string[];
}
function credentials(file: string): string {
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
  const sourceEnv = credentials(input.sourceBackupEnvFile);
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
    await stage(input.runDir, 'source-sync', deps, () => fly(deps, ['ssh', 'console', '--app', m.sourceApp, '--command', 'litestream sync -wait -timeout 60 -socket /data/litestream.sock -json /data/app.db'], 90_000));
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
        const restored = await remote(m, deps, `set -eu; trap 'rm -f /tmp/rehearsal-source.env' EXIT; . /tmp/rehearsal-source.env; test ! -e /data/app.db; litestream restore -json -integrity-check full -o /data/app.db "s3://\${LITESTREAM_BUCKET}/\${LITESTREAM_REPLICA_PATH}"`);
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
      m.state = 'migrating'; save(dir, m);
      const result = parseHostedCommandJson(await remote(m, deps, 'npm run --silent db:migrate -- --database=/data/app.db --confirm-app-stopped=true'));
      if (pending(await remote(m, deps, 'npm run --silent db:migrate -- --database=/data/app.db --status=true')).length) throw new Error('Pending migrations remain.');
      m.state = 'migrated'; save(dir, m); return result;
    }
    if (!script || !path.isAbsolute(script) || !fs.statSync(script).isFile()) throw new Error('--script must be an absolute shell script file.');
    const priorState = m.state;
    m.state = 'checking'; save(dir, m);
    await fly(deps, ['ssh', 'sftp', 'put', '--app', m.app, '--machine', m.machineId, '--user', 'root', '--mode', '0600', script, '/tmp/rehearsal-check.sh']);
    try {
      const output = sanitizeHostedOutput(await remote(m, deps, 'sh -eu /tmp/rehearsal-check.sh'));
      m.state = priorState; save(dir, m);
      return { output };
    }
    finally { await remote(m, deps, 'rm -f /tmp/rehearsal-check.sh'); }
  });
  return m;
}
