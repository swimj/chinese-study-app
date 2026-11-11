import assert from 'node:assert/strict';
import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'node:test';
import { HomePage } from '../src/pages/HomePage.tsx';
import type { BackendStatus } from '../src/services/api.ts';

test('a new learner enters Home with session controls and no intake survey', () => {
  const backendStatus: BackendStatus = {
    status: 'ok',
    time: '2026-09-26T00:00:00.000Z',
    mode: 'study',
    studyProfile: 'mandarin',
    dataDir: '',
    dbPath: '',
    wordStatusCounts: { unstudied: 0, learning: 0, review: 0 },
    dietDecksActive: true,
    dailyNewWordLimit: 5,
    unstudiedAdmissionSource: 'mixed',
    characterPresentation: 'simplified',
    sentenceCharacterPresentation: 'simplified',
    studyNewWordsFirst: false,
    studyIntroductionOrder: 'random',
    studyIntroductionSpacing: 0,
    debriefInterests: '',
    learningCoverageDate: '2026-09-26',
    reviewFailureRateDays: [],
    sessionActiveTimeMetrics: {
      todayActiveDurationMs: 0,
      rolling3DayAverageActiveDurationMs: 0,
      rolling7DayAverageActiveDurationMs: 0,
    },
    serviceBanner: null,
  };
  // Deliberately partial: the pre-session overview reads only these props.
  const props = {
    backendStatus,
    sessionStarted: false,
    sessionLoading: false,
    sessionPhase: null,
    sessionFinalization: { kind: 'unfinalized' },
    sessionPrefetch: { status: 'ready', payload: null, fetchedAt: null, error: null },
    displayedSessionItemCount: 5,
    onStartSession: () => {},
    onEndSession: () => {},
    onNudgeDiet: async () => {},
    onSaveSessionSettings: async () => {},
  } as unknown as ComponentProps<typeof HomePage>;
  const markup = renderToStaticMarkup(createElement(HomePage, props));
  assert.match(markup, /Start session/);
  assert.match(markup, /5 study items ready/);
  assert.match(markup, /aria-label="Session settings"/);
  const startButton = markup.match(/<button[^>]*class="session-start-card"[^>]*>/)?.[0];
  assert.ok(startButton);
  assert.doesNotMatch(startButton, /disabled/);
  assert.doesNotMatch(markup, /diet-intake|Before your first session|background with Chinese|Roughly where are you/);
});
