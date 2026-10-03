import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'node:test';
import { SessionIntroductionGatePanel } from '../src/features/session/SessionIntroductionGatePanel.tsx';
import { WordIntroductionExperience } from '../src/features/word-introduction/WordIntroductionExperience.tsx';
import type { SessionIntroductionGate } from '../src/features/session/useIntroductionGate.ts';
import { wordContentFixtures } from './fixtures/word-content.ts';

const { content, teaching } = wordContentFixtures[0]!;
const gate: SessionIntroductionGate = {
  key: 'session/word', wordId: content.word.wordId, status: 'introduction',
  dismiss: () => { throw new Error('Teaching must not be bypassed'); },
  complete: () => {},
  preloadedIntroduction: {
    wordId: content.word.wordId, selectedPackageId: teaching.id,
    contents: [{ content, createdAt: '2026-10-02T00:00:00Z' }],
    packages: [{ teaching, createdAt: '2026-10-02T00:00:00Z' }],
    completed: false, generationAvailable: false, model: 'prepared',
  },
};

test('session teaching has no close callback for its button or Escape; completion and Undo remain', () => {
  const panel = SessionIntroductionGatePanel({ gate, onUndo: () => {} });
  const experience = panel.props.children[0];
  assert.equal(experience.type, WordIntroductionExperience);
  assert.equal(experience.props.onCompleted, gate.complete);
  const markup = renderToStaticMarkup(panel);
  assert.doesNotMatch(markup, /Continue with study cards|Back to word|Begin recall drills/);
  assert.match(markup, /Next beat|Finish walkthrough/);
  assert.match(markup, /Undo last study action/);
});
