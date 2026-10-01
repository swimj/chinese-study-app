import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WordPreparationWork } from '../server/db/preparation-work.ts';
import { createWordIntroductionService, WordIntroductionServiceError } from '../server/word-content/service.ts';
import type { WordIntroductionLibrary } from '../src/domain/word-content/application.ts';
import { wordContentFixtures } from './fixtures/word-content.ts';

const { content, teaching } = wordContentFixtures[0]!;
const wordId = content.word.wordId;
const initialLibrary: WordIntroductionLibrary = {
  wordId, contents: [], packages: [], selectedPackageId: null, completed: false,
};

function queuedWork(status: WordPreparationWork['status']): WordPreparationWork {
  return {
    workId: 'work-1', wordId, stage: 'teaching', sourceContentId: null, status,
    attemptCount: status === 'paused' ? 3 : 0, nextAttemptAt: '2026-09-25T00:00:00.000Z',
    activeToken: null, expiresAt: null, lastError: null,
  };
}

test('prepare only enqueues durable teaching work and returns pending without calling a model or pinning', async () => {
  let work: WordPreparationWork | null = null;
  let enqueues = 0;
  let wakes = 0;
  let pins = 0;
  const service = createWordIntroductionService({
    provider: { model: 'model', isConfigured: () => true },
    requireLearner: () => 'learner-1',
    store: {
      library: (id) => id === wordId ? initialLibrary : null,
      preparation: () => null,
      pin: () => { pins += 1; },
      complete: () => { throw new Error('unexpected completion'); },
    },
    queue: {
      get: () => work,
      enqueue: () => { enqueues += 1; work ??= queuedWork('queued'); return work; },
    },
    wake: () => { wakes += 1; },
  });
  assert.equal(service.get(wordId).preparationPending, false);
  const first = await service.prepare(wordId);
  assert.equal(first.preparationPending, true);
  assert.equal(first.selectedPackageId, null);
  assert.equal(enqueues, 1);
  assert.equal(wakes, 1);
  assert.equal(pins, 0);
  work = queuedWork('running');
  assert.equal(service.get(wordId).preparationPending, true);
  work = queuedWork('paused');
  const paused = await service.prepare(wordId);
  assert.equal(paused.preparationPending, false);
  assert.equal(enqueues, 1);
  assert.equal(wakes, 1);
  await assert.rejects(service.prepare('missing'),
    (error: unknown) => error instanceof WordIntroductionServiceError && error.status === 404);
});

test('open pins only an exact eligible package and completion follows that open', async () => {
  let pinned: string | null = null;
  let completed = false;
  let enqueues = 0;
  const library: WordIntroductionLibrary = {
    wordId,
    contents: [{ content, createdAt: '2026-09-25T00:00:00.000Z' }],
    packages: [{ teaching, createdAt: '2026-09-25T00:00:01.000Z' }],
    selectedPackageId: teaching.id,
    completed: false,
  };
  const service = createWordIntroductionService({
    provider: { model: 'model', isConfigured: () => false },
    requireLearner: () => 'learner-1',
    store: {
      library: (id) => id === wordId ? { ...library, selectedPackageId: pinned ?? teaching.id, completed } : null,
      preparation: () => null,
      pin: (_word, packageId) => { pinned = packageId; },
      complete: (_word, packageId) => {
        assert.equal(packageId, pinned);
        completed = true;
      },
    },
    queue: { get: () => null, enqueue: () => { enqueues += 1; return queuedWork('queued'); } },
  });
  assert.equal((await service.prepare(wordId)).selectedPackageId, teaching.id);
  assert.equal(enqueues, 0);
  assert.equal(pinned, null);
  assert.throws(() => service.open(wordId, 'another-package'),
    (error: unknown) => error instanceof WordIntroductionServiceError && error.status === 409);
  assert.equal(pinned, null);
  assert.equal(service.open(wordId, teaching.id).selectedPackageId, teaching.id);
  assert.equal(pinned, teaching.id);
  assert.equal(service.complete(wordId, teaching.id).completed, true);
});

test('a paused bootstrap dependency stops pending even while teaching remains queued', async () => {
  let enqueues = 0;
  const service = createWordIntroductionService({
    provider: { model: 'model', isConfigured: () => true },
    requireLearner: () => 'learner-1',
    store: {
      library: () => initialLibrary,
      preparation: () => null,
      pin: () => { throw new Error('unexpected pin'); },
      complete: () => { throw new Error('unexpected completion'); },
    },
    queue: {
      get: (_id, stage) => queuedWork(stage === 'bootstrap' ? 'paused' : 'queued'),
      enqueue: () => { enqueues += 1; return queuedWork('queued'); },
    },
  });
  assert.equal(service.get(wordId).preparationPending, false);
  assert.equal((await service.prepare(wordId)).preparationPending, false);
  assert.equal(service.get(wordId).preparationUnavailable, true);
  assert.equal(enqueues, 0);
});

test('opening a selected package is private to each learner and cannot open a withdrawn package', async () => {
  const secondTeaching = { ...teaching, id: 'teaching-second' };
  const pins = new Map<string, string>();
  const completed = new Set<string>();
  const packages = [teaching, secondTeaching].map((item) => ({
    teaching: item, createdAt: '2026-09-25T00:00:01.000Z',
  }));
  function forLearner(learnerId: string) {
    return createWordIntroductionService({
      provider: { model: 'model', isConfigured: () => false },
      requireLearner: () => learnerId,
      store: {
        library: () => ({
          wordId, contents: [{ content, createdAt: '2026-09-25T00:00:00.000Z' }],
          packages, selectedPackageId: pins.get(learnerId) ?? teaching.id,
          completed: completed.has(learnerId),
        }),
        preparation: () => null,
        pin: (_word, packageId) => { pins.set(learnerId, packageId); },
        complete: (_word, packageId) => {
          assert.equal(pins.get(learnerId), packageId);
          completed.add(learnerId);
        },
      },
      queue: { get: () => null, enqueue: () => { throw new Error('unexpected enqueue'); } },
    });
  }
  const learnerA = forLearner('learner-a');
  const learnerB = forLearner('learner-b');
  assert.equal(learnerA.open(wordId, secondTeaching.id).selectedPackageId, secondTeaching.id);
  assert.equal(learnerB.get(wordId).selectedPackageId, teaching.id);
  assert.equal(pins.get('learner-b'), undefined);
  assert.equal(learnerA.complete(wordId, secondTeaching.id).completed, true);
  assert.equal(learnerB.get(wordId).completed, false);

  let enqueues = 0;
  const withdrawn = createWordIntroductionService({
    provider: { model: 'model', isConfigured: () => true },
    requireLearner: () => 'learner-c',
    store: {
      library: () => ({ ...initialLibrary, selectedPackageId: null }),
      preparation: () => ({ contentId: null, packageId: secondTeaching.id, activeStage: null }),
      pin: () => { throw new Error('withdrawn package must not be pinned'); },
      complete: () => { throw new Error('withdrawn package must not be completed'); },
    },
    queue: {
      get: () => null,
      enqueue: () => { enqueues += 1; return queuedWork('queued'); },
    },
  });
  assert.equal(withdrawn.get(wordId).preparationUnavailable, true);
  assert.equal((await withdrawn.prepare(wordId)).preparationUnavailable, true);
  assert.equal(enqueues, 0);
  assert.throws(() => withdrawn.open(wordId, secondTeaching.id),
    (error: unknown) => error instanceof WordIntroductionServiceError && error.status === 409);
});
