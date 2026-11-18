import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/check-prompt-retention.mjs', import.meta.url));

test('each committed prompt source version must survive in a tracked regular prompt file', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'prompt-retention-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' });
  git('init', '--quiet');
  function commit(): string {
    git('add', '-A');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'snapshot');
    return git('rev-parse', 'HEAD').trim();
  }
  function check(base: string, expectedStatus: number) {
    const run = spawnSync(process.execPath, [script, base, 'HEAD'], { cwd, encoding: 'utf8' });
    assert.equal(run.status, expectedStatus, run.stderr);
    if (expectedStatus) assert.match(run.stderr, /Missing prompt source/);
  }
  const active = join(cwd, 'server/example/prompts');
  const archive = join(cwd, 'server/example/other-prompts/archive');
  mkdirSync(active, { recursive: true });
  mkdirSync(archive, { recursive: true });
  writeFileSync(join(active, 'example.md'), 'version one\n');
  writeFileSync(join(active, 'README.md'), 'source directory');
  const baseline = commit();

  writeFileSync(join(active, 'example.md'), 'version two\n');
  rmSync(join(active, 'README.md'));
  commit();
  check(baseline, 1);

  const saved = join(archive, 'example-v1.md');
  writeFileSync(saved, 'version one\n');
  const archived = commit();
  check(baseline, 0);

  renameSync(saved, join(cwd, 'elsewhere.md'));
  symlinkSync('../../../../elsewhere.md', saved);
  commit();
  check(archived, 1);
});
