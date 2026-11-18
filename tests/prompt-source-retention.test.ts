import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/check-prompt-retention.mjs', import.meta.url));

const register = fileURLToPath(new URL('../scripts/register-invocation-prompt.mjs', import.meta.url));

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
  function check(base: string, diagnostic?: RegExp) {
    const run = spawnSync(process.execPath, [script, base, 'HEAD'], { cwd, encoding: 'utf8' });
    assert.equal(run.status, diagnostic ? 1 : 0, run.stderr);
    if (diagnostic) assert.match(run.stderr, diagnostic);
  }
  const active = join(cwd, 'server/example/prompts');
  const archive = join(cwd, 'server/example/other-prompts/archive');
  const catalog = join(cwd, 'server/db/invocation-prompt-catalog.json');
  mkdirSync(join(cwd, 'server/db'), { recursive: true });
  writeFileSync(catalog, '[]');
  mkdirSync(active, { recursive: true });
  mkdirSync(archive, { recursive: true });
  writeFileSync(join(active, 'example.md'), 'version one\n');
  writeFileSync(join(active, 'README.md'), 'source directory');
  const baseline = commit();

  writeFileSync(join(active, 'example.md'), 'version two\n');
  rmSync(join(active, 'README.md'));
  commit();
  check(baseline, /Missing prompt source/);

  const saved = join(archive, 'example-v1.md');
  writeFileSync(saved, 'version one\n');
  const archived = commit();
  check(baseline);

  renameSync(saved, join(cwd, 'elsewhere.md'));
  symlinkSync('../../../../elsewhere.md', saved);
  commit();
  check(archived, /Missing prompt source/);

  const retired = join(cwd, 'elsewhere.md');
  const registerFile = () => execFileSync(process.execPath, [register, retired], { cwd, encoding: 'utf8' }).trim();
  const hash = registerFile();
  assert.equal(registerFile(), hash);
  assert.deepEqual(JSON.parse(readFileSync(catalog, 'utf8')), [hash]);
  const prompt = join(cwd, 'artifacts/invocation-prompts', hash + '.txt');
  assert.deepEqual(readFileSync(prompt), readFileSync(retired));
  const outsideImage = commit();
  check(archived);

  writeFileSync(catalog, '[]');
  commit();
  check(outsideImage, /catalog must list/);

  writeFileSync(catalog, JSON.stringify([hash]));
  writeFileSync(prompt, 'different bytes');
  commit();
  check('HEAD', /hash mismatch/);

  rmSync(prompt);
  writeFileSync(join(active, 'restored.md'), 'version one\n');
  writeFileSync(catalog, '[]');
  commit();
  check(outsideImage, /Archived prompt removed/);
});
