import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWordReviewPreparationService, type WordReviewStore } from '../server/word-content/review-service.ts';
import type { WordIntroductionProvider } from '../server/word-content/provider.ts';
import { wordContentFixtures } from './fixtures/word-content.ts';

const content = wordContentFixtures[0]!.content;
const output = { exercises: [{ id: 'context', cueType: 'circumstance',
  stimulus: { kind: 'direct_text', text: 'Before a visitor arrives, formally notify the office so it has a record of the visit.' }, supplement: null }] };

function fixture() {
  let active: string | null = null;
  let ready = false;
  let calls = 0;
  let fail = false;
  let publications = 0;
  const store: WordReviewStore = {
    library: () => ({ wordId: content.word.wordId, contents: [{ content, createdAt: '2026-09-25T00:00:00.000Z' }],
      packages: [], selectedPackageId: null, completed: false }),
    preparation: () => ({ contentId: content.id, packageId: null, activeStage: null }),
    claim: (_word, source, token) => {
      assert.equal(source, content.id);
      if (ready) return 'ready';
      if (active) return 'busy';
      active = token; return 'claimed';
    },
    finish: (_word, token, exercises) => {
      assert.equal(token, active);
      assert.equal(exercises[0]!.exercise.contract.kind, 'targeted_review');
      assert.deepEqual(exercises[0]!.exercise.acceptedAnswers.map((answer) => answer.wordId), [content.word.wordId]);
      publications += 1; ready = true; active = null;
      return { cueIds: exercises.map((entry) => entry.exercise.id), supplementIds: [] };
    },
    release: (_word, token) => { if (active === token) active = null; },
  };
  const provider: WordIntroductionProvider = {
    model: 'test', isConfigured: () => true,
    generateBootstrap: async () => { throw new Error('bootstrap must not rerun'); },
    generateTeaching: async () => { throw new Error('teaching must not rerun'); },
    generateReview: async (input) => {
      calls += 1; assert.deepEqual(input, content);
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (fail) throw new Error('provider failed');
      return output;
    },
  };
  const service = () => createWordReviewPreparationService({ provider, store, requireLearner: () => 'learner',
    providerWork: async (work) => work(), wait: async () => { await new Promise((resolve) => setTimeout(resolve, 1)); } });
  return { service, calls: () => calls, publications: () => publications, setFailure: (value: boolean) => { fail = value; } };
}

test('concurrent review preparation publishes once and later requests do not recreate retired work', async () => {
  const f = fixture();
  await Promise.all([f.service().prepare(content.word.wordId), f.service().prepare(content.word.wordId)]);
  assert.equal(f.calls(), 1);
  assert.equal(f.publications(), 1);
  await f.service().prepare(content.word.wordId);
  assert.equal(f.calls(), 1);
});

test('review failure releases ownership and a later request can retry without bootstrap or teaching', async () => {
  const f = fixture(); f.setFailure(true);
  await assert.rejects(f.service().prepare(content.word.wordId), /provider failed/);
  assert.equal(f.publications(), 0);
  f.setFailure(false);
  await f.service().prepare(content.word.wordId);
  assert.equal(f.calls(), 2);
  assert.equal(f.publications(), 1);
});
