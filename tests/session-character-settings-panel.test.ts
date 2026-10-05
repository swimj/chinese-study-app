import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'node:test';
import { SessionSettingsPanel } from '../src/pages/HomeOverviewPanel.tsx';
import type { BackendStatus } from '../src/services/api.ts';

function render(characterPresentation: BackendStatus['characterPresentation'], studyProfile: BackendStatus['studyProfile'] = 'mandarin') {
  // Only the session-setting fields are consumed by this panel.
  const backendStatus = {
    dailyNewWordLimit: 10, unstudiedAdmissionSource: 'mixed', studyProfile,
    characterPresentation, sentenceCharacterPresentation: 'traditional',
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
