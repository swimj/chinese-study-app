import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const apiPort = readPort('INTRO_LAB_API_PORT', 5178);
const frontendPort = readPort('INTRO_LAB_PORT', 4177);
if (apiPort === frontendPort) throw new Error('Introduction lab ports must differ.');
const children: ChildProcess[] = [];
let stopping = false;
function stop(exitCode: number) {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;
  for (const child of children) child.kill('SIGTERM');
  const timer = setTimeout(() => {
    for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
  }, 5_000);
  timer.unref();
}
function launch(args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: 'inherit' });
  children.push(child);
  child.on('error', (error) => { console.error(error.message); stop(1); });
  child.on('exit', (code, signal) => {
    if (!stopping) stop(code === 0 && !signal ? 0 : 1);
  });
}

console.log(`Introduction lab: http://localhost:${frontendPort}/intro-lab`);
console.log('Drafts and the synthetic dev database are isolated in data/intro-lab/.');
launch([
  '--import', 'tsx', 'server/index.ts', '--mode=dev', '--auth-mode=trusted_local',
  '--study-profile=mandarin', '--learner-id=introduction-lab',
  '--data-dir=data/intro-lab', '--seed-data=server/seeds/mandarin-dev.json', `--port=${apiPort}`,
], { ...process.env, APP_WORD_CONTENT_WORKBENCH: '1', APP_METRICS_PORT: '' });
launch([
  'node_modules/vite/bin/vite.js', '--host', 'localhost', '--port', String(frontendPort), '--strictPort',
], { ...process.env, VITE_API_BASE: `http://localhost:${apiPort}`, VITE_AUTH_MODE: 'trusted_local', VITE_STUDY_PROFILE: 'mandarin' });
process.once('SIGINT', () => stop(0));
process.once('SIGTERM', () => stop(0));

function readPort(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) throw new Error(`Invalid ${name}.`);
  return value;
}
