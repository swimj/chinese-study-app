import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { WordIntroductionResponse } from '../src/domain/word-content/application.js';
import { assertIntroductionWord, selectedIntroduction } from '../src/features/word-introduction/model.js';
import { wordContentFixtures } from './fixtures/word-content.js';

const { content, teaching } = wordContentFixtures[0]!;
const base: WordIntroductionResponse = {
  wordId: content.word.wordId,
  contents: [{ createdAt: '2026-09-25T00:00:00.000Z', content }],
  packages: [{ createdAt: '2026-09-25T00:00:01.000Z', teaching }],
  selectedPackageId: teaching.id,
  completed: false,
  generationAvailable: true,
  model: 'test',
};

describe('published word introduction selection', () => {
  test('materializes the exact server-selected package and its pinned content', () => {
    const selected = selectedIntroduction(base);
    assert.equal(selected?.package.teaching.id, teaching.id);
    assert.equal(selected?.content.content.id, content.id);
    assert.equal(selected?.snapshot.wordId, content.word.wordId);
    assert.equal(selected?.snapshot.packageId, teaching.id);
  });

  test('rejects stale word responses and broken publication references', () => {
    assert.throws(() => assertIntroductionWord('another-word', base), /different word/);
    assert.equal(selectedIntroduction({ ...base, selectedPackageId: null }), null);
    assert.throws(() => selectedIntroduction({ ...base, selectedPackageId: 'missing' }), /missing/);
    assert.throws(() => selectedIntroduction({ ...base, contents: [] }), /source is missing/);
  });
});
