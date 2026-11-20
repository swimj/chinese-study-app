import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'node:test';
import { SessionSettingsPanel } from '../src/pages/HomeOverviewPanel.tsx';
import type { BackendStatus } from '../src/services/api.ts';

test('optional interests are blank by default, remembered verbatim, bounded, and Mandarin only', () => {
  function settings(studyProfile: BackendStatus['studyProfile'], debriefInterests?: string) {
    return renderToStaticMarkup(createElement(SessionSettingsPanel, { backendStatus: { studyProfile, debriefInterests, dailyNewWordLimit: 10 } as BackendStatus,
      onSaveSessionSettings: async () => {}, onSavingChange: () => {}, onClose: () => {} }));
  }
  assert.match(settings('mandarin'), /<textarea[^>]*maxLength="1000"[^>]*><\/textarea>/);
  assert.match(settings('mandarin', '  A topic\nAnother  '), /  A topic\nAnother  /);
  assert.doesNotMatch(settings('french', 'A topic'), /debrief-interests|A topic/);
});
