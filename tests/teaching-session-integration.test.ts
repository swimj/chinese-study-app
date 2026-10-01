import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Word } from '../src/types.ts';
import { wordContentFixtures } from './fixtures/word-content.ts';
import { materializeTeachingPackage, resolveContentExerciseResponse } from '../src/domain/word-content/materialize.ts';
import {
  completeActiveUnstudiedIntro, completeActiveUnstudiedTeaching, createBucketSessionState,
  getActiveSessionUnit, markActiveSessionUnitStarted, rateActiveSessionUnit,
} from '../src/lib/session-state.ts';
import { cloneBucketSessionState } from '../src/features/session/session-state-copy.ts';
import { getActiveAnswerText, getActivePrompt } from '../src/features/session/session-selectors.ts';

const fixture = wordContentFixtures[0]!;
const rehearsal = { ...materializeTeachingPackage(fixture.teaching, [fixture.content]).rehearsals[0]!,
  packageId: fixture.teaching.id, wordContentId: fixture.content.id };
const word: Word = {
  id: fixture.content.word.wordId, hanzi: fixture.content.word.hanzi,
  traditional: fixture.content.word.traditional, pinyin: fixture.content.word.pinyin,
  status: 'learning', meaning: 'old broad gloss', meanings: ['old broad gloss'],
  personalNotes: '', examples: [], priority: 100, createdAt: '2026-09-25T00:00:00.000Z',
  learningStreak: 0, lastLearningSuccessOn: null, lastLearningCoveredOn: null,
};
function learningState() {
  return createBucketSessionState({ sessionId: 'teaching-session', seed: 1, buckets: {
    review: [], unstudied: [], learning: [word],
    learningRehearsals: { [word.id]: rehearsal }, learningContent: { [word.id]: fixture.content },
  } });
}

test('learning uses curated recognition and frozen target exercise with unchanged two-skill coverage', () => {
  let state = learningState();
  const seen: string[] = [];
  for (let count = 0; count < 2; count += 1) {
    const active = getActiveSessionUnit(state);
    assert.equal(active.type, 'study');
    if (active.type !== 'study' || 'itemType' in active.item) throw new Error('Expected word item');
    const item = active.item;
    seen.push(item.actionKind);
    if (item.actionKind === 'recognition') {
      assert.equal(item.rehearsal, undefined);
      assert.equal(item.wordContent?.id, fixture.content.id);
      assert.equal(getActiveAnswerText({ item, word, allMeanings: word.meanings }), fixture.content.uses[0]!.label);
    } else {
      assert.equal(item.production, null);
      assert.equal(item.rehearsal?.contract.kind, 'target_rehearsal');
      assert.equal(item.wordContent, undefined);
      assert.equal(getActivePrompt({ item, word, allMeanings: word.meanings, promptDisplayedMeanings: word.meanings }),
        `${rehearsal.instruction}\n${rehearsal.stimulus.text}`);
      assert.equal(resolveContentExerciseResponse(item.rehearsal!, '通知').outcome, 'rejected');
      assert.equal(resolveContentExerciseResponse(item.rehearsal!, '報備').outcome, 'accepted');
    }
    const result = rateActiveSessionUnit(markActiveSessionUnitStarted(state), 'good');
    if (count === 0) assert.deepEqual(result.commit, { type: 'none' });
    else assert.deepEqual(result.commit, { type: 'commit-learning-word-session', wordId: word.id, success: true });
    state = result.state;
  }
  assert.deepEqual(seen.sort(), ['production', 'recognition']);
  assert.equal(state.phase, 'completed');
  assert.deepEqual(state.reviewProgress, {});
});

test('learning miss retains the same exercise and records unsuccessful coverage, without review evidence', () => {
  let state = learningState();
  let missed = false;
  for (let index = 0; index < 10 && state.phase !== 'completed'; index += 1) {
    const active = getActiveSessionUnit(state);
    if (active.type !== 'study' || 'itemType' in active.item) throw new Error('Expected word item');
    const isProduction = active.item.actionKind === 'production';
    if (isProduction) assert.deepEqual(active.item.rehearsal, rehearsal);
    const rating = isProduction && !missed ? 'forgot' : 'good';
    if (rating === 'forgot') missed = true;
    const result = rateActiveSessionUnit(markActiveSessionUnitStarted(state), rating);
    if (result.commit.type !== 'none') assert.deepEqual(result.commit, {
      type: 'commit-learning-word-session', wordId: word.id, success: false,
    });
    state = result.state;
  }
  assert.equal(state.phase, 'completed');
  assert.deepEqual(state.reviewProgress, {});
});

test('snapshot copies keep learning content through Undo; legacy words still use existing prompts', () => {
  const state = learningState();
  const restored = cloneBucketSessionState(state);
  assert.deepEqual(restored.scheduler.learningRehearsals, state.scheduler.learningRehearsals);
  assert.notEqual(restored.scheduler.learningRehearsals?.[word.id], state.scheduler.learningRehearsals?.[word.id]);
  const legacy = createBucketSessionState({ sessionId: 'legacy', buckets: { review: [], learning: [word], unstudied: [] } });
  const active = getActiveSessionUnit(legacy);
  if (active.type !== 'study' || 'itemType' in active.item) throw new Error('Expected word item');
  assert.equal(active.item.rehearsal, undefined);
  assert.equal(active.item.wordContent, undefined);
});

test('explicit teaching completion replaces 3x3 via deferred word completion, preserving a restorable snapshot', () => {
  const state = createBucketSessionState({ sessionId: 'intro', buckets: {
    review: [], learning: [], unstudied: [{ ...word, status: 'unstudied' }],
  } });
  const before = cloneBucketSessionState(state);
  const result = completeActiveUnstudiedTeaching(state, word.id);
  assert.deepEqual(result.commit, { type: 'commit-unstudied-word-session', wordId: word.id });
  assert.equal(result.state.phase, 'completed');
  assert.equal(result.state.answeredCount, 1);
  assert.deepEqual(result.state.reviewProgress, {});
  assert.deepEqual(state, before);
  assert.equal(getActiveSessionUnit(before).type, 'unstudied_intro');
  assert.throws(() => completeActiveUnstudiedTeaching(state, 'wrong-word'));
  assert.throws(() => completeActiveUnstudiedTeaching(learningState(), word.id));
  // Bypassing the package retains the existing intro-to-drill path, not completion.
  const bypass = completeActiveUnstudiedIntro(state);
  assert.deepEqual(bypass.commit, { type: 'none' });
  assert.equal(bypass.state.phase, 'active');
});
