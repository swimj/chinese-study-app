import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readStrictArguments, readBooleanArgument } from './lib/hosted-runtime.ts';

const args = readStrictArguments(['data-dir', 'port', 'api-port', 'reset-welcome', 'prepare-only']);
const flag = (name: string) => args.has(name) && readBooleanArgument(args, name);
const resetWelcome = flag('reset-welcome');
const prepareOnly = flag('prepare-only');
function port(name: string, fallback: number) {
  const value = Number(args.get(name) ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`Invalid --${name}.`);
  return value;
}
const frontendPort = port('port', 4183);
const apiPort = port('api-port', 5184);
if (frontendPort === apiPort) throw new Error('Frontend and API ports must differ.');
const url = `http://localhost:${frontendPort}/?reset-welcome=1`;
if (resetWelcome) {
  if (args.has('data-dir') || prepareOnly) throw new Error('Welcome-only reset does not accept data setup options.');
  console.log(`Open this link in the running new-learner preview to reset only the welcome path:\n${url}`);
  process.exit(0);
}

// Fail before preparing data if either requested listener is already occupied.
if (!prepareOnly) {
  for (const [host, requestedPort] of [['localhost', frontendPort], ['127.0.0.1', apiPort]] as const) {
    await new Promise<void>((resolve, reject) => {
      const probe = net.createServer();
      probe.once('error', reject);
      probe.listen({ host, port: requestedPort, exclusive: true }, () => probe.close((error) => error ? reject(error) : resolve()));
    });
  }
}

const root = fileURLToPath(new URL('..', import.meta.url));
// Claim a fresh directory. Never overwrite or seed an existing database.
const dataDir = args.has('data-dir') ? path.resolve(args.get('data-dir')!)
  : fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-new-learner-'));
if (args.has('data-dir')) fs.mkdirSync(dataDir);
const learnerId = 'new-learner-preview';
const env = { ...process.env, APP_MODE: 'study', APP_AUTH_MODE: 'trusted_local',
  APP_STUDY_PROFILE: 'mandarin', APP_LEARNER_ID: learnerId, APP_DATA_DIR: dataDir,
  APP_HOST: '127.0.0.1', APP_METRICS_PORT: '', APP_WORD_CONTENT_WORKBENCH: '' };
function prepare(scriptArgs: string[]) {
  const result = spawnSync(process.execPath, scriptArgs, { cwd: root, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('New-learner preparation failed; the isolated directory was retained.');
}
prepare(['--import', 'tsx', 'scripts/bootstrap-hosted-mandarin.ts', `--data-dir=${dataDir}`]);
prepare(['--import', 'tsx', '--input-type=module', '-e', `
  process.env.APP_AUTH_MODE = 'clerk';
  const db = await import('./server/db.ts');
  try { db.bootstrapLearner({ learnerId: 'new-learner-preview', displayName: 'New learner' }); }
  finally { (await import('./server/db/connection.ts')).closeDbConnection(); }
`]);
console.log(`Fresh learner database: ${dataDir}`);
if (prepareOnly) process.exit(0);

const children: ChildProcess[] = [];
let stopping = false;
function stop(code: number) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill('SIGTERM');
  const timer = setTimeout(() => {
    for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
  }, 5000);
  timer.unref();
}
function launch(command: string[], childEnv: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, command, { cwd: root, env: childEnv, stdio: 'inherit' });
  children.push(child);
  child.on('error', (error) => { console.error(error.message); stop(1); });
  child.on('exit', (code, signal) => { if (!stopping) stop(code === 0 && !signal ? 0 : 1); });
}
launch(['--import', 'tsx', 'server/index.ts', '--mode=study', '--auth-mode=trusted_local',
  '--study-profile=mandarin', `--learner-id=${learnerId}`, `--data-dir=${dataDir}`, `--port=${apiPort}`], env);
launch(['node_modules/vite/bin/vite.js', '--host', 'localhost', '--port', String(frontendPort), '--strictPort'], {
  ...env, VITE_API_BASE: `http://127.0.0.1:${apiPort}`, VITE_AUTH_MODE: 'trusted_local',
  VITE_STUDY_PROFILE: 'mandarin', VITE_NEW_LEARNER_PREVIEW: 'true',
});
console.log(`Open the fresh welcome path: ${url}`);
console.log('Ctrl-C stops both servers. The preview database is retained; running this command again creates a new one.');
process.once('SIGINT', () => stop(0));
process.once('SIGTERM', () => stop(0));
