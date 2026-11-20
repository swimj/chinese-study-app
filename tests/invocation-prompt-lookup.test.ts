import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const lookup = fileURLToPath(new URL('../scripts/lookup-invocation-prompt.mjs', import.meta.url));
const register = fileURLToPath(new URL('../scripts/register-invocation-prompt.mjs', import.meta.url));
const repo = fileURLToPath(new URL('../', import.meta.url));

type LookupMatch = {
  hash: string;
  path: string;
  uses: { name: string; version: string }[];
};

function find(cwd: string, ...args: string[]): LookupMatch[] {
  return JSON.parse(execFileSync(process.execPath, [lookup, ...args], { cwd, encoding: 'utf8' }));
}

test('operator lookup identifies the cataloged selector and inventory in both directions', () => {
  const selectorHash = '8678212c4a0c7c833247ddfdc11ed8e30175bf7254e6fa6795b56bbc804201e0';
  const inventoryHash = '1ed63131e8f5ea247d8366342905553175ae369ba79b1b14f59451d94357bce5';
  for (const [hash, name, version] of [
    [selectorHash, 'vocabulary-default-useful-selection', '7'],
    [inventoryHash, 'vocabulary-sense-inventory', '8'],
  ]) {
    const path = `artifacts/invocation-prompts/${hash}.txt`;
    const fullMatches = find(repo, 'hash', hash);
    assert.equal(fullMatches.length, 1);
    assert.equal(fullMatches[0].hash, hash);
    assert.equal(fullMatches[0].path, path);
    assert.ok(fullMatches[0].uses.some(use => use.name === name && use.version === version));
    assert.deepEqual(find(repo, 'hash', hash.slice(0, 8).toUpperCase()), fullMatches);
    assert.ok(find(repo, 'use', name, version).some(match => match.hash === hash));
    assert.equal(createHash('sha256').update(readFileSync(join(repo, path))).digest('hex'), hash);
  }
});

test('registration preserves many-to-many lookup for prompts with no invocation rows', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'invocation-prompt-lookup-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const usesDir = join(cwd, 'server/db/invocation-prompt-uses');
  mkdirSync(usesDir, { recursive: true });
  writeFileSync(join(cwd, 'server/db/invocation-prompt-catalog.json'), '[]');
  const original = 'Example system prompt.\n';
  const hash = createHash('sha256').update(original).digest('hex');
  // These different prompts share the first hex digit of their digests.
  const variant = 'Example system prompt variant 6.\n';
  const alternateHash = createHash('sha256').update(variant).digest('hex');
  assert.equal(hash[0], alternateHash[0]);
  writeFileSync(join(cwd, 'original.txt'), original);
  writeFileSync(join(cwd, 'variant.txt'), variant);
  writeFileSync(join(cwd, 'unlabeled.txt'), 'Retained source without a named use.\n');

  function add(...args: string[]) {
    return execFileSync(process.execPath, [register, ...args], { cwd, encoding: 'utf8' }).trim().split('\n');
  }
  assert.deepEqual(add('--use=example', '--version=1', 'original.txt', 'variant.txt'), [hash, alternateHash]);
  assert.deepEqual(add('--use=example', '--version=1', 'original.txt'), [hash]);
  assert.deepEqual(add('--use=example', '--version=2', 'original.txt'), [hash]);
  assert.deepEqual(add('--use=other-example', '--version=1', 'original.txt'), [hash]);
  const [unlabeledHash] = add('unlabeled.txt');
  writeFileSync(join(usesDir, 'recovered.json'), JSON.stringify([{ name: 'historical-example', version: '0', hash }]));
  assert.deepEqual(add('--use=historical-example', '--version=0', 'original.txt'), [hash]);
  const pathFor = (digest: string) => `artifacts/invocation-prompts/${digest}.txt`;
  const expected = {
    hash, path: pathFor(hash), uses: [
      { name: 'example', version: '1' },
      { name: 'example', version: '2' },
      { name: 'historical-example', version: '0' },
      { name: 'other-example', version: '1' },
    ],
  };
  assert.deepEqual(find(cwd, 'hash', hash), [expected]);
  assert.deepEqual(find(cwd, 'use', 'other-example', '1'), [expected]);
  assert.deepEqual(find(cwd, 'use', 'example', '2'), [expected]);
  assert.deepEqual(find(cwd, 'use', 'example', '1'), [
    expected, { hash: alternateHash, path: pathFor(alternateHash), uses: [{ name: 'example', version: '1' }] },
  ].sort((first, second) => first.hash.localeCompare(second.hash)));
  assert.deepEqual(find(cwd, 'hash', unlabeledHash), [{ hash: unlabeledHash, path: pathFor(unlabeledHash), uses: [] }]);
  assert.equal(readFileSync(join(cwd, expected.path), 'utf8'), original);
  assert.equal(readdirSync(join(cwd, 'artifacts/invocation-prompts')).length, 3);
  assert.equal(existsSync(join(cwd, 'data')), false);

  for (const { args, diagnostic } of [
    { args: ['hash', hash[0]], diagnostic: /Ambiguous invocation prompt hash prefix/ },
    { args: ['hash', 'f'.repeat(64)], diagnostic: /No cataloged invocation prompt/ },
    { args: ['use', 'example', '9'], diagnostic: /No cataloged invocation prompt/ },
    { args: ['use', 'example'], diagnostic: /Usage:/ },
  ]) {
    const result = spawnSync(process.execPath, [lookup, ...args], { cwd, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, diagnostic);
  }
});
