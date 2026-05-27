import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { SessionStudyItem, SessionStudyItemBuckets, StudySkillId } from '../src/domain/study-actions.ts';
import type { ReviewRating, Word } from '../src/types.ts';

const testSessionId = 'bucket-session-test';

describe('bucket session state covering contract', () => {
  test('learning words are covered as word units while actions are selected from uncovered skills', async () => {
    const {
      createBucketSessionState,
      getActiveSessionUnit,
      getBucketSessionProgress,
      getBucketSessionUnitCounts,
      markActiveSessionUnitStarted,
      rateActiveSessionUnit,
    } = await loadBucketSessionStateApi();
    const learningWord = createWord({ id: 'learning-word', status: 'learning' });
    let state = createBucketSessionState({
      buckets: {
        review: [],
        learning: [learningWord],
        unstudied: [],
      },
      sessionId: testSessionId,
      schedulerPolicy: {
        bucketWeights: { review: 0, learning: 1, unstudied: 0 },
      },
      seed: 1,
    });

    let active = getActiveSessionUnit(state);
    assert.equal(active.type, 'study');
    assert.equal(active.bucket, 'learning');
    assert.equal(active.item.targetWordId, learningWord.id);
    const firstSkill = onlySampledSkill(active.item.sampledSkillIds);

    state = markActiveSessionUnitStarted(state);
    let result = rateActiveSessionUnit(state, 'good');

    assert.deepEqual(result.commit, { type: 'none' });
    assert.equal(getBucketSessionProgress(result.state).learning[learningWord.id].coveredSkills[firstSkill], true);
    assert.equal(getBucketSessionUnitCounts(result.state).learning, 1);

    state = result.state;
    active = getActiveSessionUnit(state);
    assert.equal(active.type, 'study');
    assert.equal(active.bucket, 'learning');
    assert.equal(active.item.targetWordId, learningWord.id);
    const secondSkill = onlySampledSkill(active.item.sampledSkillIds);
    assert.notEqual(secondSkill, firstSkill);

    state = markActiveSessionUnitStarted(state);
    result = rateActiveSessionUnit(state, 'good');

    assert.deepEqual(result.commit, {
      type: 'commit-learning-word-session',
      wordId: learningWord.id,
      success: true,
    });
    assert.equal(getBucketSessionUnitCounts(result.state).learning, 0);
  });

  test('open lifecycle directions are selected randomly instead of always recognition first', async () => {
    const {
      completeActiveUnstudiedIntro,
      createBucketSessionState,
      getActiveSessionUnit,
    } = await loadBucketSessionStateApi();
    const learningWord = createWord({ id: 'random-learning-word', status: 'learning' });
    const unstudiedWord = createWord({ id: 'random-unstudied-word', status: 'unstudied' });

    const learningRecognitionFirst = createBucketSessionState({
      buckets: {
        review: [],
        learning: [learningWord],
        unstudied: [],
      },
      sessionId: testSessionId,
      schedulerPolicy: {
        bucketWeights: { review: 0, learning: 1, unstudied: 0 },
      },
      seed: 1,
    });
    const learningProductionFirst = createBucketSessionState({
      buckets: {
        review: [],
        learning: [learningWord],
        unstudied: [],
      },
      sessionId: testSessionId,
      schedulerPolicy: {
        bucketWeights: { review: 0, learning: 1, unstudied: 0 },
      },
      seed: 3,
    });

    let active = getActiveSessionUnit(learningRecognitionFirst);
    assert.equal(active.type, 'study');
    assert.equal(onlySampledSkill(active.item.sampledSkillIds), 'recognition');

    active = getActiveSessionUnit(learningProductionFirst);
    assert.equal(active.type, 'study');
    assert.equal(onlySampledSkill(active.item.sampledSkillIds), 'production');

    const unstudiedProductionFirst = completeActiveUnstudiedIntro(createBucketSessionState({
      buckets: {
        review: [],
        learning: [],
        unstudied: [unstudiedWord],
      },
      sessionId: testSessionId,
      schedulerPolicy: {
        bucketWeights: { review: 0, learning: 0, unstudied: 1 },
      },
      seed: 1,
    })).state;
    const unstudiedRecognitionFirst = completeActiveUnstudiedIntro(createBucketSessionState({
      buckets: {
        review: [],
        learning: [],
        unstudied: [unstudiedWord],
      },
      sessionId: testSessionId,
      schedulerPolicy: {
        bucketWeights: { review: 0, learning: 0, unstudied: 1 },
      },
      seed: 9,
    })).state;

    active = getActiveSessionUnit(unstudiedProductionFirst);
    assert.equal(active.type, 'study');
    assert.equal(onlySampledSkill(active.item.sampledSkillIds), 'production');

    active = getActiveSessionUnit(unstudiedRecognitionFirst);
    assert.equal(active.type, 'study');
    assert.equal(onlySampledSkill(active.item.sampledSkillIds), 'recognition');
  });

  test('learning word success is false when any covered skill was not first-try good', async () => {
    const {
      createBucketSessionState,
      getActiveSessionUnit,
      markActiveSessionUnitStarted,
      rateActiveSessionUnit,
    } = await loadBucketSessionStateApi();
    const learningWord = createWord({ id: 'shaky-learning-word', status: 'learning' });
    let state = createBucketSessionState({
      buckets: {
        review: [],
        learning: [learningWord],
        unstudied: [],
      },
      sessionId: testSessionId,
      schedulerPolicy: {
        bucketWeights: { review: 0, learning: 1, unstudied: 0 },
      },
      seed: 1,
    });

    let active = getActiveSessionUnit(state);
    assert.equal(active.type, 'study');
    const firstSkill = onlySampledSkill(active.item.sampledSkillIds);

    state = markActiveSessionUnitStarted(state);
    let result = rateActiveSessionUnit(state, 'forgot');
    assert.deepEqual(result.commit, { type: 'none' });

    state = result.state;
    for (let attempts = 0; result.commit.type === 'none' && attempts < 4; attempts += 1) {
      active = getActiveSessionUnit(state);
      assert.equal(active.type, 'study');
      assert.equal(active.item.targetWordId, learningWord.id);

      state = markActiveSessionUnitStarted(state);
      result = rateActiveSessionUnit(state, 'good');
      state = result.state;
    }

    assert.deepEqual(result.commit, {
      type: 'commit-learning-word-session',
      wordId: learningWord.id,
      success: false,
    });
  });

  test('unstudied words serve intro before recall drills and commit only after both skill streaks are complete', async () => {
    const {
      completeActiveUnstudiedIntro,
      createBucketSessionState,
      getActiveSessionUnit,
      getBucketSessionProgress,
      getBucketSessionUnitCounts,
      markActiveSessionUnitStarted,
      rateActiveSessionUnit,
    } = await loadBucketSessionStateApi();
    const unstudiedWord = createWord({ id: 'new-word', status: 'unstudied' });
    let state = createBucketSessionState({
      buckets: {
        review: [],
        learning: [],
        unstudied: [unstudiedWord],
      },
      sessionId: testSessionId,
      schedulerPolicy: {
        bucketWeights: { review: 0, learning: 0, unstudied: 1 },
      },
      seed: 1,
    });

    let active = getActiveSessionUnit(state);
    assert.deepEqual(active, {
      type: 'unstudied_intro',
      word: unstudiedWord,
    });

    let introResult = completeActiveUnstudiedIntro(state);
    assert.deepEqual(introResult.commit, { type: 'none' });
    assert.equal(getBucketSessionProgress(introResult.state).unstudied[unstudiedWord.id].introComplete, true);

    state = introResult.state;
    let finalResult: BucketSessionTransitionResult | null = null;
    for (let attempts = 0; attempts < 20; attempts += 1) {
      active = getActiveSessionUnit(state);
      assert.equal(active.type, 'study');
      assert.equal(active.bucket, 'unstudied');
      assert.equal(active.item.targetWordId, unstudiedWord.id);

      state = markActiveSessionUnitStarted(state);
      finalResult = rateActiveSessionUnit(state, 'good');
      state = finalResult.state;

      if (finalResult.commit.type !== 'none') {
        break;
      }

      const progress = getBucketSessionProgress(state).unstudied[unstudiedWord.id];
      assert.ok(progress.successStreaks.recognition < 3 || progress.successStreaks.production < 3);
      assert.equal(getBucketSessionUnitCounts(state).unstudied, 1);
    }

    assert.deepEqual(finalResult?.commit, {
      type: 'commit-unstudied-word-session',
      wordId: unstudiedWord.id,
    });
    assert.equal(getBucketSessionUnitCounts(state).unstudied, 0);
  });

  test('drain mode keeps only open learning and unstudied word work plus active or reinforcing review work', async () => {
    const {
      beginBucketDrainSession,
      completeActiveUnstudiedIntro,
      createBucketSessionState,
      getBucketSessionCandidateWordIds,
      getBucketSessionUnitCounts,
      markActiveSessionUnitStarted,
      rateActiveSessionUnit,
    } = await loadBucketSessionStateApi();
    const reinforcingReview = createReviewStudyItem('reinforcing-review');
    const untouchedReview = createReviewStudyItem('untouched-review');
    const untouchedLearningWord = createWord({ id: 'untouched-learning', status: 'learning' });
    const touchedLearningWord = createWord({ id: 'touched-learning', status: 'learning' });
    const untouchedUnstudiedWord = createWord({ id: 'untouched-unstudied', status: 'unstudied' });
    const touchedUnstudiedWord = createWord({ id: 'touched-unstudied', status: 'unstudied' });
    let state = createBucketSessionState({
      buckets: {
        review: [reinforcingReview, untouchedReview],
        learning: [touchedLearningWord, untouchedLearningWord],
        unstudied: [touchedUnstudiedWord, untouchedUnstudiedWord],
      },
      sessionId: testSessionId,
      schedulerPolicy: {
        bucketWeights: { review: 0, learning: 1, unstudied: 0 },
      },
      seed: 2,
    });

    state = markActiveSessionUnitStarted(state);
    state = rateActiveSessionUnit(state, 'good').state;

    state = {
      ...state,
      progress: {
        ...state.progress,
        unstudied: {
          [touchedUnstudiedWord.id]: {
            introComplete: true,
            successStreaks: { recognition: 0, production: 0 },
          },
        },
      },
      reviewProgress: {
        [reinforcingReview.sessionActionId]: {
          failureCount: 1,
          reinforcementStreak: 0,
          attempts: [],
        },
      },
    };

    const drainedState = beginBucketDrainSession(state);

    assert.equal(getBucketSessionUnitCounts(drainedState).review, 1);
    assert.deepEqual(getBucketSessionCandidateWordIds(drainedState, 'learning'), [touchedLearningWord.id]);
    assert.deepEqual(getBucketSessionCandidateWordIds(drainedState, 'unstudied'), [touchedUnstudiedWord.id]);
  });

  test('review lapse rotates behind later review actions', async () => {
    const {
      createBucketSessionState,
      getActiveSessionUnit,
      markActiveSessionUnitStarted,
      rateActiveSessionUnit,
    } = await loadBucketSessionStateApi();
    const lapsedReview = createReviewStudyItem('lapsed-review');
    const laterReview = createReviewStudyItem('later-review');
    let state = createBucketSessionState({
      buckets: {
        review: [lapsedReview, laterReview],
        learning: [],
        unstudied: [],
      },
      sessionId: testSessionId,
      schedulerPolicy: {
        bucketWeights: { review: 1, learning: 0, unstudied: 0 },
      },
      seed: 1,
    });

    const activeBeforeLapse = getActiveSessionUnit(state);
    assert.equal(activeBeforeLapse.type, 'study');
    assert.equal(activeBeforeLapse.type === 'study' ? activeBeforeLapse.item.targetWordId : null, 'lapsed-review');

    state = markActiveSessionUnitStarted(state);
    const result = rateActiveSessionUnit(state, 'forgot');
    const activeAfterLapse = getActiveSessionUnit(result.state);

    assert.equal(activeAfterLapse.type, 'study');
    assert.equal(activeAfterLapse.type === 'study' ? activeAfterLapse.item.targetWordId : null, 'later-review');
  });

  test('dismissing a lapsed review action clears its reinforcement progress', async () => {
    const {
      createBucketSessionState,
      dismissActiveBucketSessionUnit,
    } = await loadBucketSessionStateApi();
    const lapsedReview = createReviewStudyItem('lapsed-review');
    const state = {
      ...createBucketSessionState({
        buckets: {
          review: [lapsedReview],
          learning: [],
          unstudied: [],
        },
        sessionId: testSessionId,
        schedulerPolicy: {
          bucketWeights: { review: 1, learning: 0, unstudied: 0 },
        },
        seed: 1,
      }),
      reviewProgress: {
        [lapsedReview.sessionActionId]: {
          failureCount: 1,
          reinforcementStreak: 0,
          attempts: [],
        },
      },
    };

    const result = dismissActiveBucketSessionUnit(state);

    assert.deepEqual(result.state.reviewProgress, {});
  });

  test('canceling a rated review action removes queued reinforcement and decrements answered count', async () => {
    const {
      cancelRatedReviewSessionAction,
      createBucketSessionState,
      getActiveSessionUnit,
      getBucketSessionUnitCounts,
      markActiveSessionUnitStarted,
      rateActiveSessionUnit,
    } = await loadBucketSessionStateApi();
    const lapsedReview = createReviewStudyItem('lapsed-review');
    const laterReview = createReviewStudyItem('later-review');
    let state = createBucketSessionState({
      buckets: {
        review: [lapsedReview, laterReview],
        learning: [],
        unstudied: [],
      },
      sessionId: testSessionId,
      schedulerPolicy: {
        bucketWeights: { review: 1, learning: 0, unstudied: 0 },
      },
      seed: 1,
    });

    state = markActiveSessionUnitStarted(state);
    const lapsed = rateActiveSessionUnit(state, 'forgot').state as TestBucketSessionState;
    assert.equal(lapsed.answeredCount, 1);
    assert.equal(lapsed.reviewProgress[lapsedReview.sessionActionId]?.failureCount, 1);

    const activeAfterLapse = getActiveSessionUnit(lapsed);
    assert.equal(activeAfterLapse.type, 'study');
    assert.equal(activeAfterLapse.type === 'study' ? activeAfterLapse.item.sessionActionId : null, laterReview.sessionActionId);

    const canceled = cancelRatedReviewSessionAction(lapsed, lapsedReview.sessionActionId);
    assert.equal(canceled.answeredCount, 0);
    assert.equal(canceled.reviewProgress[lapsedReview.sessionActionId], undefined);
    assert.equal(getBucketSessionUnitCounts(canceled).review, 1);
  });

  test('contrast selection requires forgot for wrong choices and pass ratings for correct choices', async () => {
    const {
      createBucketSessionState,
      markActiveSessionUnitStarted,
      rateActiveContrastSelectionUnit,
    } = await loadBucketSessionStateApi();
    const item = createContrastStudyItem();
    const started = markActiveSessionUnitStarted(createBucketSessionState({
      buckets: {
        review: [item],
        learning: [],
        unstudied: [],
      },
      sessionId: testSessionId,
      schedulerPolicy: {
        bucketWeights: { review: 1, learning: 0, unstudied: 0 },
      },
      seed: 1,
    }));

    assert.throws(
      () => rateActiveContrastSelectionUnit({
        state: started,
        selectedWordId: 'contrast-distractor',
        rating: 'good',
        practiceMore: false,
      }),
      /incorrect contrast selection must be rated forgot/,
    );
    assert.throws(
      () => rateActiveContrastSelectionUnit({
        state: started,
        selectedWordId: 'contrast-target',
        rating: 'forgot',
        practiceMore: false,
      }),
      /correct contrast selection must use a passing rating/,
    );

    const result = rateActiveContrastSelectionUnit({
      state: started,
      selectedWordId: 'contrast-distractor',
      rating: 'forgot',
      practiceMore: false,
    });

    assert.equal(result.commit.type, 'commit-contrast-selection-action-session');
    if (result.commit.type !== 'commit-contrast-selection-action-session') {
      throw new Error('Expected contrast selection commit');
    }
    assert.equal(result.commit.rating, 'forgot');
    assert.equal(result.commit.event.outcome, 'incorrect');
    assert.equal(result.commit.event.response, 'contrast-distractor');
    assert.equal(result.commit.promptTargetWordId, 'contrast-target');
  });
});

type BucketSessionActiveUnit =
  | {
      type: 'study';
      bucket: 'review' | 'learning' | 'unstudied';
      item: {
        sessionActionId: string;
        targetWordId: string;
        sampledSkillIds: StudySkillId[];
      };
    }
  | {
      type: 'unstudied_intro';
      word: Word;
    };

type BucketSessionTransitionResult = {
  state: unknown;
  commit:
    | { type: 'none' }
    | { type: 'commit-learning-word-session'; wordId: string; success: boolean }
    | { type: 'commit-unstudied-word-session'; wordId: string }
    | {
        type: 'commit-contrast-selection-action-session';
        rating: ReviewRating;
        event: { outcome: 'correct' | 'incorrect'; response: string | null };
        promptTargetWordId: string;
      };
};

type BucketSessionStateApi = {
  beginBucketDrainSession: (state: unknown) => unknown;
  completeActiveUnstudiedIntro: (state: unknown) => BucketSessionTransitionResult;
  createBucketSessionState: (options: {
    buckets: SessionStudyItemBuckets;
    schedulerPolicy?: {
      bucketWeights: {
        review: number;
        learning: number;
        unstudied: number;
      };
    };
    seed?: number;
    sessionId: string;
  }) => unknown;
  cancelRatedReviewSessionAction: (state: unknown, sessionActionId: string) => {
    answeredCount: number;
    reviewProgress: Record<string, { failureCount: number } | undefined>;
  };
  dismissActiveBucketSessionUnit: (state: unknown) => { state: { reviewProgress: Record<string, unknown> } };
  getActiveSessionUnit: (state: unknown) => BucketSessionActiveUnit;
  getBucketSessionCandidateWordIds: (
    state: unknown,
    bucket: 'learning' | 'unstudied',
  ) => string[];
  getBucketSessionProgress: (state: unknown) => {
    learning: Record<string, {
      coveredSkills: Record<'recognition' | 'production', boolean>;
    }>;
    unstudied: Record<string, {
      introComplete: boolean;
      successStreaks: Record<'recognition' | 'production', number>;
    }>;
  };
  getBucketSessionUnitCounts: (state: unknown) => {
    review: number;
    learning: number;
    unstudied: number;
  };
  markActiveSessionUnitStarted: (state: unknown) => unknown;
  rateActiveContrastSelectionUnit: (input: {
    state: unknown;
    selectedWordId: string;
    rating: ReviewRating;
    practiceMore: boolean;
  }) => BucketSessionTransitionResult;
  rateActiveSessionUnit: (state: unknown, rating: ReviewRating) => BucketSessionTransitionResult;
};

type TestBucketSessionState = {
  answeredCount: number;
  reviewProgress: Record<string, { failureCount: number } | undefined>;
};

async function loadBucketSessionStateApi(): Promise<BucketSessionStateApi> {
  const api = await import('../src/lib/session-state.ts') as Record<string, unknown>;
  const requiredExports = [
    'beginBucketDrainSession',
    'cancelRatedReviewSessionAction',
    'completeActiveUnstudiedIntro',
    'createBucketSessionState',
    'dismissActiveBucketSessionUnit',
    'getActiveSessionUnit',
    'getBucketSessionCandidateWordIds',
    'getBucketSessionProgress',
    'getBucketSessionUnitCounts',
    'markActiveSessionUnitStarted',
    'rateActiveContrastSelectionUnit',
    'rateActiveSessionUnit',
  ];

  for (const exportName of requiredExports) {
    assert.equal(typeof api[exportName], 'function', `Expected session-state.ts to export ${exportName}`);
  }

  return api as BucketSessionStateApi;
}

function onlySampledSkill(sampledSkillIds: StudySkillId[]): Extract<StudySkillId, 'recognition' | 'production'> {
  assert.equal(sampledSkillIds.length, 1);
  const skillId = sampledSkillIds[0];
  assert.ok(skillId === 'recognition' || skillId === 'production');
  return skillId;
}

function createReviewStudyItem(wordId: string): SessionStudyItem {
  const word = createWord({ id: wordId, status: 'review' });

  return {
    sessionActionId: `review/${wordId}/recognition`,
    actionKind: 'recognition',
    targetWordId: wordId,
    sampledSkillIds: ['recognition'],
    contentRef: null,
    intervalHours: 24,
    word,
    contrastSelection: null,
  };
}

function createContrastStudyItem(): SessionStudyItem {
  const scheduledWord = createWord({ id: 'contrast-scheduled', status: 'review', hanzi: '靠近' });
  const targetWord = createWord({ id: 'contrast-target', status: 'review', hanzi: '临近' });
  const distractorWord = createWord({ id: 'contrast-distractor', status: 'review', hanzi: '靠近' });

  return {
    sessionActionId: 'review/contrast-scheduled/contextual_selection',
    actionKind: 'contrast_selection',
    targetWordId: scheduledWord.id,
    sampledSkillIds: ['contextual_selection'],
    contentRef: { type: 'contrast_prompt', id: 'contrast-prompt' },
    intervalHours: 24,
    word: scheduledWord,
    contrastSelection: {
      clusterId: 'contrast-cluster',
      clusterTitle: '靠近 / 临近',
      clusterNote: '',
      scheduledWordId: scheduledWord.id,
      promptTargetWordId: targetWord.id,
      prompt: {
        id: 'contrast-prompt',
        clusterId: 'contrast-cluster',
        targetWordId: targetWord.id,
        promptText: '春节____，火车票开始紧张。',
        explanation: '',
      },
      choices: [
        { word: distractorWord, nuanceNote: 'Physical nearness.' },
        { word: targetWord, nuanceNote: 'Approaching in time.' },
      ],
    },
  };
}

function createWord(overrides: Partial<Word> & Pick<Word, 'id' | 'status'>): Word {
  return {
    id: overrides.id,
    hanzi: overrides.hanzi ?? '汉字',
    traditional: overrides.traditional ?? null,
    pinyin: overrides.pinyin ?? 'han zi',
    meaning: overrides.meaning ?? 'meaning',
    meanings: overrides.meanings ?? ['meaning'],
    personalNotes: overrides.personalNotes ?? '',
    examples: overrides.examples ?? ['example'],
    status: overrides.status,
    priority: overrides.priority ?? 100,
    createdAt: overrides.createdAt ?? '2026-04-10T00:00:00.000Z',
    learningStreak: overrides.learningStreak ?? 0,
    lastLearningSuccessOn: overrides.lastLearningSuccessOn ?? null,
    lastLearningCoveredOn: overrides.lastLearningCoveredOn ?? null,
  };
}
