import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildHostedImage } from '../scripts/lib/hosted-build.ts';
import type { HostedUpgradeDeps } from '../scripts/lib/hosted-upgrade.ts';

const REVISION = 'c'.repeat(40);
const DIGEST = `sha256:${'e'.repeat(64)}`;
const FLY_TOML = 'app = "chinese-study-beta-swimj"\nprimary_region = "sin"\n[mounts]\n  destination = "/data"\n[[http_service.checks]]\n  path = "/healthz"\n[[vm]]\n  size = "shared-cpu-1x"\n';

function harness(options: { registryStatus?: number; digest?: string; dirty?: string; notFoundFirst?: number } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hosted-build-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '4.0.0' }));
  fs.mkdirSync(path.join(root, 'deploy/fly/.generated'), { recursive: true });
  fs.writeFileSync(path.join(root, 'deploy/fly/.generated/fly.toml'), FLY_TOML);
  const commands: string[][] = [];
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  let sleeps = 0;
  const deps: HostedUpgradeDeps = {
    now: () => new Date('2026-11-18T02:00:00Z'),
    sleep: async () => { sleeps++; },
    readFile: (file) => fs.readFileSync(file, 'utf8'),
    fileExists: (file) => fs.existsSync(file),
    gitHead: () => REVISION,
    gitStatusPorcelain: () => options.dirty ?? '',
    gitRevisionOnMainline: () => { throw new Error('a build must not require origin/main'); },
    run: async (_file, args) => {
      commands.push([...args]);
      return { stdout: args[0] === 'auth' ? 'secret-fly-token\n' : '', stderr: '' };
    },
    fetch: async (input, init) => {
      requests.push({ url: String(input), init });
      if (requests.length <= (options.notFoundFirst ?? 0)) return new Response(null, { status: 404 });
      return new Response(null, { status: options.registryStatus ?? 200, headers: { 'docker-content-digest': options.digest ?? DIGEST } });
    },
    emit: () => {},
  };
  const input = { repoRoot: root, imageApp: 'chinese-study-rehearsal-swimj', confirmSourceRevision: REVISION };
  return { input, deps, commands, requests, sleeps: () => sleeps, clean: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('builds and pushes without deploying, then resolves the tag to a digest-qualified image', async () => {
  const h = harness();
  try {
    const result = await buildHostedImage(h.input, h.deps);
    assert.equal(result.image, `registry.fly.io/chinese-study-rehearsal-swimj:release-${REVISION}@${DIGEST}`);
    assert.deepEqual(result.plannedRelease, { appVersion: '4.0.0', sourceRevision: REVISION });
    const build = h.commands.find((args) => args[0] === 'deploy')!;
    for (const flag of ['--build-only', '--push', '--remote-only']) assert.ok(build.includes(flag));
    assert.equal(build[build.indexOf('--app') + 1], 'chinese-study-rehearsal-swimj');
    assert.ok(build.includes(`APP_REVISION=${REVISION}`));
    assert.equal(h.requests[0]?.url, `https://registry.fly.io/v2/chinese-study-rehearsal-swimj/manifests/release-${REVISION}`);
    assert.equal(JSON.stringify(result).includes('secret-fly-token'), false);
    assert.ok(!h.commands.flat().some((arg) => arg.includes('secret-fly-token')), 'the token never reaches a command line');
  } finally { h.clean(); }
});

test('refuses a dirty checkout or invalid image app before building', async () => {
  const dirty = harness({ dirty: ' M server/index.ts\n' });
  try {
    await assert.rejects(buildHostedImage(dirty.input, dirty.deps), /uncommitted image-source changes/);
    await assert.rejects(buildHostedImage({ ...dirty.input, imageApp: 'Bad App' }, dirty.deps), /Fly app name/);
    assert.deepEqual(dirty.commands, []);
  } finally { dirty.clean(); }
});

test('fails when the registry cannot confirm a sha256 digest', async () => {
  for (const options of [{ registryStatus: 401 }, { digest: 'sha256:short' }]) {
    const h = harness(options);
    try {
      await assert.rejects(buildHostedImage(h.input, h.deps), /Registry/);
    } finally { h.clean(); }
  }
});

test('retries a just-pushed tag that the registry briefly reports as missing', async () => {
  const h = harness({ notFoundFirst: 2 });
  try {
    const result = await buildHostedImage(h.input, h.deps);
    assert.equal(result.digest, DIGEST);
    assert.equal(h.requests.length, 3);
    assert.equal(h.sleeps(), 2);
  } finally { h.clean(); }
});

test('gives up after a bounded number of missing-tag lookups', async () => {
  const h = harness({ registryStatus: 404 });
  try {
    await assert.rejects(buildHostedImage(h.input, h.deps), /HTTP 404/);
    assert.equal(h.requests.length, 12);
  } finally { h.clean(); }
});
