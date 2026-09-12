import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  formatExpectedProductionAnswerCopy,
  isSharedAnswerSpaceAcceptedSet,
  isSharedAnswerSpaceProduction,
  listAcceptedProductionAnswerLabels,
  sharedAnswerSpaceKey,
} from '../src/domain/production-answer-space.ts';

describe('production answer space', () => {
  test('classifies accepted sets and keys them independently of order', () => {
    assert.equal(isSharedAnswerSpaceAcceptedSet(['only']), false);
    assert.equal(isSharedAnswerSpaceAcceptedSet(['a', 'b']), true);
    assert.equal(sharedAnswerSpaceKey(['b', 'a', 'b']), 'a/b');
    assert.equal(
      sharedAnswerSpaceKey(['shared-third-word', 'shared-first-word', 'shared-second-word']),
      sharedAnswerSpaceKey(['shared-first-word', 'shared-second-word', 'shared-third-word']),
    );
  });

  test('formats expected-answer copy for single and shared answer spaces', () => {
    assert.equal(formatExpectedProductionAnswerCopy({
      acceptedAnswers: [{ wordId: 'a', hanzi: '难怪', traditional: null }],
      anchorHanzi: '难怪',
    }), '"难怪"');
    assert.equal(formatExpectedProductionAnswerCopy({
      acceptedAnswers: [
        { wordId: 'a', hanzi: '难怪', traditional: null },
        { wordId: 'b', hanzi: '怪不得', traditional: null },
      ],
      anchorHanzi: '难怪',
    }), 'one of "难怪", "怪不得"');
    assert.equal(isSharedAnswerSpaceProduction({
      acceptedAnswers: [
        { wordId: 'a', hanzi: '难怪', traditional: null },
        { wordId: 'b', hanzi: '怪不得', traditional: null },
      ],
    }), true);
    assert.deepEqual(
      listAcceptedProductionAnswerLabels([
        { wordId: 'a', hanzi: '难怪', traditional: null },
        { wordId: 'b', hanzi: '怪不得', traditional: null },
      ]),
      ['难怪', '怪不得'],
    );
  });
});
