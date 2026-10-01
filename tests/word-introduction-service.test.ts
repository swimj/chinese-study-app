import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'node:http';
import { describe, test } from 'node:test';
import type { WordIntroductionResponse } from '../src/domain/word-content/application.ts';
import { WordIntroductionError } from '../server/db/word-introductions.ts';
import { createWordIntroductionRouter } from '../server/word-content/routes.ts';
import {
  WordIntroductionServiceError,
  type WordIntroductionService,
} from '../server/word-content/service.ts';

const emptyLibrary: WordIntroductionResponse = {
  wordId: 'word-1', contents: [], packages: [], selectedPackageId: null,
  completed: false, generationAvailable: true, model: 'test-model',
};

async function withRouter<T>(service: WordIntroductionService, task: (base: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use('/api/words', createWordIntroductionRouter(service));
  const server: Server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Expected a local TCP listener.');
  try { return await task(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
}

function jsonPost(url: string, value: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value),
  });
}

describe('word introduction HTTP routes', () => {
  test('accepts exact prepare, open, and complete requests, rejecting lexical and learner overrides', async () => {
    const calls: string[] = [];
    const service: WordIntroductionService = {
      get: (wordId) => { calls.push(`get:${wordId}`); return emptyLibrary; },
      prepare: async (wordId) => { calls.push(`prepare:${wordId}`); return emptyLibrary; },
      open: (wordId, packageId) => { calls.push(`open:${wordId}:${packageId}`); return emptyLibrary; },
      complete: (wordId, packageId) => { calls.push(`complete:${wordId}:${packageId}`); return emptyLibrary; },
    };
    await withRouter(service, async (base) => {
      const url = `${base}/api/words/word-1/introduction`;
      const get = await fetch(url);
      assert.equal(get.status, 200);
      assert.deepEqual(await get.json(), emptyLibrary);

      for (const extra of [{ hanzi: '你好' }, { learnerId: 'other' }, { pinyin: 'nǐ hǎo' }]) {
        const rejected = await jsonPost(`${url}/prepare`, extra);
        assert.equal(rejected.status, 400);
      }
      const prepared = await jsonPost(`${url}/prepare`, {});
      assert.equal(prepared.status, 200);
      assert.deepEqual(await prepared.json(), emptyLibrary);

      for (const action of ['open', 'complete']) {
        for (const invalid of [{}, { packageId: '' }, { packageId: 'package-1', learnerId: 'other' }]) {
          const rejected = await jsonPost(`${url}/${action}`, invalid);
          assert.equal(rejected.status, 400);
        }
      }
      const opened = await jsonPost(`${url}/open`, { packageId: 'package-1' });
      assert.equal(opened.status, 200);
      assert.deepEqual(await opened.json(), emptyLibrary);
      const completed = await jsonPost(`${url}/complete`, { packageId: 'package-1' });
      assert.equal(completed.status, 200);
      assert.deepEqual(await completed.json(), emptyLibrary);
    });
    assert.deepEqual(calls, ['get:word-1', 'prepare:word-1', 'open:word-1:package-1', 'complete:word-1:package-1']);
  });

  test('maps availability, conflict, and unexpected failures to meaningful statuses', async () => {
    const service: WordIntroductionService = {
      get: () => { throw new WordIntroductionServiceError(404, 'Word not found.'); },
      prepare: async () => { throw new WordIntroductionServiceError(503, 'Generation unavailable.'); },
      open: () => { throw new WordIntroductionError('conflict', 'Unavailable package.'); },
      complete: () => { throw new WordIntroductionError('conflict', 'Unavailable package.'); },
    };
    await withRouter(service, async (base) => {
      const url = `${base}/api/words/word-1/introduction`;
      const missing = await fetch(url);
      assert.equal(missing.status, 404);
      const unavailable = await jsonPost(`${url}/prepare`, {});
      assert.equal(unavailable.status, 503);
      const openConflict = await jsonPost(`${url}/open`, { packageId: 'package-1' });
      assert.equal(openConflict.status, 409);
      const conflict = await jsonPost(`${url}/complete`, { packageId: 'package-1' });
      assert.equal(conflict.status, 409);
    });
  });
});
