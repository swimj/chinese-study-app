import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'node:test';
import { SessionSettingsPanel } from '../src/pages/HomeOverviewPanel.tsx';
import type { BackendStatus } from '../src/services/api.ts';

function render(characterPresentation: BackendStatus['characterPresentation'], studyProfile: BackendStatus['studyProfile'] = 'mandarin', studyNewWordsFirst = false, introductionSettings: Partial<Pick<BackendStatus, 'studyIntroductionOrder' | 'studyIntroductionSpacing'>> = {}) {
  // Only the session-setting fields are consumed by this panel.
  const backendStatus = {
    dailyNewWordLimit: 10, unstudiedAdmissionSource: 'mixed', studyProfile,
    studyNewWordsFirst, characterPresentation, sentenceCharacterPresentation: 'traditional', ...introductionSettings,
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


test('introduction order reflects the saved preference and legacy fallback', () => {
  assert.match(render('simplified', 'mandarin', true), /value="first" selected=""/);
  assert.match(render('simplified'), /value="random" selected=""/);
  const paced = render('simplified', 'mandarin', true, { studyIntroductionOrder: 'paced' });
  assert.match(paced, /value="paced" selected=""/);
  assert.match(paced, /id="study-introduction-spacing"[^>]*>.*?<option value="3" selected=""/);
  assert.match(paced, /value="10"/);
  assert.doesNotMatch(paced, /value="11"/);
  assert.match(paced, /New-word practice joins the mix after all introductions are done/);
  assert.doesNotMatch(render('simplified'), /id="study-introduction-spacing"/);
});

test('paced introduction spacing reflects its remembered value', () => {
  const markup = render('simplified', 'mandarin', false, {
    studyIntroductionOrder: 'paced', studyIntroductionSpacing: 10,
  });
  assert.match(markup, /id="study-introduction-spacing"[^>]*>.*?<option value="10" selected=""/);
});
