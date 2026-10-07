import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildWordLifecycleSessionStudyItems } from '../src/domain/study-actions.ts';
import type { WordIntroductionResponse } from '../src/domain/word-content/application.ts';
import type { Word } from '../src/types.ts';
import { wordContentFixtures } from './fixtures/word-content.ts';
import { materializeTeachingPackage, resolveContentExerciseResponse } from '../src/domain/word-content/materialize.ts';
import {
  completeActiveUnstudiedIntro, completeActiveUnstudiedTeaching, createBucketSessionState,
  getActiveSessionUnit, markActiveSessionUnitStarted, rateActiveSessionUnit, beginBucketDrainSession,
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

const library: WordIntroductionResponse = {
  wordId: word.id,
  contents: [{ content: fixture.content, createdAt: word.createdAt }],
  packages: [{ teaching: { ...fixture.teaching, rehearsals: [
    fixture.teaching.rehearsals[0]!,
    { ...fixture.teaching.rehearsals[0]!, id: 'second-rehearsal' },
  ] }, createdAt: word.createdAt }],
  selectedPackageId: fixture.teaching.id, completed: false, generationAvailable: false, model: 'prepared',
};

function unstudiedState() {
  return createBucketSessionState({ sessionId: 'intro', seed: 1, buckets: {
    review: [], learning: [], unstudied: [{ ...word, status: 'unstudied' }],
    introductions: { [word.id]: library },
  } });
}

test('teaching starts interleaved 3x3 recall without credit; Undo restores the introduction', () => {
  const state = unstudiedState();
  const before = cloneBucketSessionState(state);
  const result = completeActiveUnstudiedTeaching(state, word.id);
  assert.deepEqual(result.commit, { type: 'none' });
  assert.equal(result.state.phase, 'active');
  assert.equal(result.state.answeredCount, 0);
  assert.deepEqual(result.state.progress.unstudied[word.id], {
    introComplete: true, successStreaks: { recognition: 0, production: 0 },
  });
  assert.equal(state.scheduler.unstudiedTeaching, undefined);
  assert.equal(getActiveSessionUnit(before).type, 'unstudied_intro');
  assert.throws(() => completeActiveUnstudiedTeaching(state, 'wrong-word'));
  assert.throws(() => completeActiveUnstudiedTeaching(learningState(), word.id));
  assert.throws(() => completeActiveUnstudiedTeaching(result.state, word.id));
  assert.throws(() => completeActiveUnstudiedTeaching({ ...state, introductions: {} }, word.id));
  const bypass = completeActiveUnstudiedIntro(state);
  assert.deepEqual(bypass.commit, { type: 'none' });
  const active = getActiveSessionUnit(bypass.state);
  if (active.type !== 'study' || 'itemType' in active.item) throw new Error('Expected word item');
  assert.equal(active.item.rehearsal, undefined);
  assert.equal(active.item.wordContent, undefined);
});

test('first encounter rotates taught production, trains recognition, and commits only after both streaks', () => {
  let state = completeActiveUnstudiedTeaching(unstudiedState(), word.id).state;
  const successes = { recognition: 0, production: 0 };
  for (let count = 0; count < 6; count += 1) {
    const active = getActiveSessionUnit(state);
    if (active.type !== 'study' || 'itemType' in active.item) throw new Error('Expected word item');
    const item = active.item;
    if (item.actionKind === 'production') {
      assert.equal(item.rehearsal?.exerciseId, library.packages[0]!.teaching.rehearsals[successes.production % 2]!.id);
      assert.equal(item.rehearsal?.packageId, fixture.teaching.id);
      assert.equal(resolveContentExerciseResponse(item.rehearsal!, word.hanzi).outcome, 'accepted');
      successes.production += 1;
    } else {
      assert.equal(item.actionKind, 'recognition');
      assert.equal(item.wordContent?.id, fixture.content.id);
      successes.recognition += 1;
    }
    const undo = cloneBucketSessionState(state);
    const result = rateActiveSessionUnit(markActiveSessionUnitStarted(state), 'good');
    assert.deepEqual(result.commit, count === 5
      ? { type: 'commit-unstudied-word-session', wordId: word.id } : { type: 'none' });
    assert.deepEqual(getActiveSessionUnit(undo), active);
    assert.deepEqual(undo.scheduler.unstudiedTeaching, state.scheduler.unstudiedTeaching);
    assert.notEqual(undo.scheduler.unstudiedTeaching, state.scheduler.unstudiedTeaching);
    state = result.state;
  }
  assert.deepEqual(successes, { recognition: 3, production: 3 });
  assert.equal(state.phase, 'completed');
  assert.equal(state.answeredCount, 6);
  assert.deepEqual(state.reviewProgress, {});
});

test('first-encounter failure resets only that direction and survives draining', () => {
  let state = completeActiveUnstudiedTeaching(unstudiedState(), word.id).state;
  state = { ...state, progress: { ...state.progress, unstudied: {
    [word.id]: { introComplete: true, successStreaks: { recognition: 2, production: 2 } },
  } } };
  const active = getActiveSessionUnit(state);
  if (active.type !== 'study' || 'itemType' in active.item) throw new Error('Expected word item');
  const skill = active.item.actionKind === 'production' ? 'production' : 'recognition';
  state = rateActiveSessionUnit(markActiveSessionUnitStarted(state), 'forgot').state;
  assert.equal(state.progress.unstudied[word.id]!.successStreaks[skill], 0);
  assert.equal(state.progress.unstudied[word.id]!.successStreaks[skill === 'production' ? 'recognition' : 'production'], 2);
  state = beginBucketDrainSession(state);
  assert.equal(state.scheduler.unstudiedPool.length, 1);
  for (let count = 0; count < 4; count += 1) {
    const result = rateActiveSessionUnit(markActiveSessionUnitStarted(state), 'good');
    assert.equal(result.commit.type, count === 3 ? 'commit-unstudied-word-session' : 'none');
    state = result.state;
  }
  assert.equal(state.phase, 'completed');
});

test('review items interleave between teaching and first-encounter reinforcement', () => {
  const initial = unstudiedState();
  const review = Array.from({ length: 12 }, (_, index) => ({
    ...buildWordLifecycleSessionStudyItems({ source: 'learning', word: { ...word, id: `review-${index}`, status: 'learning' } })[0]!,
    word: { ...word, id: `review-${index}`, status: 'review' as const },
    actionKind: 'recognition' as const, sampledSkillIds: ['recognition' as const],
  }));
  let state = completeActiveUnstudiedTeaching({
    ...initial, scheduler: { ...initial.scheduler, reviewQueue: review },
  }, word.id).state;
  const sequence: string[] = ['teaching'];
  for (let count = 0; count < 25 && state.phase !== 'completed'; count += 1) {
    const active = getActiveSessionUnit(state);
    assert.equal(active.type, 'study');
    if (active.type !== 'study') throw new Error('Expected study');
    sequence.push(active.bucket);
    state = rateActiveSessionUnit(markActiveSessionUnitStarted(state), 'good').state;
  }
  assert.equal(state.phase, 'completed');
  assert.equal(sequence.filter((bucket) => bucket === 'unstudied').length, 6);
  const lastRecall = sequence.lastIndexOf('unstudied');
  assert.ok(sequence.slice(1, lastRecall).includes('review'), sequence.join(','));
});


test('new-words-first teaches every new word before all other work and preserves Undo and interleaving', () => {
  const newWords = wordContentFixtures.slice(0, 3).map(({ content }) => ({
    ...word, id: content.word.wordId, hanzi: content.word.hanzi, traditional: content.word.traditional,
    pinyin: content.word.pinyin, status: 'unstudied' as const,
  }));
  const introductions = Object.fromEntries(wordContentFixtures.slice(0, 3).map(({ content, teaching }) => [content.word.wordId, {
    ...library, wordId: content.word.wordId, selectedPackageId: teaching.id,
    contents: [{ content, createdAt: '2026-10-02T00:00:00Z' }],
    packages: [{ teaching, createdAt: '2026-10-02T00:00:00Z' }],
  }]));
  const review = Array.from({ length: 12 }, (_, index) => ({
    ...buildWordLifecycleSessionStudyItems({ source: 'learning', word: { ...word, id: `review-first-${index}` } })[0]!,
    actionKind: 'recognition' as const, sampledSkillIds: ['recognition' as const],
  }));
  const buckets = { review, learning: [{ ...word, id: 'learning-other' }], unstudied: newWords, introductions };
  let state = createBucketSessionState({ buckets, sessionId: 'new-first', seed: 1,
    schedulerPolicy: { studyNewWordsFirst: true } });
  const taught = new Set<string>();
  for (let index = 0; index < newWords.length; index += 1) {
    const active = getActiveSessionUnit(state);
    assert.equal(active.type, 'unstudied_intro');
    if (active.type !== 'unstudied_intro') throw new Error('Expected intro');
    assert.ok(!taught.has(active.word.id));
    const undo = cloneBucketSessionState(state);
    const next = completeActiveUnstudiedTeaching(state, active.word.id);
    assert.deepEqual(next.commit, { type: 'none' });
    assert.equal(undo.scheduler.policy.studyNewWordsFirst, true);
    assert.deepEqual(completeActiveUnstudiedTeaching(undo, active.word.id), next);
    taught.add(active.word.id);
    state = next.state;
  }
  assert.equal(taught.size, newWords.length);
  const sequence: string[] = [];
  for (let count = 0; count < 100 && state.phase !== 'completed'; count += 1) {
    const active = getActiveSessionUnit(state);
    assert.equal(active.type, 'study');
    if (active.type !== 'study') throw new Error('Expected recall');
    sequence.push(active.bucket);
    state = rateActiveSessionUnit(markActiveSessionUnitStarted(state), 'good').state;
  }
  assert.equal(state.phase, 'completed');
  assert.equal(sequence.filter(bucket => bucket === 'unstudied').length, newWords.length * 6);
  assert.ok(sequence.slice(0, sequence.lastIndexOf('unstudied')).includes('review'));
  assert.ok(sequence.includes('learning'));

  const defaultState = createBucketSessionState({ buckets, sessionId: 'new-first', seed: 1 });
  const offState = createBucketSessionState({ buckets, sessionId: 'new-first', seed: 1,
    schedulerPolicy: { studyNewWordsFirst: false } });
  assert.deepEqual(getActiveSessionUnit(offState), getActiveSessionUnit(defaultState));
  assert.equal(getActiveSessionUnit(offState).type, 'study');
  const emptyNewWords = createBucketSessionState({ buckets: { ...buckets, unstudied: [] }, sessionId: 'no-new',
    schedulerPolicy: { studyNewWordsFirst: true } });
  assert.equal(getActiveSessionUnit(emptyNewWords).type, 'study');
});
