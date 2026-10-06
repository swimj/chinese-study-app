import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Word } from '../src/types.ts';
import type { PureCueSessionReviewItem, SessionStudyItem } from '../src/domain/study-actions.ts';
import { createBucketSessionState, markActiveSessionUnitStarted, getActiveSessionUnit, rateActiveSessionUnit,
  rateActiveContrastSelectionUnit, rateActivePureCueProductionUnit, completeActiveUnstudiedIntro, beginBucketDrainSession } from '../src/lib/session-state.ts';
import { createSessionSummary, updateSessionSummaryForRating, updateSessionSummaryForPureCueRating } from '../src/features/session/session-summary.ts';
import { validateDebriefInventory } from '../src/domain/session-debrief.ts';

function word(id: string, status: Word['status'] = 'review'): Word {
  return { id, hanzi: id === 'A' ? '选' : id, traditional: id === 'A' ? '選' : null, pinyin: `${id}-pinyin`,
    meaning: id, meanings: [id], personalNotes: '', examples: [], status, priority: 0,
    createdAt: '2026-10-06T00:00:00.000Z', learningStreak: 0, lastLearningSuccessOn: null, lastLearningCoveredOn: null };
}
function item(w: Word, id = w.id): SessionStudyItem {
  return { sessionActionId: id, actionKind: 'recognition', targetWordId: w.id, sampledSkillIds: ['recognition'],
    contentRef: null, intervalHours: 24, word: w, contrastSelection: null, production: null };
}
function summary() { return createSessionSummary({ sessionId: 'inventory', startedAt: '2026-10-06T00:00:00.000Z', initialQueueLength: 100 }); }

test('reinforcement records only a covered exercise; immutable summary restores exact inventory on Undo', () => {
  const a = word('A'); const card = item(a);
  let state = createBucketSessionState({ sessionId: 'inventory', buckets: { review: [card], learning: [], unstudied: [] } });
  let current = summary(); const initial = current;
  for (const rating of ['forgot', 'good', 'good', 'good'] as const) {
    state = markActiveSessionUnitStarted(state);
    const before = current;
    const transition = rateActiveSessionUnit(state, rating);
    current = updateSessionSummaryForRating({ summary: current, transition, rating, activeWord: a, activeItem: card, previousPhase: state.phase })!;
    assert.equal(current.debriefInventory.length, transition.commit.type === 'none' ? 0 : 1);
    assert.deepEqual(before.debriefInventory, []);
    state = transition.state;
  }
  assert.deepEqual(current.debriefInventory, [{ word: '选', pinyin: 'A-pinyin' }]);
  // Undo is the controller's snapshot assignment; no array or object was mutated.
  current = initial;
  assert.deepEqual(current.debriefInventory, []);
});

test('covered learning and new word each add one row; unvisited drain queue adds none', () => {
  for (const status of ['learning', 'unstudied'] as const) {
    const w = word(status, status);
    let state = createBucketSessionState({ sessionId: 'inventory', buckets: { review: [], learning: status === 'learning' ? [w] : [], unstudied: status === 'unstudied' ? [w] : [] } });
    if (status === 'unstudied') state = completeActiveUnstudiedIntro(state).state;
    let current = summary();
    for (let pass = 0; state.phase !== 'completed' && pass < 10; pass += 1) {
      const active = getActiveSessionUnit(state); assert.equal(active.type, 'study');
      if (active.type !== 'study') throw new Error('Expected word item');
      state = markActiveSessionUnitStarted(state);
      const transition = rateActiveSessionUnit(state, 'good');
      current = updateSessionSummaryForRating({ summary: current, transition, rating: 'good', activeWord: w, activeItem: active.item, previousPhase: state.phase })!;
      state = transition.state;
    }
    assert.equal(state.phase, 'completed');
    assert.deepEqual(current.debriefInventory, [{ word: status, pinyin: `${status}-pinyin` }]);
  }
  const unvisited = createBucketSessionState({ sessionId: 'inventory', buckets: { review: [], learning: [word('unvisited', 'learning')], unstudied: [] } });
  beginBucketDrainSession(unvisited);
  assert.deepEqual(summary().debriefInventory, []);
});

test('contrast captures actual prompt target with frozen pronunciation and chosen characters, not scheduled anchor', () => {
  const anchor = word('anchor'); const target = word('A');
  const card: SessionStudyItem = { ...item(anchor), actionKind: 'contrast_selection', sampledSkillIds: ['contextual_selection'],
    contrastSelection: { clusterId: 'cluster', clusterTitle: '', clusterNote: '', scheduledWordId: anchor.id,
      promptTargetWordId: target.id, prompt: { id: 'prompt', clusterId: 'cluster', targetWordId: target.id, promptText: 'Prompt', explanation: '' },
      choices: [{ word: anchor, nuanceNote: '' }, { word: target, nuanceNote: '' }] } };
  const state = markActiveSessionUnitStarted(createBucketSessionState({ sessionId: 'inventory', buckets: { review: [card], learning: [], unstudied: [] } }));
  const transition = rateActiveContrastSelectionUnit({ state, selectedWordId: anchor.id, rating: 'forgot', practiceMore: false });
  const next = updateSessionSummaryForRating({ summary: summary(), transition, rating: 'forgot', activeWord: anchor,
    activeItem: card, previousPhase: state.phase, characterPresentation: 'traditional' })!;
  assert.deepEqual(next.debriefInventory, [{ word: '選', pinyin: 'A-pinyin' }]);
  target.pinyin = 'later edit'; target.hanzi = 'later edit';
  assert.deepEqual(next.debriefInventory, [{ word: '選', pinyin: 'A-pinyin' }]);
});

test('purecue keeps frozen accepted alternatives in one ordered exercise with truthful blank pinyin', () => {
  const cue: PureCueSessionReviewItem = { itemType: 'pure_cue_production', sessionActionId: 'pure', tier: 'fragile',
    snapshot: { snapshotId: 'snapshot', pureCueId: 'cue', servedAt: '2026-10-06T00:00:00.000Z', stimulus: 'Choose', axisNote: '', teachingNote: '',
      acceptedAnswers: [{ wordId: 'A', hanzi: '选', traditional: '選' }, { wordId: 'B', hanzi: '挑', traditional: null }] } };
  const state = markActiveSessionUnitStarted(createBucketSessionState({ sessionId: 'inventory', buckets: { review: [cue], learning: [], unstudied: [] } }));
  const transition = rateActivePureCueProductionUnit(state, 'good', { response: '选', outcome: 'accepted', submittedWordId: 'A' });
  const next = updateSessionSummaryForPureCueRating({ summary: summary(), transition, previousPhase: state.phase, activePureCue: cue })!;
  assert.deepEqual(next.debriefInventory, [{ word: '选 / 挑', pinyin: '' }]);
  assert.doesNotThrow(() => validateDebriefInventory(next.debriefInventory));
  assert.equal(next.completedPureCueActions, 1);
});

test('distinct covered directions retain repeated word rows and an empty session remains empty', () => {
  const w = word('A'); const first = item(w, 'recognition'); const second: SessionStudyItem = { ...item(w, 'production'), actionKind: 'production', sampledSkillIds: ['production'],
    production: { taskId: 'task', cueId: 'cue', cueType: 'minimal_context', text: 'Choose', acceptedAnswers: [{ wordId: w.id, hanzi: w.hanzi, traditional: w.traditional }], supplement: null } };
  let state = createBucketSessionState({ sessionId: 'inventory', buckets: { review: [first, second], learning: [], unstudied: [] } });
  let current = summary();
  while (state.phase !== 'completed') {
    const active = getActiveSessionUnit(state); if (active.type !== 'study') throw new Error('Expected study');
    state = markActiveSessionUnitStarted(state); const transition = rateActiveSessionUnit(state, 'good', active.item.actionKind === 'production'
      ? { response: w.hanzi, productionResponse: { submittedText: w.hanzi, result: 'accepted_anchor' } } : {});
    current = updateSessionSummaryForRating({ summary: current, transition, rating: 'good', activeWord: w, activeItem: active.item, previousPhase: state.phase })!;
    state = transition.state;
  }
  assert.deepEqual(current.debriefInventory, [{ word: '选', pinyin: 'A-pinyin' }, { word: '选', pinyin: 'A-pinyin' }]);
  assert.deepEqual(summary().debriefInventory, []);
});
