import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'node:http';
import { describe, test } from 'node:test';
import type { WordIntroductionResponse } from '../src/domain/word-content/application.ts';
import type { TeachingPackage, WordContentDocument } from '../src/domain/word-content/types.ts';
import { WordIntroductionError } from '../server/db/word-introductions.ts';
import { createWordIntroductionRouter } from '../server/word-content/routes.ts';
import {
  createWordIntroductionService,
  WordIntroductionServiceError,
  type WordIntroductionService,
  type WordIntroductionStore,
} from '../server/word-content/service.ts';
import type { WordIntroductionProvider } from '../server/word-content/provider.ts';
import { wordContentFixtures } from './fixtures/word-content.ts';

const emptyLibrary: WordIntroductionResponse = {
  wordId: 'word-1', contents: [], packages: [], selectedPackageId: null,
  completed: false, generationAvailable: true, model: 'test-model',
};

const fixture = wordContentFixtures[0]!;
const lexical = {
  wordId: fixture.content.word.wordId,
  hanzi: fixture.content.word.hanzi,
  traditional: fixture.content.word.traditional,
  pinyin: fixture.content.word.pinyin,
  meanings: ['notify for the record'],
};
const bootstrapWire = { uses: fixture.content.uses, examples: fixture.content.examples };
const teachingWire = {
  beats: fixture.teaching.beats,
  rehearsals: [{ id: 'rehearsal-test', stimulus: { kind: 'direct_text', text: 'Recall the expression just taught.' } }],
};

function fakeStores() {
  let content: WordContentDocument | null = null;
  let teaching: TeachingPackage | null = null;
  let active: { stage: 'bootstrap' | 'teaching'; token: string; expiresAt: string } | null = null;
  const pins = new Map<string, string>();
  const completions = new Set<string>();
  const counts = { bootstrap: 0, teaching: 0, waits: 0 };
  function store(learnerId: string): WordIntroductionStore {
    return {
      lexical: (wordId) => wordId === lexical.wordId ? lexical : null,
      library: (wordId) => wordId === lexical.wordId ? {
        wordId,
        contents: content ? [{ createdAt: '2026-09-25T00:00:00.000Z', content }] : [],
        packages: teaching ? [{ createdAt: '2026-09-25T00:00:01.000Z', teaching }] : [],
        selectedPackageId: pins.get(learnerId) ?? teaching?.id ?? null,
        completed: completions.has(learnerId),
      } : null,
      preparation: (wordId) => wordId === lexical.wordId ? {
        contentId: content?.id ?? null, packageId: teaching?.id ?? null, activeStage: active?.stage ?? null,
      } : null,
      claim: (wordId, stage, token, now, expiresAt) => {
        assert.equal(wordId, lexical.wordId);
        if (stage === 'bootstrap' && content) return 'ready';
        if (stage === 'teaching' && teaching) return 'ready';
        if (active && active.expiresAt > now) return 'busy';
        active = { stage, token, expiresAt };
        return 'claimed';
      },
      finishBootstrap: (wordId, token, value) => {
        assert.equal(wordId, lexical.wordId);
        assert.equal(active?.token, token);
        content = value;
        active = null;
        return { createdAt: '2026-09-25T00:00:00.000Z', content: value };
      },
      finishTeaching: (wordId, token, value) => {
        assert.equal(wordId, lexical.wordId);
        assert.equal(active?.token, token);
        assert.equal(value.wordContentId, content?.id);
        teaching = value;
        active = null;
        return { createdAt: '2026-09-25T00:00:01.000Z', teaching: value };
      },
      release: (_wordId, token) => { if (active?.token === token) active = null; },
      pin: (_wordId, packageId) => { pins.set(learnerId, packageId); },
      complete: (_wordId, packageId) => {
        assert.equal(pins.get(learnerId), packageId);
        completions.add(learnerId);
      },
    };
  }
  return { store, pins, counts, contents: () => content, package: () => teaching };
}

function fakeProvider(counts: { bootstrap: number; teaching: number }, overrides: {
  bootstrap?: () => Promise<unknown>;
  teaching?: () => Promise<unknown>;
} = {}): WordIntroductionProvider {
  return {
    model: 'test-model',
    isConfigured: () => true,
    generateBootstrap: async () => {
      counts.bootstrap += 1;
      return overrides.bootstrap ? overrides.bootstrap() : bootstrapWire;
    },
    generateTeaching: async () => {
      counts.teaching += 1;
      return overrides.teaching ? overrides.teaching() : teachingWire;
    },
  };
}

function serviceFor(stores: ReturnType<typeof fakeStores>, learnerId: string, provider: WordIntroductionProvider) {
  return createWordIntroductionService({
    provider, store: stores.store(learnerId), requireLearner: () => learnerId,
    providerWork: async (work) => work(),
    wait: async () => {
      stores.counts.waits += 1;
      await new Promise((resolve) => setTimeout(resolve, 1));
    },
  });
}

describe('shared word introduction preparation', () => {
  test('two service instances generate each stage once and pin privately for both callers', async () => {
    const stores = fakeStores();
    const provider = fakeProvider(stores.counts, {
      bootstrap: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return bootstrapWire;
      },
      teaching: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return teachingWire;
      },
    });
    const first = serviceFor(stores, 'learner-a', provider);
    const second = serviceFor(stores, 'learner-b', provider);
    const [a, b] = await Promise.all([
      first.prepare(lexical.wordId), second.prepare(lexical.wordId),
    ]);
    assert.equal(stores.counts.bootstrap, 1);
    assert.equal(stores.counts.teaching, 1);
    assert.ok(stores.counts.waits > 0);
    assert.equal(a.selectedPackageId, b.selectedPackageId);
    assert.equal(stores.pins.get('learner-a'), a.selectedPackageId);
    assert.equal(stores.pins.get('learner-b'), b.selectedPackageId);
    assert.equal(a.contents.length, 1);
    assert.equal(a.packages.length, 1);
  });

  test('teaching failure keeps bootstrap and retry reuses it', async () => {
    const stores = fakeStores();
    let failTeaching = true;
    const provider = fakeProvider(stores.counts, {
      teaching: async () => {
        if (failTeaching) throw new Error('provider unavailable');
        return teachingWire;
      },
    });
    await assert.rejects(serviceFor(stores, 'learner-a', provider).prepare(lexical.wordId),
      (error: unknown) => error instanceof WordIntroductionServiceError && error.status === 502);
    assert.ok(stores.contents());
    assert.equal(stores.package(), null);
    failTeaching = false;
    const retried = await serviceFor(stores, 'learner-b', provider).prepare(lexical.wordId);
    assert.ok(retried.selectedPackageId);
    assert.equal(stores.counts.bootstrap, 1);
    assert.equal(stores.counts.teaching, 2);
  });

  test('malformed stage output is never published', async () => {
    const malformedBootstrap = fakeStores();
    await assert.rejects(serviceFor(malformedBootstrap, 'learner-a', fakeProvider(malformedBootstrap.counts, {
      bootstrap: async () => ({ uses: [], examples: [] }),
    })).prepare(lexical.wordId),
    (error: unknown) => error instanceof WordIntroductionServiceError && error.status === 502);
    assert.equal(malformedBootstrap.contents(), null);
    assert.equal(malformedBootstrap.package(), null);

    const malformedTeaching = fakeStores();
    await assert.rejects(serviceFor(malformedTeaching, 'learner-a', fakeProvider(malformedTeaching.counts, {
      teaching: async () => ({ beats: [], rehearsals: [] }),
    })).prepare(lexical.wordId),
    (error: unknown) => error instanceof WordIntroductionServiceError && error.status === 502);
    assert.ok(malformedTeaching.contents());
    assert.equal(malformedTeaching.package(), null);
  });
});

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
  test('accepts exact prepare and complete requests, rejecting lexical and learner overrides', async () => {
    const calls: string[] = [];
    const service: WordIntroductionService = {
      get: (wordId) => { calls.push(`get:${wordId}`); return emptyLibrary; },
      prepare: async (wordId) => { calls.push(`prepare:${wordId}`); return emptyLibrary; },
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

      for (const invalid of [{}, { packageId: '' }, { packageId: 'package-1', learnerId: 'other' }]) {
        const rejected = await jsonPost(`${url}/complete`, invalid);
        assert.equal(rejected.status, 400);
      }
      const completed = await jsonPost(`${url}/complete`, { packageId: 'package-1' });
      assert.equal(completed.status, 200);
      assert.deepEqual(await completed.json(), emptyLibrary);
    });
    assert.deepEqual(calls, ['get:word-1', 'prepare:word-1', 'complete:word-1:package-1']);
  });

  test('maps availability, conflict, and unexpected failures to meaningful statuses', async () => {
    const service: WordIntroductionService = {
      get: () => { throw new WordIntroductionServiceError(404, 'Word not found.'); },
      prepare: async () => { throw new WordIntroductionServiceError(503, 'Generation unavailable.'); },
      complete: () => { throw new WordIntroductionError('conflict', 'Unavailable package.'); },
    };
    await withRouter(service, async (base) => {
      const url = `${base}/api/words/word-1/introduction`;
      const missing = await fetch(url);
      assert.equal(missing.status, 404);
      const unavailable = await jsonPost(`${url}/prepare`, {});
      assert.equal(unavailable.status, 503);
      const conflict = await jsonPost(`${url}/complete`, { packageId: 'package-1' });
      assert.equal(conflict.status, 409);
    });
  });
});
