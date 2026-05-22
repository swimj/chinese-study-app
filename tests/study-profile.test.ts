import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  normalizeProductionAnswer,
  studyProfiles,
  type ProductionMatchOptions,
} from '../src/study-profile.ts';

describe('study profile production matching', () => {
  test('mandarin defaults preserve current whitespace-insensitive target matching', () => {
    const options = studyProfiles.mandarin.defaultProductionMatchOptions;

    assert.equal(normalizeProductionAnswer(' 学 习 ', options), '学习');
    assert.notEqual(normalizeProductionAnswer('學習', options), normalizeProductionAnswer('学习', options));
  });

  test('french defaults ignore case and accents', () => {
    const options = studyProfiles.french.defaultProductionMatchOptions;

    assert.equal(normalizeProductionAnswer('École', options), normalizeProductionAnswer('ecole', options));
  });

  test('french defaults normalize apostrophe variants', () => {
    const options = studyProfiles.french.defaultProductionMatchOptions;

    assert.equal(normalizeProductionAnswer("l’homme", options), normalizeProductionAnswer("l'homme", options));
  });

  test('french defaults preserve articles', () => {
    const options = studyProfiles.french.defaultProductionMatchOptions;

    assert.notEqual(normalizeProductionAnswer('la maison', options), normalizeProductionAnswer('maison', options));
  });

  test('french defaults preserve hyphen-vs-space unless enabled', () => {
    const options = studyProfiles.french.defaultProductionMatchOptions;
    const hyphenInsensitiveOptions: ProductionMatchOptions = {
      ...options,
      ignoreHyphenSpacing: true,
    };

    assert.notEqual(normalizeProductionAnswer('peut-être', options), normalizeProductionAnswer('peut être', options));
    assert.equal(
      normalizeProductionAnswer('peut-être', hyphenInsensitiveOptions),
      normalizeProductionAnswer('peut être', hyphenInsensitiveOptions),
    );
  });
});
