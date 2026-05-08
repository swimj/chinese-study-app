import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { getAppConfig } from './config.ts';

const config = getAppConfig();
const dbPath = config.dbPath;
const appJsonPath = path.join(config.dataDir, 'app.json');
const productionMistakeCandidatesPath = path.join(config.dataDir, 'production-mistake-candidates.jsonl');
const dbExistedOnStartup = fs.existsSync(dbPath);

if (!fs.existsSync(config.dataDir)) {
  fs.mkdirSync(config.dataDir, { recursive: true });
}

type WordStatus = 'unstudied' | 'learning' | 'review';

type Word = {
  id: string;
  hanzi: string;
  traditional: string | null;
  pinyin: string;
  meaning: string;
  meanings: string[];
  personalNotes: string;
  examples: string[];
  status: WordStatus;
  priority: number;
  createdAt: string;
  learningStreak: number;
  lastLearningSuccessOn: string | null;
  lastLearningCoveredOn: string | null;
};

type WordMeaning = {
  id: string;
  wordId: string;
  position: number;
  text: string;
  showOnProductionPrompt: boolean;
  createdAt: string;
  updatedAt: string;
};

type PriorityWord = {
  word: Word;
  bumpCount: number;
  forceTop: boolean;
  effectivePriority: number;
  effectiveRank: number;
};

type PriorityWordsPayload = {
  unstudiedTotalCount: number;
  words: PriorityWord[];
};

type ReviewItem = {
  id: string;
  wordId: string;
  direction: 'forward' | 'reverse';
  intervalHours: number;
  lastReviewedAt: string | null;
  nextDueAt: string | null;
  easeFactor: number;
};

type ReviewFailureRateDay = {
  dayKey: string;
  completedReviewItemSessions: number;
  failedReviewItemSessions: number;
  failureRate: number | null;
  rolling3DayFailureRate: number | null;
  rolling7DayFailureRate: number | null;
};

type ProductionMistakeCandidate = {
  id: string;
  targetWordId: string;
  targetHanzi: string;
  attemptedHanzi: string;
  matchedWordId: string | null;
  createdAt: string;
  note: string;
};

type SessionItemWithWord = {
  reviewItem: ReviewItem;
  word: Word;
};

type ReviewRating = 'forgot' | 'hard' | 'good' | 'easy';
type ReviewPassRating = 'hard' | 'good' | 'easy';

type WordRow = {
  id: string;
  hanzi: string;
  traditional: string | null;
  pinyin: string;
  meaning: string;
  meanings_json: string;
  personal_notes: string;
  examples_json: string;
  status: WordStatus;
  priority: number;
  created_at: string;
  learning_streak: number;
  last_learning_success_on: string | null;
  last_learning_covered_on: string | null;
};

type WordMeaningRow = {
  id: string;
  word_id: string;
  position: number;
  text: string;
  show_on_production_prompt: number;
  created_at: string;
  updated_at: string;
};

type UserWordPriorityRow = {
  word_id: string;
  bump_count: number;
  force_top: number;
  priority_tier: number;
  updated_at: string;
};

type UserWordPriorityPatch = {
  bumpDelta?: number;
  forceTop?: boolean;
  reset?: boolean;
};

type ReviewItemRow = {
  id: string;
  word_id: string;
  direction: ReviewItem['direction'];
  interval_hours: number;
  last_reviewed_at: string | null;
  next_due_at: string | null;
  ease_factor: number;
};

type ReviewSessionResultRow = {
  day_key: string;
  completed_count: number;
  failed_count: number;
};

type StudySkillId = 'recognition' | 'production' | 'contextual_selection';
type WordStudyPhase = 'review';

type WordStudyAdmissionState = {
  wordId: string;
  studyPhase: WordStudyPhase;
  earliestNextStudyAt: string | null;
};

type WordSkillState = {
  wordId: string;
  skillId: StudySkillId;
  enabled: boolean;
  intervalHours: number;
  lastStudiedAt: string;
  nextDueAt: string | null;
  easeFactor: number;
};

type WordStudyAdmissionStateRow = {
  word_id: string;
  study_phase: WordStudyPhase;
  earliest_next_study_at: string | null;
};

type WordSkillStateRow = {
  word_id: string;
  skill_id: StudySkillId;
  enabled: number;
  interval_hours: number;
  last_studied_at: string;
  next_due_at: string | null;
  ease_factor: number;
};

type StudySchedulerShadowMismatch = {
  reviewItemId: string;
  wordId: string;
  direction: ReviewItem['direction'];
  skillId: StudySkillId;
  problem: string;
};

type AppMetadataRow = {
  key: string;
  value: string;
  updated_at: string;
};

type DailyNewWordIntakeRow = {
  day_key: string;
  new_study_count: number;
};

type SeedData = {
  words: Word[];
  wordMeanings: WordMeaning[];
  reviewItems: ReviewItem[];
};

type HomeOverview = {
  dueReviewItemCount: number;
  pendingLearningWordCount: number;
  newWordIntroCount: number;
  hasSessionWork: boolean;
};

type SessionPayload = {
  buckets: SessionItemBuckets;
};

type SessionItemBuckets = {
  review: SessionItemWithWord[];
  learning: SessionItemWithWord[];
  unstudied: SessionItemWithWord[];
};

type SessionItemWithWordRow = {
  id: string;
  word_id: string;
  direction: ReviewItem['direction'];
  interval_hours: number;
  last_reviewed_at: string | null;
  next_due_at: string | null;
  ease_factor: number;
  word_hanzi: string;
  word_traditional: string | null;
  word_pinyin: string;
  word_meaning: string;
  word_meanings_json: string;
  word_personal_notes: string;
  word_examples_json: string;
  word_status: WordStatus;
  word_priority: number;
  word_created_at: string;
  word_learning_streak: number;
  word_last_learning_success_on: string | null;
  word_last_learning_covered_on: string | null;
};

type PriorityWordRow = WordRow & {
  bump_count: number;
  force_top: number;
  priority_tier: number;
  effective_priority: number;
  effective_rank: number;
};

let db = openDatabase(dbPath);
const DAILY_NEW_WORD_LIMIT = 10;
const PRIORITY_BUMP_UNIT = 12248;
const UNSTUDIED_COUNT_BASELINE = 116000;
const PRIORITY_MAX_BASELINE = PRIORITY_BUMP_UNIT * 10;
const INITIAL_REVIEW_EASE_FACTOR = 2.5;
const PRIORITY_TIER_TOP = 1;
const PRIORITY_TIER_REGULAR = 0;
const PRIORITY_TIER_SUNK = -1;
const REVIEW_PHASE_RECENCY_GUARD_HOURS = 6;
const STUDY_SCHEDULER_SHADOW_BACKFILL_KEY = 'study_scheduler_shadow_backfill_v1';

initializeDatabase();

export type {
  HomeOverview,
  WordMeaning,
  ProductionMistakeCandidate,
  ReviewItem,
  ReviewFailureRateDay,
  ReviewPassRating,
  ReviewRating,
  SessionItemWithWord,
  SessionItemBuckets,
  SessionPayload,
  PriorityWord,
  PriorityWordsPayload,
  StudySchedulerShadowMismatch,
  StudySkillId,
  WordSkillState,
  WordStudyAdmissionState,
  Word,
  WordStatus,
};
export { config as dbConfig };

export function getUnstudiedCountBaseline(): number {
  return UNSTUDIED_COUNT_BASELINE;
}

export function getWords(): Word[] {
  const rows = db
    .prepare(`
      SELECT
        id,
        hanzi,
        traditional,
        pinyin,
        meaning,
        meanings_json,
        personal_notes,
        examples_json,
        status,
        priority,
        created_at,
        learning_streak,
        last_learning_success_on,
        last_learning_covered_on
      FROM words
      ORDER BY priority DESC, created_at ASC
    `)
    .all() as WordRow[];

  return rows.map(mapWordRow);
}

export function getWordMeanings(wordId: string): WordMeaning[] {
  const existingWord = db
    .prepare(`
      SELECT id
      FROM words
      WHERE id = ?
    `)
    .get(wordId) as { id: string } | undefined;

  if (!existingWord) {
    throw new Error('Word not found');
  }

  const rows = db
    .prepare(`
      SELECT
        id,
        word_id,
        position,
        text,
        show_on_production_prompt,
        created_at,
        updated_at
      FROM word_meanings
      WHERE word_id = ?
      ORDER BY position ASC
    `)
    .all(wordId) as WordMeaningRow[];

  return rows.map(mapWordMeaningRow);
}

export function updateWordMeaningVisibility(wordId: string, meaningId: string, showOnProductionPrompt: boolean): WordMeaning[] {
  const existingMeaning = db
    .prepare(`
      SELECT id
      FROM word_meanings
      WHERE id = ?
        AND word_id = ?
    `)
    .get(meaningId, wordId) as { id: string } | undefined;

  if (!existingMeaning) {
    throw new Error('Word meaning not found');
  }

  db.prepare(`
    UPDATE word_meanings
    SET show_on_production_prompt = ?,
        updated_at = ?
    WHERE id = ?
      AND word_id = ?
  `).run(showOnProductionPrompt ? 1 : 0, new Date().toISOString(), meaningId, wordId);

  return getWordMeanings(wordId);
}

export function getUnstudiedPriorityWords(): PriorityWordsPayload {
  const rows = db
    .prepare(`
      SELECT
        words.id,
        words.hanzi,
        words.traditional,
        words.pinyin,
        words.meaning,
        words.meanings_json,
        words.personal_notes,
        words.examples_json,
        words.status,
        words.priority,
        words.created_at,
        words.learning_streak,
        words.last_learning_success_on,
        words.last_learning_covered_on,
        COALESCE(user_word_priority.bump_count, 0) AS bump_count,
        COALESCE(user_word_priority.force_top, 0) AS force_top,
        COALESCE(user_word_priority.priority_tier, 0) AS priority_tier,
        words.priority
          + COALESCE(user_word_priority.bump_count, 0) * ${PRIORITY_BUMP_UNIT} AS effective_priority,
        ROW_NUMBER() OVER (
          ORDER BY
            COALESCE(user_word_priority.priority_tier, 0) DESC,
            words.priority + COALESCE(user_word_priority.bump_count, 0) * ${PRIORITY_BUMP_UNIT} DESC,
            words.priority DESC,
            words.created_at ASC
        ) AS effective_rank
      FROM words
      LEFT JOIN user_word_priority ON user_word_priority.word_id = words.id
      WHERE words.status = 'unstudied'
      ORDER BY
        priority_tier DESC,
        effective_priority DESC,
        priority DESC,
        created_at ASC
    `)
    .all() as PriorityWordRow[];

  return {
    unstudiedTotalCount: UNSTUDIED_COUNT_BASELINE,
    words: rows.map(mapPriorityWordRow),
  };
}

export function getPrioritizedUnstudiedWords(): PriorityWordsPayload {
  const allUnstudied = getUnstudiedPriorityWords();
  return {
    unstudiedTotalCount: allUnstudied.unstudiedTotalCount,
    words: allUnstudied.words.filter((entry) => entry.forceTop || entry.bumpCount > 0),
  };
}

export function updateWordPersonalNotes(wordId: string, personalNotes: string): Word {
  const existingWord = db
    .prepare(`
      SELECT
        id
      FROM words
      WHERE id = ?
    `)
    .get(wordId) as { id: string } | undefined;

  if (!existingWord) {
    throw new Error('Word not found');
  }

  db.prepare(`
    UPDATE words
    SET personal_notes = ?
    WHERE id = ?
  `).run(personalNotes, wordId);

  const updatedWord = db
    .prepare(`
      SELECT
        id,
        hanzi,
        traditional,
        pinyin,
        meaning,
        meanings_json,
        personal_notes,
        examples_json,
        status,
        priority,
        created_at,
        learning_streak,
        last_learning_success_on,
        last_learning_covered_on
      FROM words
      WHERE id = ?
    `)
    .get(wordId) as WordRow;

  return mapWordRow(updatedWord);
}

export function updateWordUserPriority(wordId: string, patch: UserWordPriorityPatch): PriorityWord {
  const existingWord = db
    .prepare(`
      SELECT
        id,
        status
      FROM words
      WHERE id = ?
    `)
    .get(wordId) as { id: string; status: WordStatus } | undefined;

  if (!existingWord) {
    throw new Error('Word not found');
  }

  if (existingWord.status !== 'unstudied') {
    throw new Error('Expected unstudied word');
  }

  const existingPriorityRow = db
    .prepare(`
      SELECT
        word_id,
        bump_count,
        force_top,
        priority_tier,
        updated_at
      FROM user_word_priority
      WHERE word_id = ?
    `)
    .get(wordId) as UserWordPriorityRow | undefined;

  const currentBumpCount = existingPriorityRow?.bump_count ?? 0;
  const currentPriorityTier = existingPriorityRow?.priority_tier ?? PRIORITY_TIER_REGULAR;
  const currentForceTop = currentPriorityTier === PRIORITY_TIER_TOP;
  const reset = patch.reset === true;
  const nextBumpCount = reset ? 0 : clampInteger(currentBumpCount + (patch.bumpDelta ?? 0), 0, 10);
  const nextPriorityTier = reset
    ? PRIORITY_TIER_REGULAR
    : patch.forceTop === undefined
      ? currentPriorityTier
      : patch.forceTop
        ? PRIORITY_TIER_TOP
        : PRIORITY_TIER_REGULAR;
  const nextForceTop = nextPriorityTier === PRIORITY_TIER_TOP;

  if (nextBumpCount === 0 && nextPriorityTier === PRIORITY_TIER_REGULAR) {
    db.prepare(`
      DELETE FROM user_word_priority
      WHERE word_id = ?
    `).run(wordId);
  } else {
    db.prepare(`
      INSERT INTO user_word_priority (
        word_id,
        bump_count,
        force_top,
        priority_tier,
        updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(word_id) DO UPDATE SET
        bump_count = excluded.bump_count,
        force_top = excluded.force_top,
        priority_tier = excluded.priority_tier,
        updated_at = excluded.updated_at
    `).run(wordId, nextBumpCount, nextForceTop ? 1 : 0, nextPriorityTier, new Date().toISOString());
  }

  return getUnstudiedPriorityWordById(wordId);
}

export function addUnstudiedUserPriorityByHanzi(hanzi: string): PriorityWord[] {
  const matches = db
    .prepare(`
      SELECT
        id
      FROM words
      WHERE status = 'unstudied'
        AND hanzi = ?
      ORDER BY created_at ASC
    `)
    .all(hanzi) as Array<{ id: string }>;

  if (matches.length === 0) {
    throw new Error('No matching unstudied words found');
  }

  db.exec('BEGIN');

  try {
    for (const match of matches) {
      const existingPriorityRow = db
        .prepare(`
          SELECT
            bump_count,
            force_top,
            priority_tier
          FROM user_word_priority
          WHERE word_id = ?
        `)
        .get(match.id) as { bump_count: number; force_top: number; priority_tier: number } | undefined;

      const nextBumpCount = Math.max(existingPriorityRow?.bump_count ?? 0, 1);
      const nextForceTop = existingPriorityRow?.force_top ?? 0;
      const nextPriorityTier = Math.max(existingPriorityRow?.priority_tier ?? PRIORITY_TIER_REGULAR, PRIORITY_TIER_REGULAR);

      db.prepare(`
        INSERT INTO user_word_priority (
          word_id,
          bump_count,
          force_top,
          priority_tier,
          updated_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(word_id) DO UPDATE SET
          bump_count = excluded.bump_count,
          force_top = excluded.force_top,
          priority_tier = excluded.priority_tier,
          updated_at = excluded.updated_at
      `).run(match.id, nextBumpCount, nextForceTop, nextPriorityTier, new Date().toISOString());
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return matches.map((match) => getUnstudiedPriorityWordById(match.id));
}

export function getSessionPayload(studyDayKey: string): SessionPayload {
  assertStudyDayKey(studyDayKey);
  return {
    buckets: getSessionItemBucketsWithWords(studyDayKey),
  };
}

export function getReviewItems(): ReviewItem[] {
  const rows = db
    .prepare(`
      SELECT
        review_items.id,
        review_items.word_id,
        review_items.direction,
        review_items.interval_hours,
        review_items.last_reviewed_at,
        review_items.next_due_at,
        review_items.ease_factor
      FROM review_items
      ORDER BY next_due_at ASC
    `)
    .all() as ReviewItemRow[];

  return rows.map(mapReviewItemRow);
}

export function getWordStudyAdmissionStates(): WordStudyAdmissionState[] {
  const rows = db
    .prepare(`
      SELECT
        word_id,
        study_phase,
        earliest_next_study_at
      FROM word_study_admission_state
      ORDER BY word_id ASC
    `)
    .all() as WordStudyAdmissionStateRow[];

  return rows.map(mapWordStudyAdmissionStateRow);
}

export function getWordSkillStates(): WordSkillState[] {
  const rows = db
    .prepare(`
      SELECT
        word_id,
        skill_id,
        enabled,
        interval_hours,
        last_studied_at,
        next_due_at,
        ease_factor
      FROM word_skill_state
      ORDER BY word_id ASC, skill_id ASC
    `)
    .all() as WordSkillStateRow[];

  return rows.map(mapWordSkillStateRow);
}

export function validateReviewItemStudySchedulerShadow(): StudySchedulerShadowMismatch[] {
  const rows = db
    .prepare(`
      SELECT
        review_items.id,
        review_items.word_id,
        review_items.direction,
        review_items.interval_hours,
        review_items.last_reviewed_at,
        review_items.next_due_at,
        review_items.ease_factor,
        word_skill_state.skill_id,
        word_skill_state.enabled,
        word_skill_state.interval_hours AS shadow_interval_hours,
        word_skill_state.last_studied_at,
        word_skill_state.next_due_at AS shadow_next_due_at,
        word_skill_state.ease_factor AS shadow_ease_factor
      FROM review_items
      INNER JOIN words ON words.id = review_items.word_id
      LEFT JOIN word_skill_state
        ON word_skill_state.word_id = review_items.word_id
       AND word_skill_state.skill_id = CASE review_items.direction
          WHEN 'forward' THEN 'recognition'
          WHEN 'reverse' THEN 'production'
        END
      WHERE words.status = 'review'
      ORDER BY review_items.word_id ASC, review_items.direction ASC
    `)
    .all() as Array<ReviewItemRow & {
      skill_id: StudySkillId | null;
      enabled: number | null;
      shadow_interval_hours: number | null;
      last_studied_at: string | null;
      shadow_next_due_at: string | null;
      shadow_ease_factor: number | null;
    }>;

  const mismatches: StudySchedulerShadowMismatch[] = [];

  for (const row of rows) {
    const skillId = mapReviewDirectionToStudySkill(row.direction);

    if (row.skill_id === null) {
      mismatches.push({
        reviewItemId: row.id,
        wordId: row.word_id,
        direction: row.direction,
        skillId,
        problem: 'missing word_skill_state row',
      });
      continue;
    }

    const problems = [
      row.enabled !== 1 ? 'disabled shadow skill' : null,
      row.shadow_interval_hours !== row.interval_hours ? 'interval_hours mismatch' : null,
      row.last_studied_at !== row.last_reviewed_at ? 'last_studied_at mismatch' : null,
      row.shadow_next_due_at !== row.next_due_at ? 'next_due_at mismatch' : null,
      row.shadow_ease_factor !== row.ease_factor ? 'ease_factor mismatch' : null,
    ].filter((problem): problem is string => problem !== null);

    for (const problem of problems) {
      mismatches.push({
        reviewItemId: row.id,
        wordId: row.word_id,
        direction: row.direction,
        skillId,
        problem,
      });
    }
  }

  return mismatches;
}

export function captureProductionMistakeCandidate({
  targetWordId,
  attemptedHanzi,
  note = '',
}: {
  targetWordId: string;
  attemptedHanzi: string;
  note?: string;
}): ProductionMistakeCandidate {
  const targetWord = getWordById(targetWordId);
  if (!targetWord) {
    throw new Error('Word not found');
  }

  const normalizedAttempt = normalizeProductionMistakeHanzi(attemptedHanzi);
  if (normalizedAttempt.length === 0) {
    throw new Error('Expected non-empty attempted Hanzi');
  }

  const targetHanzi = normalizeProductionMistakeHanzi(targetWord.hanzi);
  if (normalizedAttempt === targetHanzi) {
    throw new Error('Expected attempted Hanzi to differ from target Hanzi');
  }

  const matchedWord = findFirstWordByHanzi(normalizedAttempt);
  const candidate: ProductionMistakeCandidate = {
    id: randomUUID(),
    targetWordId: targetWord.id,
    targetHanzi: targetWord.hanzi,
    attemptedHanzi: normalizedAttempt,
    matchedWordId: matchedWord?.id ?? null,
    createdAt: new Date().toISOString(),
    note: note.trim(),
  };

  fs.appendFileSync(productionMistakeCandidatesPath, `${JSON.stringify(candidate)}\n`, 'utf8');
  return candidate;
}

export function getProductionMistakeCandidates(): ProductionMistakeCandidate[] {
  if (!fs.existsSync(productionMistakeCandidatesPath)) {
    return [];
  }

  return fs
    .readFileSync(productionMistakeCandidatesPath, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => parseProductionMistakeCandidateLine(line));
}

export function getWordStatusCounts(): Record<WordStatus, number> {
  const rows = db
    .prepare(`
      SELECT status, COUNT(*) as count
      FROM words
      GROUP BY status
    `)
    .all() as Array<{ status: WordStatus; count: number }>;

  const counts: Record<WordStatus, number> = {
    unstudied: 0,
    learning: 0,
    review: 0,
  };

  for (const row of rows) {
    counts[row.status] = row.count;
  }

  return counts;
}

export function getHomeOverview(studyDayKey: string): HomeOverview {
  assertStudyDayKey(studyDayKey);
  const dueReviewItemCount = db
    .prepare(`
      SELECT COUNT(*) as count
      FROM review_items
      INNER JOIN words ON words.id = review_items.word_id
      WHERE words.status = 'review'
        AND review_items.next_due_at IS NOT NULL
        AND review_items.next_due_at <= ?
    `)
    .get(new Date().toISOString()) as { count: number };

  const pendingLearningWordCount = db
    .prepare(`
      SELECT COUNT(*) as count
      FROM words
      WHERE status = 'learning'
        AND (last_learning_covered_on IS NULL OR last_learning_covered_on != ?)
    `)
    .get(getTodayKey()) as { count: number };

  const newWordIntroCount = db
    .prepare(`
      SELECT COUNT(*) as count
      FROM (
        SELECT id
        FROM words
        WHERE status = 'unstudied'
        ORDER BY priority DESC, created_at ASC
        LIMIT ?
      )
    `)
    .get(getRemainingDailyNewWordSlots(studyDayKey)) as { count: number };

  return {
    dueReviewItemCount: dueReviewItemCount.count,
    pendingLearningWordCount: pendingLearningWordCount.count,
    newWordIntroCount: newWordIntroCount.count,
    hasSessionWork:
      dueReviewItemCount.count > 0 ||
      pendingLearningWordCount.count > 0 ||
      newWordIntroCount.count > 0,
  };
}

export function getLearningPolicy(studyDayKey: string) {
  assertStudyDayKey(studyDayKey);
  return {
    dailyNewWordLimit: DAILY_NEW_WORD_LIMIT,
    learningCoverageDate: studyDayKey,
  };
}

export function completeUnstudiedWordSession(wordId: string, studyDayKey: string): Word {
  assertStudyDayKey(studyDayKey);
  const existingWord = db
    .prepare(`
      SELECT
        id,
        hanzi,
        traditional,
        pinyin,
        meaning,
        meanings_json,
        personal_notes,
        examples_json,
        status,
        priority,
        created_at,
        learning_streak,
        last_learning_success_on,
        last_learning_covered_on
      FROM words
      WHERE id = ?
    `)
    .get(wordId) as WordRow | undefined;

  if (!existingWord) {
    throw new Error('Word not found');
  }

  if (existingWord.status !== 'unstudied') {
    throw new Error('Expected unstudied word');
  }

  if (
    existingWord.learning_streak !== 0 ||
    existingWord.last_learning_success_on !== null ||
    existingWord.last_learning_covered_on !== null
  ) {
    throw new Error('Unstudied word has unexpected learning progress');
  }

  const today = getTodayKey();

  db.exec('BEGIN');

  try {
    db.prepare(`
      UPDATE words
      SET status = 'learning',
          learning_streak = 0,
          last_learning_success_on = NULL,
          last_learning_covered_on = ?
      WHERE id = ?
    `).run(today, wordId);

    incrementDailyNewStudyCount(studyDayKey);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  const updatedWord = db
    .prepare(`
      SELECT
        id,
        hanzi,
        traditional,
        pinyin,
        meaning,
        meanings_json,
        personal_notes,
        examples_json,
        status,
        priority,
        created_at,
        learning_streak,
        last_learning_success_on,
        last_learning_covered_on
      FROM words
      WHERE id = ?
    `)
    .get(wordId) as WordRow;

  return mapWordRow(updatedWord);
}

export function completeReviewItemSession(
  reviewItemId: string,
  failureCount: number,
  terminalRating: ReviewPassRating | null,
): ReviewItem {
  const existingRow = db
    .prepare(`
      SELECT
        review_items.id,
        review_items.word_id,
        review_items.direction,
        review_items.interval_hours,
        review_items.last_reviewed_at,
        review_items.next_due_at,
        review_items.ease_factor
      FROM review_items
      WHERE id = ?
    `)
    .get(reviewItemId) as ReviewItemRow | undefined;

  if (!existingRow) {
    throw new Error('Review item not found');
  }

  const currentItem = mapReviewItemRow(existingRow);
  const updatedItem = scheduleReviewItemFromSession(currentItem, failureCount, terminalRating);

  db.exec('BEGIN');

  try {
    db.prepare(`
      UPDATE review_items
      SET interval_hours = ?,
          last_reviewed_at = ?,
          next_due_at = ?,
          ease_factor = ?
      WHERE id = ?
    `).run(
      updatedItem.intervalHours,
      updatedItem.lastReviewedAt,
      updatedItem.nextDueAt,
      updatedItem.easeFactor,
      updatedItem.id,
    );

    upsertWordSkillStateFromReviewItem(updatedItem);
    upsertWordStudyAdmissionState(
      updatedItem.wordId,
      'review',
      updatedItem.lastReviewedAt
        ? addHours(updatedItem.lastReviewedAt, REVIEW_PHASE_RECENCY_GUARD_HOURS)
        : null,
    );

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return updatedItem;
}

export function getReviewFailureRateDays(limit = 14): ReviewFailureRateDay[] {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('Expected positive integer limit');
  }

  const rows = db
    .prepare(`
      SELECT
        day_key,
        SUM(completed_count) AS completed_count,
        SUM(failed_count) AS failed_count
      FROM review_session_summaries
      GROUP BY day_key
      ORDER BY day_key DESC
      LIMIT ?
    `)
    .all(limit) as ReviewSessionResultRow[];

  const ascendingRows = [...rows].reverse();
  const countsByDay = new Map(
    ascendingRows.map((row) => [
      row.day_key,
      {
        completedCount: row.completed_count,
        failedCount: row.failed_count,
      },
    ]),
  );

  return ascendingRows.map((row) => {
    const rolling3 = getRollingReviewFailureCounts(countsByDay, row.day_key, 3);
    const rolling7 = getRollingReviewFailureCounts(countsByDay, row.day_key, 7);

    return {
      dayKey: row.day_key,
      completedReviewItemSessions: row.completed_count,
      failedReviewItemSessions: row.failed_count,
      failureRate: calculateFailureRate(row.failed_count, row.completed_count),
      rolling3DayFailureRate: calculateFailureRate(rolling3.failedCount, rolling3.completedCount),
      rolling7DayFailureRate: calculateFailureRate(rolling7.failedCount, rolling7.completedCount),
    };
  });
}

export function recordReviewSessionSummary({
  sessionId,
  completedAt,
  completedReviewItemCount,
  failedReviewItemCount,
}: {
  sessionId: string;
  completedAt: string;
  completedReviewItemCount: number;
  failedReviewItemCount: number;
}) {
  const normalizedSessionId = sessionId.trim();
  if (normalizedSessionId.length === 0) {
    throw new Error('Expected non-empty session id');
  }

  if (!Number.isInteger(completedReviewItemCount) || completedReviewItemCount < 0) {
    throw new Error('Expected non-negative integer completedReviewItemCount');
  }

  if (!Number.isInteger(failedReviewItemCount) || failedReviewItemCount < 0) {
    throw new Error('Expected non-negative integer failedReviewItemCount');
  }

  if (failedReviewItemCount > completedReviewItemCount) {
    throw new Error('Expected failedReviewItemCount to be less than or equal to completedReviewItemCount');
  }

  db.prepare(`
    INSERT INTO review_session_summaries (
      session_id,
      completed_at,
      day_key,
      completed_count,
      failed_count
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      completed_at = excluded.completed_at,
      day_key = excluded.day_key,
      completed_count = excluded.completed_count,
      failed_count = excluded.failed_count
  `).run(
    normalizedSessionId,
    completedAt,
    completedAt.slice(0, 10),
    completedReviewItemCount,
    failedReviewItemCount,
  );
}

export function completeLearningWordSession(wordId: string, success: boolean): Word {
  const existingWord = db
    .prepare(`
      SELECT
        id,
        hanzi,
        traditional,
        pinyin,
        meaning,
        meanings_json,
        personal_notes,
        examples_json,
        status,
        priority,
        created_at,
        learning_streak,
        last_learning_success_on,
        last_learning_covered_on
      FROM words
      WHERE id = ?
    `)
    .get(wordId) as WordRow | undefined;

  if (!existingWord) {
    throw new Error('Word not found');
  }

  const today = getTodayKey();
  const nextLearningStreak = success ? existingWord.learning_streak + 1 : 0;
  const nextStatus: WordStatus = nextLearningStreak >= 3 ? 'review' : 'learning';

  db.exec('BEGIN');

  try {
    db.prepare(`
      UPDATE words
      SET status = ?,
          learning_streak = ?,
          last_learning_success_on = ?,
          last_learning_covered_on = ?
      WHERE id = ?
    `).run(
      nextStatus,
      nextLearningStreak,
      success ? today : existingWord.last_learning_success_on,
      today,
      wordId,
    );

    if (nextStatus === 'review') {
      const now = new Date().toISOString();
      const nextDueAt = addHours(now, 24);
      db.prepare(`
        UPDATE review_items
        SET interval_hours = 24,
            last_reviewed_at = ?,
            next_due_at = ?,
            ease_factor = ?
        WHERE word_id = ?
      `).run(now, nextDueAt, INITIAL_REVIEW_EASE_FACTOR, wordId);

      mirrorWordReviewItemsToWordSkillState(wordId);
      upsertWordStudyAdmissionState(wordId, 'review', addHours(now, REVIEW_PHASE_RECENCY_GUARD_HOURS));
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  const updatedWord = db
    .prepare(`
      SELECT
        id,
        hanzi,
        traditional,
        pinyin,
        meaning,
        meanings_json,
        personal_notes,
        examples_json,
        status,
        priority,
        created_at,
        learning_streak,
        last_learning_success_on,
        last_learning_covered_on
      FROM words
      WHERE id = ?
    `)
    .get(wordId) as WordRow;

  return mapWordRow(updatedWord);
}

export function dismissWordFromStudy(wordId: string): void {
  const existingWord = db
    .prepare(`
      SELECT
        id,
        status
      FROM words
      WHERE id = ?
    `)
    .get(wordId) as { id: string; status: WordStatus } | undefined;

  if (!existingWord) {
    throw new Error('Word not found');
  }

  db.exec('BEGIN');

  try {
    db.prepare(`
      INSERT INTO user_word_priority (
        word_id,
        bump_count,
        force_top,
        priority_tier,
        updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(word_id) DO UPDATE SET
        bump_count = excluded.bump_count,
        force_top = excluded.force_top,
        priority_tier = excluded.priority_tier,
        updated_at = excluded.updated_at
    `).run(wordId, 0, 0, PRIORITY_TIER_SUNK, new Date().toISOString());

    if (existingWord.status !== 'unstudied') {
      db.prepare(`
        UPDATE words
        SET status = 'unstudied',
            learning_streak = 0,
            last_learning_success_on = NULL,
            last_learning_covered_on = NULL
        WHERE id = ?
      `).run(wordId);

      deleteStudySchedulerStateForWord(wordId);
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function initializeDatabase() {
  if (!dbExistedOnStartup) {
    createSchema();
    seedDatabase();
    backfillStudySchedulerStateFromReviewItems();
    return;
  }

  try {
    applyLightweightSchemaMigrations();
    validateSchema();
    ensureIndexes();
    seedEmptyDevDatabase();
  } catch (error) {
    if (!shouldRebuildDevDatabase(error)) {
      throw error;
    }

    rebuildDevDatabase(error);
  }
}

function openDatabase(targetPath: string) {
  const database = new DatabaseSync(targetPath);
  database.exec('PRAGMA foreign_keys = ON;');
  return database;
}

function applyLightweightSchemaMigrations() {
  const wordColumns = db.prepare(`PRAGMA table_info(words)`).all() as Array<{ name: string }>;
  const hasWordsTable = wordColumns.length > 0;

  if (!hasWordsTable) {
    return;
  }

  const hasMeaningsJson = wordColumns.some((column) => column.name === 'meanings_json');
  if (!hasMeaningsJson) {
    db.exec(`ALTER TABLE words ADD COLUMN meanings_json TEXT NOT NULL DEFAULT '[]'`);
  }

  const hasPersonalNotes = wordColumns.some((column) => column.name === 'personal_notes');
  if (!hasPersonalNotes) {
    db.exec(`ALTER TABLE words ADD COLUMN personal_notes TEXT NOT NULL DEFAULT ''`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS app_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_word_priority (
      word_id TEXT PRIMARY KEY REFERENCES words(id) ON DELETE CASCADE,
      bump_count INTEGER NOT NULL DEFAULT 0,
      force_top INTEGER NOT NULL DEFAULT 0,
      priority_tier INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS word_meanings (
      id TEXT PRIMARY KEY,
      word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      text TEXT NOT NULL,
      show_on_production_prompt INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(word_id, position)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_new_word_intake (
      day_key TEXT PRIMARY KEY,
      new_study_count INTEGER NOT NULL DEFAULT 0
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS word_study_admission_state (
      word_id TEXT PRIMARY KEY REFERENCES words(id) ON DELETE CASCADE,
      study_phase TEXT NOT NULL,
      earliest_next_study_at TEXT
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS word_skill_state (
      word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
      skill_id TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      interval_hours INTEGER NOT NULL,
      last_studied_at TEXT NOT NULL,
      next_due_at TEXT,
      ease_factor REAL NOT NULL,
      PRIMARY KEY (word_id, skill_id)
    );
  `);

  migrateWordSkillStateLastStudiedAtNotNull();

  db.exec(`
    CREATE TABLE IF NOT EXISTS review_session_summaries (
      session_id TEXT PRIMARY KEY,
      completed_at TEXT NOT NULL,
      day_key TEXT NOT NULL,
      completed_count INTEGER NOT NULL,
      failed_count INTEGER NOT NULL
    );
  `);

  const userPriorityColumns = db.prepare(`PRAGMA table_info(user_word_priority)`).all() as Array<{ name: string }>;
  const hasPriorityTier = userPriorityColumns.some((column) => column.name === 'priority_tier');
  if (!hasPriorityTier) {
    db.exec(`ALTER TABLE user_word_priority ADD COLUMN priority_tier INTEGER NOT NULL DEFAULT 0`);
    db.exec(`UPDATE user_word_priority SET priority_tier = CASE WHEN force_top != 0 THEN 1 ELSE 0 END`);
  }

  db.exec(`
    UPDATE user_word_priority
    SET priority_tier = 1
    WHERE force_top != 0
      AND priority_tier = 0
  `);

  backfillWordMeaningsFromWords();
  backfillStudySchedulerStateFromReviewItems();
}

function migrateWordSkillStateLastStudiedAtNotNull() {
  const columns = db.prepare(`PRAGMA table_info(word_skill_state)`).all() as Array<{ name: string; notnull: number; pk: number }>;
  const lastStudiedAtColumn = columns.find((column) => column.name === 'last_studied_at');

  if (!lastStudiedAtColumn || lastStudiedAtColumn.notnull === 1 || lastStudiedAtColumn.pk !== 0) {
    return;
  }

  const nullCount = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM word_skill_state
      WHERE last_studied_at IS NULL
    `)
    .get() as { count: number };

  if (nullCount.count > 0) {
    throw new Error(
      `Database at ${dbPath} cannot migrate word_skill_state.last_studied_at to NOT NULL because ${nullCount.count} row(s) contain NULL.`,
    );
  }

  db.exec('BEGIN');

  try {
    db.exec(`
      CREATE TABLE word_skill_state_next (
        word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
        skill_id TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        interval_hours INTEGER NOT NULL,
        last_studied_at TEXT NOT NULL,
        next_due_at TEXT,
        ease_factor REAL NOT NULL,
        PRIMARY KEY (word_id, skill_id)
      );

      INSERT INTO word_skill_state_next (
        word_id,
        skill_id,
        enabled,
        interval_hours,
        last_studied_at,
        next_due_at,
        ease_factor
      )
      SELECT
        word_id,
        skill_id,
        enabled,
        interval_hours,
        last_studied_at,
        next_due_at,
        ease_factor
      FROM word_skill_state;

      DROP TABLE word_skill_state;
      ALTER TABLE word_skill_state_next RENAME TO word_skill_state;
    `);

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function backfillWordMeaningsFromWords() {
  const wordsWithoutMeanings = db
    .prepare(`
      SELECT
        words.id,
        words.meaning,
        words.meanings_json,
        words.created_at
      FROM words
      WHERE NOT EXISTS (
        SELECT 1
        FROM word_meanings
        WHERE word_meanings.word_id = words.id
      )
    `)
    .all() as Array<{ id: string; meaning: string; meanings_json: string; created_at: string }>;

  if (wordsWithoutMeanings.length === 0) {
    return;
  }

  const insertMeaning = db.prepare(`
    INSERT INTO word_meanings (
      id,
      word_id,
      position,
      text,
      show_on_production_prompt,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, 1, ?, ?)
  `);

  db.exec('BEGIN');

  try {
    for (const word of wordsWithoutMeanings) {
      const meanings = parseMeaningsJson(word.meanings_json, word.meaning);
      for (const [index, meaningText] of meanings.entries()) {
        const timestamp = word.created_at || new Date().toISOString();
        insertMeaning.run(
          `${word.id}-meaning-${index + 1}`,
          word.id,
          index,
          meaningText,
          timestamp,
          timestamp,
        );
      }
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function backfillStudySchedulerStateFromReviewItems() {
  if (isAppMetadataComplete(STUDY_SCHEDULER_SHADOW_BACKFILL_KEY)) {
    return;
  }

  const reviewItems = db
    .prepare(`
      SELECT
        review_items.id,
        review_items.word_id,
        review_items.direction,
        review_items.interval_hours,
        review_items.last_reviewed_at,
        review_items.next_due_at,
        review_items.ease_factor
      FROM review_items
      INNER JOIN words ON words.id = review_items.word_id
      WHERE words.status = 'review'
      ORDER BY review_items.word_id ASC, review_items.direction ASC
    `)
    .all() as ReviewItemRow[];

  if (reviewItems.length === 0) {
    markAppMetadataComplete(STUDY_SCHEDULER_SHADOW_BACKFILL_KEY);
    return;
  }

  db.exec('BEGIN');

  try {
    for (const row of reviewItems) {
      if (row.last_reviewed_at === null) {
        throw new Error(
          `Database at ${dbPath} cannot backfill word_skill_state: review item "${row.id}" has null last_reviewed_at.`,
        );
      }
      upsertWordSkillStateFromReviewItem(mapReviewItemRow(row));
    }

    db.prepare(`
      INSERT OR IGNORE INTO word_study_admission_state (
        word_id,
        study_phase,
        earliest_next_study_at
      )
      SELECT DISTINCT
        review_items.word_id,
        words.status,
        NULL
      FROM review_items
      INNER JOIN words ON words.id = review_items.word_id
      WHERE words.status = 'review'
    `).run();

    db.exec('COMMIT');
    markAppMetadataComplete(STUDY_SCHEDULER_SHADOW_BACKFILL_KEY);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function isAppMetadataComplete(key: string) {
  const row = db
    .prepare(`
      SELECT
        key,
        value,
        updated_at
      FROM app_metadata
      WHERE key = ?
    `)
    .get(key) as AppMetadataRow | undefined;

  return row?.value === 'completed';
}

function markAppMetadataComplete(key: string) {
  db.prepare(`
    INSERT INTO app_metadata (
      key,
      value,
      updated_at
    ) VALUES (?, 'completed', ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `).run(key, new Date().toISOString());
}

function mirrorWordReviewItemsToWordSkillState(wordId: string) {
  const reviewItems = db
    .prepare(`
      SELECT
        id,
        word_id,
        direction,
        interval_hours,
        last_reviewed_at,
        next_due_at,
        ease_factor
      FROM review_items
      WHERE word_id = ?
    `)
    .all(wordId) as ReviewItemRow[];

  for (const row of reviewItems) {
    upsertWordSkillStateFromReviewItem(mapReviewItemRow(row));
  }
}

function upsertWordStudyAdmissionState(
  wordId: string,
  studyPhase: WordStudyPhase,
  earliestNextStudyAt: string | null,
) {
  db.prepare(`
    INSERT INTO word_study_admission_state (
      word_id,
      study_phase,
      earliest_next_study_at
    ) VALUES (?, ?, ?)
    ON CONFLICT(word_id) DO UPDATE SET
      study_phase = excluded.study_phase,
      earliest_next_study_at = excluded.earliest_next_study_at
  `).run(wordId, studyPhase, earliestNextStudyAt);
}

function upsertWordSkillStateFromReviewItem(item: ReviewItem) {
  if (item.lastReviewedAt === null) {
    throw new Error(
      `Database at ${dbPath} cannot write word_skill_state for review item "${item.id}" with null lastReviewedAt.`,
    );
  }

  db.prepare(`
    INSERT INTO word_skill_state (
      word_id,
      skill_id,
      enabled,
      interval_hours,
      last_studied_at,
      next_due_at,
      ease_factor
    ) VALUES (?, ?, 1, ?, ?, ?, ?)
    ON CONFLICT(word_id, skill_id) DO UPDATE SET
      enabled = excluded.enabled,
      interval_hours = excluded.interval_hours,
      last_studied_at = excluded.last_studied_at,
      next_due_at = excluded.next_due_at,
      ease_factor = excluded.ease_factor
  `).run(
    item.wordId,
    mapReviewDirectionToStudySkill(item.direction),
    item.intervalHours,
    item.lastReviewedAt,
    item.nextDueAt,
    item.easeFactor,
  );
}

function deleteStudySchedulerStateForWord(wordId: string) {
  db.prepare(`
    DELETE FROM word_skill_state
    WHERE word_id = ?
  `).run(wordId);

  db.prepare(`
    DELETE FROM word_study_admission_state
    WHERE word_id = ?
  `).run(wordId);
}

function getWordById(wordId: string): Word | null {
  const row = db
    .prepare(`
      SELECT
        id,
        hanzi,
        traditional,
        pinyin,
        meaning,
        meanings_json,
        personal_notes,
        examples_json,
        status,
        priority,
        created_at,
        learning_streak,
        last_learning_success_on,
        last_learning_covered_on
      FROM words
      WHERE id = ?
    `)
    .get(wordId) as WordRow | undefined;

  return row ? mapWordRow(row) : null;
}

function findFirstWordByHanzi(hanzi: string): Word | null {
  const row = db
    .prepare(`
      SELECT
        id,
        hanzi,
        traditional,
        pinyin,
        meaning,
        meanings_json,
        personal_notes,
        examples_json,
        status,
        priority,
        created_at,
        learning_streak,
        last_learning_success_on,
        last_learning_covered_on
      FROM words
      WHERE hanzi = ?
         OR traditional = ?
      ORDER BY status DESC, priority DESC, created_at ASC
      LIMIT 1
    `)
    .get(hanzi, hanzi) as WordRow | undefined;

  return row ? mapWordRow(row) : null;
}

function normalizeProductionMistakeHanzi(value: string): string {
  return value.trim().replace(/\s+/g, '');
}

function parseProductionMistakeCandidateLine(line: string): ProductionMistakeCandidate {
  const parsed = JSON.parse(line) as Partial<ProductionMistakeCandidate>;

  if (
    typeof parsed.id !== 'string' ||
    typeof parsed.targetWordId !== 'string' ||
    typeof parsed.targetHanzi !== 'string' ||
    typeof parsed.attemptedHanzi !== 'string' ||
    (parsed.matchedWordId !== null && typeof parsed.matchedWordId !== 'string') ||
    typeof parsed.createdAt !== 'string' ||
    typeof parsed.note !== 'string'
  ) {
    throw new Error(`Invalid production mistake candidate record: ${line}`);
  }

  return {
    id: parsed.id,
    targetWordId: parsed.targetWordId,
    targetHanzi: parsed.targetHanzi,
    attemptedHanzi: parsed.attemptedHanzi,
    matchedWordId: parsed.matchedWordId,
    createdAt: parsed.createdAt,
    note: parsed.note,
  };
}

function shouldRebuildDevDatabase(error: unknown) {
  if (config.mode !== 'dev') {
    return false;
  }

  return error instanceof Error && error.message.startsWith(`Database at ${dbPath} `);
}

function rebuildDevDatabase(error: unknown) {
  const backupPath = path.join(
    config.dataDir,
    `app.db.invalid-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  );

  db.close();

  if (fs.existsSync(dbPath)) {
    fs.renameSync(dbPath, backupPath);
  }

  console.warn(
    [
      `Dev database at ${dbPath} is invalid; rebuilding it from seed data.`,
      error instanceof Error ? error.message : String(error),
      `Original file backed up to ${backupPath}.`,
    ].join(' '),
  );

  db = openDatabase(dbPath);
  createSchema();
  seedDatabase();
  backfillStudySchedulerStateFromReviewItems();
}

function seedEmptyDevDatabase() {
  if (!config.seedSampleData) {
    return;
  }

  const counts = db
    .prepare(`
      SELECT
        (SELECT COUNT(*) FROM words) AS word_count,
        (SELECT COUNT(*) FROM review_items) AS review_item_count
    `)
    .get() as { word_count: number; review_item_count: number };

  if (counts.word_count === 0 && counts.review_item_count === 0) {
    seedDatabase();
  }
}

function createSchema() {
  db.exec(`
    CREATE TABLE words (
      id TEXT PRIMARY KEY,
      hanzi TEXT NOT NULL,
      traditional TEXT,
      pinyin TEXT NOT NULL,
      meaning TEXT NOT NULL,
      meanings_json TEXT NOT NULL DEFAULT '[]',
      personal_notes TEXT NOT NULL DEFAULT '',
      examples_json TEXT NOT NULL,
      status TEXT NOT NULL,
      priority INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      learning_streak INTEGER NOT NULL DEFAULT 0,
      last_learning_success_on TEXT,
      last_learning_covered_on TEXT
    );

    CREATE TABLE review_items (
      id TEXT PRIMARY KEY,
      word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
      direction TEXT NOT NULL,
      interval_hours INTEGER NOT NULL,
      last_reviewed_at TEXT,
      next_due_at TEXT,
      ease_factor REAL NOT NULL
    );

    CREATE TABLE word_meanings (
      id TEXT PRIMARY KEY,
      word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      text TEXT NOT NULL,
      show_on_production_prompt INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(word_id, position)
    );

    CREATE TABLE user_word_priority (
      word_id TEXT PRIMARY KEY REFERENCES words(id) ON DELETE CASCADE,
      bump_count INTEGER NOT NULL DEFAULT 0,
      force_top INTEGER NOT NULL DEFAULT 0,
      priority_tier INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE app_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE word_study_admission_state (
      word_id TEXT PRIMARY KEY REFERENCES words(id) ON DELETE CASCADE,
      study_phase TEXT NOT NULL,
      earliest_next_study_at TEXT
    );

    CREATE TABLE word_skill_state (
      word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
      skill_id TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      interval_hours INTEGER NOT NULL,
      last_studied_at TEXT NOT NULL,
      next_due_at TEXT,
      ease_factor REAL NOT NULL,
      PRIMARY KEY (word_id, skill_id)
    );

    CREATE TABLE daily_new_word_intake (
      day_key TEXT PRIMARY KEY,
      new_study_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE review_session_summaries (
      session_id TEXT PRIMARY KEY,
      completed_at TEXT NOT NULL,
      day_key TEXT NOT NULL,
      completed_count INTEGER NOT NULL,
      failed_count INTEGER NOT NULL
    );
  `);

  ensureIndexes();
}

function ensureIndexes() {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_words_priority ON words(priority DESC, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_review_items_due ON review_items(next_due_at ASC);
    CREATE INDEX IF NOT EXISTS idx_word_meanings_word_position ON word_meanings(word_id, position ASC);
    CREATE INDEX IF NOT EXISTS idx_user_word_priority_force_top ON user_word_priority(force_top DESC, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_user_word_priority_tier ON user_word_priority(priority_tier DESC, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_word_study_admission_next ON word_study_admission_state(earliest_next_study_at ASC);
    CREATE INDEX IF NOT EXISTS idx_word_skill_state_due ON word_skill_state(next_due_at ASC);
    CREATE INDEX IF NOT EXISTS idx_review_session_summaries_day ON review_session_summaries(day_key ASC);
  `);
}

function validateSchema() {
  assertTableColumns('words', [
    'id',
    'hanzi',
    'traditional',
    'pinyin',
    'meaning',
    'meanings_json',
    'personal_notes',
    'examples_json',
    'status',
    'priority',
    'created_at',
    'learning_streak',
    'last_learning_success_on',
    'last_learning_covered_on',
  ]);
  assertTableColumns('review_items', [
    'id',
    'word_id',
    'direction',
    'interval_hours',
    'last_reviewed_at',
    'next_due_at',
    'ease_factor',
  ]);
  assertTableColumns('word_meanings', [
    'id',
    'word_id',
    'position',
    'text',
    'show_on_production_prompt',
    'created_at',
    'updated_at',
  ]);
  assertTableColumns('user_word_priority', [
    'word_id',
    'bump_count',
    'force_top',
    'priority_tier',
    'updated_at',
  ]);
  assertTableColumns('daily_new_word_intake', [
    'day_key',
    'new_study_count',
  ]);
  assertTableColumns('app_metadata', [
    'key',
    'value',
    'updated_at',
  ]);
  assertTableColumns('word_study_admission_state', [
    'word_id',
    'study_phase',
    'earliest_next_study_at',
  ]);
  assertTableColumns('word_skill_state', [
    'word_id',
    'skill_id',
    'enabled',
    'interval_hours',
    'last_studied_at',
    'next_due_at',
    'ease_factor',
  ]);
  assertTableColumnNotNull('word_skill_state', 'last_studied_at');
  assertTableColumns('review_session_summaries', [
    'session_id',
    'completed_at',
    'day_key',
    'completed_count',
    'failed_count',
  ]);
}

function assertTableColumns(tableName: string, expectedColumns: string[]) {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  const availableColumns = new Set(rows.map((row) => row.name));

  if (availableColumns.size === 0) {
    throw new Error(`Database at ${dbPath} is missing the required "${tableName}" table.`);
  }

  for (const column of expectedColumns) {
    if (!availableColumns.has(column)) {
      throw new Error(
        `Database at ${dbPath} has an incompatible "${tableName}" table. Missing column "${column}". Reset the dev database or create a fresh study database under the new schema.`,
      );
    }
  }
}

function assertTableColumnNotNull(tableName: string, columnName: string) {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string; notnull: number; pk: number }>;
  const column = rows.find((row) => row.name === columnName);

  if (!column) {
    throw new Error(`Database at ${dbPath} has an incompatible "${tableName}" table. Missing column "${columnName}".`);
  }

  if (column.notnull !== 1 && column.pk === 0) {
    throw new Error(
      `Database at ${dbPath} has an incompatible "${tableName}" table. Column "${columnName}" must be NOT NULL.`,
    );
  }
}

function seedDatabase() {
  if (!config.seedSampleData) {
    return;
  }

  const seedData = readSeedData() ?? buildSampleSeedData();

  const insertWord = db.prepare(`
    INSERT INTO words (
      id,
      hanzi,
      traditional,
      pinyin,
      meaning,
      meanings_json,
      personal_notes,
      examples_json,
      status,
      priority,
      created_at,
      learning_streak,
      last_learning_success_on,
      last_learning_covered_on
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertReviewItem = db.prepare(`
    INSERT INTO review_items (
      id,
      word_id,
      direction,
      interval_hours,
      last_reviewed_at,
      next_due_at,
      ease_factor
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertWordMeaning = db.prepare(`
    INSERT INTO word_meanings (
      id,
      word_id,
      position,
      text,
      show_on_production_prompt,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  db.exec('BEGIN');

  try {
    for (const word of seedData.words) {
      insertWord.run(
        word.id,
        word.hanzi,
        word.traditional,
        word.pinyin,
        word.meaning,
        JSON.stringify(word.meanings),
        word.personalNotes,
        JSON.stringify(word.examples),
        word.status,
        word.priority,
        word.createdAt,
        word.learningStreak,
        word.lastLearningSuccessOn,
        word.lastLearningCoveredOn,
      );
    }

    for (const wordMeaning of seedData.wordMeanings) {
      insertWordMeaning.run(
        wordMeaning.id,
        wordMeaning.wordId,
        wordMeaning.position,
        wordMeaning.text,
        wordMeaning.showOnProductionPrompt ? 1 : 0,
        wordMeaning.createdAt,
        wordMeaning.updatedAt,
      );
    }

    for (const reviewItem of seedData.reviewItems) {
      insertReviewItem.run(
        reviewItem.id,
        reviewItem.wordId,
        reviewItem.direction,
        reviewItem.intervalHours,
        reviewItem.lastReviewedAt,
        reviewItem.nextDueAt,
        reviewItem.easeFactor,
      );
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function readSeedData(): SeedData | null {
  if (!fs.existsSync(appJsonPath)) {
    return null;
  }

  const parsed = JSON.parse(fs.readFileSync(appJsonPath, 'utf8')) as Partial<SeedData>;

  if (!Array.isArray(parsed.words) || !Array.isArray(parsed.reviewItems)) {
    return null;
  }

  const words = parsed.words.map(normalizeSeedWord);
  return {
    words,
    wordMeanings: buildWordMeaningsFromWords(words),
    reviewItems: parsed.reviewItems.map(normalizeSeedReviewItem),
  };
}

function normalizeSeedWord(word: Partial<Word>): Word {
  return {
    id: word.id ?? '',
    hanzi: word.hanzi ?? '',
    traditional: word.traditional ?? null,
    pinyin: word.pinyin ?? '',
    meaning: word.meaning ?? '',
    meanings: Array.isArray((word as Partial<Word> & { meanings?: unknown }).meanings)
      ? ((word as Partial<Word> & { meanings?: unknown }).meanings as string[]).filter((meaning) => meaning.trim().length > 0)
      : [word.meaning ?? ''],
    personalNotes: word.personalNotes ?? '',
    examples: Array.isArray(word.examples) ? word.examples : [],
    status: word.status ?? 'unstudied',
    priority: word.priority ?? 0,
    createdAt: word.createdAt ?? new Date().toISOString(),
    learningStreak: word.learningStreak ?? 0,
    lastLearningSuccessOn: word.lastLearningSuccessOn ?? null,
    lastLearningCoveredOn: word.lastLearningCoveredOn ?? null,
  };
}

function normalizeSeedReviewItem(reviewItem: Partial<ReviewItem>): ReviewItem {
  return {
    id: reviewItem.id ?? '',
    wordId: reviewItem.wordId ?? '',
    direction: reviewItem.direction === 'reverse' ? 'reverse' : 'forward',
    intervalHours: reviewItem.intervalHours ?? 0,
    lastReviewedAt: reviewItem.lastReviewedAt ?? null,
    nextDueAt: reviewItem.nextDueAt ?? null,
    easeFactor: reviewItem.easeFactor ?? INITIAL_REVIEW_EASE_FACTOR,
  };
}

function buildSampleSeedData(): SeedData {
  const words = buildSampleWords();
  return {
    words,
    wordMeanings: buildWordMeaningsFromWords(words),
    reviewItems: buildSampleReviewItems(words),
  };
}

function buildSampleWords(): Word[] {
  const now = new Date().toISOString();
  const today = getTodayKey();

  return [
    {
      id: 'word-1',
      hanzi: '你好',
      traditional: '你好',
      pinyin: 'nǐ hǎo',
      meaning: 'hello',
      meanings: ['hello'],
      personalNotes: '',
      examples: ['你好！你今天怎么样？'],
      status: 'review',
      priority: 100,
      createdAt: now,
      learningStreak: 0,
      lastLearningSuccessOn: null,
      lastLearningCoveredOn: null,
    },
    {
      id: 'word-2',
      hanzi: '谢谢',
      traditional: '謝謝',
      pinyin: 'xiè xie',
      meaning: 'thank you',
      meanings: ['thank you'],
      personalNotes: '',
      examples: ['谢谢你的帮助。'],
      status: 'learning',
      priority: 99,
      createdAt: now,
      learningStreak: 1,
      lastLearningSuccessOn: addDaysToDateKey(today, -1),
      lastLearningCoveredOn: null,
    },
    {
      id: 'word-3',
      hanzi: '学习',
      traditional: '學習',
      pinyin: 'xué xí',
      meaning: 'to study',
      meanings: ['to study'],
      personalNotes: '',
      examples: ['我每天学习汉语。'],
      status: 'learning',
      priority: 98,
      createdAt: now,
      learningStreak: 0,
      lastLearningSuccessOn: null,
      lastLearningCoveredOn: null,
    },
    {
      id: 'word-4',
      hanzi: '朋友',
      traditional: '朋友',
      pinyin: 'péng you',
      meaning: 'friend',
      meanings: ['friend'],
      personalNotes: '',
      examples: ['她是我的好朋友。'],
      status: 'unstudied',
      priority: 97,
      createdAt: now,
      learningStreak: 0,
      lastLearningSuccessOn: null,
      lastLearningCoveredOn: null,
    },
    {
      id: 'word-5',
      hanzi: '说',
      traditional: '說',
      pinyin: 'shuō',
      meaning: 'to speak',
      meanings: ['to speak'],
      personalNotes: '',
      examples: ['你会说中文吗？'],
      status: 'unstudied',
      priority: 96,
      createdAt: now,
      learningStreak: 0,
      lastLearningSuccessOn: null,
      lastLearningCoveredOn: null,
    },
  ];
}

function buildSampleReviewItems(words: Word[]): ReviewItem[] {
  const now = new Date().toISOString();
  const overdueAt = addHours(now, -24);
  const learningDueAt = addHours(new Date().toISOString(), -1);

  return words.flatMap((word) => {
    const nextDueAt = word.status === 'unstudied' ? null : word.status === 'review' ? overdueAt : learningDueAt;
    const lastReviewedAt = word.status === 'review' ? addHours(overdueAt, -48) : null;

    return [
      {
        id: `${word.id}-forward`,
        wordId: word.id,
        direction: 'forward',
        intervalHours: word.status === 'review' ? 48 : 6,
        lastReviewedAt,
        nextDueAt,
        easeFactor: INITIAL_REVIEW_EASE_FACTOR,
      },
      {
        id: `${word.id}-reverse`,
        wordId: word.id,
        direction: 'reverse',
        intervalHours: word.status === 'review' ? 36 : 6,
        lastReviewedAt,
        nextDueAt,
        easeFactor: INITIAL_REVIEW_EASE_FACTOR,
      },
    ];
  });
}

function buildWordMeaningsFromWords(words: Word[]): WordMeaning[] {
  return words.flatMap((word) => {
    const sourceMeanings = word.meanings.length > 0 ? word.meanings : word.meaning.trim() ? [word.meaning] : [];
    return sourceMeanings.map((text, index) => ({
      id: `${word.id}-meaning-${index + 1}`,
      wordId: word.id,
      position: index,
      text,
      showOnProductionPrompt: true,
      createdAt: word.createdAt,
      updatedAt: word.createdAt,
    }));
  });
}

function mapWordRow(row: WordRow): Word {
  return {
    id: row.id,
    hanzi: row.hanzi,
    traditional: row.traditional,
    pinyin: row.pinyin,
    meaning: row.meaning,
    meanings: parseMeaningsJson(row.meanings_json, row.meaning),
    personalNotes: row.personal_notes,
    examples: JSON.parse(row.examples_json) as string[],
    status: row.status,
    priority: row.priority,
    createdAt: row.created_at,
    learningStreak: row.learning_streak,
    lastLearningSuccessOn: row.last_learning_success_on,
    lastLearningCoveredOn: row.last_learning_covered_on,
  };
}

function mapWordMeaningRow(row: WordMeaningRow): WordMeaning {
  return {
    id: row.id,
    wordId: row.word_id,
    position: row.position,
    text: row.text,
    showOnProductionPrompt: row.show_on_production_prompt !== 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPriorityWordRow(row: PriorityWordRow): PriorityWord {
  return {
    word: mapWordRow(row),
    bumpCount: row.bump_count,
    forceTop: row.priority_tier === PRIORITY_TIER_TOP,
    effectivePriority: row.effective_priority,
    effectiveRank: row.effective_rank,
  };
}

function buildPriorityWordFromParts({
  row,
  bumpCount,
  forceTop,
  effectivePriority,
  effectiveRank,
}: {
  row: WordRow;
  bumpCount: number;
  forceTop: boolean;
  effectivePriority: number;
  effectiveRank: number;
}): PriorityWord {
  return {
    word: mapWordRow(row),
    bumpCount,
    forceTop,
    effectivePriority,
    effectiveRank,
  };
}

function mapReviewItemRow(row: ReviewItemRow): ReviewItem {
  return {
    id: row.id,
    wordId: row.word_id,
    direction: row.direction,
    intervalHours: row.interval_hours,
    lastReviewedAt: row.last_reviewed_at,
    nextDueAt: row.next_due_at,
    easeFactor: row.ease_factor,
  };
}

function mapReviewDirectionToStudySkill(direction: ReviewItem['direction']): StudySkillId {
  switch (direction) {
    case 'forward':
      return 'recognition';
    case 'reverse':
      return 'production';
    default:
      return assertUnreachableReviewDirection(direction);
  }
}

function mapWordStudyAdmissionStateRow(row: WordStudyAdmissionStateRow): WordStudyAdmissionState {
  return {
    wordId: row.word_id,
    studyPhase: row.study_phase,
    earliestNextStudyAt: row.earliest_next_study_at,
  };
}

function mapWordSkillStateRow(row: WordSkillStateRow): WordSkillState {
  return {
    wordId: row.word_id,
    skillId: row.skill_id,
    enabled: row.enabled !== 0,
    intervalHours: row.interval_hours,
    lastStudiedAt: row.last_studied_at,
    nextDueAt: row.next_due_at,
    easeFactor: row.ease_factor,
  };
}

function getSessionItemBucketsWithWords(studyDayKey: string): SessionItemBuckets {
  const now = new Date().toISOString();
  const today = getTodayKey();
  const remainingDailyNewWordSlots = getRemainingDailyNewWordSlots(studyDayKey);
  const reviewRows = db
    .prepare(`
      SELECT
        review_items.id,
        review_items.word_id,
        review_items.direction,
        review_items.interval_hours,
        review_items.last_reviewed_at,
        review_items.next_due_at,
        review_items.ease_factor,
        words.hanzi AS word_hanzi,
        words.traditional AS word_traditional,
        words.pinyin AS word_pinyin,
        words.meaning AS word_meaning,
        words.meanings_json AS word_meanings_json,
        words.personal_notes AS word_personal_notes,
        words.examples_json AS word_examples_json,
        words.status AS word_status,
        words.priority AS word_priority,
        words.created_at AS word_created_at,
        words.learning_streak AS word_learning_streak,
        words.last_learning_success_on AS word_last_learning_success_on,
        words.last_learning_covered_on AS word_last_learning_covered_on
      FROM review_items
      INNER JOIN words ON words.id = review_items.word_id
      WHERE words.status = 'review'
        AND review_items.next_due_at IS NOT NULL
        AND review_items.next_due_at <= ?
      ORDER BY
        CASE review_items.direction
          WHEN 'reverse' THEN 0
          ELSE 1
        END ASC,
        review_items.next_due_at ASC
    `)
    .all(now) as SessionItemWithWordRow[];

  const learningRows = db
    .prepare(`
      SELECT
        review_items.id,
        review_items.word_id,
        review_items.direction,
        review_items.interval_hours,
        review_items.last_reviewed_at,
        review_items.next_due_at,
        review_items.ease_factor,
        words.hanzi AS word_hanzi,
        words.traditional AS word_traditional,
        words.pinyin AS word_pinyin,
        words.meaning AS word_meaning,
        words.meanings_json AS word_meanings_json,
        words.personal_notes AS word_personal_notes,
        words.examples_json AS word_examples_json,
        words.status AS word_status,
        words.priority AS word_priority,
        words.created_at AS word_created_at,
        words.learning_streak AS word_learning_streak,
        words.last_learning_success_on AS word_last_learning_success_on,
        words.last_learning_covered_on AS word_last_learning_covered_on
      FROM review_items
      INNER JOIN words ON words.id = review_items.word_id
      WHERE words.status = 'learning'
        AND (words.last_learning_covered_on IS NULL OR words.last_learning_covered_on != ?)
      ORDER BY
        CASE review_items.direction
          WHEN 'reverse' THEN 0
          ELSE 1
        END ASC
    `)
    .all(today) as SessionItemWithWordRow[];

  // -- See BACKLOG.md "Unstudied Intake Modeling". We intentionally keep
  // -- `WITH ranked_unstudied AS (...) ... LIMIT ?` here so limiting happens
  // -- at the word level before expanding into per-direction review-item rows.
  const unstudiedRows = db
    .prepare(`
      WITH ranked_unstudied AS (
        SELECT
          words.id,
          words.priority AS base_priority,
          words.created_at,
          COALESCE(user_word_priority.bump_count, 0) AS bump_count,
          COALESCE(user_word_priority.force_top, 0) AS force_top,
          COALESCE(user_word_priority.priority_tier, 0) AS priority_tier,
          words.priority
            + COALESCE(user_word_priority.bump_count, 0) * ${PRIORITY_BUMP_UNIT} AS effective_priority
        FROM words
        LEFT JOIN user_word_priority ON user_word_priority.word_id = words.id
        WHERE words.status = 'unstudied'
        ORDER BY
          priority_tier DESC,
          effective_priority DESC,
          words.priority DESC,
          words.created_at ASC
        LIMIT ?
      )
      SELECT
        review_items.id,
        review_items.word_id,
        review_items.direction,
        review_items.interval_hours,
        review_items.last_reviewed_at,
        review_items.next_due_at,
        review_items.ease_factor,
        words.hanzi AS word_hanzi,
        words.traditional AS word_traditional,
        words.pinyin AS word_pinyin,
        words.meaning AS word_meaning,
        words.meanings_json AS word_meanings_json,
        words.personal_notes AS word_personal_notes,
        words.examples_json AS word_examples_json,
        words.status AS word_status,
        words.priority AS word_priority,
        words.created_at AS word_created_at,
        words.learning_streak AS word_learning_streak,
        words.last_learning_success_on AS word_last_learning_success_on,
        words.last_learning_covered_on AS word_last_learning_covered_on
      FROM review_items
      INNER JOIN words ON words.id = review_items.word_id
      INNER JOIN ranked_unstudied ON ranked_unstudied.id = words.id
      ORDER BY
        ranked_unstudied.priority_tier DESC,
        ranked_unstudied.effective_priority DESC,
        words.priority DESC,
        words.created_at ASC,
        CASE review_items.direction
          WHEN 'forward' THEN 0
          ELSE 1
        END ASC
    `)
    .all(remainingDailyNewWordSlots) as SessionItemWithWordRow[];

  return {
    review: reviewRows.map(mapSessionItemWithWordRow),
    learning: learningRows.map(mapSessionItemWithWordRow),
    unstudied: unstudiedRows.map(mapSessionItemWithWordRow),
  };
}

function mapSessionItemWithWordRow(row: SessionItemWithWordRow): SessionItemWithWord {
  return {
    reviewItem: mapReviewItemRow(row),
    word: {
      id: row.word_id,
      hanzi: row.word_hanzi,
      traditional: row.word_traditional,
      pinyin: row.word_pinyin,
      meaning: row.word_meaning,
      meanings: parseMeaningsJson(row.word_meanings_json, row.word_meaning),
      personalNotes: row.word_personal_notes,
      examples: JSON.parse(row.word_examples_json) as string[],
      status: row.word_status,
      priority: row.word_priority,
      createdAt: row.word_created_at,
      learningStreak: row.word_learning_streak,
      lastLearningSuccessOn: row.word_last_learning_success_on,
      lastLearningCoveredOn: row.word_last_learning_covered_on,
    },
  };
}

// Applies the persisted scheduling update for a covered review-item session.
// - `failureCount > 0`: treat as lapse-and-recovery, reset interval to 6h and reduce ease by `0.15 * failureCount` with a floor of `1.8`
// - clean `hard`: multiply interval by `1.5`, then round up to the next whole hour with a minimum of 6h; reduce ease by `0.15`, floor `1.8`
// - clean `good`: multiply interval by current ease, then round up to the next whole hour; ease stays unchanged
// - clean `easy`: multiply interval by `ease + 0.35`, then round up to the next whole hour; ease increases by `0.15`
function scheduleReviewItemFromSession(
  item: ReviewItem,
  failureCount: number,
  terminalRating: ReviewPassRating | null,
): ReviewItem {
  const reviewedAt = new Date().toISOString();

  if (failureCount > 0) {
    const penaltyEase = Math.max(1.8, Number((item.easeFactor - 0.15 * failureCount).toFixed(2)));

    return {
      ...item,
      intervalHours: 6,
      lastReviewedAt: reviewedAt,
      nextDueAt: addHours(reviewedAt, 6),
      easeFactor: penaltyEase,
    };
  }

  if (terminalRating === 'hard') {
    const nextInterval = Math.max(6, ceilIntervalHours(item.intervalHours * 1.5));

    return {
      ...item,
      intervalHours: nextInterval,
      lastReviewedAt: reviewedAt,
      nextDueAt: addHours(reviewedAt, nextInterval),
      easeFactor: Math.max(1.8, Number((item.easeFactor - 0.15).toFixed(2))),
    };
  }

  if (terminalRating === 'good') {
    const baseInterval = ceilIntervalHours(item.intervalHours * item.easeFactor);

    return {
      ...item,
      intervalHours: baseInterval,
      lastReviewedAt: reviewedAt,
      nextDueAt: addHours(reviewedAt, baseInterval),
      easeFactor: Number(item.easeFactor.toFixed(2)),
    };
  }

  if (terminalRating !== 'easy') {
    throw new Error('Expected terminal review rating');
  }

  const nextInterval = ceilIntervalHours(item.intervalHours * (item.easeFactor + 0.35));

  return {
    ...item,
    intervalHours: nextInterval,
    lastReviewedAt: reviewedAt,
    nextDueAt: addHours(reviewedAt, nextInterval),
    easeFactor: Number((item.easeFactor + 0.15).toFixed(2)),
  };
}

function getRollingReviewFailureCounts(
  countsByDay: Map<string, { completedCount: number; failedCount: number }>,
  dayKey: string,
  windowDays: number,
) {
  let completedCount = 0;
  let failedCount = 0;

  for (let offset = 0; offset < windowDays; offset += 1) {
    const counts = countsByDay.get(addDaysToDateKey(dayKey, -offset));
    if (!counts) {
      continue;
    }

    completedCount += counts.completedCount;
    failedCount += counts.failedCount;
  }

  return { completedCount, failedCount };
}

function calculateFailureRate(failedCount: number, completedCount: number) {
  if (completedCount === 0) {
    return null;
  }

  return failedCount / completedCount;
}

function addHours(isoTimestamp: string, hours: number): string {
  const date = new Date(isoTimestamp);
  date.setUTCHours(date.getUTCHours() + hours);
  return date.toISOString();
}

function parseMeaningsJson(raw: string, fallbackMeaning: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      const cleaned = parsed.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
      if (cleaned.length > 0) {
        return cleaned;
      }
    }
  } catch {
    // Fall through to the persisted single-string meaning.
  }

  return fallbackMeaning.trim() ? [fallbackMeaning] : [];
}

function ceilIntervalHours(hours: number) {
  return Math.max(1, Math.ceil(hours));
}

function assertUnreachableReviewDirection(direction: never): never {
  throw new Error(`Unsupported review direction "${String(direction)}".`);
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// just used on the update path, intentionally fuzzy
function getUnstudiedPriorityWordById(wordId: string): PriorityWord {
  const row = db
    .prepare(`
      SELECT
        words.id,
        words.hanzi,
        words.traditional,
        words.pinyin,
        words.meaning,
        words.meanings_json,
        words.personal_notes,
        words.examples_json,
        words.status,
        words.priority,
        words.created_at,
        words.learning_streak,
        words.last_learning_success_on,
        words.last_learning_covered_on,
        COALESCE(user_word_priority.bump_count, 0) AS bump_count,
        COALESCE(user_word_priority.force_top, 0) AS force_top,
        COALESCE(user_word_priority.priority_tier, 0) AS priority_tier,
        words.priority
          + COALESCE(user_word_priority.bump_count, 0) * ${PRIORITY_BUMP_UNIT} AS effective_priority
      FROM words
      LEFT JOIN user_word_priority ON user_word_priority.word_id = words.id
      WHERE words.id = ?
        AND words.status = 'unstudied'
    `)
    .get(wordId) as
    | (WordRow & { bump_count: number; force_top: number; priority_tier: number; effective_priority: number })
    | undefined;

  if (!row) {
    throw new Error('Expected unstudied word');
  }

  const bumpCount = row.bump_count;
  const forceTop = row.priority_tier === PRIORITY_TIER_TOP;
  const effectivePriority = row.effective_priority;
  const effectiveRank = estimateApproximatePriorityRank({
    priority: row.priority,
    bumpCount,
    priorityTier: row.priority_tier,
  });

  return buildPriorityWordFromParts({
    row,
    bumpCount,
    forceTop,
    effectivePriority,
    effectiveRank,
  });
}

function estimateApproximatePriorityRank({
  priority,
  bumpCount,
  priorityTier,
}: {
  priority: number;
  bumpCount: number;
  priorityTier: number;
}): number {
  if (priorityTier === PRIORITY_TIER_TOP) {
    return 1;
  }

  if (priorityTier === PRIORITY_TIER_SUNK) {
    return UNSTUDIED_COUNT_BASELINE;
  }

  const normalizedPriority = clampInteger(Math.round(priority), 0, PRIORITY_MAX_BASELINE);
  const priorityRatio = PRIORITY_MAX_BASELINE === 0 ? 0 : normalizedPriority / PRIORITY_MAX_BASELINE;
  const baseRank = Math.round((1 - priorityRatio) * (UNSTUDIED_COUNT_BASELINE - 1)) + 1;
  const bumpRankShift = bumpCount * Math.ceil(UNSTUDIED_COUNT_BASELINE * 0.1);

  return clampInteger(baseRank - bumpRankShift, 1, UNSTUDIED_COUNT_BASELINE);
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function getRemainingDailyNewWordSlots(studyDayKey: string): number {
  const studiedCount = getDailyNewStudyCount(studyDayKey);
  return Math.max(0, DAILY_NEW_WORD_LIMIT - studiedCount);
}

function getDailyNewStudyCount(studyDayKey: string): number {
  const row = db
    .prepare(`
      SELECT
        day_key,
        new_study_count
      FROM daily_new_word_intake
      WHERE day_key = ?
    `)
    .get(studyDayKey) as DailyNewWordIntakeRow | undefined;

  return row?.new_study_count ?? 0;
}

function incrementDailyNewStudyCount(studyDayKey: string) {
  db.prepare(`
    INSERT INTO daily_new_word_intake (
      day_key,
      new_study_count
    ) VALUES (?, 1)
    ON CONFLICT(day_key) DO UPDATE SET
      new_study_count = daily_new_word_intake.new_study_count + 1
  `).run(studyDayKey);
}

function assertStudyDayKey(studyDayKey: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(studyDayKey)) {
    throw new Error('Invalid study day key');
  }
}
