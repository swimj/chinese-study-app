import { execFile, type ChildProcess } from 'node:child_process';
import type { CommandRunner } from './hosted-upgrade.ts';

/** Latch shutdown across subprocess boundaries and wait for the active writer. */
export function createMigrationCommandRunner() {
  let interrupted: NodeJS.Signals | null = null;
  let active: ChildProcess | null = null;
  const cancelled = () => new Error(`Hosted migration interrupted by ${interrupted}; keep the app stopped.`);
  const run: CommandRunner = (file, argv, options) => new Promise((resolve, reject) => {
    if (interrupted) { reject(cancelled()); return; }
    active = execFile(file, [...argv], {
      encoding: 'utf8', timeout: options?.timeoutMs, maxBuffer: 1024 * 1024,
      cwd: options?.cwd, env: options?.env,
    }, (error, stdout, stderr) => {
      active = null;
      if (interrupted) reject(cancelled());
      else if (error) reject(error);
      else resolve({ stdout, stderr });
    });
  });
  return { run, interrupt(signal: NodeJS.Signals) { interrupted ??= signal; active?.kill(signal); } };
}
