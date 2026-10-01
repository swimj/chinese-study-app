import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBucketSessionState } from '../src/lib/session-state.ts';
import { cloneBucketSessionState } from '../src/features/session/session-state-copy.ts';
import type { WordIntroductionResponse } from '../src/domain/word-content/application.ts';
import { wordContentFixtures } from './fixtures/word-content.ts';

const { content, teaching } = wordContentFixtures[0]!;
const library: WordIntroductionResponse = {
  wordId: content.word.wordId,
  contents: [{ content, createdAt: '2026-01-01T00:00:00.000Z' }],
  packages: [{ teaching, createdAt: '2026-01-01T00:00:00.000Z' }],
  selectedPackageId: teaching.id,
  completed: false,
  generationAvailable: false,
  model: 'prepared',
};

test('admitted introduction is copied into session and survives an undo snapshot', () => {
  const state = createBucketSessionState({
    sessionId: 'session-1',
    buckets: { review: [], learning: [], unstudied: [], introductions: { [content.word.wordId]: library } },
  });
  assert.deepEqual(state.introductions[content.word.wordId], library);
  assert.notEqual(state.introductions[content.word.wordId], library);
  const copied = cloneBucketSessionState(state);
  assert.equal(copied.introductions[content.word.wordId], state.introductions[content.word.wordId]);
});
