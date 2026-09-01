import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  normalizeProductionAnswer,
  studyProfiles,
  type ProductionMatchOptions,
} from '../src/study-profile.ts';
import {
  resolveProductionResponse,
  resolveSessionProductionResponse,
} from '../src/domain/production-response.ts';

describe('study profile production matching', () => {
  test('mandarin defaults ignore whitespace, commas, and other symbols', () => {
    const options = studyProfiles.mandarin.defaultProductionMatchOptions;

    assert.equal(normalizeProductionAnswer(' 学 习 ', options), '学习');
    assert.equal(
      normalizeProductionAnswer('吃一堑长一智', options),
      normalizeProductionAnswer('吃一堑,长一智', options),
    );
    assert.equal(
      normalizeProductionAnswer('吃一堑长一智', options),
      normalizeProductionAnswer('吃一堑，长一智。', options),
    );
    assert.equal(normalizeProductionAnswer('“学习”', options), '学习');
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

describe('production response resolution', () => {
  const answerWords = [
    { wordId: 'anchor', hanzi: '学习', traditional: '學習' },
    { wordId: 'other', hanzi: '研习', traditional: '研習' },
    { wordId: 'homograph-a', hanzi: '行', traditional: '行' },
    { wordId: 'homograph-b', hanzi: '行', traditional: null },
    { wordId: 'traditional-collision', hanzi: '學習', traditional: null },
    { wordId: 'outside', hanzi: '外', traditional: null },
  ];

  test('resolves anchor, accepted non-anchor, and traditional forms while preserving raw text', () => {
    assert.deepEqual(resolveProductionResponse({
      submittedText: ' 學 習 ',
      anchorWordId: 'anchor',
      acceptedWordIds: ['anchor', 'other'],
      answerWords,
    }), {
      submittedText: ' 學 習 ',
      submittedWordId: 'anchor',
      result: 'accepted_anchor',
    });
    assert.deepEqual(resolveProductionResponse({
      submittedText: '研习',
      anchorWordId: 'anchor',
      acceptedWordIds: ['anchor', 'other'],
      answerWords,
    }).result, 'accepted_non_anchor');
  });

  test('accepts an anchor even when an unaccepted word has the same canonical form', () => {
    assert.deepEqual(resolveProductionResponse({
      submittedText: '行',
      anchorWordId: 'homograph-a',
      acceptedWordIds: ['homograph-a'],
      answerWords,
    }), {
      submittedText: '行',
      submittedWordId: 'homograph-a',
      result: 'accepted_anchor',
    });
    assert.equal(resolveProductionResponse({
      submittedText: '學習',
      anchorWordId: 'anchor',
      acceptedWordIds: ['anchor'],
      answerWords,
    }).result, 'accepted_anchor');
  });

  test('accepts a matching non-anchor and uses accepted-set order for the rare tie', () => {
    assert.deepEqual(resolveProductionResponse({
      submittedText: '行',
      anchorWordId: 'anchor',
      acceptedWordIds: ['anchor', 'homograph-b'],
      answerWords,
    }), {
      submittedText: '行',
      submittedWordId: 'homograph-b',
      result: 'accepted_non_anchor',
    });
    assert.equal(resolveProductionResponse({
      submittedText: '行',
      anchorWordId: 'anchor',
      acceptedWordIds: ['anchor', 'homograph-b', 'homograph-a'],
      answerWords,
    }).submittedWordId, 'homograph-b');
  });

  test('retains a unique known out-of-set word and rejects unknown text', () => {
    assert.deepEqual(resolveProductionResponse({
      submittedText: '外',
      anchorWordId: 'anchor',
      acceptedWordIds: ['anchor'],
      answerWords,
    }), {
      submittedText: '外',
      submittedWordId: 'outside',
      result: 'rejected',
    });
    assert.equal(resolveProductionResponse({
      submittedText: '未知',
      anchorWordId: 'anchor',
      acceptedWordIds: ['anchor'],
      answerWords,
    }).submittedWordId, null);
  });

  test('accepts a saying without the corpus comma or surrounding symbols', () => {
    const sayingWords = [
      { wordId: 'saying', hanzi: '吃一堑,长一智', traditional: '吃一塹，長一智' },
    ];

    assert.deepEqual(resolveProductionResponse({
      submittedText: '吃一堑长一智',
      anchorWordId: 'saying',
      acceptedWordIds: ['saying'],
      answerWords: sayingWords,
    }), {
      submittedText: '吃一堑长一智',
      submittedWordId: 'saying',
      result: 'accepted_anchor',
    });
    assert.equal(resolveProductionResponse({
      submittedText: '吃一塹長一智',
      anchorWordId: 'saying',
      acceptedWordIds: ['saying'],
      answerWords: sayingWords,
    }).result, 'accepted_anchor');
  });

  test('requires a frozen snapshot for review production resolution', () => {
    assert.throws(
      () => resolveSessionProductionResponse({
        submittedText: '行',
        anchorWordId: 'homograph-a',
        production: null,
        answerWords,
      }),
      /requires a frozen production snapshot/,
    );
  });
});
