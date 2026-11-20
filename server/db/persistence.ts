import { getSessionWordReport } from './session-word-outcomes.ts';
import { DEFAULT_INTRODUCTION_SPACING, isStudyIntroductionOrder, isStudyIntroductionSpacing, type StudyIntroductionOrder } from '../../src/domain/introduction-order.ts';
import { enqueueSessionDebrief } from './session-debrief.ts';
import { validateDebriefInventory, type SessionDebriefInventoryItem } from '../../src/domain/session-debrief.ts';
import { validateContentQualitySchema } from './content-quality.ts';
import fs from 'node:fs';
import path from 'node:path';
import type {
  ContrastCluster,
  ContrastClusterMember,
  ContrastPrompt,
  WordSkillRelevanceState,
} from '../../src/domain/study-actions.ts';
import { config, getDb, dbPath, seedDataPath, dbExistedOnStartup } from './connection.ts';
import { seedWordIntroductionFixtures } from '../seeds/word-introductions.ts';
import { fillMissingNormalizedHanzi, normalizeMandarinHanziLookup } from './hanzi-lookup.ts';
import { assertSchemaCurrent, migrateDatabase } from './migrations.ts';
import { createHostedOperationsSchema } from './hosted-operations.ts';
import {
  createReflectionIndexes,
  createReflectionSchema,
  validateReflectionSchema,
} from './reflections.ts';
import {
  createIntakeTriageIndexes,
  createIntakeTriageSchema,
  validateIntakeTriageSchema,
} from './intake-triage.ts';
import { enableContextualSelectionWithoutTransaction } from './domain-commands.ts';
import {
  createProductionCueIndexes,
  createProductionCueSchema,
  validateProductionCueSchema,
} from './production-cues.ts';
import {
  DEFAULT_DAILY_NEW_WORD_LIMIT,
  INITIAL_REVIEW_EASE_FACTOR,
  INITIAL_CONTEXTUAL_SELECTION_INTERVAL_HOURS,
  PRIORITY_TIER_TOP,
  PRIORITY_TIER_REGULAR,
} from './types.ts';
import type {
  PriorityWord,
  PriorityWordRow,
  PriorityWordsPayload,
  SeedData,
  StudySkillId,
  UserWordPriorityPatch,
  UserWordPriorityRow,
  Word,
  WordMeaning,
  WordMeaningRow,
  WordRow,
  WordSkillRelevance,
  WordSkillState,
  WordStudyAdmissionState,
} from './types.ts';
import { invalidateDeckWordIds } from './deck-words.ts';
import {
  DEFAULT_UNSTUDIED_ADMISSION_SOURCE,
  type UnstudiedAdmissionSource,
  assertUnstudiedAdmissionSource,
} from './unstudied-admission.ts';
import {
  assertCharacterPresentation,
  assertSentenceCharacterPresentation,
  DEFAULT_SENTENCE_CHARACTER_PRESENTATION,
  type SentenceCharacterPresentation,
  DEFAULT_CHARACTER_PRESENTATION,
  type CharacterPresentation,
} from '../../src/domain/card-characters.ts';
import {
  assertLearnerExists,
  bootstrapLearner,
  createIdentitySchema,
  recordLearnerOwnershipSchema,
} from './identity.ts';
import { requireLearnerId } from './learner-context.ts';
import {
  createLearnerScopedCompatibilityViews,
  learnerScopedStorageTableName,
} from './learner-scoped-tables.ts';
import {
  createScopedContentCompatibilityViews,
  scopedContentStorageTableName,
} from './scoped-content-tables.ts';

import { createLearnerOwnershipGuards } from './learner-ownership-guards.ts';
import {
  createSharedContentSchema,
  validateSharedContentSchema,
} from './shared-content.ts';

export function applyProductionContrastExerciseSeed() {
  if (!config.seedSampleData || !config.includeDevContrastSeed || config.studyProfile !== 'mandarin') {
    return;
  }

  const sqlPaths = [
    path.resolve(process.cwd(), 'data/seed-production-contrast-exercises.sql'),
    path.resolve(process.cwd(), 'data/seed-production-contrast-dev-scheduling.sql'),
  ];

  for (const sqlPath of sqlPaths) {
    if (!fs.existsSync(sqlPath)) {
      throw new Error(`Production contrast exercise seed SQL not found at ${sqlPath}`);
    }

    getDb().exec(fs.readFileSync(sqlPath, 'utf8'));
  }

  backfillContrastClusterMemberEligibility();
}

export function getWords(): Word[] {
  const rows = getDb()
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

export function searchWords(query: string, limit = 20): Word[] {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length === 0) {
    return [];
  }

  const boundedLimit = clampInteger(limit, 1, 50);
  const likeQuery = `%${normalizedQuery}%`;
  const rows = getDb()
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
      WHERE hanzi LIKE ?
         OR traditional LIKE ?
         OR pinyin LIKE ?
         OR meaning LIKE ?
      ORDER BY
        CASE
          WHEN hanzi = ? OR traditional = ? THEN 0
          WHEN hanzi LIKE ? OR traditional LIKE ? THEN 1
          ELSE 2
        END ASC,
        status DESC,
        priority DESC,
        created_at ASC
      LIMIT ?
    `)
    .all(
      likeQuery,
      likeQuery,
      likeQuery,
      likeQuery,
      normalizedQuery,
      normalizedQuery,
      `${normalizedQuery}%`,
      `${normalizedQuery}%`,
      boundedLimit,
    ) as WordRow[];

  return rows.map(mapWordRow);
}

export function getWordMeanings(wordId: string): WordMeaning[] {
  const existingWord = getDb()
    .prepare(`
      SELECT id
      FROM words
      WHERE id = ?
    `)
    .get(wordId) as { id: string } | undefined;

  if (!existingWord) {
    throw new Error('Word not found');
  }

  const rows = getDb()
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
  const existingMeaning = getDb()
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

  getDb().prepare(`
    UPDATE word_meanings
    SET show_on_production_prompt = ?,
        updated_at = ?
    WHERE id = ?
      AND word_id = ?
  `).run(showOnProductionPrompt ? 1 : 0, new Date().toISOString(), meaningId, wordId);

  return getWordMeanings(wordId);
}

export function getPrioritizedUnstudiedWords(): PriorityWordsPayload {
  const rows = getDb()
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
        'unstudied' AS status,
        words.priority,
        words.created_at,
        words.learning_streak,
        words.last_learning_success_on,
        words.last_learning_covered_on,
        user_word_priority.bump_count,
        user_word_priority.force_top,
        user_word_priority.priority_tier,
        user_word_priority.required_for_next_session,
        user_word_priority.updated_at AS overlay_updated_at
      FROM user_word_priority
      JOIN words ON words.id = user_word_priority.word_id
      WHERE ${unstudiedPriorityPredicate('words')}
        AND ${priorityMembershipPredicate('words')}
        AND user_word_priority.priority_tier >= ${PRIORITY_TIER_REGULAR}
        AND (
          user_word_priority.bump_count > 0
          OR user_word_priority.priority_tier = ${PRIORITY_TIER_TOP}
          OR user_word_priority.required_for_next_session != 0
        )
      ORDER BY
        user_word_priority.priority_tier DESC,
        user_word_priority.updated_at DESC,
        words.id ASC
    `)
    .all() as PriorityWordRow[];

  return {
    words: rows.map(mapPriorityWordRow),
  };
}

export function updateWordPersonalNotes(wordId: string, personalNotes: string): Word {
  const existingWord = getDb()
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

  getDb().prepare(`
    UPDATE words
    SET personal_notes = ?
    WHERE id = ?
  `).run(personalNotes, wordId);

  const updatedWord = getDb()
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
  const existingWord = getDb()
    .prepare(`
      SELECT
        id,
        CASE WHEN ${unstudiedPriorityPredicate('words')} THEN 1 ELSE 0 END AS is_unstudied
      FROM words
      WHERE id = ?
    `)
    .get(wordId) as { id: string; is_unstudied: number } | undefined;

  if (!existingWord) {
    throw new Error('Word not found');
  }

  if (existingWord.is_unstudied !== 1) {
    throw new Error('Expected unstudied word');
  }

  const existingPriorityRow = getDb()
    .prepare(`
      SELECT
        word_id,
        bump_count,
        force_top,
        priority_tier,
        required_for_next_session,
        updated_at
      FROM user_word_priority
      WHERE word_id = ?
    `)
    .get(wordId) as UserWordPriorityRow | undefined;

  const currentBumpCount = existingPriorityRow?.bump_count ?? 0;
  const currentPriorityTier = existingPriorityRow?.priority_tier ?? PRIORITY_TIER_REGULAR;
  const currentRequiredForNextSession = existingPriorityRow?.required_for_next_session ?? 0;
  const reset = patch.reset === true;
  const nextBumpCount = reset
    ? 0
    : patch.bumpDelta === undefined
      ? currentBumpCount
      : patch.bumpDelta > 0
        ? Math.max(currentBumpCount, 1)
        : 0;
  const nextPriorityTier = reset
    ? PRIORITY_TIER_REGULAR
    : patch.forceTop === undefined
      ? currentPriorityTier
      : patch.forceTop
        ? PRIORITY_TIER_TOP
        : PRIORITY_TIER_REGULAR;
  const nextForceTop = nextPriorityTier === PRIORITY_TIER_TOP;
  const nextRequiredForNextSession = reset
    ? false
    : patch.requiredForNextSession ?? (currentRequiredForNextSession !== 0);

  if (nextBumpCount === 0 && nextPriorityTier === PRIORITY_TIER_REGULAR && !nextRequiredForNextSession) {
    getDb().prepare(`
      DELETE FROM user_word_priority
      WHERE word_id = ?
    `).run(wordId);
  } else {
    getDb().prepare(`
      INSERT INTO learner_owned_user_word_priority (
        word_id,
        bump_count,
        force_top,
        priority_tier,
        required_for_next_session,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(learner_id, word_id) DO UPDATE SET
        bump_count = excluded.bump_count,
        force_top = excluded.force_top,
        priority_tier = excluded.priority_tier,
        required_for_next_session = excluded.required_for_next_session,
        updated_at = excluded.updated_at
    `).run(
      wordId,
      nextBumpCount,
      nextForceTop ? 1 : 0,
      nextPriorityTier,
      nextRequiredForNextSession ? 1 : 0,
      new Date().toISOString(),
    );
  }

  return getUnstudiedPriorityWordById(wordId);
}

export function listUnstudiedPriorityMatchesByTarget(targetText: string): Word[] {
  return resolveUnstudiedPriorityWordIdsByTarget(targetText).map((match) => getUnstudiedPriorityWordById(match.id).word);
}

export function addUnstudiedUserPriorityByHanzi(
  hanzi: string,
  requiredForNextSession = false,
  wordIds?: string[],
): PriorityWord[] {
  const matches = resolveUnstudiedPriorityWordIdsByTarget(hanzi);

  if (matches.length === 0) {
    throw new Error('No matching unstudied words found');
  }

  const matchesToAdd = selectPriorityMatchesByWordIds(matches, wordIds);

  getDb().exec('SAVEPOINT add_unstudied_priority');

  try {
    for (const match of matchesToAdd) {
      const existingPriorityRow = getDb()
        .prepare(`
          SELECT
            bump_count,
            force_top,
            priority_tier,
            required_for_next_session
          FROM user_word_priority
          WHERE word_id = ?
        `)
        .get(match.id) as
        | { bump_count: number; force_top: number; priority_tier: number; required_for_next_session: number }
        | undefined;

      const nextBumpCount = Math.max(existingPriorityRow?.bump_count ?? 0, 1);
      const nextForceTop = existingPriorityRow?.force_top ?? 0;
      const nextPriorityTier = Math.max(existingPriorityRow?.priority_tier ?? PRIORITY_TIER_REGULAR, PRIORITY_TIER_REGULAR);
      const nextRequiredForNextSession = requiredForNextSession ? 1 : (existingPriorityRow?.required_for_next_session ?? 0);

      getDb().prepare(`
        INSERT INTO learner_owned_user_word_priority (
          word_id,
          bump_count,
          force_top,
          priority_tier,
          required_for_next_session,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(learner_id, word_id) DO UPDATE SET
          bump_count = excluded.bump_count,
          force_top = excluded.force_top,
          priority_tier = excluded.priority_tier,
          required_for_next_session = excluded.required_for_next_session,
          updated_at = excluded.updated_at
      `).run(match.id, nextBumpCount, nextForceTop, nextPriorityTier, nextRequiredForNextSession, new Date().toISOString());
    }

    getDb().exec('RELEASE add_unstudied_priority');
  } catch (error) {
    getDb().exec('ROLLBACK TO add_unstudied_priority');
    getDb().exec('RELEASE add_unstudied_priority');
    throw error;
  }

  return matchesToAdd.map((match) => getUnstudiedPriorityWordById(match.id));
}

function selectPriorityMatchesByWordIds(
  matches: Array<{ id: string }>,
  wordIds: string[] | undefined,
): Array<{ id: string }> {
  if (wordIds === undefined) {
    return matches;
  }

  if (!Array.isArray(wordIds)) {
    throw new Error('Expected wordIds to be an array of strings when provided');
  }

  const uniqueWordIds: string[] = [];
  const seenWordIds = new Set<string>();
  for (const wordId of wordIds) {
    if (typeof wordId !== 'string' || wordId.trim().length === 0) {
      throw new Error('Expected wordIds to be an array of strings when provided');
    }
    if (seenWordIds.has(wordId)) {
      continue;
    }
    seenWordIds.add(wordId);
    uniqueWordIds.push(wordId);
  }

  if (uniqueWordIds.length === 0) {
    throw new Error('Expected non-empty wordIds when provided');
  }

  const matchIds = new Set(matches.map((match) => match.id));
  for (const wordId of uniqueWordIds) {
    if (!matchIds.has(wordId)) {
      throw new Error('wordIds must match the submitted target');
    }
  }

  return uniqueWordIds.map((id) => ({ id }));
}

/** Stash APIs follow the new Mandarin mode once enrolled; other profiles retain their lifecycle. */
function unstudiedPriorityPredicate(alias: 'words'): string {
  if (config.studyProfile !== 'mandarin') return `${alias}.status='unstudied'`;
  return `COALESCE((SELECT CASE WHEN vocabulary.mode='unstudied' THEN 1 ELSE 0 END FROM learner_words vocabulary
    WHERE vocabulary.learner_id=current_learner_id() AND vocabulary.word_id=${alias}.id),CASE WHEN ${alias}.status='unstudied' THEN 1 ELSE 0 END)=1`;
}
function priorityMembershipPredicate(alias: 'words'): string {
  if (config.studyProfile !== 'mandarin') return '1=1';
  return `COALESCE((SELECT CASE WHEN vocabulary.in_stash=1 AND vocabulary.dismissed_at IS NULL THEN 1 ELSE 0 END
    FROM learner_words vocabulary WHERE vocabulary.learner_id=current_learner_id() AND vocabulary.word_id=${alias}.id),1)=1`;
}

function resolveUnstudiedPriorityWordIdsByTarget(targetText: string): Array<{ id: string }> {
  const submittedText = targetText.trim();
  const exactMatches = getDb()
    .prepare(`
      SELECT
        id
      FROM words
      WHERE ${unstudiedPriorityPredicate('words')}
        AND hanzi = ?
      ORDER BY priority DESC, created_at ASC
    `)
    .all(submittedText) as Array<{ id: string }>;

  const candidateMatches = [...exactMatches];

  if (config.studyProfile === 'mandarin') {
    const normalizedHanzi = normalizeMandarinHanziLookup(submittedText);
    if (normalizedHanzi.length > 0) {
      const normalizedMatches = getDb()
        .prepare(`
          SELECT
            words.id,
            words.priority,
            words.created_at
          FROM words
          JOIN lexical_words ON lexical_words.id = words.id
          WHERE ${unstudiedPriorityPredicate('words')}
            AND lexical_words.normalized_hanzi <> ''
            AND lexical_words.normalized_hanzi = ?
          ORDER BY words.priority DESC, words.created_at ASC
        `)
        .all(normalizedHanzi) as Array<{ id: string; priority: number; created_at: string }>;

      candidateMatches.push(...normalizedMatches.map((match) => ({ id: match.id })));
    }
  }

  if (config.studyProfile === 'french') {
    const normalizedAlias = normalizeLookupText(submittedText);
    const aliasMatches = getDb()
      .prepare(`
        SELECT DISTINCT
          words.id,
          words.priority,
          words.created_at
        FROM word_lookup_aliases
        JOIN words ON words.id = word_lookup_aliases.word_id
        WHERE ${unstudiedPriorityPredicate('words')}
          AND word_lookup_aliases.normalized_alias = ?
        ORDER BY words.priority DESC, words.created_at ASC
      `)
      .all(normalizedAlias) as Array<{ id: string; priority: number; created_at: string }>;

    candidateMatches.push(...aliasMatches.map((match) => ({ id: match.id })));
  }

  const seenWordIds = new Set<string>();
  return candidateMatches.filter((match) => {
    if (seenWordIds.has(match.id)) {
      return false;
    }

    seenWordIds.add(match.id);
    return true;
  });
}

export function setDailyNewWordLimit(dailyNewWordLimit: number) {
  assertDailyNewWordLimit(dailyNewWordLimit);
  upsertLearnerSetting('daily_new_word_limit', dailyNewWordLimit);
  return getLearningPolicy();
}

export function setUnstudiedAdmissionSource(unstudiedAdmissionSource: UnstudiedAdmissionSource) {
  assertUnstudiedAdmissionSource(unstudiedAdmissionSource);
  upsertLearnerSetting('unstudied_admission_source', unstudiedAdmissionSource);
  return getLearningPolicy();
}

export function getCharacterPresentation(): CharacterPresentation {
  return readCharacterPresentation();
}

export function setCharacterPresentation(characterPresentation: CharacterPresentation) {
  assertCharacterPresentation(characterPresentation);
  upsertLearnerSetting('character_presentation', characterPresentation);
  return { characterPresentation: readCharacterPresentation() };
}

function getStudyNewWordsFirst(): boolean {
  const row = getDb().prepare(`
    SELECT value_json FROM learner_settings
    WHERE learner_id = ? AND setting_key = 'study_new_words_first'
  `).get(requireLearnerId()) as { value_json: string } | undefined;
  if (!row) return false;
  const value: unknown = JSON.parse(row.value_json);
  if (typeof value !== 'boolean') throw new Error('Expected studyNewWordsFirst to be a boolean');
  return value;
}

export function getStudyIntroductionOrder(): StudyIntroductionOrder {
  const row = getDb().prepare(`
    SELECT value_json FROM learner_settings
    WHERE learner_id = ? AND setting_key = 'study_introduction_order'
  `).get(requireLearnerId()) as { value_json: string } | undefined;
  if (!row) return getStudyNewWordsFirst() ? 'first' : 'random';
  const value: unknown = JSON.parse(row.value_json);
  if (!isStudyIntroductionOrder(value)) throw new Error('Expected studyIntroductionOrder to be random, first or paced');
  return value;
}

export function getStudyIntroductionSpacing(): number {
  const row = getDb().prepare(`
    SELECT value_json FROM learner_settings
    WHERE learner_id = ? AND setting_key = 'study_introduction_spacing'
  `).get(requireLearnerId()) as { value_json: string } | undefined;
  if (!row) return DEFAULT_INTRODUCTION_SPACING;
  const value: unknown = JSON.parse(row.value_json);
  if (!isStudyIntroductionSpacing(value)) throw new Error('Expected integer studyIntroductionSpacing between 1 and 10');
  return value;
}

export function setStudyIntroductionOrder(studyIntroductionOrder: StudyIntroductionOrder, studyIntroductionSpacing: number) {
  if (!isStudyIntroductionOrder(studyIntroductionOrder)) throw new Error('Expected studyIntroductionOrder to be random, first or paced');
  if (!isStudyIntroductionSpacing(studyIntroductionSpacing)) throw new Error('Expected integer studyIntroductionSpacing between 1 and 10');
  getDb().exec('SAVEPOINT set_study_introduction_order');
  try {
    upsertLearnerSetting('study_introduction_order', studyIntroductionOrder);
    upsertLearnerSetting('study_introduction_spacing', studyIntroductionSpacing);
    getDb().exec('RELEASE SAVEPOINT set_study_introduction_order');
  } catch (error) {
    getDb().exec('ROLLBACK TO SAVEPOINT set_study_introduction_order');
    getDb().exec('RELEASE SAVEPOINT set_study_introduction_order');
    throw error;
  }
  return { studyIntroductionOrder: getStudyIntroductionOrder(), studyIntroductionSpacing: getStudyIntroductionSpacing() };
}

export function getSentenceCharacterPresentation(): SentenceCharacterPresentation {
  const row = getDb()
    .prepare(`
      SELECT value_json
      FROM learner_settings
      WHERE learner_id = ? AND setting_key = 'sentence_character_presentation'
    `)
    .get(requireLearnerId()) as { value_json: string } | undefined;
  if (!row) {
    return DEFAULT_SENTENCE_CHARACTER_PRESENTATION;
  }
  const presentation: unknown = JSON.parse(row.value_json);
  assertSentenceCharacterPresentation(presentation);
  return presentation;
}

export function setSentenceCharacterPresentation(sentenceCharacterPresentation: SentenceCharacterPresentation) {
  assertSentenceCharacterPresentation(sentenceCharacterPresentation);
  upsertLearnerSetting('sentence_character_presentation', sentenceCharacterPresentation);
  return { sentenceCharacterPresentation: getSentenceCharacterPresentation() };
}

export function recordReviewSessionSummary({
  sessionId,
  completedAt,
  completedReviewActionCount,
  failedReviewActionCount,
  activeDurationMs,
  completedLearningWordCount,
  debriefInventory,
}: {
  sessionId: string;
  completedAt: string;
  completedReviewActionCount: number;
  failedReviewActionCount: number;
  activeDurationMs: number;
  completedLearningWordCount?: number;
  debriefInventory?: SessionDebriefInventoryItem[];
}) {
  const normalizedSessionId = sessionId.trim();
  if (normalizedSessionId.length === 0) {
    throw new Error('Expected non-empty session id');
  }

  if (!Number.isInteger(completedReviewActionCount) || completedReviewActionCount < 0) {
    throw new Error('Expected non-negative integer completedReviewActionCount');
  }

  if (!Number.isInteger(failedReviewActionCount) || failedReviewActionCount < 0) {
    throw new Error('Expected non-negative integer failedReviewActionCount');
  }

  if (failedReviewActionCount > completedReviewActionCount) {
    throw new Error('Expected failedReviewActionCount to be less than or equal to completedReviewActionCount');
  }

  if (!Number.isInteger(activeDurationMs) || activeDurationMs < 0) {
    throw new Error('Expected non-negative integer activeDurationMs');
  }

  if (completedLearningWordCount !== undefined &&
    (!Number.isInteger(completedLearningWordCount) || completedLearningWordCount < 0)) {
    throw new Error('Expected non-negative integer completedLearningWordCount');
  }

  if (debriefInventory !== undefined) validateDebriefInventory(debriefInventory);
  getDb().exec('SAVEPOINT recordReviewSessionSummary');
  try {
    const previous = getDb().prepare('SELECT day_key FROM review_session_summaries WHERE session_id = ?')
      .get(normalizedSessionId) as { day_key: string } | undefined;
    const dayKey = completedAt.slice(0, 10);
    const closedReport = getDb().prepare(`SELECT json_array_length(report_json, '$.newWords') AS count
      FROM learner_session_completions WHERE learner_id = ? AND session_id = ? AND status = 'closed'`)
      .get(requireLearnerId(), normalizedSessionId) as { count: number } | undefined;
    // Migration can retain a confirmed report even when individual outcomes are absent.
    const newWordCount = closedReport?.count ?? getSessionWordReport(normalizedSessionId).newWords.length;
    getDb().prepare(`
      INSERT INTO learner_owned_review_session_summaries (
        session_id,
        completed_at,
        day_key,
        completed_count,
        failed_count,
        active_duration_ms,
        learning_completed_count,
        new_word_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(learner_id, session_id) DO UPDATE SET
        completed_at = excluded.completed_at,
        day_key = excluded.day_key,
        completed_count = excluded.completed_count,
        failed_count = excluded.failed_count,
        active_duration_ms = excluded.active_duration_ms,
        learning_completed_count = COALESCE(excluded.learning_completed_count, learner_owned_review_session_summaries.learning_completed_count),
        new_word_count = excluded.new_word_count
    `).run(
      normalizedSessionId,
      completedAt,
      completedAt.slice(0, 10),
      completedReviewActionCount,
      failedReviewActionCount,
      activeDurationMs,
      completedLearningWordCount ?? null,
      newWordCount,
    );
    // A completion can arrive after midnight's snapshot. Refresh persisted totals
    // on write (also on summary retries/moves), never reconstruct them on panel load.
    getDb().prepare(`UPDATE usage_daily_snapshots SET new_words = (
      SELECT COALESCE(SUM(new_word_count), 0) FROM learner_owned_review_session_summaries
      WHERE day_key = usage_daily_snapshots.day_key
    ) WHERE day_key IN (?, ?)`).run(previous?.day_key ?? dayKey, dayKey);
    if (debriefInventory !== undefined && config.studyProfile === 'mandarin') enqueueSessionDebrief(normalizedSessionId, completedAt, debriefInventory);
    getDb().exec('RELEASE recordReviewSessionSummary');
  } catch (error) {
    getDb().exec('ROLLBACK TO recordReviewSessionSummary'); getDb().exec('RELEASE recordReviewSessionSummary');
    throw error;
  }
}

// Versioned migrations include content-only cleanup (such as rehearsal framing).
// Existing databases must apply these offline; startup never rewrites content.
export function initializeDatabase() {
  if (!dbExistedOnStartup) {
    createBaselineSchema();
    migrateDatabase(getDb());
    if (config.authMode === 'trusted_local') {
      bootstrapLearner({ learnerId: config.learnerId });
      ensureDefaultDailyNewWordLimit();
    }
    seedDatabase();
    backfillContrastClusterMemberEligibility();
    return;
  }

  assertSchemaCurrent(getDb());
  validateSchema();
  if (config.authMode === 'trusted_local') {
    assertLearnerExists(config.learnerId);
  }
  seedEmptyDevDatabase();
}

function backfillContrastClusterMemberEligibility(): void {
  // This repair predates authenticated learner contexts and applies only to
  // the one configured trusted-local learner. Hosted databases prepare legacy
  // dogfood eligibility before cutover; Clerk startup must not invent a global
  // learner or grant cluster eligibility across accounts.
  if (config.authMode !== 'trusted_local') return;
  const rows = getDb().prepare(`
    SELECT DISTINCT word_id
    FROM contrast_cluster_members
    ORDER BY word_id ASC
  `).all() as Array<{ word_id: string }>;
  if (rows.length === 0) {
    return;
  }

  const updatedAt = new Date().toISOString();
  getDb().exec('BEGIN');
  try {
    for (const row of rows) {
      enableContextualSelectionWithoutTransaction({
        wordId: row.word_id,
        updatedAt,
        sourceEventId: null,
      });
    }
    getDb().exec('COMMIT');
  } catch (error) {
    getDb().exec('ROLLBACK');
    throw error;
  }
}

function seedEmptyDevDatabase() {
  if (!config.seedSampleData) {
    return;
  }

  const counts = getDb()
    .prepare(`
      SELECT
        (SELECT COUNT(*) FROM lexical_words) AS word_count
    `)
    .get() as { word_count: number };

  if (counts.word_count === 0) {
    seedDatabase();
    backfillContrastClusterMemberEligibility();
  }
}

/** Frozen fresh-database baseline; callers apply versioned migrations before seeding. */
export function createBaselineSchema() {
  createIdentitySchema();
  getDb().exec(`
    CREATE TABLE lexical_words (
      id TEXT PRIMARY KEY,
      hanzi TEXT NOT NULL,
      traditional TEXT,
      pinyin TEXT NOT NULL,
      meaning TEXT NOT NULL,
      meanings_json TEXT NOT NULL DEFAULT '[]',
      examples_json TEXT NOT NULL,
      priority INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE learner_word_state (
      learner_id TEXT NOT NULL DEFAULT (current_learner_id()) REFERENCES learners(learner_id) ON DELETE CASCADE,
      word_id TEXT NOT NULL REFERENCES lexical_words(id) ON DELETE CASCADE,
      personal_notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'unstudied',
      learning_streak INTEGER NOT NULL DEFAULT 0,
      last_learning_success_on TEXT,
      last_learning_covered_on TEXT,
      PRIMARY KEY (learner_id, word_id)
    );

    CREATE VIEW words AS
    SELECT
      lexical_words.id,
      lexical_words.hanzi,
      lexical_words.traditional,
      lexical_words.pinyin,
      lexical_words.meaning,
      lexical_words.meanings_json,
      COALESCE(learner_word_state.personal_notes, '') AS personal_notes,
      lexical_words.examples_json,
      COALESCE(learner_word_state.status, 'unstudied') AS status,
      lexical_words.priority,
      lexical_words.created_at,
      COALESCE(learner_word_state.learning_streak, 0) AS learning_streak,
      learner_word_state.last_learning_success_on,
      learner_word_state.last_learning_covered_on
    FROM lexical_words
    LEFT JOIN learner_word_state
      ON learner_word_state.word_id = lexical_words.id
     AND learner_word_state.learner_id = current_learner_id();

    CREATE TRIGGER words_insert
    INSTEAD OF INSERT ON words
    BEGIN
      INSERT INTO lexical_words (
        id, hanzi, traditional, pinyin, meaning, meanings_json, examples_json, priority, created_at
      ) VALUES (
        NEW.id, NEW.hanzi, NEW.traditional, NEW.pinyin, NEW.meaning,
        COALESCE(NEW.meanings_json, '[]'), NEW.examples_json, NEW.priority, NEW.created_at
      ) ON CONFLICT(id) DO NOTHING;
      INSERT INTO learner_word_state (
        learner_id, word_id, personal_notes, status, learning_streak,
        last_learning_success_on, last_learning_covered_on
      ) VALUES (
        current_learner_id(), NEW.id, COALESCE(NEW.personal_notes, ''),
        COALESCE(NEW.status, 'unstudied'), COALESCE(NEW.learning_streak, 0),
        NEW.last_learning_success_on, NEW.last_learning_covered_on
      ) ON CONFLICT(learner_id, word_id) DO UPDATE SET
        personal_notes = excluded.personal_notes,
        status = excluded.status,
        learning_streak = excluded.learning_streak,
        last_learning_success_on = excluded.last_learning_success_on,
        last_learning_covered_on = excluded.last_learning_covered_on;
    END;

    CREATE TRIGGER words_update
    INSTEAD OF UPDATE ON words
    BEGIN
      UPDATE lexical_words SET
        hanzi = NEW.hanzi, traditional = NEW.traditional, pinyin = NEW.pinyin,
        meaning = NEW.meaning, meanings_json = NEW.meanings_json,
        examples_json = NEW.examples_json, priority = NEW.priority, created_at = NEW.created_at
      WHERE id = OLD.id;
      INSERT INTO learner_word_state (
        learner_id, word_id, personal_notes, status, learning_streak,
        last_learning_success_on, last_learning_covered_on
      ) VALUES (
        current_learner_id(), OLD.id, NEW.personal_notes, NEW.status, NEW.learning_streak,
        NEW.last_learning_success_on, NEW.last_learning_covered_on
      ) ON CONFLICT(learner_id, word_id) DO UPDATE SET
        personal_notes = excluded.personal_notes,
        status = excluded.status,
        learning_streak = excluded.learning_streak,
        last_learning_success_on = excluded.last_learning_success_on,
        last_learning_covered_on = excluded.last_learning_covered_on;
    END;

    CREATE TRIGGER words_delete
    INSTEAD OF DELETE ON words
    BEGIN
      DELETE FROM learner_word_state
      WHERE learner_id = current_learner_id() AND word_id = OLD.id;
      DELETE FROM lexical_words
      WHERE id = OLD.id AND NOT EXISTS (
        SELECT 1 FROM learner_word_state WHERE word_id = OLD.id
      );
    END;

    CREATE TABLE lexical_word_meanings (
      id TEXT PRIMARY KEY,
      word_id TEXT NOT NULL REFERENCES lexical_words(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(word_id, position)
    );

    CREATE TABLE learner_word_meaning_preferences (
      learner_id TEXT NOT NULL DEFAULT (current_learner_id()) REFERENCES learners(learner_id) ON DELETE CASCADE,
      meaning_id TEXT NOT NULL REFERENCES lexical_word_meanings(id) ON DELETE CASCADE,
      show_on_production_prompt INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (learner_id, meaning_id)
    );

    CREATE VIEW word_meanings AS
    SELECT
      lexical_word_meanings.id,
      lexical_word_meanings.word_id,
      lexical_word_meanings.position,
      lexical_word_meanings.text,
      COALESCE(learner_word_meaning_preferences.show_on_production_prompt, 1)
        AS show_on_production_prompt,
      lexical_word_meanings.created_at,
      lexical_word_meanings.updated_at
    FROM lexical_word_meanings
    LEFT JOIN learner_word_meaning_preferences
      ON learner_word_meaning_preferences.meaning_id = lexical_word_meanings.id
     AND learner_word_meaning_preferences.learner_id = current_learner_id();

    CREATE TRIGGER word_meanings_insert
    INSTEAD OF INSERT ON word_meanings
    BEGIN
      INSERT INTO lexical_word_meanings (id, word_id, position, text, created_at, updated_at)
      VALUES (NEW.id, NEW.word_id, NEW.position, NEW.text, NEW.created_at, NEW.updated_at)
      ON CONFLICT(id) DO NOTHING;
      INSERT INTO learner_word_meaning_preferences (
        learner_id, meaning_id, show_on_production_prompt, updated_at
      ) VALUES (
        current_learner_id(), NEW.id, COALESCE(NEW.show_on_production_prompt, 1), NEW.updated_at
      ) ON CONFLICT(learner_id, meaning_id) DO UPDATE SET
        show_on_production_prompt = excluded.show_on_production_prompt,
        updated_at = excluded.updated_at;
    END;

    CREATE TRIGGER word_meanings_update
    INSTEAD OF UPDATE ON word_meanings
    BEGIN
      UPDATE lexical_word_meanings SET
        position = NEW.position, text = NEW.text, updated_at = NEW.updated_at
      WHERE id = OLD.id;
      INSERT INTO learner_word_meaning_preferences (
        learner_id, meaning_id, show_on_production_prompt, updated_at
      ) VALUES (
        current_learner_id(), OLD.id, NEW.show_on_production_prompt, NEW.updated_at
      ) ON CONFLICT(learner_id, meaning_id) DO UPDATE SET
        show_on_production_prompt = excluded.show_on_production_prompt,
        updated_at = excluded.updated_at;
    END;

    CREATE TRIGGER word_meanings_delete
    INSTEAD OF DELETE ON word_meanings
    BEGIN
      DELETE FROM lexical_word_meanings WHERE id = OLD.id;
    END;

    CREATE TABLE user_word_priority (
      learner_id TEXT NOT NULL DEFAULT (current_learner_id()) REFERENCES learners(learner_id) ON DELETE CASCADE,
      word_id TEXT NOT NULL REFERENCES lexical_words(id) ON DELETE CASCADE,
      bump_count INTEGER NOT NULL DEFAULT 0,
      force_top INTEGER NOT NULL DEFAULT 0,
      priority_tier INTEGER NOT NULL DEFAULT 0,
      required_for_next_session INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (learner_id, word_id)
    );

    CREATE TABLE word_lookup_aliases (
      alias_text TEXT NOT NULL,
      normalized_alias TEXT NOT NULL,
      word_id TEXT NOT NULL REFERENCES lexical_words(id) ON DELETE CASCADE,
      relation TEXT NOT NULL,
      source TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]',
      confidence REAL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (normalized_alias, word_id, source)
    );

    CREATE TABLE word_study_admission_state (
      learner_id TEXT NOT NULL DEFAULT (current_learner_id()) REFERENCES learners(learner_id) ON DELETE CASCADE,
      word_id TEXT NOT NULL REFERENCES lexical_words(id) ON DELETE CASCADE,
      study_phase TEXT NOT NULL,
      earliest_next_study_at TEXT,
      PRIMARY KEY (learner_id, word_id)
    );

    CREATE TABLE word_skill_state (
      learner_id TEXT NOT NULL DEFAULT (current_learner_id()) REFERENCES learners(learner_id) ON DELETE CASCADE,
      word_id TEXT NOT NULL REFERENCES lexical_words(id) ON DELETE CASCADE,
      skill_id TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      interval_hours INTEGER NOT NULL,
      last_studied_at TEXT NOT NULL,
      next_due_at TEXT,
      ease_factor REAL NOT NULL,
      PRIMARY KEY (learner_id, word_id, skill_id)
    );

    CREATE TABLE daily_new_word_intake (
      learner_id TEXT NOT NULL DEFAULT (current_learner_id()) REFERENCES learners(learner_id) ON DELETE CASCADE,
      day_key TEXT NOT NULL,
      new_study_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (learner_id, day_key)
    );

    CREATE TABLE review_session_summaries (
      learner_id TEXT NOT NULL DEFAULT (current_learner_id()) REFERENCES learners(learner_id) ON DELETE CASCADE,
      session_id TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      day_key TEXT NOT NULL,
      completed_count INTEGER NOT NULL,
      failed_count INTEGER NOT NULL,
      active_duration_ms INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (learner_id, session_id)
    );

    CREATE TABLE study_sessions (
      id TEXT NOT NULL,
      learner_id TEXT NOT NULL DEFAULT (current_learner_id()) REFERENCES learners(learner_id) ON DELETE CASCADE,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      processing_state TEXT NOT NULL,
      processed_at TEXT,
      PRIMARY KEY (learner_id, id)
    );

    CREATE TABLE study_attempt_events (
      id TEXT NOT NULL,
      learner_id TEXT NOT NULL DEFAULT (current_learner_id()) REFERENCES learners(learner_id) ON DELETE CASCADE,
      occurred_at TEXT NOT NULL,
      session_id TEXT NOT NULL,
      session_action_id TEXT NOT NULL,
      session_event_sequence INTEGER NOT NULL,
      action_attempt_sequence INTEGER NOT NULL,
      action_kind TEXT NOT NULL,
      target_word_id TEXT NOT NULL REFERENCES lexical_words(id),
      sampled_skill_ids_json TEXT NOT NULL,
      response TEXT,
      outcome TEXT NOT NULL,
      rating TEXT,
      content_ref_json TEXT,
      metadata_json TEXT NOT NULL,
      projected_at TEXT,
      FOREIGN KEY (learner_id, session_id) REFERENCES study_sessions(learner_id, id) ON DELETE CASCADE,
      PRIMARY KEY (learner_id, id)
    );

    CREATE TABLE study_events (
      id TEXT NOT NULL,
      learner_id TEXT NOT NULL DEFAULT (current_learner_id()) REFERENCES learners(learner_id) ON DELETE CASCADE,
      occurred_at TEXT NOT NULL,
      session_id TEXT,
      session_action_id TEXT,
      session_event_sequence INTEGER,
      event_type TEXT NOT NULL,
      target_word_id TEXT REFERENCES lexical_words(id),
      action_kind TEXT,
      sampled_skill_ids_json TEXT NOT NULL DEFAULT '[]',
      content_ref_json TEXT,
      payload_json TEXT NOT NULL,
      projected_at TEXT,
      FOREIGN KEY (learner_id, session_id) REFERENCES study_sessions(learner_id, id) ON DELETE CASCADE,
      PRIMARY KEY (learner_id, id)
    );

    CREATE TABLE word_skill_relevance (
      learner_id TEXT NOT NULL DEFAULT (current_learner_id()) REFERENCES learners(learner_id) ON DELETE CASCADE,
      word_id TEXT NOT NULL REFERENCES lexical_words(id) ON DELETE CASCADE,
      skill_id TEXT NOT NULL,
      relevance_state TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      source_event_id TEXT,
      PRIMARY KEY (learner_id, word_id, skill_id),
      FOREIGN KEY (learner_id, source_event_id) REFERENCES study_events(learner_id, id) ON DELETE SET NULL
    );

    CREATE TABLE contrast_clusters (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      content_scope TEXT NOT NULL DEFAULT 'learner' CHECK (content_scope IN ('learner', 'shared')),
      owner_learner_id TEXT DEFAULT (current_learner_id()) REFERENCES learners(learner_id) ON DELETE RESTRICT,
      CHECK (
        (content_scope = 'learner' AND owner_learner_id IS NOT NULL)
        OR (content_scope = 'shared' AND owner_learner_id IS NULL)
      )
    );

    CREATE TABLE contrast_cluster_members (
      cluster_id TEXT NOT NULL REFERENCES contrast_clusters(id) ON DELETE CASCADE,
      word_id TEXT NOT NULL REFERENCES lexical_words(id) ON DELETE CASCADE,
      nuance_note TEXT NOT NULL DEFAULT '',
      display_order INTEGER,
      PRIMARY KEY (cluster_id, word_id)
    );

    CREATE TABLE contrast_prompts (
      id TEXT PRIMARY KEY,
      cluster_id TEXT NOT NULL REFERENCES contrast_clusters(id) ON DELETE CASCADE,
      target_word_id TEXT NOT NULL,
      prompt_text TEXT NOT NULL,
      explanation TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (cluster_id, target_word_id)
        REFERENCES contrast_cluster_members(cluster_id, word_id)
        ON DELETE CASCADE
    );
  `);

  createReflectionSchema();
  createProductionCueSchema();
  createSharedContentSchema();
  createIntakeTriageSchema();
  createIndexes();
  createScopedContentCompatibilityViews();
  createLearnerScopedCompatibilityViews();
  createLearnerOwnershipGuards();
  createHostedOperationsSchema();
  recordLearnerOwnershipSchema();
}

function ensureDefaultDailyNewWordLimit() {
  getDb().prepare(`
    INSERT OR IGNORE INTO learner_settings (
      learner_id,
      setting_key,
      value_json,
      updated_at
    ) VALUES (?, 'daily_new_word_limit', ?, ?)
  `).run(requireLearnerId(), JSON.stringify(DEFAULT_DAILY_NEW_WORD_LIMIT), new Date().toISOString());
}

function createIndexes() {
  getDb().exec(`
    CREATE INDEX idx_words_priority ON lexical_words(priority DESC, created_at ASC);
    CREATE INDEX idx_word_lookup_aliases_normalized_alias ON word_lookup_aliases(normalized_alias);
    CREATE INDEX idx_word_meanings_word_position ON lexical_word_meanings(word_id, position ASC);
    CREATE INDEX idx_user_word_priority_force_top ON ${learnerScopedStorageTableName('user_word_priority')}(force_top DESC, updated_at DESC);
    CREATE INDEX idx_user_word_priority_tier ON ${learnerScopedStorageTableName('user_word_priority')}(priority_tier DESC, updated_at DESC);
    CREATE INDEX idx_word_study_admission_next ON ${learnerScopedStorageTableName('word_study_admission_state')}(earliest_next_study_at ASC);
    CREATE INDEX idx_word_skill_state_due ON ${learnerScopedStorageTableName('word_skill_state')}(next_due_at ASC);
    CREATE INDEX idx_review_session_summaries_day ON ${learnerScopedStorageTableName('review_session_summaries')}(day_key ASC);
    CREATE INDEX idx_study_attempt_events_session ON ${learnerScopedStorageTableName('study_attempt_events')}(session_id ASC, session_event_sequence ASC);
    CREATE INDEX idx_study_attempt_events_projected ON ${learnerScopedStorageTableName('study_attempt_events')}(projected_at ASC, session_id ASC);
    CREATE INDEX idx_study_events_session ON ${learnerScopedStorageTableName('study_events')}(session_id ASC, session_event_sequence ASC);
    CREATE INDEX idx_study_events_projected ON ${learnerScopedStorageTableName('study_events')}(projected_at ASC, occurred_at ASC);
    CREATE INDEX idx_word_skill_relevance_state ON ${learnerScopedStorageTableName('word_skill_relevance')}(skill_id ASC, relevance_state ASC);
    CREATE INDEX idx_contrast_cluster_members_word ON ${scopedContentStorageTableName('contrast_cluster_members')}(word_id ASC, cluster_id ASC);
    CREATE INDEX idx_contrast_prompts_cluster_target ON ${scopedContentStorageTableName('contrast_prompts')}(cluster_id ASC, target_word_id ASC);
    CREATE INDEX idx_contrast_prompts_target ON ${scopedContentStorageTableName('contrast_prompts')}(target_word_id ASC);
  `);
  createReflectionIndexes();
  createProductionCueIndexes();
  createIntakeTriageIndexes();
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
    'required_for_next_session',
    'updated_at',
  ]);
  assertTableColumns('word_lookup_aliases', [
    'alias_text',
    'normalized_alias',
    'word_id',
    'relation',
    'source',
    'tags_json',
    'confidence',
    'created_at',
  ]);
  assertTableColumns('daily_new_word_intake', [
    'day_key',
    'new_study_count',
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
    'active_duration_ms',
  ]);
  assertTableColumns('study_sessions', [
    'id',
    'started_at',
    'ended_at',
    'processing_state',
    'processed_at',
  ]);
  assertTableColumns('study_attempt_events', [
    'id',
    'occurred_at',
    'session_id',
    'session_action_id',
    'session_event_sequence',
    'action_attempt_sequence',
    'action_kind',
    'target_word_id',
    'sampled_skill_ids_json',
    'response',
    'outcome',
    'rating',
    'content_ref_json',
    'metadata_json',
    'projected_at',
  ]);
  assertTableColumns('study_events', [
    'id',
    'occurred_at',
    'session_id',
    'session_action_id',
    'session_event_sequence',
    'event_type',
    'target_word_id',
    'action_kind',
    'sampled_skill_ids_json',
    'content_ref_json',
    'payload_json',
    'projected_at',
  ]);
  assertTableColumns('word_skill_relevance', [
    'word_id',
    'skill_id',
    'relevance_state',
    'updated_at',
    'source_event_id',
  ]);
  assertTableColumns('contrast_clusters', [
    'id',
    'title',
    'note',
  ]);
  assertTableColumns('contrast_cluster_members', [
    'cluster_id',
    'word_id',
    'nuance_note',
    'display_order',
  ]);
  assertTableColumns('contrast_prompts', [
    'id',
    'cluster_id',
    'target_word_id',
    'prompt_text',
    'explanation',
  ]);
  assertTableColumns('model_invocations', [
    'id', 'timestamp', 'provider', 'model', 'invocation_type', 'learner_id',
    'spend_usd', 'spend_source', 'status', 'pricing_json', 'latency_ms',
  ]);
  assertTableColumns('word_preparation_work', ['requested_by_learner_id']);
  validateContentQualitySchema();
  validateReflectionSchema();
  validateProductionCueSchema();
  validateSharedContentSchema();
  validateIntakeTriageSchema();
}

function assertTableColumns(tableName: string, expectedColumns: string[]) {
  const rows = getDb().prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
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
  const storageTableName = learnerScopedStorageTableName(tableName);
  const rows = getDb().prepare(`PRAGMA table_info(${storageTableName})`).all() as Array<{ name: string; notnull: number; pk: number }>;
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
  invalidateDeckWordIds();
  if (!config.seedSampleData) {
    return;
  }

  const seedData = withDevContrastSeedData(readSeedData() ?? buildSampleSeedData());

  if (config.authMode === 'clerk') {
    seedSharedDevelopmentFixtureData(seedData);
    seedWordIntroductionFixtures(seedData.wordIntroductionFixtureIds ?? []);
    return;
  }

  const insertWord = getDb().prepare(`
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
  const insertWordMeaning = getDb().prepare(`
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
  const insertWordStudyAdmissionState = getDb().prepare(`
    INSERT INTO word_study_admission_state (
      word_id,
      study_phase,
      earliest_next_study_at
    )
    VALUES (?, ?, ?)
  `);
  const insertWordSkillState = getDb().prepare(`
    INSERT INTO learner_owned_word_skill_state (
      word_id,
      skill_id,
      enabled,
      interval_hours,
      last_studied_at,
      next_due_at,
      ease_factor
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertWordSkillRelevance = getDb().prepare(`
    INSERT INTO word_skill_relevance (
      word_id,
      skill_id,
      relevance_state,
      updated_at,
      source_event_id
    )
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertContrastCluster = getDb().prepare(`
    INSERT INTO contrast_clusters (
      id,
      title,
      note
    )
    VALUES (?, ?, ?)
  `);
  const insertContrastClusterMember = getDb().prepare(`
    INSERT INTO contrast_cluster_members (
      cluster_id,
      word_id,
      nuance_note,
      display_order
    )
    VALUES (?, ?, ?, ?)
  `);
  const insertContrastPrompt = getDb().prepare(`
    INSERT INTO contrast_prompts (
      id,
      cluster_id,
      target_word_id,
      prompt_text,
      explanation
    )
    VALUES (?, ?, ?, ?, ?)
  `);

  getDb().exec('BEGIN');

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

    for (const admissionState of seedData.wordStudyAdmissionStates) {
      insertWordStudyAdmissionState.run(
        admissionState.wordId,
        admissionState.studyPhase,
        admissionState.earliestNextStudyAt,
      );
    }

    for (const skillState of seedData.wordSkillStates) {
      insertWordSkillState.run(
        skillState.wordId,
        skillState.skillId,
        skillState.enabled ? 1 : 0,
        skillState.intervalHours,
        skillState.lastStudiedAt,
        skillState.nextDueAt,
        skillState.easeFactor,
      );
    }

    for (const relevance of seedData.wordSkillRelevances) {
      insertWordSkillRelevance.run(
        relevance.wordId,
        relevance.skillId,
        relevance.relevanceState,
        relevance.updatedAt,
        relevance.sourceEventId,
      );
    }

    for (const cluster of seedData.contrastClusters) {
      insertContrastCluster.run(
        cluster.id,
        cluster.title,
        cluster.note,
      );
    }

    for (const member of seedData.contrastClusterMembers) {
      insertContrastClusterMember.run(
        member.clusterId,
        member.wordId,
        member.nuanceNote,
        member.displayOrder,
      );
    }

    for (const prompt of seedData.contrastPrompts) {
      insertContrastPrompt.run(
        prompt.id,
        prompt.clusterId,
        prompt.targetWordId,
        prompt.promptText,
        prompt.explanation,
      );
    }

    fillMissingNormalizedHanzi(getDb());
    getDb().exec('COMMIT');
  } catch (error) {
    getDb().exec('ROLLBACK');
    throw error;
  }
  seedWordIntroductionFixtures(seedData.wordIntroductionFixtureIds ?? []);
}

/**
 * Clerk development runs need a corpus but must not prepopulate any learner's
 * private state. Fresh authenticated learners read the lexical defaults from
 * the shared tables and acquire their own state only as they study.
 */
function seedSharedDevelopmentFixtureData(seedData: SeedData) {
  const insertWord = getDb().prepare(`
    INSERT OR IGNORE INTO lexical_words (
      id, hanzi, traditional, pinyin, meaning, meanings_json, examples_json, priority, created_at, normalized_hanzi
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMeaning = getDb().prepare(`
    INSERT OR IGNORE INTO lexical_word_meanings (
      id, word_id, position, text, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  getDb().exec('BEGIN');
  try {
    for (const word of seedData.words) {
      insertWord.run(
        word.id,
        word.hanzi,
        word.traditional,
        word.pinyin,
        word.meaning,
        JSON.stringify(word.meanings),
        JSON.stringify(word.examples),
        word.priority,
        word.createdAt,
        normalizeMandarinHanziLookup(word.hanzi),
      );
    }
    for (const meaning of seedData.wordMeanings) {
      insertMeaning.run(
        meaning.id,
        meaning.wordId,
        meaning.position,
        meaning.text,
        meaning.createdAt,
        meaning.updatedAt,
      );
    }
    getDb().exec('COMMIT');
  } catch (error) {
    getDb().exec('ROLLBACK');
    throw error;
  }
}

function readSeedData(): SeedData | null {
  if (!fs.existsSync(seedDataPath)) {
    return null;
  }

  const parsed = JSON.parse(fs.readFileSync(seedDataPath, 'utf8')) as Partial<SeedData>;

  if (!Array.isArray(parsed.words)) {
    return null;
  }

  if (!Array.isArray(parsed.wordStudyAdmissionStates) || !Array.isArray(parsed.wordSkillStates)) {
    return null;
  }

  const words = parsed.words.map(normalizeSeedWord);
  return {
    words,
    wordIntroductionFixtureIds: parsed.wordIntroductionFixtureIds,
    wordMeanings: buildWordMeaningsFromWords(words),
    wordStudyAdmissionStates: parsed.wordStudyAdmissionStates.map(normalizeSeedWordStudyAdmissionState),
    wordSkillStates: parsed.wordSkillStates.map(normalizeSeedWordSkillState),
    wordSkillRelevances: Array.isArray(parsed.wordSkillRelevances)
      ? parsed.wordSkillRelevances.map(normalizeSeedWordSkillRelevance)
      : [],
    contrastClusters: Array.isArray(parsed.contrastClusters)
      ? parsed.contrastClusters.map(normalizeSeedContrastCluster)
      : [],
    contrastClusterMembers: Array.isArray(parsed.contrastClusterMembers)
      ? parsed.contrastClusterMembers.map(normalizeSeedContrastClusterMember)
      : [],
    contrastPrompts: Array.isArray(parsed.contrastPrompts)
      ? parsed.contrastPrompts.map(normalizeSeedContrastPrompt)
      : [],
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

function normalizeSeedWordStudyAdmissionState(state: Partial<WordStudyAdmissionState>): WordStudyAdmissionState {
  return {
    wordId: state.wordId ?? '',
    studyPhase: 'review',
    earliestNextStudyAt: state.earliestNextStudyAt ?? null,
  };
}

function normalizeSeedWordSkillState(state: Partial<WordSkillState>): WordSkillState {
  return {
    wordId: state.wordId ?? '',
    skillId: isStudySkillId(state.skillId) ? state.skillId : 'recognition',
    enabled: state.enabled !== false,
    intervalHours: state.intervalHours ?? 24,
    lastStudiedAt: state.lastStudiedAt ?? new Date().toISOString(),
    nextDueAt: state.nextDueAt ?? null,
    easeFactor: state.easeFactor ?? INITIAL_REVIEW_EASE_FACTOR,
  };
}

function normalizeSeedWordSkillRelevance(relevance: Partial<WordSkillRelevance>): WordSkillRelevance {
  return {
    wordId: relevance.wordId ?? '',
    skillId: isStudySkillId(relevance.skillId) ? relevance.skillId : 'recognition',
    relevanceState: isWordSkillRelevanceState(relevance.relevanceState) ? relevance.relevanceState : 'normal',
    updatedAt: relevance.updatedAt ?? new Date().toISOString(),
    sourceEventId: relevance.sourceEventId ?? null,
  };
}

function normalizeSeedContrastCluster(cluster: Partial<ContrastCluster>): ContrastCluster {
  return {
    id: cluster.id ?? '',
    title: cluster.title ?? '',
    note: cluster.note ?? '',
  };
}

function normalizeSeedContrastClusterMember(member: Partial<ContrastClusterMember>): ContrastClusterMember {
  return {
    clusterId: member.clusterId ?? '',
    wordId: member.wordId ?? '',
    nuanceNote: member.nuanceNote ?? '',
    displayOrder: member.displayOrder ?? null,
  };
}

function normalizeSeedContrastPrompt(prompt: Partial<ContrastPrompt>): ContrastPrompt {
  return {
    id: prompt.id ?? '',
    clusterId: prompt.clusterId ?? '',
    targetWordId: prompt.targetWordId ?? '',
    promptText: prompt.promptText ?? '',
    explanation: prompt.explanation ?? '',
  };
}

function withDevContrastSeedData(seedData: SeedData): SeedData {
  if (!config.seedSampleData || !config.includeDevContrastSeed || config.studyProfile !== 'mandarin') {
    return seedData;
  }

  const devContrastSeedData = buildMandarinDevContrastSeedData();
  return mergeSeedData(seedData, devContrastSeedData);
}

function mergeSeedData(seedData: SeedData, addition: SeedData): SeedData {
  return {
    wordIntroductionFixtureIds: [...new Set([
      ...seedData.wordIntroductionFixtureIds ?? [], ...addition.wordIntroductionFixtureIds ?? [],
    ])],
    words: mergeBy(seedData.words, addition.words, (word) => word.id),
    wordMeanings: mergeBy(seedData.wordMeanings, addition.wordMeanings, (meaning) => meaning.id),
    wordStudyAdmissionStates: mergeBy(
      seedData.wordStudyAdmissionStates,
      addition.wordStudyAdmissionStates,
      (state) => state.wordId,
    ),
    wordSkillStates: mergeBy(
      seedData.wordSkillStates,
      addition.wordSkillStates,
      (state) => `${state.wordId}/${state.skillId}`,
    ),
    wordSkillRelevances: mergeBy(
      seedData.wordSkillRelevances,
      addition.wordSkillRelevances,
      (relevance) => `${relevance.wordId}/${relevance.skillId}`,
    ),
    contrastClusters: mergeBy(seedData.contrastClusters, addition.contrastClusters, (cluster) => cluster.id),
    contrastClusterMembers: mergeBy(
      seedData.contrastClusterMembers,
      addition.contrastClusterMembers,
      (member) => `${member.clusterId}/${member.wordId}`,
    ),
    contrastPrompts: mergeBy(seedData.contrastPrompts, addition.contrastPrompts, (prompt) => prompt.id),
  };
}

function mergeBy<T>(base: T[], addition: T[], getKey: (item: T) => string): T[] {
  const seen = new Set(base.map(getKey));
  const merged = [...base];

  for (const item of addition) {
    const key = getKey(item);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(item);
  }

  return merged;
}

function buildMandarinDevContrastSeedData(): SeedData {
  const createdAt = '2026-05-23T00:00:00.000Z';
  const lastStudiedAt = '2026-05-20T00:00:00.000Z';
  const nextDueAt = '2026-05-22T00:00:00.000Z';
  const contextualSelectionWordIds = new Set([
    'dev-contrast-qiadang',
    'dev-contrast-shidang',
    'dev-contrast-kaojin',
    'dev-contrast-linjin',
  ]);
  const words: Word[] = [
    buildDevContrastWord({
      id: 'dev-contrast-qiadang',
      hanzi: '恰当',
      traditional: '恰當',
      pinyin: 'qià dàng',
      meaning: 'appropriate; fitting; exactly right for the situation',
      examples: ['这个词用在这里很恰当。'],
      priority: 90,
      createdAt,
    }),
    buildDevContrastWord({
      id: 'dev-contrast-shidang',
      hanzi: '适当',
      traditional: '適當',
      pinyin: 'shì dàng',
      meaning: 'suitable; proper; moderate in degree',
      examples: ['运动后要适当休息。'],
      priority: 89,
      createdAt,
    }),
    buildDevContrastWord({
      id: 'dev-contrast-kaojin',
      hanzi: '靠近',
      traditional: '靠近',
      pinyin: 'kào jìn',
      meaning: 'to approach; to move close to',
      examples: ['请不要靠近施工区域。'],
      priority: 88,
      createdAt,
    }),
    buildDevContrastWord({
      id: 'dev-contrast-linjin',
      hanzi: '临近',
      traditional: '臨近',
      pinyin: 'lín jìn',
      meaning: 'to be near; to approach in time or location',
      examples: ['春节临近，车票越来越难买。'],
      priority: 87,
      createdAt,
    }),
    buildDevContrastWord({
      id: 'dev-contrast-yanjun',
      hanzi: '严峻',
      traditional: '嚴峻',
      pinyin: 'yán jùn',
      meaning: 'severe; grim; serious, usually for situations or tests',
      examples: ['公司正面临严峻的挑战。'],
      priority: 86,
      createdAt,
    }),
    buildDevContrastWord({
      id: 'dev-contrast-yanli',
      hanzi: '严厉',
      traditional: '嚴厲',
      pinyin: 'yán lì',
      meaning: 'stern; severe, usually for criticism or punishment',
      examples: ['老师严厉地批评了迟到的学生。'],
      priority: 85,
      createdAt,
    }),
    buildDevContrastWord({
      id: 'dev-contrast-yansu',
      hanzi: '严肃',
      traditional: '嚴肅',
      pinyin: 'yán sù',
      meaning: 'serious; solemn; earnest',
      examples: ['会议的气氛很严肃。'],
      priority: 84,
      createdAt,
    }),
    buildDevContrastWord({
      id: 'dev-contrast-zhuangzhong',
      hanzi: '庄重',
      traditional: '莊重',
      pinyin: 'zhuāng zhòng',
      meaning: 'dignified; stately; solemn in manner or appearance',
      examples: ['她穿得很庄重，适合参加典礼。'],
      priority: 83,
      createdAt,
    }),
    buildDevContrastWord({
      id: 'dev-contrast-zhengzhong',
      hanzi: '郑重',
      traditional: '鄭重',
      pinyin: 'zhèng zhòng',
      meaning: 'solemn; earnest; serious in statement or promise',
      examples: ['他郑重地向大家道歉。'],
      priority: 82,
      createdAt,
    }),
    buildDevContrastWord({
      id: 'dev-contrast-shanyu',
      hanzi: '善于',
      traditional: '善於',
      pinyin: 'shàn yú',
      meaning: 'to be good at; to be adept at doing something',
      examples: ['她善于和孩子沟通。'],
      priority: 81,
      createdAt,
    }),
    buildDevContrastWord({
      id: 'dev-contrast-shanchang',
      hanzi: '擅长',
      traditional: '擅長',
      pinyin: 'shàn cháng',
      meaning: 'to specialize in; to be skilled at a particular thing',
      examples: ['他擅长数据分析。'],
      priority: 80,
      createdAt,
    }),
  ];

  return {
    words,
    wordMeanings: buildWordMeaningsFromWords(words),
    wordStudyAdmissionStates: words.map((word) => ({
      wordId: word.id,
      studyPhase: 'review',
      earliestNextStudyAt: null,
    })),
    wordSkillStates: words.flatMap((word) => {
      const baseStates: WordSkillState[] = [
        {
          wordId: word.id,
          skillId: 'recognition',
          enabled: true,
          intervalHours: 48,
          lastStudiedAt,
          nextDueAt,
          easeFactor: INITIAL_REVIEW_EASE_FACTOR,
        },
        {
          wordId: word.id,
          skillId: 'production',
          enabled: true,
          intervalHours: 48,
          lastStudiedAt,
          nextDueAt,
          easeFactor: INITIAL_REVIEW_EASE_FACTOR,
        },
      ];

      if (contextualSelectionWordIds.has(word.id)) {
        baseStates.push({
          wordId: word.id,
          skillId: 'contextual_selection',
          enabled: true,
          intervalHours: INITIAL_CONTEXTUAL_SELECTION_INTERVAL_HOURS,
          lastStudiedAt,
          nextDueAt,
          easeFactor: INITIAL_REVIEW_EASE_FACTOR,
        });
      }

      return baseStates;
    }),
    wordSkillRelevances: [...contextualSelectionWordIds].map((wordId) => ({
      wordId,
      skillId: 'contextual_selection',
      relevanceState: 'normal',
      updatedAt: createdAt,
      sourceEventId: null,
    })),
    contrastClusters: [
      {
        id: 'dev-contrast-cluster-qiadang-shidang',
        title: '恰当 / 适当',
        note: 'Both can mean appropriate. 恰当 emphasizes exact fit; 适当 often allows a suitable or moderate degree.',
      },
      {
        id: 'dev-contrast-cluster-kaojin-linjin',
        title: '靠近 / 临近',
        note: '靠近 often describes physically moving or being close; 临近 often describes something approaching in time or location.',
      },
      {
        id: 'dev-contrast-cluster-yan-family',
        title: '严峻 / 严厉 / 严肃 / 庄重 / 郑重',
        note: 'A seriousness cluster: situations, criticism, atmosphere, dignified bearing, and solemn statements.',
      },
      {
        id: 'dev-contrast-cluster-shanyu-shanchang',
        title: '善于 / 擅长',
        note: 'Both describe ability. 善于 often emphasizes being adept at handling an activity; 擅长 emphasizes a particular skill or specialty.',
      },
    ],
    contrastClusterMembers: [
      buildDevContrastMember('dev-contrast-cluster-qiadang-shidang', 'dev-contrast-qiadang', 'Exact fit for the context or wording.', 1),
      buildDevContrastMember('dev-contrast-cluster-qiadang-shidang', 'dev-contrast-shidang', 'Suitable, proper, or moderate in amount.', 2),
      buildDevContrastMember('dev-contrast-cluster-kaojin-linjin', 'dev-contrast-kaojin', 'Move close to or be physically near something.', 1),
      buildDevContrastMember('dev-contrast-cluster-kaojin-linjin', 'dev-contrast-linjin', 'Be near in time, deadline, season, or sometimes location.', 2),
      buildDevContrastMember('dev-contrast-cluster-yan-family', 'dev-contrast-yanjun', 'For severe situations, challenges, tests, or conditions.', 1),
      buildDevContrastMember('dev-contrast-cluster-yan-family', 'dev-contrast-yanli', 'For stern criticism, punishment, measures, or tone.', 2),
      buildDevContrastMember('dev-contrast-cluster-yan-family', 'dev-contrast-yansu', 'For serious mood, attitude, expression, or matter.', 3),
      buildDevContrastMember('dev-contrast-cluster-yan-family', 'dev-contrast-zhuangzhong', 'For dignified behavior, appearance, ceremony, or setting.', 4),
      buildDevContrastMember('dev-contrast-cluster-yan-family', 'dev-contrast-zhengzhong', 'For solemn promises, statements, apologies, or declarations.', 5),
      buildDevContrastMember('dev-contrast-cluster-shanyu-shanchang', 'dev-contrast-shanyu', 'Good at doing or handling an activity.', 1),
      buildDevContrastMember('dev-contrast-cluster-shanyu-shanchang', 'dev-contrast-shanchang', 'Skilled in a specific field, technique, or specialty.', 2),
    ],
    contrastPrompts: [
      buildDevContrastPrompt('dev-contrast-prompt-qiadang-1', 'dev-contrast-cluster-qiadang-shidang', 'dev-contrast-qiadang', '这个例子放在这里很____，正好说明了作者的观点。', 'The example is exactly fitting for the argument, so 恰当 is the sharper choice.'),
      buildDevContrastPrompt('dev-contrast-prompt-shidang-1', 'dev-contrast-cluster-qiadang-shidang', 'dev-contrast-shidang', '医生建议他每天做____的运动，不要过量。', 'The sentence is about a suitable or moderate amount, so 适当 fits.'),
      buildDevContrastPrompt('dev-contrast-prompt-kaojin-1', 'dev-contrast-cluster-kaojin-linjin', 'dev-contrast-kaojin', '游客不要____栏杆，以免发生危险。', 'The warning is about moving physically close to the railing, so 靠近 fits.'),
      buildDevContrastPrompt('dev-contrast-prompt-linjin-1', 'dev-contrast-cluster-kaojin-linjin', 'dev-contrast-linjin', '考试____，他每天复习到很晚。', 'The exam is approaching in time, so 临近 fits.'),
      buildDevContrastPrompt('dev-contrast-prompt-yanjun-1', 'dev-contrast-cluster-yan-family', 'dev-contrast-yanjun', '这家公司正面临____的财务危机。', 'A crisis or challenge can be 严峻: severe and serious.'),
      buildDevContrastPrompt('dev-contrast-prompt-yanli-1', 'dev-contrast-cluster-yan-family', 'dev-contrast-yanli', '校方对作弊行为作出了____的处罚。', 'Punishment or criticism can be 严厉: stern or severe.'),
      buildDevContrastPrompt('dev-contrast-prompt-yansu-1', 'dev-contrast-cluster-yan-family', 'dev-contrast-yansu', '听到这个消息后，他的表情变得很____。', 'An expression, mood, or attitude can be 严肃: serious.'),
      buildDevContrastPrompt('dev-contrast-prompt-zhuangzhong-1', 'dev-contrast-cluster-yan-family', 'dev-contrast-zhuangzhong', '参加典礼时，她选择了一套____的衣服。', 'Dress or bearing for a ceremony can be 庄重: dignified and solemn.'),
      buildDevContrastPrompt('dev-contrast-prompt-zhengzhong-1', 'dev-contrast-cluster-yan-family', 'dev-contrast-zhengzhong', '他在会上____承诺会按时完成任务。', 'A promise or statement can be 郑重: solemn and earnest.'),
      buildDevContrastPrompt('dev-contrast-prompt-shanyu-1', 'dev-contrast-cluster-shanyu-shanchang', 'dev-contrast-shanyu', '她____倾听别人的想法，所以大家都愿意找她商量。', 'This describes being adept at an activity, so 善于 fits.'),
      buildDevContrastPrompt('dev-contrast-prompt-shanchang-1', 'dev-contrast-cluster-shanyu-shanchang', 'dev-contrast-shanchang', '在团队里，他最____数据分析。', 'This names a specific skill area, so 擅长 fits.'),
    ],
  };
}

function buildDevContrastWord({
  id,
  hanzi,
  traditional,
  pinyin,
  meaning,
  examples,
  priority,
  createdAt,
}: {
  id: string;
  hanzi: string;
  traditional: string;
  pinyin: string;
  meaning: string;
  examples: string[];
  priority: number;
  createdAt: string;
}): Word {
  return {
    id,
    hanzi,
    traditional,
    pinyin,
    meaning,
    meanings: [meaning],
    personalNotes: '',
    examples,
    status: 'review',
    priority,
    createdAt,
    learningStreak: 0,
    lastLearningSuccessOn: null,
    lastLearningCoveredOn: null,
  };
}

function buildDevContrastMember(
  clusterId: string,
  wordId: string,
  nuanceNote: string,
  displayOrder: number,
): ContrastClusterMember {
  return {
    clusterId,
    wordId,
    nuanceNote,
    displayOrder,
  };
}

function buildDevContrastPrompt(
  id: string,
  clusterId: string,
  targetWordId: string,
  promptText: string,
  explanation: string,
): ContrastPrompt {
  return {
    id,
    clusterId,
    targetWordId,
    promptText,
    explanation,
  };
}

function buildSampleSeedData(): SeedData {
  const words = buildSampleWords();
  return {
    words,
    wordMeanings: buildWordMeaningsFromWords(words),
    ...buildSampleReviewSchedulerState(words),
    wordSkillRelevances: [],
    contrastClusters: [],
    contrastClusterMembers: [],
    contrastPrompts: [],
  };
}

function buildSampleReviewSchedulerState(words: Word[]): Pick<SeedData, 'wordStudyAdmissionStates' | 'wordSkillStates'> {
  const now = new Date().toISOString();
  const overdueAt = addHours(now, -24);
  const lastStudiedAt = addHours(overdueAt, -48);
  const reviewWords = words.filter((word) => word.status === 'review');

  return {
    wordStudyAdmissionStates: reviewWords.map((word) => ({
      wordId: word.id,
      studyPhase: 'review',
      earliestNextStudyAt: null,
    })),
    wordSkillStates: reviewWords.flatMap((word) => [
      {
        wordId: word.id,
        skillId: 'recognition' as const,
        enabled: true,
        intervalHours: 48,
        lastStudiedAt,
        nextDueAt: overdueAt,
        easeFactor: INITIAL_REVIEW_EASE_FACTOR,
      },
      {
        wordId: word.id,
        skillId: 'production' as const,
        enabled: true,
        intervalHours: 36,
        lastStudiedAt,
        nextDueAt: overdueAt,
        easeFactor: INITIAL_REVIEW_EASE_FACTOR,
      },
    ]),
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
    requiredForNextSession: row.required_for_next_session !== 0,
    overlayUpdatedAt: row.overlay_updated_at,
  };
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

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeLookupText(value: string): string {
  return value
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/\s+/g, ' ');
}

function getUnstudiedPriorityWordById(wordId: string): PriorityWord {
  const row = getDb()
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
        'unstudied' AS status,
        words.priority,
        words.created_at,
        words.learning_streak,
        words.last_learning_success_on,
        words.last_learning_covered_on,
        COALESCE(user_word_priority.bump_count, 0) AS bump_count,
        COALESCE(user_word_priority.force_top, 0) AS force_top,
        COALESCE(user_word_priority.priority_tier, 0) AS priority_tier,
        COALESCE(user_word_priority.required_for_next_session, 0) AS required_for_next_session,
        user_word_priority.updated_at AS overlay_updated_at
      FROM words
      LEFT JOIN user_word_priority ON user_word_priority.word_id = words.id
      WHERE words.id = ?
        AND ${unstudiedPriorityPredicate('words')}
    `)
    .get(wordId) as PriorityWordRow | undefined;

  if (!row) {
    throw new Error('Expected unstudied word');
  }

  return mapPriorityWordRow(row);
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function getLearningPolicy() {
  return {
    dailyNewWordLimit: getDailyNewWordLimit(),
    unstudiedAdmissionSource: getUnstudiedAdmissionSource(),
  };
}

function upsertLearnerSetting(settingKey: string, value: unknown) {
  getDb().prepare(`
    INSERT INTO learner_settings (
      learner_id,
      setting_key,
      value_json,
      updated_at
    ) VALUES (?, ?, ?, ?)
    ON CONFLICT(learner_id, setting_key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at
  `).run(requireLearnerId(), settingKey, JSON.stringify(value), new Date().toISOString());
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function getDailyNewWordLimit(): number {
  const row = getDb()
    .prepare(`
      SELECT value_json
      FROM learner_settings
      WHERE learner_id = ? AND setting_key = 'daily_new_word_limit'
    `)
    .get(requireLearnerId()) as { value_json: string } | undefined;

  if (!row) {
    // Existing saved limits remain authoritative; only unset learners use the default.
    return DEFAULT_DAILY_NEW_WORD_LIMIT;
  }

  const dailyNewWordLimit = JSON.parse(row.value_json) as unknown;
  assertDailyNewWordLimit(dailyNewWordLimit);
  return dailyNewWordLimit;
}

function getUnstudiedAdmissionSource(): UnstudiedAdmissionSource {
  const row = getDb()
    .prepare(`
      SELECT value_json
      FROM learner_settings
      WHERE learner_id = ? AND setting_key = 'unstudied_admission_source'
    `)
    .get(requireLearnerId()) as { value_json: string } | undefined;

  if (!row) {
    // New learners receive an explicit stash-only setting during bootstrap.
    // Keep the legacy mixed policy for existing learners without a saved choice.
    return DEFAULT_UNSTUDIED_ADMISSION_SOURCE;
  }

  const unstudiedAdmissionSource = JSON.parse(row.value_json) as unknown;
  assertUnstudiedAdmissionSource(unstudiedAdmissionSource);
  return unstudiedAdmissionSource;
}

function readCharacterPresentation(): CharacterPresentation {
  const row = getDb()
    .prepare(`
      SELECT value_json
      FROM learner_settings
      WHERE learner_id = ? AND setting_key = 'character_presentation'
    `)
    .get(requireLearnerId()) as { value_json: string } | undefined;

  if (!row) {
    return DEFAULT_CHARACTER_PRESENTATION;
  }

  const characterPresentation = JSON.parse(row.value_json) as unknown;
  assertCharacterPresentation(characterPresentation);
  return characterPresentation;
}

function assertDailyNewWordLimit(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 20) {
    throw new Error('Expected integer dailyNewWordLimit between 0 and 20');
  }
}

function isStudySkillId(value: unknown): value is StudySkillId {
  return value === 'recognition' || value === 'production' || value === 'contextual_selection';
}

function isWordSkillRelevanceState(value: unknown): value is WordSkillRelevanceState {
  return value === 'normal' || value === 'suppressed';
}
