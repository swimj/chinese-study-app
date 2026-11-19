import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { normalizeProductionAnswerForProfile } from '../src/study-profile.ts';
import {
  buildProductionAnswerLookup,
  deriveAcceptedSubmittedWordId,
  resolveAcceptedProductionResponse,
  resolveUniqueOutOfSetWordId,
} from '../src/domain/production-response.ts';

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

describe('production response resolution', () => {
  const acceptedAnswers = [
    { wordId: 'anchor', hanzi: '学习', traditional: '學習' },
    { wordId: 'other', hanzi: '研习', traditional: '研習' },
    { wordId: 'homograph-a', hanzi: '行', traditional: '行' },
    { wordId: 'homograph-b', hanzi: '行', traditional: null },
  ];

  test('accepts target traditional forms and rejects alternate words while preserving raw text', () => {
    assert.deepEqual(resolveAcceptedProductionResponse({
      submittedText: ' 學 習 ',
      anchorWordId: 'anchor',
      acceptedAnswers: [acceptedAnswers[0]!],
    }), {
      submittedText: ' 學 習 ',
      result: 'accepted_anchor',
    });
    assert.equal(resolveAcceptedProductionResponse({
      submittedText: '研习',
      anchorWordId: 'anchor',
      acceptedAnswers: [acceptedAnswers[0]!],
    }).result, 'rejected');
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

  test('rejects multi-answer served forms even when the target or an alternate matches', () => {
    for (const submittedText of ['学习', '行']) {
      assert.throws(() => resolveAcceptedProductionResponse({
        submittedText,
        anchorWordId: 'anchor',
        acceptedAnswers: [acceptedAnswers[0]!, acceptedAnswers[3]!],
      }), /exactly one accepted answer/);
    }
    assert.throws(() => resolveAcceptedProductionResponse({
      submittedText: '行',
      anchorWordId: 'homograph-a',
      acceptedAnswers: [acceptedAnswers[2]!, acceptedAnswers[3]!],
    }), /exactly one accepted answer/);
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
    const answerLookup = buildProductionAnswerLookup(catalogWords);
    assert.equal(resolveUniqueOutOfSetWordId({
      submittedText: '外',
      answerLookup,
      acceptedWordIds: ['anchor'],
    }), 'outside');
    assert.equal(resolveUniqueOutOfSetWordId({
      submittedText: '未知',
      answerLookup,
      acceptedWordIds: ['anchor'],
    }), null);
    assert.equal(resolveUniqueOutOfSetWordId({
      submittedText: '行',
      answerLookup,
      acceptedWordIds: ['anchor'],
    }), null);
  });

  test('server attribution returns only the target or null and rejects inconsistent results', () => {
    assert.equal(deriveAcceptedSubmittedWordId({
      result: 'accepted_anchor',
      submittedText: ' 學 習 ',
      anchorWordId: 'anchor',
      acceptedAnswers: [acceptedAnswers[0]!],
    }), 'anchor');
    assert.equal(deriveAcceptedSubmittedWordId({
      result: 'rejected',
      submittedText: '研习',
      anchorWordId: 'anchor',
      acceptedAnswers: [acceptedAnswers[0]!],
    }), null);
    assert.throws(() => deriveAcceptedSubmittedWordId({
      result: 'accepted_anchor',
      submittedText: '研习',
      anchorWordId: 'anchor',
      acceptedAnswers: [acceptedAnswers[0]!],
    }), /does not match the frozen target-only answer form/);
    assert.throws(() => deriveAcceptedSubmittedWordId({
      result: 'accepted_anchor',
      submittedText: '行',
      anchorWordId: 'homograph-a',
      acceptedAnswers: [acceptedAnswers[2]!, acceptedAnswers[3]!],
    }), /exactly one accepted answer/);
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
});
