import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { VocabularyCompletionPanel, type VocabularyCompletionPanelActions } from '../src/features/vocabulary-ui/VocabularyCompletionPanel.tsx';
import type { VocabularyCompletionView, VocabularyWordOutcome } from '../src/features/vocabulary-ui/types.ts';
import { projectVocabularySession } from '../src/domain/vocabulary-session.ts';
import { vocabularyCompletionOutcomeGroup } from '../src/features/vocabulary-study/completion-outcome.ts';

const noop = () => {};
const props: VocabularyCompletionPanelActions = { busy: false, error: null, onWordModeChange: noop,
  onPractiseWord: noop, onDismissWord: noop, onReturnHome: noop, onUndo: noop, onKeepSummaryOpen: noop,
  onCancelCompletion: noop, onRetryCompletion: noop };
const word: VocabularyWordOutcome = { word: { id: 'a', hanzi: '學', pinyin: 'xué', meaning: 'to study' },
  detail: '', group: 'new', canPractise: true, canDismiss: false,
  mode: 'solidify', modeLabel: 'Solidify', modeChoices: [{ value: 'practice', label: 'Practice', description: 'Retrieval practice spaced over time.', enabled: true }] };
const completion: VocabularyCompletionView = { status: 'pending', remainingSeconds: 12, elapsedLabel: '4:38', covered: 1, encountered: 2,
  outcomes: [word], feedback: [], canCancel: true, canUndo: true, canReturnHome: true };
function render(patch: Partial<VocabularyCompletionView> = {}, actionPatch: Partial<VocabularyCompletionPanelActions> = {}) {
  return renderToStaticMarkup(createElement(VocabularyCompletionPanel, { completion: { ...completion, ...patch }, props: { ...props, ...actionPatch } }));
}

test('vocabulary summary retains report layout, word meaning, mode controls, and pending actions', () => {
  const html = render();
  assert.match(html, /Session Summary/);
  assert.doesNotMatch(html, /Introduction completed/);
  assert.match(html, /Returning to Home in 12 seconds/);
  assert.match(html, /Today’s new words/);
  assert.match(html, /學/); assert.match(html, /xué/); assert.match(html, /to study/);
  assert.match(html, /Learning mode for 學/);
  assert.match(html, /provisional/);
  assert.match(html, /Undo last action/); assert.match(html, /Return to study/); assert.match(html, /Keep summary open/);
  assert.ok(html.indexOf('Return to Home') < html.indexOf('Today’s new words'));
  assert.match(html, /4:38 of study/);
  assert.doesNotMatch(html, /Words solidified|Left for next time|Coming back more reliably/);
});

test('large word groups collapse with native disclosures and retain every word', () => {
  const html = render({ outcomes: Array.from({ length: 8 }, (_, index) => ({ ...word, word: { ...word.word, id: String(index) } })) });
  assert.match(html, /<summary>View words<\/summary>/);
  assert.match(html, /vocab-summary-count">8/);
  assert.equal((html.match(/<li>/g) ?? []).length, 8);
});

test('keep-open and closed summaries separate finalization from navigation and retain read-only feedback', () => {
  assert.match(render({ keepOpen: true }), /Undo is available for 12 more seconds/);
  assert.match(render({ keepOpen: true }), /This summary will stay open/);
  const html = render({ status: 'closed', canUndo: false, canCancel: false, outcomes: [{ ...word, canPractise: false }],
    feedback: [{ id: 'note', title: 'Practice note', body: 'A retained lesson.' }] });
  assert.match(html, /Session saved/); assert.match(html, /A retained lesson/);
  assert.doesNotMatch(html, /Undo last action|Return to study|Keep summary open|Practise more|Returning to Home/);
  assert.match(render({ status: 'failed' }, { error: 'Offline' }), /Try saving again/);
});

test('word groups reflect teaching, mode progression, and coverage without inventing recall credit', () => {
  const projected = projectVocabularySession({ sessionId: 's', words: [{ wordId: 'a', mode: 'solidify' }] }, []).words.a;
  assert.equal(vocabularyCompletionOutcomeGroup(projected, 'practice', false), 'graduated');
  assert.equal(vocabularyCompletionOutcomeGroup(projected, 'solidify', false), 'unfinished');
  assert.equal(vocabularyCompletionOutcomeGroup({ ...projected, covered: true, successfulRecall: false }, 'solidify', false), 'covered');
  assert.equal(vocabularyCompletionOutcomeGroup({ ...projected, initialMode: 'unstudied', teachingCompleted: true }, 'solidify', false), 'new');
  assert.equal(vocabularyCompletionOutcomeGroup(projected, 'practice', true), 'unfinished');
  assert.equal(vocabularyCompletionOutcomeGroup({ ...projected, initialMode: 'practice', covered: true }, 'maintain', false), 'covered');
  const html = render({ outcomes: [{ ...word, group: 'graduated', detail: 'Solidify → Practice.' }, { ...word, word: { ...word.word, id: 'b' }, group: 'unfinished', detail: 'Unfinished; remains due for another session.' }] });
  assert.match(html, /Words solidified/); assert.match(html, /Left for next time/); assert.match(html, /Solidify → Practice/);
});
