import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Word } from '../src/types.ts';
import type { PureCueSessionReviewItem, SessionStudyItem } from '../src/domain/study-actions.ts';
import {
  createBucketSessionState, markActiveSessionUnitStarted, rateActiveSessionUnit,
  completeActiveUnstudiedIntro, rateActivePureCueProductionUnit, rateActiveContrastSelectionUnit,
} from '../src/lib/session-state.ts';
import { getSessionDeskOutcome, getSessionDeskUnitKey, retainSessionDeskAgainKeys, updateSessionDeskAgainKeys } from '../src/features/session/session-desk-model.ts';

function word(status: Word['status']): Word {
  return { id: 'word', hanzi: '字', traditional: null, pinyin: 'zi', meaning: 'character', meanings: ['character'], personalNotes: '', examples: [], status, priority: 1, createdAt: '2026-01-01T00:00:00.000Z', learningStreak: 0, lastLearningSuccessOn: null, lastLearningCoveredOn: null };
}
function review(): SessionStudyItem {
  return { sessionActionId: 'recognition', actionKind: 'recognition', targetWordId: 'word', sampledSkillIds: ['recognition'], contentRef: null, intervalHours: 24, word: word('review'), contrastSelection: null };
}
function stateFor(bucket: 'review' | 'learning' | 'unstudied') {
  return createBucketSessionState({
    sessionId: 'desk-test', seed: 1,
    buckets: { review: bucket === 'review' ? [review()] : [], learning: bucket === 'learning' ? [word('learning')] : [], unstudied: bucket === 'unstudied' ? [word('unstudied')] : [] },
  });
}

test('desk review exits follow real reinforcement coverage and preserve one pending pile item', () => {
  let state = stateFor('review');
  const key = getSessionDeskUnitKey('review', 'recognition');
  let keys: string[] = [];
  for (const [rating, expected] of [['forgot', 'wrong'], ['forgot', 'wrong'], ['good', 'ongoing'], ['good', 'ongoing'], ['good', 'done']] as const) {
    const transition = rateActiveSessionUnit(markActiveSessionUnitStarted(state), rating);
    const outcome = getSessionDeskOutcome(rating, transition.commit);
    assert.equal(outcome, expected);
    keys = updateSessionDeskAgainKeys(keys, key, outcome);
    assert.equal(keys.length, expected === 'done' ? 0 : 1);
    state = transition.state;
  }
  assert.equal(state.phase, 'completed');
});

test('clean hard review is complete, while learning retains its other direction', () => {
  const clean = rateActiveSessionUnit(markActiveSessionUnitStarted(stateFor('review')), 'hard');
  assert.equal(getSessionDeskOutcome('hard', clean.commit), 'done');
  let learning = rateActiveSessionUnit(markActiveSessionUnitStarted(stateFor('learning')), 'good');
  assert.equal(getSessionDeskOutcome('good', learning.commit), 'ongoing');
  learning = rateActiveSessionUnit(markActiveSessionUnitStarted(learning.state), 'good');
  assert.equal(getSessionDeskOutcome('good', learning.commit), 'done');
});

test('new word stays ongoing until both real three-recall streaks are covered', () => {
  let state = completeActiveUnstudiedIntro(stateFor('unstudied')).state;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const transition = rateActiveSessionUnit(markActiveSessionUnitStarted(state), 'good');
    assert.equal(getSessionDeskOutcome('good', transition.commit), attempt === 5 ? 'done' : 'ongoing');
    state = transition.state;
  }
});

test('pile identity follows word units for learning and action units for review; stale units disappear', () => {
  assert.equal(getSessionDeskUnitKey('learning', 'production', 'word'), getSessionDeskUnitKey('learning', 'recognition', 'word'));
  assert.notEqual(getSessionDeskUnitKey('review', 'production', 'word'), getSessionDeskUnitKey('review', 'recognition', 'word'));
  const before = ['review:recognition', 'review:removed', 'learning:word'];
  assert.deepEqual(retainSessionDeskAgainKeys(before, stateFor('review')), ['review:recognition']);
  const after = updateSessionDeskAgainKeys(before, 'review:recognition', 'done');
  assert.deepEqual(before, ['review:recognition', 'review:removed', 'learning:word'], 'undo snapshots must not be mutated');
  assert.deepEqual(after, ['review:removed', 'learning:word']);
  assert.deepEqual(updateSessionDeskAgainKeys([], 'review:contrast', 'contrast-miss'), []);
});


test('pure cues without a word anchor use the same reinforcement exits', () => {
  const item: PureCueSessionReviewItem = {
    itemType: 'pure_cue_production', sessionActionId: 'pure-cue/test', tier: 'fragile',
    snapshot: { snapshotId: 'snapshot', pureCueId: 'cue', servedAt: '2026-01-01T00:00:00.000Z', stimulus: 'character', axisNote: '', teachingNote: '', acceptedAnswers: [{ wordId: 'word', hanzi: '字', traditional: null }] },
  };
  let state = createBucketSessionState({ sessionId: 'pure-desk', buckets: { review: [item], learning: [], unstudied: [] } });
  for (const [rating, expected] of [['forgot', 'wrong'], ['good', 'ongoing'], ['good', 'ongoing'], ['good', 'done']] as const) {
    const transition = rateActivePureCueProductionUnit(markActiveSessionUnitStarted(state), rating, { response: rating === 'forgot' ? null : '字', outcome: rating === 'forgot' ? 'rejected' : 'accepted', submittedWordId: rating === 'forgot' ? null : 'word' });
    assert.equal(getSessionDeskOutcome(rating, transition.commit), expected);
    state = transition.state;
  }
});

test('a contrast miss is completed and never promises same-session reinforcement', () => {
  const item: SessionStudyItem = {
    ...review(), actionKind: 'contrast_selection', sampledSkillIds: ['contextual_selection'],
    contrastSelection: {
      clusterId: 'cluster', clusterTitle: 'contrast', clusterNote: '', scheduledWordId: 'word', promptTargetWordId: 'word',
      prompt: { id: 'prompt', clusterId: 'cluster', targetWordId: 'word', promptText: '____', explanation: '' },
      choices: [{ word: word('review'), nuanceNote: '' }, { word: { ...word('review'), id: 'other' }, nuanceNote: '' }],
    },
  };
  const state = createBucketSessionState({ sessionId: 'contrast-desk', buckets: { review: [item], learning: [], unstudied: [] } });
  const transition = rateActiveContrastSelectionUnit({ state: markActiveSessionUnitStarted(state), selectedWordId: 'other', rating: 'forgot', practiceMore: false });
  assert.equal(getSessionDeskOutcome('forgot', transition.commit), 'contrast-miss');
  assert.equal(transition.state.phase, 'completed');
});
