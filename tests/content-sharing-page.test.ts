import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'node:test';
import type { ContentSharingDigest } from '../src/domain/content-sharing.ts';
import { ContentSharingReport } from '../src/pages/ContentSharingPanel.tsx';
import { sharingWeekLabel, shiftSharingWeek } from '../src/features/operator/sharing-presentation.ts';

const digest: ContentSharingDigest = {
  weekStart: '2026-10-05', weekEnd: '2026-10-12', currentWeekStart: '2026-10-05', isCurrentWeek: true,
  generatedAt: '2026-10-09T12:00:00.000Z', newlyReused: { introductions: 1, rehearsals: 3, reviewCues: 0 },
  reflectionCuesAttemptedByOthers: { productionCues: 0, pureCues: 0, total: 0 },
  overlap: { studiedWords: 7900, wordsStudiedByMultipleLearners: 39 },
  examples: [{ contentKey: 'package:one', wordId: 'word-lag', kind: 'introduction', word: { hanzi: '滞后', pinyin: 'zhì hòu' }, title: 'Introduction: 滞后',
    firstUsedAt: '2026-10-02T03:44:42.699Z', secondLearnerUsedAt: '2026-10-07T06:24:53.186Z', learnerCount: 2,
    completedLearnerCount: 2, generation: { bootstrapAttempts: 1, bootstrapSuccessfulAttempts: 1, teachingAttempts: 1, teachingSuccessfulAttempts: 1 } }],
  coverageNotes: ['Older progress does not prove exact-content use.'],
};
function render(overrides: Partial<ContentSharingDigest> = {}) {
  return renderToStaticMarkup(createElement(ContentSharingReport, { payload: { ...digest, ...overrides } }));
}

test('report separates weekly actual reuse from current imported overlap and labels UTC dates', () => {
  const html = render();
  assert.match(html, /Week in progress/);
  assert.match(html, /Introductions newly reused/);
  assert.match(html, /Practice exercises newly reused/);
  assert.match(html, /Reflection cues used by others/);
  assert.match(html, /Review cue versions newly reused/);
  assert.match(html, /Sharing potential · current/);
  assert.match(html, /historical\/imported progress/);
  assert.match(html, /UTC/);
  assert.match(html, /Showing 1 of 4 newly reused items/);
  assert.match(html, /See reuse evidence/);
  assert.match(html, /2 distinct learners/);
  assert.match(html, /Bootstrap: 1 attempt \(1 successful\)/);
  assert.doesNotMatch(html, /Generated once|generation saved|completed the same introduction/);
});

test('empty weeks and missing preparation evidence do not invent sharing or generation claims', () => {
  const empty = render({ examples: [], newlyReused: { introductions: 0, rehearsals: 0, reviewCues: 0 }, isCurrentWeek: false });
  assert.match(empty, /Completed week/);
  assert.match(empty, /No recorded content reached its second learner/);
  assert.doesNotMatch(empty, /See reuse evidence/);
  const missing = render({ examples: [{ ...digest.examples[0], generation: null, completedLearnerCount: null }] });
  assert.doesNotMatch(missing, /Recorded preparation|Introduction completions/);
  const origin = render({ examples: [], newlyReused: { introductions: 0, rehearsals: 0, reviewCues: 0 },
    reflectionCuesAttemptedByOthers: { productionCues: 1, pureCues: 0, total: 1 } });
  assert.match(origin, /Learner-originated cues were still used by other learners/);
});

test('standalone cue labels and long content references render safely', () => {
  const html = render({ examples: [{ ...digest.examples[0], word: null, wordId: null, kind: 'pure_cue', title: '<script>private attack</script>',
    contentKey: 'a'.repeat(240), generation: null, completedLearnerCount: null }] });
  assert.match(html, /Standalone cue/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /encountered this exact content/);
});

test('week navigation crosses month and year boundaries in UTC', () => {
  assert.equal(shiftSharingWeek('2026-01-05', -1), '2025-12-29');
  assert.equal(shiftSharingWeek('2026-09-28', 1), '2026-10-05');
  assert.match(sharingWeekLabel('2026-10-05', '2026-10-12'), /2026/);
});

test('related exact items form one word example with separate learner evidence', () => {
  const exercises = [1, 2, 3].map(index => ({ ...digest.examples[0], contentKey: `exercise:${index}`, kind: 'rehearsal' as const,
    completedLearnerCount: null, generation: null, learnerCount: index + 1 }));
  const html = render({ examples: [digest.examples[0], ...exercises] });
  assert.equal((html.match(/class="stat-card sharing-example"/g) ?? []).length, 1);
  assert.match(html, /1 introduction · 3 practice exercises reached a second learner this week/);
  assert.equal((html.match(/Exact content reference/g) ?? []).length, 4);
  assert.match(html, /4 through this report’s cutoff/);
  assert.doesNotMatch(html, /Used by 4 learners|Both learners/);
});
