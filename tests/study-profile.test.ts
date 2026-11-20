import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { normalizeProductionAnswerForProfile } from '../src/study-profile.ts';

describe('study profile production matching', () => {
  test('mandarin defaults ignore whitespace, commas, and other symbols', () => {
    assert.equal(normalizeProductionAnswerForProfile(' 学 习 ', 'mandarin'), '学习');
    assert.equal(
      normalizeProductionAnswerForProfile('吃一堑长一智', 'mandarin'),
      normalizeProductionAnswerForProfile('吃一堑,长一智', 'mandarin'),
    );
    assert.equal(
      normalizeProductionAnswerForProfile('吃一堑长一智', 'mandarin'),
      normalizeProductionAnswerForProfile('吃一堑，长一智。', 'mandarin'),
    );
    assert.equal(normalizeProductionAnswerForProfile('“学习”', 'mandarin'), '学习');
    assert.notEqual(normalizeProductionAnswerForProfile('學習', 'mandarin'), normalizeProductionAnswerForProfile('学习', 'mandarin'));
  });

  test('french defaults ignore case and accents', () => {
    assert.equal(normalizeProductionAnswerForProfile('École', 'french'), normalizeProductionAnswerForProfile('ecole', 'french'));
  });

  test('french defaults normalize apostrophe variants', () => {
    assert.equal(normalizeProductionAnswerForProfile("l’homme", 'french'), normalizeProductionAnswerForProfile("l'homme", 'french'));
  });

  test('french defaults preserve articles', () => {
    assert.notEqual(normalizeProductionAnswerForProfile('la maison', 'french'), normalizeProductionAnswerForProfile('maison', 'french'));
  });

  test('french defaults preserve hyphen-vs-space', () => {
    assert.notEqual(normalizeProductionAnswerForProfile('peut-être', 'french'), normalizeProductionAnswerForProfile('peut être', 'french'));
  });
});
