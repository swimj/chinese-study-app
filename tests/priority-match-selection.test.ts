import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, test } from 'node:test';
import {
  digitKeyToMatchIndex,
  matchIndexShortcutLabel,
  toggleSelectedMatchId,
} from '../src/features/priority/priority-match-selection.ts';
import { PriorityPage, type PriorityPageProps } from '../src/pages/PriorityPage.tsx';
import type { Word } from '../src/types.ts';

describe('priority match selection helpers', () => {
  test('maps digit keys 1-9 and 0 onto the first ten match indices', () => {
    assert.equal(digitKeyToMatchIndex('1'), 0);
    assert.equal(digitKeyToMatchIndex('9'), 8);
    assert.equal(digitKeyToMatchIndex('0'), 9);
    assert.equal(digitKeyToMatchIndex('a'), null);
    assert.equal(digitKeyToMatchIndex('10'), null);
  });

  test('renders shortcut labels for the first ten rows only', () => {
    assert.equal(matchIndexShortcutLabel(0), '1');
    assert.equal(matchIndexShortcutLabel(8), '9');
    assert.equal(matchIndexShortcutLabel(9), '0');
    assert.equal(matchIndexShortcutLabel(10), null);
  });

  test('toggles selected match ids without mutating the prior array', () => {
    const original = ['a'];
    assert.deepEqual(toggleSelectedMatchId(original, 'b'), ['a', 'b']);
    assert.deepEqual(toggleSelectedMatchId(['a', 'b'], 'a'), ['b']);
    assert.deepEqual(original, ['a']);
  });
});

describe('priority match picker markup', () => {
  test('shows numbered multi-select matches above the add field', () => {
    const markup = render({
      matchChoices: {
        query: '学',
        matches: [
          word('dup-a', '学', 'xué', 'study'),
          word('dup-b', '学', 'xué', 'learn; school'),
        ],
      },
      selectedMatchIds: ['dup-b'],
    });

    assert.match(markup, /id="priority-match-picker"/);
    assert.match(markup, /2 matches for “学”/);
    assert.match(markup, /aria-multiselectable="true"/);
    assert.match(markup, /aria-selected="true"/);
    assert.match(markup, />1</);
    assert.match(markup, />2</);
    assert.match(markup, /Add selected \(1\)/);
    assert.match(markup, /learn · school/);
  });
});

function render(overrides: Partial<PriorityPageProps> = {}): string {
  return renderToStaticMarkup(createElement(PriorityPage, {
    rows: [],
    searchHanzi: '',
    searchNotice: null,
    searchSubmitting: false,
    matchChoices: null,
    selectedMatchIds: [],
    highlightedWordIds: [],
    onSearchHanziChange: () => {},
    onSearchSubmit: () => {},
    onToggleMatchSelection: () => {},
    onConfirmMatchSelection: () => {},
    onCancelMatchSelection: () => {},
    onHighlightsHandled: () => {},
    priorityBatchSubmitting: false,
    onRequireForNextSession: async () => {},
    onMoveSelectedToTop: async () => {},
    onMoveSelectedToStash: async () => {},
    onRemoveSelected: async () => {},
    ...overrides,
  }));
}

function word(id: string, hanzi: string, pinyin: string, meaning: string): Word {
  return {
    id,
    hanzi,
    traditional: null,
    pinyin,
    meaning,
    meanings: meaning.split('; ').map((part) => part.trim()),
    personalNotes: '',
    examples: [],
    status: 'unstudied',
    priority: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    learningStreak: 0,
    lastLearningSuccessOn: null,
    lastLearningCoveredOn: null,
  };
}
