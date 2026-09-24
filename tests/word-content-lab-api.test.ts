import assert from 'node:assert/strict';
import express from 'express';
import { request as httpRequest, type Server } from 'node:http';
import { test } from 'node:test';
import type { IntroductionDraft } from '../src/domain/word-content/lab.ts';
import type { IntroductionLabService } from '../server/word-content-lab/service.ts';
import { createIntroductionLabRouter, introductionLabEnabled } from '../server/word-content-lab/routes.ts';
import { wordContentFixtures } from './fixtures/word-content.ts';

const config = { mode: 'dev' as const, authMode: 'trusted_local' as const, studyProfile: 'mandarin' as const };
const sample = wordContentFixtures[0]!;
const draft: IntroductionDraft = {
  id: '4dd64a39-2145-44e1-9b1e-6d90b8782abd',
  createdAt: '2026-09-24T00:00:00.000Z',
  origin: 'sample',
  content: sample.content,
  teaching: sample.teaching,
};

function fakeService(calls: string[]): IntroductionLabService {
  return {
    status: () => ({ generationAvailable: true, model: 'fake-model' }),
    listDrafts: async () => { calls.push('list'); return [draft]; },
    bootstrap: async () => { calls.push('bootstrap'); return draft; },
    generateTeaching: async (id) => { calls.push(`teach:${id}`); return draft; },
    importDraft: async () => { calls.push('import'); return draft; },
  };
}

async function withServer<T>(app: ReturnType<typeof express>, task: (url: string) => Promise<T>): Promise<T> {
  const server: Server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Expected TCP listener.');
  try { return await task(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
}

test('opt-in requires dev, trusted local, and Mandarin', () => {
  assert.equal(introductionLabEnabled(config, '1'), true);
  assert.equal(introductionLabEnabled(config, undefined), false);
  assert.equal(introductionLabEnabled({ ...config, mode: 'study' }, '1'), false);
  assert.equal(introductionLabEnabled({ ...config, authMode: 'clerk' }, '1'), false);
  assert.equal(introductionLabEnabled({ ...config, studyProfile: 'french' }, '1'), false);
});

test('local router returns bare status/drafts and blocks foreign origins and hosts', async () => {
  const calls: string[] = [];
  const app = express();
  app.use(express.json());
  app.use('/api/intro-lab', createIntroductionLabRouter(fakeService(calls)));
  await withServer(app, async (url) => {
    const status = await fetch(`${url}/api/intro-lab/status`);
    assert.equal(status.status, 200);
    assert.deepEqual(await status.json(), { generationAvailable: true, model: 'fake-model' });
    const list = await fetch(`${url}/api/intro-lab/drafts`);
    assert.deepEqual(await list.json(), [draft]);
    const blocked = await fetch(`${url}/api/intro-lab/bootstrap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' },
      body: JSON.stringify({ hanzi: '报备' }),
    });
    assert.equal(blocked.status, 403);
    assert.deepEqual(calls, ['list']);
    const hostBlocked = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(`${url}/api/intro-lab/status`, {
        headers: { Host: 'untrusted.example' },
      }, (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode ?? 0));
      });
      request.on('error', reject);
      request.end();
    });
    assert.equal(hostBlocked, 403);
    const accepted = await fetch(`${url}/api/intro-lab/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:4177' },
      body: JSON.stringify({ content: sample.content, teaching: sample.teaching }),
    });
    assert.equal(accepted.status, 201);
    assert.deepEqual(await accepted.json(), draft);
    assert.deepEqual(calls, ['list', 'import']);
  });
});

test('disabled opt-in exposes no lab routes', async () => {
  const app = express();
  if (introductionLabEnabled(config, undefined)) {
    app.use('/api/intro-lab', createIntroductionLabRouter(fakeService([])));
  }
  await withServer(app, async (url) => {
    const response = await fetch(`${url}/api/intro-lab/status`);
    assert.equal(response.status, 404);
  });
});
