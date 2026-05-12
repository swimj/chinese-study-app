import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { SessionStudyItem, SessionStudyItemBuckets } from '../src/domain/study-actions.ts';
import type { Word } from '../src/types.ts';

describe('bucket session scheduler contract', () => {
  test('uses weighted top-level bucket selection before bucket policy selection', async () => {
    const {
      createBucketSessionScheduler,
      getBucketSchedulerActiveUnit,
    } = await loadBucketSchedulerApi();
    const sessionAction = createReviewStudyItem('review-1');
    const learningWord = createWord({ id: 'learning-1', status: 'learning' });
    const unstudiedWord = createWord({ id: 'unstudied-1', status: 'unstudied' });

    const scheduler = createBucketSessionScheduler({
      buckets: {
        review: [sessionAction],
        learning: [learningWord],
        unstudied: [unstudiedWord],
      },
      policy: {
        bucketWeights: {
          review: 0,
          learning: 1,
          unstudied: 0,
        },
      },
      seed: 1,
    });

    const active = getBucketSchedulerActiveUnit(scheduler);

    assert.equal(active.type, 'study');
    assert.equal(active.bucket, 'learning');
    assert.equal(active.item.targetWordId, learningWord.id);
  });

  test('falls back to a nonempty bucket when the sampled bucket is empty', async () => {
    const {
      createBucketSessionScheduler,
      getBucketSchedulerActiveUnit,
    } = await loadBucketSchedulerApi();
    const learningWord = createWord({ id: 'learning-only', status: 'learning' });

    const scheduler = createBucketSessionScheduler({
      buckets: {
        review: [],
        learning: [learningWord],
        unstudied: [],
      },
      policy: {
        bucketWeights: {
          review: 1,
          learning: 0,
          unstudied: 0,
        },
      },
      seed: 1,
    });

    const active = getBucketSchedulerActiveUnit(scheduler);

    assert.equal(active.type, 'study');
    assert.equal(active.bucket, 'learning');
    assert.equal(active.item.targetWordId, learningWord.id);
  });

  test('advances random state between bucket selections', async () => {
    const {
      createBucketSessionScheduler,
      getBucketSchedulerActiveUnit,
      syncBucketScheduler,
    } = await loadBucketSchedulerApi();
    const sessionAction = createReviewStudyItem('review-1');
    const learningWord = createWord({ id: 'learning-1', status: 'learning' });
    const unstudiedWord = createWord({ id: 'unstudied-1', status: 'unstudied' });

    const scheduler = createBucketSessionScheduler({
      buckets: {
        review: [sessionAction],
        learning: [learningWord],
        unstudied: [unstudiedWord],
      },
    });

    assert.equal(getBucketSchedulerActiveUnit(scheduler).bucket, 'learning');

    const secondScheduler = syncBucketScheduler(scheduler);
    assert.equal(getBucketSchedulerActiveUnit(secondScheduler).type, 'unstudied_intro');

    const thirdScheduler = syncBucketScheduler(secondScheduler);
    const thirdActive = getBucketSchedulerActiveUnit(thirdScheduler);
    assert.equal(thirdActive.type, 'study');
    assert.equal(thirdActive.bucket, 'review');
  });

  test('preserves backend review ordering inside the review bucket', async () => {
    const {
      completeActiveBucketSchedulerUnit,
      createBucketSessionScheduler,
      getBucketSchedulerActiveUnit,
    } = await loadBucketSchedulerApi();
    const firstReview = createReviewStudyItem('review-1');
    const secondReview = createReviewStudyItem('review-2');

    const scheduler = createBucketSessionScheduler({
      buckets: {
        review: [firstReview, secondReview],
        learning: [],
        unstudied: [],
      },
      policy: {
        bucketWeights: {
          review: 1,
          learning: 0,
          unstudied: 0,
        },
      },
      seed: 1,
    });

    assert.equal(getBucketSchedulerActiveUnit(scheduler).item.sessionActionId, firstReview.sessionActionId);

    const nextScheduler = completeActiveBucketSchedulerUnit(scheduler);

    assert.equal(getBucketSchedulerActiveUnit(nextScheduler).item.sessionActionId, secondReview.sessionActionId);
  });

  test('tracks learning and unstudied as word pools rather than pre-expanded action pools', async () => {
    const {
      createBucketSessionScheduler,
      getBucketSchedulerBucketCounts,
    } = await loadBucketSchedulerApi();
    const learningWords = [
      createWord({ id: 'learning-1', status: 'learning' }),
      createWord({ id: 'learning-2', status: 'learning' }),
    ];
    const unstudiedWords = [
      createWord({ id: 'unstudied-1', status: 'unstudied' }),
      createWord({ id: 'unstudied-2', status: 'unstudied' }),
    ];

    const scheduler = createBucketSessionScheduler({
      buckets: {
        review: [],
        learning: learningWords,
        unstudied: unstudiedWords,
      },
      seed: 1,
    });

    assert.deepEqual(getBucketSchedulerBucketCounts(scheduler), {
      review: 0,
      learning: 2,
      unstudied: 2,
    });
  });

  test('selects learning and unstudied by word first before choosing an action within the word', async () => {
    const {
      createBucketSessionScheduler,
      getBucketSchedulerCandidateWordIds,
    } = await loadBucketSchedulerApi();
    const twoSkillLearningWord = createWord({ id: 'learning-two-open-skills', status: 'learning' });
    const oneSkillLearningWord = createWord({ id: 'learning-one-open-skill', status: 'learning' });

    const scheduler = createBucketSessionScheduler({
      buckets: {
        review: [],
        learning: [twoSkillLearningWord, oneSkillLearningWord],
        unstudied: [],
      },
      progress: {
        learning: {
          [oneSkillLearningWord.id]: {
            coveredSkills: { recognition: true, production: false },
            firstTryGood: { recognition: true, production: false },
            attempts: { recognition: 1, production: 0 },
          },
        },
      },
      seed: 1,
    });

    assert.deepEqual(getBucketSchedulerCandidateWordIds(scheduler, 'learning'), [
      twoSkillLearningWord.id,
      oneSkillLearningWord.id,
    ]);
  });
});

type BucketSchedulerApi = {
  completeActiveBucketSchedulerUnit: (scheduler: unknown) => unknown;
  createBucketSessionScheduler: (options: {
    buckets: SessionStudyItemBuckets;
    policy?: {
      bucketWeights?: {
        review: number;
        learning: number;
        unstudied: number;
      };
    };
    progress?: unknown;
    seed?: number;
  }) => unknown;
  getBucketSchedulerActiveUnit: (scheduler: unknown) => {
    type: 'study' | 'unstudied_intro';
    bucket?: 'review' | 'learning' | 'unstudied';
    item: SessionStudyItem;
    word?: Word;
  };
  getBucketSchedulerBucketCounts: (scheduler: unknown) => {
    review: number;
    learning: number;
    unstudied: number;
  };
  getBucketSchedulerCandidateWordIds: (
    scheduler: unknown,
    bucket: 'learning' | 'unstudied',
  ) => string[];
  syncBucketScheduler: (scheduler: unknown, progress?: unknown) => unknown;
};

async function loadBucketSchedulerApi(): Promise<BucketSchedulerApi> {
  const api = await import('../src/lib/session-scheduler.ts') as Record<string, unknown>;
  const requiredExports = [
    'completeActiveBucketSchedulerUnit',
    'createBucketSessionScheduler',
    'getBucketSchedulerActiveUnit',
    'getBucketSchedulerBucketCounts',
    'getBucketSchedulerCandidateWordIds',
    'syncBucketScheduler',
  ];

  for (const exportName of requiredExports) {
    assert.equal(typeof api[exportName], 'function', `Expected session-scheduler.ts to export ${exportName}`);
  }

  return api as BucketSchedulerApi;
}

function createReviewStudyItem(wordId: string): SessionStudyItem {
  const word = createWord({ id: wordId, status: 'review' });

  return {
    sessionActionId: `review/${wordId}/recognition`,
    actionKind: 'recognition',
    targetWordId: wordId,
    sampledSkillIds: ['recognition'],
    contentRef: null,
    word,
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
