// Where journals live. The real journal sits outside every checkout so merges,
// worktree cleanup and reboots cannot take it; checkouts get a fixture or a copy.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';

export type Profile = 'live' | 'fixture' | 'copy' | 'custom';
type Env = Record<string, string | undefined>;

export function journalHome(env: Env = process.env) {
  if (env.JOURNAL_HOME) return env.JOURNAL_HOME;
  if (platform() === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Mandarin Journal');
  return join(env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'mandarin-journal');
}
export const livePath = (env: Env = process.env) => join(journalHome(env), 'live.sqlite');
export const backupDir = (env: Env = process.env) => join(journalHome(env), 'backups');
export const fixturePath = (checkout: string) => join(checkout, '.local', 'fixture.sqlite');
export const copyPath = (checkout: string) => join(checkout, '.local', 'live-copy.sqlite');

// The live journal follows main: only the primary checkout opens it, never an agent worktree.
export function isPrimaryCheckout(cwd: string) {
  try {
    const git = (arg: string) => execFileSync('git', ['rev-parse', '--path-format=absolute', arg], { cwd, encoding: 'utf8' }).trim();
    return git('--git-dir') === git('--git-common-dir');
  } catch {
    return false;
  }
}

const stamp = (date = new Date()) => date.toISOString().replace(/[:.]/g, '-');

// A consistent SQLite copy, read from the source without writing to it.
export async function copyDatabase(source: string, target: string) {
  mkdirSync(dirname(target), { recursive: true });
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    await backup(db, target);
  } finally {
    db.close();
  }
}

export async function snapshot(source: string, dir: string, keep = 30) {
  if (!existsSync(source) || statSync(source).size === 0) return undefined;
  const target = join(dir, 'live-' + stamp() + '.sqlite');
  await copyDatabase(source, target);
  const old = readdirSync(dir).filter((f) => /^live-.*\.sqlite$/.test(f)).sort();
  for (const file of old.slice(0, Math.max(0, old.length - keep))) rmSync(join(dir, file));
  return target;
}

export type Resolved = { profile: Profile; path: string; snapshot?: string; fresh: boolean };

export async function resolveStorage({ env = process.env, checkout, primary = isPrimaryCheckout(checkout) }: { env?: Env; checkout: string; primary?: boolean }): Promise<Resolved> {
  if (env.JOURNAL_DB) return { profile: 'custom', path: env.JOURNAL_DB, fresh: !existsSync(env.JOURNAL_DB) };
  const profile = (env.JOURNAL_PROFILE || 'fixture') as Profile;
  if (profile === 'live') {
    if (!primary && env.JOURNAL_ALLOW_LIVE !== '1')
      throw new Error('The live journal opens only from the primary checkout. Use `npm run journal:copy-live` and `npm run start:copy` in a worktree.');
    const path = livePath(env);
    mkdirSync(dirname(path), { recursive: true });
    const fresh = !existsSync(path);
    return { profile, path, fresh, snapshot: await snapshot(path, backupDir(env)) };
  }
  if (profile === 'copy') {
    const path = copyPath(checkout);
    if (!existsSync(path)) throw new Error('No copy of the live journal in this checkout yet. Run `npm run journal:copy-live` first.');
    return { profile, path, fresh: false };
  }
  if (profile === 'fixture') {
    const path = fixturePath(checkout);
    return { profile, path, fresh: !existsSync(path) };
  }
  throw new Error('Unknown JOURNAL_PROFILE "' + profile + '". Use live, fixture or copy.');
}
