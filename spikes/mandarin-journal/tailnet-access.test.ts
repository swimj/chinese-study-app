import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { after, before, test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

const checkout = fileURLToPath(new URL('.', import.meta.url));
const tailnetHost = 'journal-host.bird-tailnet.ts.net';
const tailnetOrigin = `https://${tailnetHost}`;

let root: string;
let spike: string;
let tailscale: string;
before(() => {
  root = mkdtempSync(join(tmpdir(), 'journal-tailnet-'));
  spike = join(root, 'spikes', 'mandarin-journal');
  // A disposable primary checkout exercises the real live-profile startup guard.
  cpSync(checkout, spike, {
    recursive: true,
    filter: (path) => !['node_modules', '.env', '.local'].includes(basename(path)),
  });
  symlinkSync(join(checkout, 'node_modules'), join(spike, 'node_modules'));
  symlinkSync(join(checkout, '../../scripts'), join(root, 'scripts'));
  execFileSync('git', ['init', '-q', '--template=', root]);
  tailscale = join(root, 'tailscale');
  writeFileSync(tailscale, `#!/bin/sh
test "$TAILSCALE_BE_CLI" = 1 && test "$*" = 'status --json --peers=false' || exit 1
printf '%s\\n' "$TAILSCALE_TEST_STATUS"
`, { mode: 0o755 });
  mkdirSync(join(spike, '.local'));
  writeFileSync(join(spike, '.local', 'live-copy.sqlite'), '');
});
after(() => rmSync(root, { recursive: true, force: true }));

async function start(t: TestContext, profile: 'live' | 'fixture' | 'copy', cli: string, status: string) {
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const address = socket.address();
  assert.ok(address && typeof address !== 'string');
  const { port } = address;
  socket.close();
  await once(socket, 'close');

  const server = spawn(process.execPath, ['server.ts'], {
    cwd: spike,
    env: {
      PATH: process.env.PATH,
      JOURNAL_HOME: root,
      JOURNAL_PORT: String(port),
      JOURNAL_PROFILE: profile,
      JOURNAL_TAILSCALE_BIN: cli,
      TAILSCALE_TEST_STATUS: status,
    },
  });
  const exited = once(server, 'exit');
  t.after(async () => { server.kill(); await exited; });
  let stdout = '';
  let stderr = '';
  server.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  server.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  const started = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Journal startup timed out. ${stderr}`)), 10_000);
    const check = () => {
      if (!stdout.includes(`tutor · http://127.0.0.1:${port}`)) return;
      clearTimeout(timeout);
      resolve();
    };
    server.stdout.on('data', check);
    server.once('exit', code => {
      clearTimeout(timeout);
      reject(new Error(`Journal exited with code ${code}. ${stderr}`));
    });
    server.once('error', reject);
  });
  await started;
  return { port, stdout, stderr };
}

function send(port: number, host: string, options: { origin?: string; write?: boolean; forwardedHost?: string } = {}) {
  return new Promise<number>((resolve, reject) => {
    const { origin, write, forwardedHost } = options;
    const req = request({
      hostname: '127.0.0.1',
      port,
      method: write ? 'POST' : 'GET',
      path: write ? '/api/action' : '/',
      headers: {
        Host: host,
        ...(origin !== undefined ? { Origin: origin } : {}),
        ...(forwardedHost ? { 'X-Forwarded-Host': forwardedHost, 'X-Forwarded-Proto': 'https' } : {}),
        ...(write ? { 'Content-Type': 'application/json' } : {}),
      },
    }, res => {
      res.on('end', () => resolve(res.statusCode ?? 0));
      res.on('error', reject);
      res.resume();
    });
    req.setTimeout(3000, () => req.destroy(new Error('Journal request timed out.')));
    req.on('error', reject);
    req.end(write ? JSON.stringify({ id: randomUUID(), type: 'settings', pictures: 'off' }) : undefined);
  });
}

const running = (name: string) => JSON.stringify({ BackendState: 'Running', Self: { DNSName: name } });

test('the live server discovers its HTTPS host and enforces the matching origin', async t => {
  const { port, stdout } = await start(t, 'live', tailscale, running(`${tailnetHost.toUpperCase()}.`));
  const localHost = `localhost:${port}`;
  const localOrigin = `http://${localHost}`;
  assert.ok(stdout.includes(tailnetOrigin));
  assert.equal(await send(port, tailnetHost), 200);
  assert.equal(await send(port, tailnetHost, { origin: tailnetOrigin, write: true }), 200);
  assert.equal(await send(port, localHost), 200);
  assert.equal(await send(port, localHost, { origin: localOrigin, write: true }), 200);
  assert.equal(await send(port, `127.0.0.1:${port}`), 200);
  assert.equal(await send(port, tailnetHost, { origin: `http://${tailnetHost}`, write: true }), 403);
  assert.equal(await send(port, localHost, { origin: tailnetOrigin, write: true }), 403);
  assert.equal(await send(port, tailnetHost, { origin: 'null', write: true }), 403);
  assert.equal(await send(port, `${tailnetHost}.invalid`, { forwardedHost: tailnetHost }), 403);
});

test('missing CLI, an invalid MagicDNS name, and an offline node fall back to loopback', async t => {
  const discoveryFailures = [
    { cli: join(root, 'missing-tailscale'), status: '' },
    { cli: tailscale, status: running(`https://${tailnetHost}/`) },
    { cli: tailscale, status: JSON.stringify({ BackendState: 'Stopped', Self: { DNSName: tailnetHost } }) },
  ];
  for (const { cli, status } of discoveryFailures) {
    await t.test(`fallback with ${basename(cli)} and status ${status || '(empty)'}`, async t => {
      const { port, stderr } = await start(t, 'live', cli, status);
      assert.match(stderr, /Using loopback access/);
      assert.equal(await send(port, `localhost:${port}`), 200);
      assert.equal(await send(port, tailnetHost), 403);
    });
  }
});

test('fixture and copy profiles stay loopback-only even when discovery would succeed', async t => {
  for (const profile of ['fixture', 'copy'] as const) {
    await t.test(profile, async t => {
      const { port, stdout } = await start(t, profile, tailscale, running(tailnetHost));
      assert.doesNotMatch(stdout, /Tailscale journal origin enabled/);
      assert.equal(await send(port, `localhost:${port}`), 200);
      assert.equal(await send(port, tailnetHost), 403);
    });
  }
});
