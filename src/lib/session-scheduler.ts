import type {
  SessionStudyItem,
  SessionStudyItemBuckets,
  StudySkillId,
} from '../domain/study-actions';
import { buildWordLifecycleSessionStudyItems, cloneProductionExerciseSnapshot } from '../domain/study-actions';
import type { Word } from '../types';

// Live sessions seed from sessionId. This fallback keeps scheduler unit tests
// deterministic when they omit both a seed and a session id.
const DEFAULT_SEED = 0x9e3779b9;

export type BucketSchedulerBucket = 'review' | 'learning' | 'unstudied';

export type BucketSchedulerWeights = Record<BucketSchedulerBucket, number>;

export type BucketSessionSchedulerPolicy = {
  bucketWeights: BucketSchedulerWeights;
};

export type BucketSchedulerLearningProgress = {
  coveredSkills: Record<ReviewStudySkillId, boolean>;
  firstTryGood: Record<ReviewStudySkillId, boolean>;
  attempts: Record<ReviewStudySkillId, number>;
};

export type BucketSchedulerUnstudiedProgress = {
  introComplete: boolean;
  successStreaks: Record<ReviewStudySkillId, number>;
};

export type BucketSchedulerProgress = {
  learning: Record<string, BucketSchedulerLearningProgress>;
  unstudied: Record<string, BucketSchedulerUnstudiedProgress>;
};

export type ActiveBucketSchedulerUnit =
  | {
      type: 'study';
      bucket: BucketSchedulerBucket;
      item: SessionStudyItem;
    }
  | {
      type: 'unstudied_intro';
      word: Word;
    };

export type BucketSessionScheduler = {
  reviewQueue: SessionStudyItem[];
  learningPool: Word[];
  unstudiedPool: Word[];
  policy: BucketSessionSchedulerPolicy;
  rngState: number;
  activeUnit: ActiveBucketSchedulerUnit | null;
};

type ReviewStudySkillId = Extract<StudySkillId, 'recognition' | 'production'>;

const DEFAULT_BUCKET_POLICY: BucketSessionSchedulerPolicy = {
  bucketWeights: {
    review: 50,
    learning: 30,
    unstudied: 20,
  },
};

const REVIEW_STUDY_SKILLS: ReviewStudySkillId[] = ['recognition', 'production'];

export function createBucketSessionScheduler({
  buckets,
  policy,
  progress,
  seed,
}: {
  buckets: SessionStudyItemBuckets;
  policy?: Partial<BucketSessionSchedulerPolicy>;
  progress?: Partial<BucketSchedulerProgress>;
  seed?: number;
}): BucketSessionScheduler {
  const scheduler: BucketSessionScheduler = {
    reviewQueue: [...buckets.review],
    learningPool: [...buckets.learning],
    unstudiedPool: [...buckets.unstudied],
    policy: {
      ...DEFAULT_BUCKET_POLICY,
      ...policy,
      bucketWeights: {
        ...DEFAULT_BUCKET_POLICY.bucketWeights,
        ...policy?.bucketWeights,
      },
    },
    rngState: normalizeSeed(seed ?? DEFAULT_SEED),
    activeUnit: null,
  };

  return syncBucketScheduler(scheduler, normalizeBucketSchedulerProgress(progress));
}

export function sessionIdToSchedulerSeed(sessionId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < sessionId.length; i += 1) {
    hash ^= sessionId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return normalizeSeed(hash);
}

export function getBucketSchedulerActiveUnit(scheduler: BucketSessionScheduler): ActiveBucketSchedulerUnit {
  return scheduler.activeUnit ?? assertActiveBucketUnitPresent();
}

export function getBucketSchedulerBucketCounts(
  scheduler: BucketSessionScheduler,
  progress: BucketSchedulerProgress = createEmptyBucketSchedulerProgress(),
) {
  return getBucketSchedulerBucketCountsForProgress(scheduler, progress);
}

function getBucketSchedulerBucketCountsForProgress(
  scheduler: BucketSessionScheduler,
  progress: BucketSchedulerProgress,
) {
  return {
    review: scheduler.reviewQueue.length,
    learning: getBucketSchedulerCandidateWordIds(scheduler, 'learning', progress).length,
    unstudied: getBucketSchedulerCandidateWordIds(scheduler, 'unstudied', progress).length,
  };
}

export function getBucketSchedulerCandidateWordIds(
  scheduler: BucketSessionScheduler,
  bucket: 'learning' | 'unstudied',
  progress: BucketSchedulerProgress = createEmptyBucketSchedulerProgress(),
): string[] {
  return getBucketSchedulerCandidateWords(scheduler, bucket, progress).map((word) => word.id);
}

// test only, I think
export function completeActiveBucketSchedulerUnit(scheduler: BucketSessionScheduler): BucketSessionScheduler {
  const active = getBucketSchedulerActiveUnit(scheduler);

  switch (active.type) {
    case 'study':
      if (active.bucket === 'review') {
        assertActiveReviewHeadMatches(scheduler, active.item);
        return syncBucketScheduler({
          ...scheduler,
          reviewQueue: scheduler.reviewQueue.slice(1),
        });
      }

      return syncBucketScheduler(removeBucketSchedulerWord(scheduler, active.bucket, active.item.targetWordId));
    case 'unstudied_intro':
      return syncBucketScheduler(scheduler);
    default:
      return assertUnreachableActiveBucketUnit(active);
  }
}

export function syncBucketScheduler(
  scheduler: BucketSessionScheduler,
  progress: BucketSchedulerProgress = createEmptyBucketSchedulerProgress(),
): BucketSessionScheduler {
  return recomputeActiveBucketSchedulerUnit(scheduler, progress);
}

export function removeBucketSchedulerWord(
  scheduler: BucketSessionScheduler,
  bucket: 'learning' | 'unstudied',
  wordId: string,
): BucketSessionScheduler {
  if (bucket === 'learning') {
    return {
      ...scheduler,
      learningPool: scheduler.learningPool.filter((word) => word.id !== wordId),
    };
  }

  return {
    ...scheduler,
    unstudiedPool: scheduler.unstudiedPool.filter((word) => word.id !== wordId),
  };
}

export function pruneBucketSchedulerWords(
  scheduler: BucketSessionScheduler,
  keep: (unit: ActiveBucketSchedulerUnit | { type: 'candidate_word'; bucket: 'learning' | 'unstudied'; word: Word }) => boolean,
): BucketSessionScheduler {
  const active = scheduler.activeUnit;
  const nextScheduler: BucketSessionScheduler = {
    ...scheduler,
    reviewQueue: scheduler.reviewQueue.filter((item) => {
      const unit: ActiveBucketSchedulerUnit = { type: 'study', bucket: 'review', item };
      return (active?.type === 'study' && active.bucket === 'review' && active.item.sessionActionId === item.sessionActionId) ||
        keep(unit);
    }),
    learningPool: scheduler.learningPool.filter((word) => {
      const unit = { type: 'candidate_word' as const, bucket: 'learning' as const, word };
      return isActiveBucketWord(active, 'learning', word.id) || keep(unit);
    }),
    unstudiedPool: scheduler.unstudiedPool.filter((word) => {
      const unit = { type: 'candidate_word' as const, bucket: 'unstudied' as const, word };
      return isActiveBucketWord(active, 'unstudied', word.id) || keep(unit);
    }),
  };

  return nextScheduler;
}

export function cloneBucketSessionScheduler(scheduler: BucketSessionScheduler): BucketSessionScheduler {
  return {
    reviewQueue: scheduler.reviewQueue.map(cloneSessionStudyItem),
    learningPool: scheduler.learningPool.map(cloneWord),
    unstudiedPool: scheduler.unstudiedPool.map(cloneWord),
    policy: {
      bucketWeights: { ...scheduler.policy.bucketWeights },
    },
    rngState: scheduler.rngState,
    activeUnit: scheduler.activeUnit ? cloneActiveBucketSchedulerUnit(scheduler.activeUnit) : null,
  };
}

function lcg(value: number): number {
  return (Math.imul(value, 1664525) + 1013904223) >>> 0;
}

function randomIndex(rngState: number, length: number): number {
  return Math.floor((rngState / 0x100000000) * length);
}

function normalizeSeed(seed: number): number {
  return (seed >>> 0) || 1;
}

function cloneActiveBucketSchedulerUnit(unit: ActiveBucketSchedulerUnit): ActiveBucketSchedulerUnit {
  if (unit.type === 'unstudied_intro') {
    return {
      type: 'unstudied_intro',
      word: cloneWord(unit.word),
    };
  }

  return {
    type: 'study',
    bucket: unit.bucket,
    item: cloneSessionStudyItem(unit.item),
  };
}

function cloneSessionStudyItem(item: SessionStudyItem): SessionStudyItem {
  return {
    ...item,
    sampledSkillIds: [...item.sampledSkillIds],
    contentRef: item.contentRef ? { ...item.contentRef } : null,
    production: item.production
      ? cloneProductionExerciseSnapshot(item.production)
      : null,
    word: cloneWord(item.word),
    contrastSelection: item.contrastSelection
      ? {
          ...item.contrastSelection,
          prompt: { ...item.contrastSelection.prompt },
          choices: item.contrastSelection.choices.map((choice) => ({
            ...choice,
            word: cloneWord(choice.word),
          })),
        }
      : null,
  };
}

function cloneWord(word: Word): Word {
  return {
    ...word,
    meanings: [...word.meanings],
    examples: [...word.examples],
  };
}

function recomputeActiveBucketSchedulerUnit(
  scheduler: BucketSessionScheduler,
  progress: BucketSchedulerProgress,
): BucketSessionScheduler {
  const counts = getBucketSchedulerBucketCountsForProgress(scheduler, progress);
  if (counts.review === 0 && counts.learning === 0 && counts.unstudied === 0) {
    return {
      ...scheduler,
      activeUnit: null,
    };
  }

  const bucket = pickBucketSchedulerBucket(scheduler, progress, scheduler.rngState);
  const activeUnit = pickActiveBucketSchedulerUnit(scheduler, bucket, progress, lcg(scheduler.rngState));

  return {
    ...scheduler,
    rngState: lcg(lcg(scheduler.rngState)),
    activeUnit,
  };
}

function pickBucketSchedulerBucket(
  scheduler: BucketSessionScheduler,
  progress: BucketSchedulerProgress,
  rngState: number,
): BucketSchedulerBucket {
  const nonemptyBuckets = getNonemptyBucketSchedulerBuckets(scheduler, progress);
  const totalWeight = nonemptyBuckets.reduce((sum, bucket) => sum + Math.max(0, scheduler.policy.bucketWeights[bucket]), 0);

  if (totalWeight <= 0) {
    return nonemptyBuckets[0] ?? assertNonemptyBucketPresent();
  }

  let cursor = randomIndex(rngState, totalWeight);
  for (const bucket of nonemptyBuckets) {
    cursor -= Math.max(0, scheduler.policy.bucketWeights[bucket]);
    if (cursor < 0) {
      return bucket;
    }
  }

  return nonemptyBuckets[nonemptyBuckets.length - 1] ?? assertNonemptyBucketPresent();
}

function getNonemptyBucketSchedulerBuckets(
  scheduler: BucketSessionScheduler,
  progress: BucketSchedulerProgress,
): BucketSchedulerBucket[] {
  const counts = getBucketSchedulerBucketCountsForProgress(scheduler, progress);
  return REVIEW_BUCKETS.filter((bucket) => counts[bucket] > 0);
}

const REVIEW_BUCKETS: BucketSchedulerBucket[] = ['review', 'learning', 'unstudied'];

function pickActiveBucketSchedulerUnit(
  scheduler: BucketSessionScheduler,
  bucket: BucketSchedulerBucket,
  progress: BucketSchedulerProgress,
  rngState: number,
): ActiveBucketSchedulerUnit {
  if (bucket === 'review') {
    const item = scheduler.reviewQueue[0] ?? assertBucketSchedulerReviewActionPresent();
    return { type: 'study', bucket, item };
  }

  const candidates = getBucketSchedulerCandidateWords(scheduler, bucket, progress);
  const word = candidates[randomIndex(rngState, candidates.length)] ?? assertBucketSchedulerCandidateWordPresent(bucket);

  if (bucket === 'unstudied') {
    const wordProgress = progress.unstudied[word.id] ?? createInitialBucketUnstudiedProgress();
    if (!wordProgress.introComplete) {
      return { type: 'unstudied_intro', word };
    }
  }

  return {
    type: 'study',
    bucket,
    item: buildBucketWordStudyItem({
      bucket,
      word,
      skillId: pickOpenBucketWordSkill(progress, bucket, word.id, lcg(rngState)),
    }),
  };
}

function getBucketSchedulerCandidateWords(
  scheduler: BucketSessionScheduler,
  bucket: 'learning' | 'unstudied',
  progress: BucketSchedulerProgress,
): Word[] {
  const pool = bucket === 'learning' ? scheduler.learningPool : scheduler.unstudiedPool;

  return pool.filter((word) => hasOpenBucketWordWork(progress, bucket, word.id));
}

function hasOpenBucketWordWork(
  progress: BucketSchedulerProgress,
  bucket: 'learning' | 'unstudied',
  wordId: string,
): boolean {
  if (bucket === 'learning') {
    const wordProgress = progress.learning[wordId] ?? createInitialBucketLearningProgress();
    return REVIEW_STUDY_SKILLS.some((skillId) => !wordProgress.coveredSkills[skillId]);
  }

  const wordProgress = progress.unstudied[wordId] ?? createInitialBucketUnstudiedProgress();
  return !wordProgress.introComplete || REVIEW_STUDY_SKILLS.some((skillId) => wordProgress.successStreaks[skillId] < 3);
}

function pickOpenBucketWordSkill(
  progress: BucketSchedulerProgress,
  bucket: 'learning' | 'unstudied',
  wordId: string,
  rngState: number,
): ReviewStudySkillId {
  const openSkills = getOpenBucketWordSkills(progress, bucket, wordId);
  return openSkills[randomIndex(rngState, openSkills.length)] ?? assertOpenBucketWordSkillPresent(bucket, wordId);
}

function getOpenBucketWordSkills(
  progress: BucketSchedulerProgress,
  bucket: 'learning' | 'unstudied',
  wordId: string,
): ReviewStudySkillId[] {
  if (bucket === 'learning') {
    const wordProgress = progress.learning[wordId] ?? createInitialBucketLearningProgress();
    return REVIEW_STUDY_SKILLS.filter((skillId) => !wordProgress.coveredSkills[skillId]);
  }

  const wordProgress = progress.unstudied[wordId] ?? createInitialBucketUnstudiedProgress();
  return REVIEW_STUDY_SKILLS.filter((skillId) => wordProgress.successStreaks[skillId] < 3);
}

function buildBucketWordStudyItem({
  bucket,
  word,
  skillId,
}: {
  bucket: 'learning' | 'unstudied';
  word: Word;
  skillId: ReviewStudySkillId;
}): SessionStudyItem {
  const item = buildWordLifecycleSessionStudyItems({ source: bucket, word })
    .find((candidate) => candidate.sampledSkillIds.length === 1 && candidate.sampledSkillIds[0] === skillId);

  return item ?? assertLifecycleSessionStudyItemPresent(bucket, word.id, skillId);
}

export function createInitialBucketLearningProgress(): BucketSchedulerLearningProgress {
  return {
    coveredSkills: {
      recognition: false,
      production: false,
    },
    firstTryGood: {
      recognition: false,
      production: false,
    },
    attempts: {
      recognition: 0,
      production: 0,
    },
  };
}

export function createInitialBucketUnstudiedProgress(): BucketSchedulerUnstudiedProgress {
  return {
    introComplete: false,
    successStreaks: {
      recognition: 0,
      production: 0,
    },
  };
}

function createEmptyBucketSchedulerProgress(): BucketSchedulerProgress {
  return {
    learning: {},
    unstudied: {},
  };
}

function normalizeBucketSchedulerProgress(
  progress: Partial<BucketSchedulerProgress> | undefined,
): BucketSchedulerProgress {
  return {
    learning: { ...progress?.learning },
    unstudied: { ...progress?.unstudied },
  };
}

function isActiveBucketWord(
  active: ActiveBucketSchedulerUnit | null,
  bucket: 'learning' | 'unstudied',
  wordId: string,
) {
  if (!active) {
    return false;
  }

  if (active.type === 'unstudied_intro') {
    return bucket === 'unstudied' && active.word.id === wordId;
  }

  return active.bucket === bucket && active.item.targetWordId === wordId;
}

function assertActiveReviewHeadMatches(scheduler: BucketSessionScheduler, item: SessionStudyItem) {
  const head = scheduler.reviewQueue[0] ?? assertBucketSchedulerReviewActionPresent();
  if (head.sessionActionId !== item.sessionActionId) {
    throw new Error(
      `Invariant violated: active review action is not the review bucket head (${item.sessionActionId} !== ${head.sessionActionId}).`,
    );
  }
}

function assertActiveBucketUnitPresent(): never {
  throw new Error('Invariant violated: attempted to read an active bucket scheduler unit when none is set.');
}

function assertNonemptyBucketPresent(): never {
  throw new Error('Invariant violated: bucket scheduler has no nonempty bucket.');
}

function assertBucketSchedulerReviewActionPresent(): never {
  throw new Error('Invariant violated: review bucket selected with no review action.');
}

function assertBucketSchedulerCandidateWordPresent(bucket: 'learning' | 'unstudied'): never {
  throw new Error(`Invariant violated: ${bucket} bucket selected with no candidate word.`);
}

function assertOpenBucketWordSkillPresent(bucket: 'learning' | 'unstudied', wordId: string): never {
  throw new Error(`Invariant violated: ${bucket} word "${wordId}" has no open skill.`);
}

function assertLifecycleSessionStudyItemPresent(
  bucket: 'learning' | 'unstudied',
  wordId: string,
  skillId: ReviewStudySkillId,
): never {
  throw new Error(`Invariant violated: failed to build ${bucket} ${skillId} study action for word "${wordId}".`);
}

function assertUnreachableActiveBucketUnit(unit: never): never {
  throw new Error(`Unsupported active bucket unit "${JSON.stringify(unit)}".`);
}
