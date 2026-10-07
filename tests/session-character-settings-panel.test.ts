import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'node:test';
import { SessionSettingsPanel } from '../src/pages/HomeOverviewPanel.tsx';
import type { BackendStatus } from '../src/services/api.ts';

function render(characterPresentation: BackendStatus['characterPresentation'], studyProfile: BackendStatus['studyProfile'] = 'mandarin', studyNewWordsFirst = false) {
  // Only the session-setting fields are consumed by this panel.
  const backendStatus = {
    dailyNewWordLimit: 10, unstudiedAdmissionSource: 'mixed', studyProfile,
    studyNewWordsFirst, characterPresentation, sentenceCharacterPresentation: 'traditional',
  } as BackendStatus;
  return renderToStaticMarkup(createElement(SessionSettingsPanel, {
    backendStatus, onSaveSessionSettings: async () => {}, onSavingChange: () => {}, onClose: () => {},
  }));
}

test('shows remembered sentence preference only with Both cards in Mandarin', () => {
  const both = render('both');
  assert.match(both, /Sentences and examples:/);
  assert.match(both, /id="sentence-character-presentation"[^>]*>.*?<option value="traditional" selected=""/);
  for (const presentation of ['simplified', 'traditional'] as const) {
    assert.doesNotMatch(render(presentation), /sentence-character-presentation/);
  }
  assert.doesNotMatch(render('both', 'french'), /sentence-character-presentation/);
});


test('new-word ordering checkbox reflects the saved preference', () => {
  assert.match(render('simplified', 'mandarin', true), /type="checkbox" checked=""\/>Study new words first/);
  assert.match(render('simplified'), /type="checkbox"\/>Study new words first/);
});
