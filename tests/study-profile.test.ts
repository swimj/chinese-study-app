import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  normalizeProductionAnswer,
  studyProfiles,
  type ProductionMatchOptions,
} from '../src/study-profile.ts';
import {
  resolveAcceptedProductionResponse,
  resolveSessionProductionResponse,
  resolveUniqueOutOfSetWordId,
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
  const acceptedAnswers = [
    { wordId: 'anchor', hanzi: '学习', traditional: '學習' },
    { wordId: 'other', hanzi: '研习', traditional: '研習' },
    { wordId: 'homograph-a', hanzi: '行', traditional: '行' },
    { wordId: 'homograph-b', hanzi: '行', traditional: null },
  ];

  test('resolves anchor, accepted non-anchor, and traditional forms while preserving raw text', () => {
    assert.deepEqual(resolveAcceptedProductionResponse({
      submittedText: ' 學 習 ',
      anchorWordId: 'anchor',
      acceptedAnswers,
    }), {
      submittedText: ' 學 習 ',
      result: 'accepted_anchor',
    });
    assert.equal(resolveAcceptedProductionResponse({
      submittedText: '研习',
      anchorWordId: 'anchor',
      acceptedAnswers,
    }).result, 'accepted_non_anchor');
  });

  test('accepts an anchor even when an unaccepted word has the same canonical form', () => {
    assert.deepEqual(resolveAcceptedProductionResponse({
      submittedText: '行',
      anchorWordId: 'homograph-a',
      acceptedAnswers: [acceptedAnswers[2]!],
    }), {
      submittedText: '行',
      result: 'accepted_anchor',
    });
    assert.equal(resolveAcceptedProductionResponse({
      submittedText: '學習',
      anchorWordId: 'anchor',
      acceptedAnswers: [acceptedAnswers[0]!],
    }).result, 'accepted_anchor');
  });

  test('accepts a matching non-anchor and uses accepted-set order for the rare tie', () => {
    assert.deepEqual(resolveAcceptedProductionResponse({
      submittedText: '行',
      anchorWordId: 'anchor',
      acceptedAnswers: [acceptedAnswers[0]!, acceptedAnswers[3]!],
    }), {
      submittedText: '行',
      result: 'accepted_non_anchor',
    });
    assert.equal(resolveAcceptedProductionResponse({
      submittedText: '行',
      anchorWordId: 'anchor',
      acceptedAnswers: [acceptedAnswers[0]!, acceptedAnswers[3]!, acceptedAnswers[2]!],
    }).result, 'accepted_non_anchor');
  });

  test('rejects unknown text against the accepted set only', () => {
    assert.deepEqual(resolveAcceptedProductionResponse({
      submittedText: '外',
      anchorWordId: 'anchor',
      acceptedAnswers: [acceptedAnswers[0]!],
    }), {
      submittedText: '外',
      result: 'rejected',
    });
  });

  test('retains a unique known out-of-set word and leaves ambiguous or unknown text unresolved', () => {
    const catalogWords = [
      ...acceptedAnswers,
      { wordId: 'outside', hanzi: '外', traditional: null },
    ];
    assert.equal(resolveUniqueOutOfSetWordId({
      submittedText: '外',
      catalogWords,
      acceptedWordIds: ['anchor'],
    }), 'outside');
    assert.equal(resolveUniqueOutOfSetWordId({
      submittedText: '未知',
      catalogWords,
      acceptedWordIds: ['anchor'],
    }), null);
    assert.equal(resolveUniqueOutOfSetWordId({
      submittedText: '行',
      catalogWords,
      acceptedWordIds: ['anchor'],
    }), null);
  });

  test('accepts a saying without the corpus comma or surrounding symbols', () => {
    const sayingAnswers = [
      { wordId: 'saying', hanzi: '吃一堑,长一智', traditional: '吃一塹，長一智' },
    ];

    assert.deepEqual(resolveAcceptedProductionResponse({
      submittedText: '吃一堑长一智',
      anchorWordId: 'saying',
      acceptedAnswers: sayingAnswers,
    }), {
      submittedText: '吃一堑长一智',
      result: 'accepted_anchor',
    });
    assert.equal(resolveAcceptedProductionResponse({
      submittedText: '吃一塹長一智',
      anchorWordId: 'saying',
      acceptedAnswers: sayingAnswers,
    }).result, 'accepted_anchor');
  });

  test('requires a frozen snapshot for review production resolution', () => {
    assert.throws(
      () => resolveSessionProductionResponse({
        submittedText: '行',
        anchorWordId: 'homograph-a',
        production: null,
      }),
      /requires a frozen production snapshot/,
    );
  });
});
