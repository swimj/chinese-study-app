import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type {
  ContrastCluster,
  ContrastClusterMember,
  ContrastSelectionContent,
  ContrastSelectionCommitIntent,
  ContrastPrompt,
  ReviewCommitFields,
  SessionStudyItem,
  SessionStudyItemBuckets,
  StudyAttemptEvent,
  StudyAttemptOutcome,
  StudyActionKind,
  StudyContentRef,
  StudyEvent,
  StudyEventType,
  StudyManagementActionKind,
  StudySessionRecord,
  WordSkillRelevanceState,
} from '../../src/domain/study-actions.ts';
import { buildReviewSessionStudyItem, deriveReviewCommitFieldsFromAttemptEvents } from '../../src/domain/study-actions.ts';
import { config, getDb, dbPath, seedDataPath, dbExistedOnStartup, openDatabase, setDb } from './connection.ts';
import {
  ensureReflectionIndexes,
  ensureReflectionSchema,
  validateReflectionSchema,
} from './reflections.ts';
import {
  enableContextualSelectionWithoutTransaction,
  suppressDefinitionProductionWithoutTransaction,
} from './domain-commands.ts';
import {
  ensureProductionCueIndexes,
  ensureProductionCueSchema,
  validateProductionCueSchema,
} from './production-cues.ts';
import {
  DEFAULT_DAILY_NEW_WORD_LIMIT,
  PRIORITY_BUMP_UNIT,
  UNSTUDIED_COUNT_BASELINE,
  PRIORITY_MAX_BASELINE,
  INITIAL_REVIEW_EASE_FACTOR,
  INITIAL_CONTEXTUAL_SELECTION_INTERVAL_HOURS,
  PRIORITY_TIER_TOP,
  PRIORITY_TIER_REGULAR,
  PRIORITY_TIER_SUNK,
  REVIEW_PHASE_RECENCY_GUARD_HOURS,
  REVIEW_SKILL_URGENCY_TIE_EPSILON,
} from './types.ts';

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

export function getUnstudiedCountBaseline(): number {
  return UNSTUDIED_COUNT_BASELINE;
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

export function getUnstudiedPriorityWords(): PriorityWordsPayload {
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
        words.status,
        words.priority,
        words.created_at,
        words.learning_streak,
        words.last_learning_success_on,
        words.last_learning_covered_on,
        COALESCE(user_word_priority.bump_count, 0) AS bump_count,
        COALESCE(user_word_priority.force_top, 0) AS force_top,
        COALESCE(user_word_priority.priority_tier, 0) AS priority_tier,
        COALESCE(user_word_priority.required_for_next_session, 0) AS required_for_next_session,
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
        words.status,
        words.priority,
        words.created_at,
        words.learning_streak,
        words.last_learning_success_on,
        words.last_learning_covered_on,
        user_word_priority.bump_count,
        user_word_priority.force_top,
        user_word_priority.priority_tier,
        user_word_priority.required_for_next_session,
        words.priority + user_word_priority.bump_count * ${PRIORITY_BUMP_UNIT} AS effective_priority
      FROM user_word_priority
      JOIN words ON words.id = user_word_priority.word_id
      WHERE words.status = 'unstudied'
        AND user_word_priority.priority_tier >= ${PRIORITY_TIER_REGULAR}
        AND (
          user_word_priority.bump_count > 0
          OR user_word_priority.priority_tier = ${PRIORITY_TIER_TOP}
          OR user_word_priority.required_for_next_session != 0
        )
      ORDER BY
        user_word_priority.priority_tier DESC,
        effective_priority DESC,
        words.priority DESC,
        words.created_at ASC
    `)
    .all() as Array<WordRow & {
      bump_count: number;
      force_top: number;
      priority_tier: number;
      required_for_next_session: number;
      effective_priority: number;
    }>;

  return {
    unstudiedTotalCount: UNSTUDIED_COUNT_BASELINE,
    words: rows.map(mapPrioritizedWordRowWithApproximateRank),
  };
}

export function getTopUnstudiedPriorityWords(limit: number): PriorityWordsPayload {
  const boundedLimit = clampInteger(limit, 1, 100);
  const rows = getDb()
    .prepare(`
      SELECT *
      FROM (
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
          COALESCE(user_word_priority.required_for_next_session, 0) AS required_for_next_session,
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
          AND COALESCE(user_word_priority.priority_tier, 0) >= ${PRIORITY_TIER_REGULAR}
      )
      ORDER BY
        priority_tier DESC,
        effective_priority DESC,
        priority DESC,
        created_at ASC
      LIMIT ?
    `)
    .all(boundedLimit) as PriorityWordRow[];

  return {
    unstudiedTotalCount: UNSTUDIED_COUNT_BASELINE,
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
      INSERT INTO user_word_priority (
        word_id,
        bump_count,
        force_top,
        priority_tier,
        required_for_next_session,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(word_id) DO UPDATE SET
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

export function addUnstudiedUserPriorityByHanzi(hanzi: string, requiredForNextSession = false): PriorityWord[] {
  const matches = resolveUnstudiedPriorityWordIdsByTarget(hanzi);

  if (matches.length === 0) {
    throw new Error('No matching unstudied words found');
  }

  getDb().exec('BEGIN');

  try {
    for (const match of matches) {
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
        INSERT INTO user_word_priority (
          word_id,
          bump_count,
          force_top,
          priority_tier,
          required_for_next_session,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(word_id) DO UPDATE SET
          bump_count = excluded.bump_count,
          force_top = excluded.force_top,
          priority_tier = excluded.priority_tier,
          required_for_next_session = excluded.required_for_next_session,
          updated_at = excluded.updated_at
      `).run(match.id, nextBumpCount, nextForceTop, nextPriorityTier, nextRequiredForNextSession, new Date().toISOString());
    }

    getDb().exec('COMMIT');
  } catch (error) {
    getDb().exec('ROLLBACK');
    throw error;
  }

  return matches.map((match) => getUnstudiedPriorityWordById(match.id));
}

function resolveUnstudiedPriorityWordIdsByTarget(targetText: string): Array<{ id: string }> {
  const submittedText = targetText.trim();
  const exactMatches = getDb()
    .prepare(`
      SELECT
        id
      FROM words
      WHERE status = 'unstudied'
        AND hanzi = ?
      ORDER BY priority DESC, created_at ASC
    `)
    .all(submittedText) as Array<{ id: string }>;

  const candidateMatches = [...exactMatches];

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
        WHERE words.status = 'unstudied'
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

export function getSessionPayload(studyDayKey: string): SessionPayload {
  assertStudyDayKey(studyDayKey);
  ensureAcceptedReviewAttemptEventsProjectedBeforeSessionComposition();

  return {
    buckets: getSessionItemBucketsWithWords(studyDayKey),
  };
}

export function ensureAcceptedReviewAttemptEventsProjectedBeforeSessionComposition() {
  const row = getDb()
    .prepare(`
      SELECT
        id,
        session_id
      FROM study_attempt_events
      WHERE projected_at IS NULL
      ORDER BY occurred_at ASC, session_event_sequence ASC, id ASC
      LIMIT 1
    `)
    .get() as { id: string; session_id: string } | undefined;

  if (row) {
    throw new Error(
      `Session composition invariant violated: accepted attempt event "${row.id}" from session "${row.session_id}" has not been projected.`,
    );
  }
}

export function getWordStudyAdmissionStates(): WordStudyAdmissionState[] {
  const rows = getDb()
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
  const rows = getDb()
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

export function createContrastCluster({
  id = randomUUID(),
  title,
  note = '',
}: {
  id?: string;
  title: string;
  note?: string;
}): ContrastCluster {
  const normalizedId = id.trim();
  const normalizedTitle = title.trim();
  const normalizedNote = note.trim();

  assertNonEmptyString(normalizedId, 'Expected non-empty contrast cluster id');
  assertNonEmptyString(normalizedTitle, 'Expected non-empty contrast cluster title');

  getDb().prepare(`
    INSERT INTO contrast_clusters (
      id,
      title,
      note
    ) VALUES (?, ?, ?)
  `).run(normalizedId, normalizedTitle, normalizedNote);

  return {
    id: normalizedId,
    title: normalizedTitle,
    note: normalizedNote,
  };
}

export function updateContrastCluster({
  id,
  title,
  note = '',
}: {
  id: string;
  title: string;
  note?: string;
}): ContrastCluster {
  const normalizedId = id.trim();
  const normalizedTitle = title.trim();
  const normalizedNote = note.trim();
  assertNonEmptyString(normalizedId, 'Expected non-empty contrast cluster id');
  assertNonEmptyString(normalizedTitle, 'Expected non-empty contrast cluster title');
  ensureContrastClusterExists(normalizedId);

  getDb().prepare(`
    UPDATE contrast_clusters
    SET title = ?, note = ?
    WHERE id = ?
  `).run(normalizedTitle, normalizedNote, normalizedId);

  return {
    id: normalizedId,
    title: normalizedTitle,
    note: normalizedNote,
  };
}

export function getContrastClusters(): ContrastCluster[] {
  const rows = getDb()
    .prepare(`
      SELECT
        id,
        title,
        note
      FROM contrast_clusters
      ORDER BY title ASC, id ASC
    `)
    .all() as ContrastClusterRow[];

  return rows.map(mapContrastClusterRow);
}

export function addContrastClusterMember({
  clusterId,
  wordId,
  nuanceNote = '',
  displayOrder = null,
}: {
  clusterId: string;
  wordId: string;
  nuanceNote?: string;
  displayOrder?: number | null;
}): ContrastClusterMember {
  const normalizedClusterId = clusterId.trim();
  const normalizedWordId = wordId.trim();
  const normalizedNuanceNote = nuanceNote.trim();
  const normalizedDisplayOrder = normalizeNullableDisplayOrder(displayOrder);

  ensureContrastClusterExists(normalizedClusterId);
  ensureWordExists(normalizedWordId);

  getDb().exec('SAVEPOINT add_contrast_cluster_member');
  try {
    getDb().prepare(`
      INSERT INTO contrast_cluster_members (
        cluster_id,
        word_id,
        nuance_note,
        display_order
      ) VALUES (?, ?, ?, ?)
    `).run(normalizedClusterId, normalizedWordId, normalizedNuanceNote, normalizedDisplayOrder);
    enableContextualSelectionWithoutTransaction({
      wordId: normalizedWordId,
      updatedAt: new Date().toISOString(),
      sourceEventId: null,
    });
    getDb().exec('RELEASE SAVEPOINT add_contrast_cluster_member');
  } catch (error) {
    getDb().exec('ROLLBACK TO SAVEPOINT add_contrast_cluster_member');
    getDb().exec('RELEASE SAVEPOINT add_contrast_cluster_member');
    throw error;
  }

  return {
    clusterId: normalizedClusterId,
    wordId: normalizedWordId,
    nuanceNote: normalizedNuanceNote,
    displayOrder: normalizedDisplayOrder,
  };
}

export function updateContrastClusterMember({
  clusterId,
  wordId,
  nuanceNote,
  displayOrder,
}: {
  clusterId: string;
  wordId: string;
  nuanceNote?: string;
  displayOrder?: number | null;
}): ContrastClusterMember {
  const normalizedClusterId = clusterId.trim();
  const normalizedWordId = wordId.trim();
  const normalizedNuanceNote = nuanceNote?.trim() ?? '';
  const normalizedDisplayOrder = normalizeNullableDisplayOrder(displayOrder ?? null);
  ensureContrastClusterMemberExists(normalizedClusterId, normalizedWordId);

  getDb().prepare(`
    UPDATE contrast_cluster_members
    SET nuance_note = ?, display_order = ?
    WHERE cluster_id = ?
      AND word_id = ?
  `).run(normalizedNuanceNote, normalizedDisplayOrder, normalizedClusterId, normalizedWordId);

  return {
    clusterId: normalizedClusterId,
    wordId: normalizedWordId,
    nuanceNote: normalizedNuanceNote,
    displayOrder: normalizedDisplayOrder,
  };
}

export function removeContrastClusterMember({
  clusterId,
  wordId,
}: {
  clusterId: string;
  wordId: string;
}): ContrastClusterContent {
  const normalizedClusterId = clusterId.trim();
  const normalizedWordId = wordId.trim();
  ensureContrastClusterMemberExists(normalizedClusterId, normalizedWordId);

  getDb().exec('BEGIN');
  try {
    getDb().prepare(`
      DELETE FROM contrast_prompts
      WHERE cluster_id = ?
        AND target_word_id = ?
    `).run(normalizedClusterId, normalizedWordId);

    getDb().prepare(`
      DELETE FROM contrast_cluster_members
      WHERE cluster_id = ?
        AND word_id = ?
    `).run(normalizedClusterId, normalizedWordId);

    getDb().exec('COMMIT');
    return getContrastClusterContentById(normalizedClusterId);
  } catch (error) {
    getDb().exec('ROLLBACK');
    throw error;
  }
}

export function getContrastClusterMembers(clusterId: string): ContrastClusterMember[] {
  const normalizedClusterId = clusterId.trim();
  ensureContrastClusterExists(normalizedClusterId);

  const rows = getDb()
    .prepare(`
      SELECT
        cluster_id,
        word_id,
        nuance_note,
        display_order
      FROM contrast_cluster_members
      WHERE cluster_id = ?
      ORDER BY
        display_order IS NULL ASC,
        display_order ASC,
        word_id ASC
    `)
    .all(normalizedClusterId) as ContrastClusterMemberRow[];

  return rows.map(mapContrastClusterMemberRow);
}

export function getContrastSiblingsForWord(wordId: string): ContrastClusterMember[] {
  const normalizedWordId = wordId.trim();
  ensureWordExists(normalizedWordId);

  const rows = getDb()
    .prepare(`
      SELECT DISTINCT
        sibling.cluster_id,
        sibling.word_id,
        sibling.nuance_note,
        sibling.display_order
      FROM contrast_cluster_members AS source
      JOIN contrast_cluster_members AS sibling
        ON sibling.cluster_id = source.cluster_id
       AND sibling.word_id != source.word_id
      WHERE source.word_id = ?
      ORDER BY
        sibling.cluster_id ASC,
        sibling.display_order IS NULL ASC,
        sibling.display_order ASC,
        sibling.word_id ASC
    `)
    .all(normalizedWordId) as ContrastClusterMemberRow[];

  return rows.map(mapContrastClusterMemberRow);
}

export function createContrastPrompt({
  id = randomUUID(),
  clusterId,
  targetWordId,
  promptText,
  explanation = '',
}: {
  id?: string;
  clusterId: string;
  targetWordId: string;
  promptText: string;
  explanation?: string;
}): ContrastPrompt {
  const normalizedId = id.trim();
  const normalizedClusterId = clusterId.trim();
  const normalizedTargetWordId = targetWordId.trim();
  const normalizedPromptText = promptText.trim();
  const normalizedExplanation = explanation.trim();

  assertNonEmptyString(normalizedId, 'Expected non-empty contrast prompt id');
  assertNonEmptyString(normalizedPromptText, 'Expected non-empty contrast prompt text');
  ensureContrastClusterMemberExists(normalizedClusterId, normalizedTargetWordId);

  getDb().prepare(`
    INSERT INTO contrast_prompts (
      id,
      cluster_id,
      target_word_id,
      prompt_text,
      explanation
    ) VALUES (?, ?, ?, ?, ?)
  `).run(
    normalizedId,
    normalizedClusterId,
    normalizedTargetWordId,
    normalizedPromptText,
    normalizedExplanation,
  );

  return {
    id: normalizedId,
    clusterId: normalizedClusterId,
    targetWordId: normalizedTargetWordId,
    promptText: normalizedPromptText,
    explanation: normalizedExplanation,
  };
}

export function getContrastPromptsForCluster(clusterId: string): ContrastPrompt[] {
  const normalizedClusterId = clusterId.trim();
  ensureContrastClusterExists(normalizedClusterId);

  const rows = getDb()
    .prepare(`
      SELECT
        id,
        cluster_id,
        target_word_id,
        prompt_text,
        explanation
      FROM contrast_prompts
      WHERE cluster_id = ?
      ORDER BY id ASC
    `)
    .all(normalizedClusterId) as ContrastPromptRow[];

  return rows.map(mapContrastPromptRow);
}

export function deleteContrastPrompt(id: string): void {
  const normalizedId = id.trim();
  assertNonEmptyString(normalizedId, 'Expected non-empty contrast prompt id');

  const result = getDb()
    .prepare(`
      DELETE FROM contrast_prompts
      WHERE id = ?
    `)
    .run(normalizedId);

  if (result.changes === 0) {
    throw new Error('Contrast prompt not found');
  }
}

export function getContrastClusterContent(): ContrastClusterContent[] {
  const wordsById = new Map(getWords().map((word) => [word.id, word]));
  const productionSuppressedWordIds = new Set(
    getWordSkillRelevanceRows()
      .filter((row) => row.skillId === 'production' && row.relevanceState === 'suppressed')
      .map((row) => row.wordId),
  );
  const badProductionPromptWordIds = getGeneratedPromptFeedbackState().badDefinitionBasedProductionPromptWordIds;

  return getContrastClusters().map((cluster) => ({
    ...cluster,
    members: getContrastClusterMembers(cluster.id).map((member) => {
      const word = wordsById.get(member.wordId);
      if (!word) {
        throw new Error(`Contrast cluster member references missing word "${member.wordId}"`);
      }

      return {
        ...member,
        word,
        productionSuppressed: productionSuppressedWordIds.has(member.wordId),
        badProductionPromptReported: badProductionPromptWordIds.has(member.wordId),
      };
    }),
    prompts: getContrastPromptContentForCluster(cluster.id),
  }));
}

function getContrastPromptContentForCluster(clusterId: string): ContrastPromptContent[] {
  const feedbackByPromptId = getContrastPromptFeedbackSummariesByPromptId();

  return getContrastPromptsForCluster(clusterId).map((prompt) => {
    const feedback = feedbackByPromptId.get(prompt.id) ?? createEmptyContrastPromptFeedbackSummary();
    return {
      ...prompt,
      feedback,
    };
  });
}

function getContrastPromptContentById(id: string): ContrastPromptContent {
  const normalizedId = id.trim();
  assertNonEmptyString(normalizedId, 'Expected non-empty contrast prompt id');

  const row = getDb()
    .prepare(`
      SELECT
        id,
        cluster_id,
        target_word_id,
        prompt_text,
        explanation
      FROM contrast_prompts
      WHERE id = ?
    `)
    .get(normalizedId) as ContrastPromptRow | undefined;

  if (!row) {
    throw new Error('Contrast prompt not found');
  }

  return {
    ...mapContrastPromptRow(row),
    feedback: getContrastPromptFeedbackSummariesByPromptId().get(normalizedId) ?? createEmptyContrastPromptFeedbackSummary(),
  };
}

export function resolveContrastPromptBadFeedback({
  promptId,
  note = '',
}: {
  promptId: string;
  note?: string;
}): ContrastPromptContent {
  const normalizedPromptId = promptId.trim();
  const normalizedNote = note.trim();
  assertNonEmptyString(normalizedPromptId, 'Expected non-empty contrast prompt id');
  const prompt = getContrastPromptContentById(normalizedPromptId);
  ensureWordExists(prompt.targetWordId);

  insertStudyContentFeedbackLogRow({
    targetType: 'contrast_prompt',
    targetId: prompt.id,
    targetWordId: prompt.targetWordId,
    actionKind: 'contrast_selection',
    feedbackType: 'bad_prompt',
    feedbackAction: 'resolved',
    sourceEventId: null,
    note: normalizedNote,
  });

  return getContrastPromptContentById(normalizedPromptId);
}

type ContrastPromptFeedbackSummary = ContrastPromptContent['feedback'];

function createEmptyContrastPromptFeedbackSummary(): ContrastPromptFeedbackSummary {
  return {
    flagged: false,
    badPromptCount: 0,
    latestBadPromptAt: null,
    notes: [],
  };
}

function getContrastPromptFeedbackSummariesByPromptId(): Map<string, ContrastPromptFeedbackSummary> {
  const feedbackByPromptId = new Map<string, ContrastPromptFeedbackSummary>();

  for (const feedback of getStudyContentFeedback()) {
    if (feedback.targetType !== 'contrast_prompt' || feedback.feedbackType !== 'bad_prompt') {
      continue;
    }

    if (feedback.feedbackAction === 'resolved') {
      feedbackByPromptId.set(feedback.targetId, createEmptyContrastPromptFeedbackSummary());
      continue;
    }

    const summary = feedbackByPromptId.get(feedback.targetId) ?? createEmptyContrastPromptFeedbackSummary();
    feedbackByPromptId.set(feedback.targetId, {
      flagged: true,
      badPromptCount: summary.badPromptCount + 1,
      latestBadPromptAt: feedback.createdAt,
      notes: feedback.note.length > 0 ? [...summary.notes, feedback.note] : summary.notes,
    });
  }

  return feedbackByPromptId;
}

function getBlockedContrastPromptIds(): Set<string> {
  const blockedPromptIds = new Set<string>();

  for (const [promptId, feedback] of getContrastPromptFeedbackSummariesByPromptId()) {
    if (feedback.flagged) {
      blockedPromptIds.add(promptId);
    }
  }

  return blockedPromptIds;
}

export function getContrastIntakeGroups(): ContrastIntakeGroupsPayload {
  const openRows = getContrastCandidateIntake().filter((row) => row.status === 'open');
  const wordsById = new Map(getWords().map((word) => [word.id, word]));
  const clusters = getContrastClusterContent();
  const groupedRows = new Map<string, ContrastCandidateIntake[]>();

  for (const row of openRows) {
    const groupKey = buildContrastIntakeGroupKey({
      targetWordId: row.targetWordId,
      candidateText: row.candidateText,
      matchedWordId: row.matchedWordId,
    });
    const currentRows = groupedRows.get(groupKey) ?? [];
    currentRows.push(row);
    groupedRows.set(groupKey, currentRows);
  }

  const groups = [...groupedRows.entries()].map(([groupKey, rows]) => {
    const firstRow = rows[0] ?? assertContrastIntakeRowsPresent();
    const targetWord = wordsById.get(firstRow.targetWordId);
    if (!targetWord) {
      throw new Error(`Contrast intake references missing target word "${firstRow.targetWordId}"`);
    }

    const matchedWordId = firstRow.matchedWordId;
    const matchedWord = matchedWordId ? wordsById.get(matchedWordId) ?? null : null;
    const relevantWordIds = new Set([targetWord.id]);
    if (matchedWord) {
      relevantWordIds.add(matchedWord.id);
    }

    const relevantClusters = clusters.filter((cluster) =>
      cluster.members.some((member) => relevantWordIds.has(member.wordId)),
    );
    const intakeWordIds = matchedWord ? [targetWord.id, matchedWord.id] : [targetWord.id];
    const coverage = summarizeContrastIntakeCoverage({
      targetWordId: targetWord.id,
      candidateWordIds: matchedWord ? [matchedWord.id] : [],
      intakeWordIds,
      clusters: relevantClusters,
    });
    const sortedRows = [...rows].sort((left, right) => {
      const createdComparison = left.createdAt.localeCompare(right.createdAt);
      return createdComparison === 0 ? left.id.localeCompare(right.id) : createdComparison;
    });
    const notes = [...new Set(sortedRows.map((row) => row.note.trim()).filter((note) => note.length > 0))];

    return {
      groupKey,
      targetWordId: targetWord.id,
      candidateText: firstRow.candidateText,
      matchedWordId,
      targetWord,
      matchedWord,
      count: rows.length,
      firstCreatedAt: sortedRows[0]?.createdAt ?? firstRow.createdAt,
      latestCreatedAt: sortedRows[sortedRows.length - 1]?.createdAt ?? firstRow.createdAt,
      notes,
      sources: sortedRows,
      relevantClusters,
      coverage,
    };
  });

  groups.sort((left, right) => {
    if (right.count !== left.count) {
      return right.count - left.count;
    }

    const latestComparison = right.latestCreatedAt.localeCompare(left.latestCreatedAt);
    return latestComparison === 0 ? left.groupKey.localeCompare(right.groupKey) : latestComparison;
  });

  return { groups };
}

export function getContrastIntakeWords(): ContrastIntakeWordsPayload {
  const openRows = getContrastCandidateIntake().filter((row) => row.status === 'open');
  const wordsById = new Map(getWords().map((word) => [word.id, word]));
  const clusters = getContrastClusterContent();
  const groupedByTarget = new Map<string, ContrastCandidateIntake[]>();
  const productionSuppressedWordIds = new Set(
    getWordSkillRelevanceRows()
      .filter((row) => row.skillId === 'production' && row.relevanceState === 'suppressed')
      .map((row) => row.wordId),
  );
  const badProductionPromptWordIds = getGeneratedPromptFeedbackState().badDefinitionBasedProductionPromptWordIds;

  for (const row of openRows) {
    const current = groupedByTarget.get(row.targetWordId) ?? [];
    current.push(row);
    groupedByTarget.set(row.targetWordId, current);
  }

  const words = [...groupedByTarget.entries()].map(([targetWordId, rows]) => {
    const targetWord = wordsById.get(targetWordId);
    if (!targetWord) {
      throw new Error(`Contrast intake references missing target word "${targetWordId}"`);
    }

    const sortedRows = [...rows].sort((left, right) => {
      const createdComparison = left.createdAt.localeCompare(right.createdAt);
      return createdComparison === 0 ? left.id.localeCompare(right.id) : createdComparison;
    });
    const notes = [...new Set(sortedRows.map((row) => row.note.trim()).filter((note) => note.length > 0))];
    const relevantClusters = clusters.filter((cluster) =>
      cluster.members.some((member) => member.wordId === targetWordId),
    );

    const groupedCandidates = new Map<string, ContrastCandidateIntake[]>();
    for (const row of rows) {
      // Single-word intake rows intentionally have no candidate; keep them at word-level only.
      if (!row.candidateText && !row.matchedWordId) {
        continue;
      }
      const key = buildContrastIntakeGroupKey({
        targetWordId: row.targetWordId,
        candidateText: row.candidateText,
        matchedWordId: row.matchedWordId,
      });
      const current = groupedCandidates.get(key) ?? [];
      current.push(row);
      groupedCandidates.set(key, current);
    }

    const productionSuppressed = productionSuppressedWordIds.has(targetWordId);
    const badProductionPromptReported = badProductionPromptWordIds.has(targetWordId);
    const candidateSummaries = [...groupedCandidates.entries()].map(([key, candidateRows]) => {
      const first = candidateRows[0] ?? assertContrastIntakeRowsPresent();
      const matchedWord = first.matchedWordId ? wordsById.get(first.matchedWordId) ?? null : null;
      // Candidate rows keep the original text and resolve all matching words only when Intake is read.
      const matchedWords = resolveContrastIntakeMatchedWords({
        candidateText: first.candidateText,
        persistedMatchedWordId: first.matchedWordId,
        wordsById,
      }).map((word) => {
        const coverage = summarizeContrastIntakeCoverage({
          targetWordId,
          candidateWordIds: [word.id],
          intakeWordIds: [targetWordId, word.id],
          clusters: relevantClusters,
        });
        const candidateProductionSuppressed = productionSuppressedWordIds.has(word.id);
        const candidateBadProductionPromptReported = badProductionPromptWordIds.has(word.id);

        return {
          wordId: word.id,
          word,
          coverage,
          productionSuppressed: candidateProductionSuppressed,
          badProductionPromptReported: candidateBadProductionPromptReported,
          unaddressed: !candidateProductionSuppressed && !candidateBadProductionPromptReported && !coverage.hasSharedCluster,
        } satisfies ContrastIntakeMatchedWord;
      });
      const coverage = summarizeContrastIntakeCoverage({
        targetWordId,
        candidateWordIds: matchedWords.map((word) => word.wordId),
        intakeWordIds: matchedWords.length > 0
          ? [targetWordId, ...matchedWords.map((word) => word.wordId)]
          : [targetWordId],
        clusters: relevantClusters,
      });
      const sortedCandidateRows = [...candidateRows].sort((left, right) => {
        const createdComparison = left.createdAt.localeCompare(right.createdAt);
        return createdComparison === 0 ? left.id.localeCompare(right.id) : createdComparison;
      });

      return {
        key,
        candidateText: first.candidateText,
        matchedWordId: first.matchedWordId,
        matchedWord,
        count: sortedCandidateRows.length,
        firstCreatedAt: sortedCandidateRows[0]?.createdAt ?? first.createdAt,
        latestCreatedAt: sortedCandidateRows[sortedCandidateRows.length - 1]?.createdAt ?? first.createdAt,
        notes: [...new Set(sortedCandidateRows.map((row) => row.note.trim()).filter((note) => note.length > 0))],
        sources: sortedCandidateRows,
        relevantClusters,
        coverage,
        matchedWords,
        unaddressed: matchedWords.length > 0
          ? matchedWords.some((word) => word.unaddressed)
          : !coverage.hasSharedCluster,
      } satisfies ContrastIntakeCandidateSummary;
    }).sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      const latestComparison = right.latestCreatedAt.localeCompare(left.latestCreatedAt);
      return latestComparison === 0 ? left.key.localeCompare(right.key) : latestComparison;
    });
    const resolvedCandidateWordIds = [...new Set(
      candidateSummaries
        .flatMap((candidate) => candidate.matchedWords.map((word) => word.wordId)),
    )];
    const suggestedWordIdSet = new Set([targetWordId, ...resolvedCandidateWordIds]);
    const suggestedClusters = clusters
      .filter((cluster) => cluster.members.some((member) => suggestedWordIdSet.has(member.wordId)))
      .sort((left, right) => {
        const leftOverlapCount = countClusterSuggestedOverlap(left, suggestedWordIdSet);
        const rightOverlapCount = countClusterSuggestedOverlap(right, suggestedWordIdSet);
        if (rightOverlapCount !== leftOverlapCount) {
          return rightOverlapCount - leftOverlapCount;
        }

        return left.title.localeCompare(right.title, 'zh-Hans-CN');
      })
      .map((cluster) => ({
        ...cluster,
        completeness: summarizeClusterCompleteness(cluster),
      }));

    return {
      targetWordId,
      targetWord,
      openRowCount: sortedRows.length,
      firstCreatedAt: sortedRows[0]?.createdAt ?? '',
      latestCreatedAt: sortedRows[sortedRows.length - 1]?.createdAt ?? '',
      notes,
      sources: sortedRows,
      candidates: candidateSummaries,
      resolvedCandidateWordIds,
      suggestedClusters,
      productionSuppressed,
      badProductionPromptReported,
    } satisfies ContrastIntakeWord;
  });

  words.sort((left, right) => {
    if (right.openRowCount !== left.openRowCount) {
      return right.openRowCount - left.openRowCount;
    }
    const latestComparison = right.latestCreatedAt.localeCompare(left.latestCreatedAt);
    return latestComparison === 0
      ? left.targetWord.hanzi.localeCompare(right.targetWord.hanzi, 'zh-Hans-CN')
      : latestComparison;
  });

  return { words };
}

export function mergeSuggestedContrastClustersForIntakeWord({
  targetWordId,
  destinationClusterId,
}: {
  targetWordId: string;
  destinationClusterId: string;
}): ContrastClusterContent {
  const normalizedTargetWordId = targetWordId.trim();
  const normalizedDestinationClusterId = destinationClusterId.trim();
  assertNonEmptyString(normalizedTargetWordId, 'Expected non-empty target word id');
  assertNonEmptyString(normalizedDestinationClusterId, 'Expected non-empty destination cluster id');

  const intakeWord = getContrastIntakeWords().words.find((word) => word.targetWordId === normalizedTargetWordId);
  if (!intakeWord) {
    throw new Error('Contrast intake word not found');
  }

  const suggestedClusterIds = intakeWord.suggestedClusters.map((cluster) => cluster.id);
  if (suggestedClusterIds.length < 2) {
    throw new Error('Expected at least two suggested clusters to merge');
  }
  if (!suggestedClusterIds.includes(normalizedDestinationClusterId)) {
    throw new Error('Expected destination cluster to be one of the suggested clusters for this intake word');
  }

  const sourceClusterIds = suggestedClusterIds.filter((clusterId) => clusterId !== normalizedDestinationClusterId);

  getDb().exec('BEGIN');
  try {
    mergeContrastClustersIntoDestination({
      destinationClusterId: normalizedDestinationClusterId,
      sourceClusterIds,
    });
    getDb().exec('COMMIT');
    return getContrastClusterContentById(normalizedDestinationClusterId);
  } catch (error) {
    getDb().exec('ROLLBACK');
    throw error;
  }
}

export function createContrastClusterFromIntake(input: CreateContrastIntakeClusterInput): ContrastClusterContent {
  const normalizedInput = normalizeCreateContrastIntakeClusterInput(input);

  getDb().exec('BEGIN');

  try {
    const cluster = createContrastCluster({
      title: normalizedInput.title,
      note: normalizedInput.note,
    });
    addContrastClusterMember({
      clusterId: cluster.id,
      wordId: normalizedInput.targetWordId,
      nuanceNote: normalizedInput.targetNuanceNote,
      displayOrder: 1,
    });
    addContrastClusterMember({
      clusterId: cluster.id,
      wordId: normalizedInput.resolvedCandidateWordId,
      nuanceNote: normalizedInput.candidateNuanceNote,
      displayOrder: 2,
    });
    normalizedInput.extraMemberWordIds?.forEach((wordId, index) => {
      addContrastClusterMember({
        clusterId: cluster.id,
        wordId,
        displayOrder: index + 3,
      });
    });
    createContrastPrompt({
      clusterId: cluster.id,
      targetWordId: normalizedInput.prompt.targetWordId,
      promptText: normalizedInput.prompt.promptText,
      explanation: normalizedInput.prompt.explanation,
    });

    getDb().exec('COMMIT');
    return getContrastClusterContentById(cluster.id);
  } catch (error) {
    getDb().exec('ROLLBACK');
    throw error;
  }
}

export function addContrastIntakeToCluster(input: AddContrastIntakeToClusterInput): ContrastClusterContent {
  const normalizedInput = normalizeAddContrastIntakeToClusterInput(input);

  getDb().exec('BEGIN');

  try {
    ensureContrastClusterMemberForIntakeWithoutTransaction({
      clusterId: normalizedInput.clusterId,
      wordId: normalizedInput.targetWordId,
      nuanceNote: normalizedInput.targetNuanceNote,
    });
    ensureContrastClusterMemberForIntakeWithoutTransaction({
      clusterId: normalizedInput.clusterId,
      wordId: normalizedInput.resolvedCandidateWordId,
      nuanceNote: normalizedInput.candidateNuanceNote,
    });
    normalizedInput.extraMemberWordIds?.forEach((wordId) => {
      ensureContrastClusterMemberForIntakeWithoutTransaction({
        clusterId: normalizedInput.clusterId,
        wordId,
        nuanceNote: '',
      });
    });
    createContrastPrompt({
      clusterId: normalizedInput.clusterId,
      targetWordId: normalizedInput.prompt.targetWordId,
      promptText: normalizedInput.prompt.promptText,
      explanation: normalizedInput.prompt.explanation,
    });

    getDb().exec('COMMIT');
    return getContrastClusterContentById(normalizedInput.clusterId);
  } catch (error) {
    getDb().exec('ROLLBACK');
    throw error;
  }
}

export function addContrastPromptFromIntake(input: AddContrastIntakePromptInput): ContrastClusterContent {
  const normalizedInput = normalizeAddContrastIntakePromptInput(input);

  getDb().exec('BEGIN');

  try {
    createContrastPrompt({
      clusterId: normalizedInput.clusterId,
      targetWordId: normalizedInput.prompt.targetWordId,
      promptText: normalizedInput.prompt.promptText,
      explanation: normalizedInput.prompt.explanation,
    });

    getDb().exec('COMMIT');
    return getContrastClusterContentById(normalizedInput.clusterId);
  } catch (error) {
    getDb().exec('ROLLBACK');
    throw error;
  }
}

export function acceptContrastIntakeGroup(input: ContrastIntakeGroupSelector): ContrastIntakeGroupsPayload {
  const normalizedInput = normalizeContrastIntakeGroupSelector(input);

  getDb().exec('BEGIN');

  try {
    updateContrastIntakeGroupStatusWithoutTransaction(normalizedInput, 'resolved');
    getDb().exec('COMMIT');
    return getContrastIntakeGroups();
  } catch (error) {
    getDb().exec('ROLLBACK');
    throw error;
  }
}

export function dismissContrastIntakeGroup(input: ContrastIntakeGroupSelector): ContrastIntakeGroupsPayload {
  const normalizedInput = normalizeContrastIntakeGroupSelector(input);

  getDb().exec('BEGIN');

  try {
    updateContrastIntakeGroupStatusWithoutTransaction(normalizedInput, 'resolved');
    getDb().exec('COMMIT');
    return getContrastIntakeGroups();
  } catch (error) {
    getDb().exec('ROLLBACK');
    throw error;
  }
}

export function resolveContrastIntakeWord(input: ContrastIntakeWordSelector): ContrastIntakeWordsPayload {
  const normalizedInput = normalizeContrastIntakeWordSelector(input);

  getDb().exec('BEGIN');

  try {
    const result = getDb().prepare(`
      UPDATE contrast_candidate_intake
      SET status = 'resolved'
      WHERE target_word_id = ?
        AND status = 'open'
    `).run(normalizedInput.targetWordId);
    if (result.changes === 0) {
      throw new Error('Contrast intake word not found');
    }
    getDb().exec('COMMIT');
    return getContrastIntakeWords();
  } catch (error) {
    getDb().exec('ROLLBACK');
    throw error;
  }
}

export function updateContrastPrompt({
  id,
  targetWordId,
  promptText,
  explanation = '',
}: {
  id: string;
  targetWordId: string;
  promptText: string;
  explanation?: string;
}): ContrastPrompt {
  const normalizedId = id.trim();
  const existingPrompt = getContrastPromptById(normalizedId);
  if (!existingPrompt) {
    throw new Error('Contrast prompt not found');
  }

  const normalizedTargetWordId = targetWordId.trim();
  const normalizedPromptText = promptText.trim();
  const normalizedExplanation = explanation.trim();

  assertNonEmptyString(normalizedPromptText, 'Expected non-empty contrast prompt text');
  ensureContrastClusterMemberExists(existingPrompt.clusterId, normalizedTargetWordId);

  getDb().prepare(`
    UPDATE contrast_prompts
    SET
      target_word_id = ?,
      prompt_text = ?,
      explanation = ?
    WHERE id = ?
  `).run(
    normalizedTargetWordId,
    normalizedPromptText,
    normalizedExplanation,
    normalizedId,
  );

  return {
    ...existingPrompt,
    targetWordId: normalizedTargetWordId,
    promptText: normalizedPromptText,
    explanation: normalizedExplanation,
  };
}

export function upsertStudySessionRecord(record: StudySessionRecord): StudySessionRecord {
  assertStudySessionRecord(record);

  getDb().prepare(`
    INSERT INTO study_sessions (
      id,
      started_at,
      ended_at,
      processing_state,
      processed_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      started_at = excluded.started_at,
      ended_at = excluded.ended_at,
      processing_state = excluded.processing_state,
      processed_at = excluded.processed_at
  `).run(
    record.id,
    record.startedAt,
    record.endedAt,
    record.processingState,
    record.processedAt,
  );

  return getStudySessionRecord(record.id) ?? assertPersistedStudySession(record.id);
}

export function getStudySessionRecord(sessionId: string): StudySessionRecord | null {
  const row = getDb()
    .prepare(`
      SELECT
        id,
        started_at,
        ended_at,
        processing_state,
        processed_at
      FROM study_sessions
      WHERE id = ?
    `)
    .get(sessionId) as StudySessionRow | undefined;

  return row ? mapStudySessionRow(row) : null;
}

export function getStudyEventsForSession(sessionId: string): StudyEvent[] {
  assertNonEmptyString(sessionId, 'Expected non-empty study session id');

  const rows = getDb()
    .prepare(`
      SELECT
        id,
        occurred_at,
        session_id,
        session_action_id,
        session_event_sequence,
        event_type,
        target_word_id,
        action_kind,
        sampled_skill_ids_json,
        content_ref_json,
        payload_json,
        projected_at
      FROM study_events
      WHERE session_id = ?
      ORDER BY session_event_sequence ASC, occurred_at ASC, id ASC
    `)
    .all(sessionId) as StudyEventRow[];

  return rows.map(mapStudyEventRow);
}

export function getWordSkillRelevance(wordId: string, skillId: StudySkillId): WordSkillRelevance | null {
  assertNonEmptyString(wordId, 'Expected non-empty word id');
  if (!isStudySkillId(skillId)) {
    throw new Error(`Invalid study skill id "${String(skillId)}"`);
  }

  const row = getDb()
    .prepare(`
      SELECT
        word_id,
        skill_id,
        relevance_state,
        updated_at,
        source_event_id
      FROM word_skill_relevance
      WHERE word_id = ?
        AND skill_id = ?
    `)
    .get(wordId, skillId) as WordSkillRelevanceRow | undefined;

  return row ? mapWordSkillRelevanceRow(row) : null;
}

export function getWordSkillRelevanceRows(): WordSkillRelevance[] {
  const rows = getDb()
    .prepare(`
      SELECT
        word_id,
        skill_id,
        relevance_state,
        updated_at,
        source_event_id
      FROM word_skill_relevance
      ORDER BY updated_at ASC, word_id ASC, skill_id ASC
    `)
    .all() as WordSkillRelevanceRow[];

  return rows.map(mapWordSkillRelevanceRow);
}

export function getContrastCandidateIntake(): ContrastCandidateIntake[] {
  const rows = getDb()
    .prepare(`
      SELECT
        id,
        created_at,
        target_word_id,
        source_event_id,
        source_action_kind,
        source_content_ref_json,
        candidate_text,
        matched_word_id,
        note,
        status
      FROM contrast_candidate_intake
      ORDER BY created_at ASC, id ASC
    `)
    .all() as ContrastCandidateIntakeRow[];

  return rows.map(mapContrastCandidateIntakeRow);
}

export function getStudyContentFeedback(): StudyContentFeedback[] {
  const rows = getDb()
    .prepare(`
      SELECT
        id,
        created_at,
        target_type,
        target_id,
        target_word_id,
        action_kind,
        feedback_type,
        feedback_action,
        source_event_id,
        note
      FROM study_content_feedback
      ORDER BY created_at ASC, rowid ASC
    `)
    .all() as StudyContentFeedbackRow[];

  return rows.map(mapStudyContentFeedbackRow);
}

export function recordStudyManagementAction(input: RecordStudyManagementActionInput): StudyEvent {
  assertStudyManagementActionInput(input);

  const targetWord = getWordById(input.targetWordId);
  if (!targetWord) {
    throw new Error('Word not found');
  }

  if (targetWord.status !== 'review') {
    throw new Error('Study management actions are currently limited to review words');
  }

  const now = new Date().toISOString();
  const eventId = randomUUID();
  const note = input.note?.trim() ?? '';
  const candidateText = input.candidateText?.trim() ? input.candidateText.trim() : null;
  const eventType = mapStudyManagementActionToEventType(input.managementAction);

  getDb().exec('BEGIN');

  try {
    ensureStudySessionExistsWithoutTransaction(input.sessionId, now);
    const sessionEventSequence = getNextStudyEventSequenceWithoutTransaction(input.sessionId);

    const event: StudyEvent = {
      id: eventId,
      occurredAt: now,
      sessionId: input.sessionId,
      sessionActionId: input.sessionActionId,
      sessionEventSequence,
      eventType,
      targetWordId: input.targetWordId,
      actionKind: input.actionKind,
      sampledSkillIds: input.sampledSkillIds,
      contentRef: input.contentRef,
      payload: {
        managementAction: input.managementAction,
        note,
        candidateText,
      },
      projectedAt: null,
    };

    insertStudyEventWithoutTransaction(event);
    projectStudyManagementActionWithoutTransaction({
      input,
      eventId,
      projectedAt: now,
      note,
      candidateText,
    });
    markStudyEventProjectedWithoutTransaction(eventId, now);

    getDb().exec('COMMIT');

    return {
      ...event,
      projectedAt: now,
    };
  } catch (error) {
    getDb().exec('ROLLBACK');
    throw error;
  }
}

export function suppressProductionForWordOutsideSession({
  targetWordId,
}: {
  targetWordId: string;
}): WordSkillRelevance {
  const normalizedTargetWordId = targetWordId.trim();
  assertNonEmptyString(normalizedTargetWordId, 'Expected non-empty target word id');
  const targetWord = getWordById(normalizedTargetWordId);
  if (!targetWord) {
    throw new Error('Word not found');
  }

  const now = new Date().toISOString();
  getDb().exec('BEGIN');
  try {
    const result = suppressDefinitionProductionWithoutTransaction({
      wordId: normalizedTargetWordId,
      updatedAt: now,
      sourceEventId: null,
    });
    getDb().exec('COMMIT');
    return result.relevance;
  } catch (error) {
    getDb().exec('ROLLBACK');
    throw error;
  }
}

export function reportBadProductionPromptOutsideSession({
  targetWordId,
  note = '',
}: {
  targetWordId: string;
  note?: string;
}): StudyContentFeedback {
  const normalizedTargetWordId = targetWordId.trim();
  const normalizedNote = note.trim();
  assertNonEmptyString(normalizedTargetWordId, 'Expected non-empty target word id');
  const targetWord = getWordById(normalizedTargetWordId);
  if (!targetWord) {
    throw new Error('Word not found');
  }

  const now = new Date().toISOString();
  const feedback: StudyContentFeedback = {
    id: randomUUID(),
    createdAt: now,
    targetType: 'generated_prompt',
    targetId: 'definition_based_production',
    targetWordId: normalizedTargetWordId,
    actionKind: 'production',
    feedbackType: 'bad_prompt',
    feedbackAction: 'reported',
    sourceEventId: null,
    note: normalizedNote,
  };

  getDb().exec('BEGIN');
  try {
    getDb().prepare(`
      INSERT INTO study_content_feedback (
        id,
        created_at,
        target_type,
        target_id,
        target_word_id,
        action_kind,
        feedback_type,
        feedback_action,
        source_event_id,
        note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      feedback.id,
      feedback.createdAt,
      feedback.targetType,
      feedback.targetId,
      feedback.targetWordId,
      feedback.actionKind,
      feedback.feedbackType,
      feedback.feedbackAction,
      null,
      feedback.note,
    );
    upsertWordStudyAdmissionState(
      normalizedTargetWordId,
      'review',
      addHours(now, REVIEW_PHASE_RECENCY_GUARD_HOURS),
    );
    getDb().exec('COMMIT');
    return feedback;
  } catch (error) {
    getDb().exec('ROLLBACK');
    throw error;
  }
}

// White-box storage helper for focused attempt-event persistence tests.
// Runtime review commits should use recordAcceptedReviewAttemptBatch so event
// insertion and scheduler projection share one transaction.
export function insertStudyAttemptEvents(events: StudyAttemptEvent[]): StudyAttemptEvent[] {
  const sessionId = events[0]?.sessionId ?? null;
  for (const event of events) {
    assertStudyAttemptEvent(event);
    if (sessionId !== null && event.sessionId !== sessionId) {
      throw new Error('Study attempt event batch must belong to one session');
    }
  }

  getDb().exec('BEGIN');

  try {
    insertStudyAttemptEventsWithoutTransaction(events);
    getDb().exec('COMMIT');
  } catch (error) {
    getDb().exec('ROLLBACK');
    throw error;
  }

  return getStudyAttemptEventsForSession(sessionId);
}

export function recordAcceptedReviewAttemptBatch({
  sessionId,
  events,
  commitIntent,
}: {
  sessionId: string;
  events: StudyAttemptEvent[];
  commitIntent: ReviewAttemptCommitIntent;
}): { events: StudyAttemptEvent[] } {
  assertNonEmptyString(sessionId, 'Expected non-empty study session id');
  assertReviewAttemptCommitIntent(commitIntent);

  if (events.length === 0) {
    throw new Error('Expected at least one accepted attempt event');
  }

  for (const event of events) {
    assertStudyAttemptEvent(event);
    if (event.sessionId !== sessionId) {
      throw new Error('Accepted attempt event sessionId must match route session id');
    }
  }

  assertReviewAttemptBatchMatchesCommitIntent(events, commitIntent);
  const derivedCommitFields = deriveReviewCommitFieldsFromAttemptEvents(events);
  assertDerivedReviewCommitMatchesIntent(derivedCommitFields, commitIntent);

  const reviewedAt = new Date().toISOString();

  getDb().exec('BEGIN');

  try {
    ensureStudySessionExistsWithoutTransaction(sessionId, events[0]?.occurredAt ?? reviewedAt);
    insertStudyAttemptEventsWithoutTransaction(events);
    projectReviewAttemptEventsWithoutTransaction({
      events,
      failureCount: derivedCommitFields.failureCount,
      terminalRating: derivedCommitFields.terminalRating,
      reviewedAt,
    });
    markStudyAttemptEventsProjectedWithoutTransaction(events.map((event) => event.id), reviewedAt);

    getDb().exec('COMMIT');
  } catch (error) {
    getDb().exec('ROLLBACK');
    throw error;
  }

  return {
    events: getStudyAttemptEventsForSession(sessionId).filter((event) => events.some((input) => input.id === event.id)),
  };
}

export function recordAcceptedContrastSelectionAttempt({
  sessionId,
  event,
  commitIntent,
}: {
  sessionId: string;
  event: StudyAttemptEvent;
  commitIntent: ContrastSelectionCommitIntent;
}): { event: StudyAttemptEvent } {
  assertNonEmptyString(sessionId, 'Expected non-empty study session id');
  assertStudyAttemptEvent(event);
  assertContrastSelectionCommitIntent(commitIntent);

  if (event.sessionId !== sessionId) {
    throw new Error('Accepted contrast attempt event sessionId must match route session id');
  }

  assertContrastSelectionAttemptMatchesCommitIntent(event, commitIntent);

  const reviewedAt = new Date().toISOString();

  getDb().exec('BEGIN');

  try {
    ensureStudySessionExistsWithoutTransaction(sessionId, event.occurredAt);
    insertStudyAttemptEventsWithoutTransaction([event]);
    projectContrastSelectionAttemptEventWithoutTransaction({
      event,
      reviewedAt,
    });
    markStudyAttemptEventsProjectedWithoutTransaction([event.id], reviewedAt);

    getDb().exec('COMMIT');
  } catch (error) {
    getDb().exec('ROLLBACK');
    throw error;
  }

  const persistedEvent = getStudyAttemptEventsForSession(sessionId).find((candidate) => candidate.id === event.id);
  return {
    event: persistedEvent ?? event,
  };
}

export function getStudyAttemptEventsForSession(sessionId: string | null): StudyAttemptEvent[] {
  if (sessionId === null) {
    return [];
  }

  const rows = getDb()
    .prepare(`
      SELECT
        id,
        occurred_at,
        session_id,
        session_action_id,
        session_event_sequence,
        action_attempt_sequence,
        action_kind,
        target_word_id,
        sampled_skill_ids_json,
        response,
        outcome,
        rating,
        content_ref_json,
        metadata_json,
        projected_at
      FROM study_attempt_events
      WHERE session_id = ?
      ORDER BY
        session_event_sequence ASC,
        occurred_at ASC,
        id ASC
    `)
    .all(sessionId) as StudyAttemptEventRow[];

  return rows.map(mapStudyAttemptEventRow);
}

function insertStudyAttemptEventsWithoutTransaction(events: StudyAttemptEvent[]) {
  const insert = getDb().prepare(`
    INSERT INTO study_attempt_events (
      id,
      occurred_at,
      session_id,
      session_action_id,
      session_event_sequence,
      action_attempt_sequence,
      action_kind,
      target_word_id,
      sampled_skill_ids_json,
      response,
      outcome,
      rating,
      content_ref_json,
      metadata_json,
      projected_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `);

  for (const event of events) {
    insert.run(
      event.id,
      event.occurredAt,
      event.sessionId,
      event.sessionActionId,
      event.sessionEventSequence,
      event.actionAttemptSequence,
      event.actionKind,
      event.targetWordId,
      JSON.stringify(event.sampledSkillIds),
      event.response,
      event.outcome,
      event.rating,
      event.contentRef === null ? null : JSON.stringify(event.contentRef),
      JSON.stringify(event.metadata),
    );
  }
}

function ensureStudySessionExistsWithoutTransaction(sessionId: string, startedAt: string) {
  getDb().prepare(`
    INSERT INTO study_sessions (
      id,
      started_at,
      ended_at,
      processing_state,
      processed_at
    ) VALUES (?, ?, NULL, 'open', NULL)
    ON CONFLICT(id) DO NOTHING
  `).run(sessionId, startedAt);
}

function getNextStudyEventSequenceWithoutTransaction(sessionId: string) {
  const row = getDb()
    .prepare(`
      SELECT COALESCE(MAX(session_event_sequence), 0) + 1 AS next_sequence
      FROM (
        SELECT session_event_sequence
        FROM study_events
        WHERE session_id = ?
          AND session_event_sequence IS NOT NULL
        UNION ALL
        SELECT session_event_sequence
        FROM study_attempt_events
        WHERE session_id = ?
      )
    `)
    .get(sessionId, sessionId) as { next_sequence: number };

  return row.next_sequence;
}

function insertStudyEventWithoutTransaction(event: StudyEvent) {
  getDb().prepare(`
    INSERT INTO study_events (
      id,
      occurred_at,
      session_id,
      session_action_id,
      session_event_sequence,
      event_type,
      target_word_id,
      action_kind,
      sampled_skill_ids_json,
      content_ref_json,
      payload_json,
      projected_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.id,
    event.occurredAt,
    event.sessionId,
    event.sessionActionId,
    event.sessionEventSequence,
    event.eventType,
    event.targetWordId,
    event.actionKind,
    JSON.stringify(event.sampledSkillIds),
    event.contentRef === null ? null : JSON.stringify(event.contentRef),
    JSON.stringify(event.payload),
    event.projectedAt,
  );
}

function projectStudyManagementActionWithoutTransaction({
  input,
  eventId,
  projectedAt,
  note,
  candidateText,
}: {
  input: RecordStudyManagementActionInput;
  eventId: string;
  projectedAt: string;
  note: string;
  candidateText: string | null;
}) {
  if (input.managementAction === 'suppress_skill') {
    const skillId = getManagedSkillId(input.actionKind);
    if (skillId === 'production') {
      suppressDefinitionProductionWithoutTransaction({
        wordId: input.targetWordId,
        updatedAt: projectedAt,
        sourceEventId: eventId,
      });
    } else {
      upsertWordSkillRelevanceWithoutTransaction({
        wordId: input.targetWordId,
        skillId,
        relevanceState: 'suppressed',
        updatedAt: projectedAt,
        sourceEventId: eventId,
      });
    }
    return;
  }

  if (input.managementAction === 'add_contrast_candidate') {
    enableContextualSelectionWithoutTransaction({
      wordId: input.targetWordId,
      updatedAt: projectedAt,
      sourceEventId: eventId,
    });
    insertContrastCandidateIntakeWithoutTransaction({
      input,
      eventId,
      createdAt: projectedAt,
      note,
      candidateText,
    });
    return;
  }

  if (input.managementAction === 'suppress_skill_and_add_contrast_candidate') {
    suppressDefinitionProductionWithoutTransaction({
      wordId: input.targetWordId,
      updatedAt: projectedAt,
      sourceEventId: eventId,
    });
    enableContextualSelectionWithoutTransaction({
      wordId: input.targetWordId,
      updatedAt: projectedAt,
      sourceEventId: eventId,
    });
    insertContrastCandidateIntakeWithoutTransaction({
      input,
      eventId,
      createdAt: projectedAt,
      note,
      candidateText,
    });
    return;
  }

  if (input.managementAction === 'bad_prompt') {
    insertStudyContentFeedbackWithoutTransaction({
      input,
      eventId,
      createdAt: projectedAt,
      note,
    });
    upsertWordStudyAdmissionState(
      input.targetWordId,
      'review',
      addHours(projectedAt, REVIEW_PHASE_RECENCY_GUARD_HOURS),
    );
  }
}

function upsertWordSkillRelevanceWithoutTransaction(relevance: WordSkillRelevance) {
  getDb().prepare(`
    INSERT INTO word_skill_relevance (
      word_id,
      skill_id,
      relevance_state,
      updated_at,
      source_event_id
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(word_id, skill_id) DO UPDATE SET
      relevance_state = excluded.relevance_state,
      updated_at = excluded.updated_at,
      source_event_id = excluded.source_event_id
  `).run(
    relevance.wordId,
    relevance.skillId,
    relevance.relevanceState,
    relevance.updatedAt,
    relevance.sourceEventId,
  );
}

function insertContrastCandidateIntakeWithoutTransaction({
  input,
  eventId,
  createdAt,
  note,
  candidateText,
}: {
  input: RecordStudyManagementActionInput;
  eventId: string;
  createdAt: string;
  note: string;
  candidateText: string | null;
}) {
  getDb().prepare(`
    INSERT INTO contrast_candidate_intake (
      id,
      created_at,
      target_word_id,
      source_event_id,
      source_action_kind,
      source_content_ref_json,
      candidate_text,
      matched_word_id,
      note,
      status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')
  `).run(
    randomUUID(),
    createdAt,
    input.targetWordId,
    eventId,
    input.actionKind,
    input.contentRef === null ? null : JSON.stringify(input.contentRef),
    candidateText,
    null,
    note,
  );
}

function insertStudyContentFeedbackWithoutTransaction({
  input,
  eventId,
  createdAt,
  note,
}: {
  input: RecordStudyManagementActionInput;
  eventId: string;
  createdAt: string;
  note: string;
}) {
  const feedbackTarget = getStudyContentFeedbackTarget(input);

  insertStudyContentFeedbackLogRow({
    targetType: feedbackTarget.targetType,
    targetId: feedbackTarget.targetId,
    targetWordId: input.targetWordId,
    actionKind: input.actionKind,
    feedbackType: 'bad_prompt',
    feedbackAction: 'reported',
    sourceEventId: eventId,
    note,
    createdAt,
  });
}

function insertStudyContentFeedbackLogRow({
  targetType,
  targetId,
  targetWordId,
  actionKind,
  feedbackType,
  feedbackAction,
  sourceEventId,
  note,
  createdAt = new Date().toISOString(),
}: {
  targetType: StudyContentFeedback['targetType'];
  targetId: string;
  targetWordId: string;
  actionKind: StudyContentFeedback['actionKind'];
  feedbackType: StudyContentFeedback['feedbackType'];
  feedbackAction: StudyContentFeedback['feedbackAction'];
  sourceEventId: string | null;
  note: string;
  createdAt?: string;
}) {
  getDb().prepare(`
    INSERT INTO study_content_feedback (
      id,
      created_at,
      target_type,
      target_id,
      target_word_id,
      action_kind,
      feedback_type,
      feedback_action,
      source_event_id,
      note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    createdAt,
    targetType,
    targetId,
    targetWordId,
    actionKind,
    feedbackType,
    feedbackAction,
    sourceEventId,
    note,
  );
}

function getStudyContentFeedbackTarget(input: RecordStudyManagementActionInput): Pick<StudyContentFeedback, 'targetType' | 'targetId'> {
  if (input.contentRef?.type === 'contrast_prompt') {
    return {
      targetType: 'contrast_prompt',
      targetId: input.contentRef.id,
    };
  }

  if (input.actionKind === 'production') {
    return {
      targetType: 'generated_prompt',
      targetId: 'definition_based_production',
    };
  }

  throw new Error('Expected contrast prompt content reference for contrast prompt feedback');
}

function markStudyEventProjectedWithoutTransaction(eventId: string, projectedAt: string) {
  getDb().prepare(`
    UPDATE study_events
    SET projected_at = ?
    WHERE id = ?
  `).run(projectedAt, eventId);
}

function projectReviewAttemptEventsWithoutTransaction({
  events,
  failureCount,
  terminalRating,
  reviewedAt,
}: {
  events: StudyAttemptEvent[];
  failureCount: number;
  terminalRating: ReviewPassRating | null;
  reviewedAt: string;
}) {
  const firstEvent = events[0] ?? assertAttemptEventBatchNotEmpty();
  const skillId = mapReviewActionKindToStudySkill(firstEvent.actionKind);
  const currentState = getWordSkillState(firstEvent.targetWordId, skillId);
  const updatedState = scheduleWordSkillStateFromReviewAttempt(currentState, failureCount, terminalRating, reviewedAt);

  upsertWordSkillState(updatedState);
  upsertWordStudyAdmissionState(
    updatedState.wordId,
    'review',
    addHours(updatedState.lastStudiedAt, REVIEW_PHASE_RECENCY_GUARD_HOURS),
  );
}

function projectContrastSelectionAttemptEventWithoutTransaction({
  event,
  reviewedAt,
}: {
  event: StudyAttemptEvent;
  reviewedAt: string;
}) {
  const currentState = getWordSkillState(event.targetWordId, 'contextual_selection');
  const updatedState =
    event.outcome === 'incorrect'
      ? scheduleWordSkillStateFromReviewAttempt(currentState, 1, null, reviewedAt)
      : scheduleWordSkillStateFromReviewAttempt(currentState, 0, event.rating as ReviewPassRating, reviewedAt);

  upsertWordSkillState(updatedState);
  upsertWordStudyAdmissionState(
    updatedState.wordId,
    'review',
    addHours(updatedState.lastStudiedAt, REVIEW_PHASE_RECENCY_GUARD_HOURS),
  );
}

function markStudyAttemptEventsProjectedWithoutTransaction(eventIds: string[], projectedAt: string) {
  const update = getDb().prepare(`
    UPDATE study_attempt_events
    SET projected_at = ?
    WHERE id = ?
  `);

  for (const eventId of eventIds) {
    update.run(projectedAt, eventId);
  }
}

export function validateStudySchedulerStateInvariants(): StudySchedulerStateInvariantViolation[] {
  const reviewWordsMissingAdmission = getDb()
    .prepare(`
      SELECT words.id
      FROM words
      LEFT JOIN word_study_admission_state
        ON word_study_admission_state.word_id = words.id
       AND word_study_admission_state.study_phase = 'review'
      WHERE words.status = 'review'
        AND word_study_admission_state.word_id IS NULL
      ORDER BY words.id ASC
    `)
    .all() as Array<{ id: string }>;

  const reviewWordsMissingSkill = getDb()
    .prepare(`
      WITH expected_skills(skill_id) AS (
        VALUES ('recognition'), ('production')
      )
      SELECT
        words.id,
        expected_skills.skill_id
      FROM words
      CROSS JOIN expected_skills
      LEFT JOIN word_skill_state
        ON word_skill_state.word_id = words.id
       AND word_skill_state.skill_id = expected_skills.skill_id
      WHERE words.status = 'review'
        AND word_skill_state.word_id IS NULL
      ORDER BY words.id ASC, expected_skills.skill_id ASC
    `)
    .all() as Array<{ id: string; skill_id: StudySkillId }>;

  const invalidSkillStates = getDb()
    .prepare(`
      SELECT
        word_id,
        skill_id,
        enabled,
        interval_hours,
        last_studied_at,
        ease_factor
      FROM word_skill_state
      WHERE skill_id IN ('recognition', 'production')
        AND (
          enabled = 0
          OR interval_hours <= 0
          OR last_studied_at IS NULL
          OR last_studied_at = ''
          OR ease_factor <= 0
        )
      ORDER BY word_id ASC, skill_id ASC
    `)
    .all() as Array<{
      word_id: string;
      skill_id: StudySkillId;
      enabled: number;
      interval_hours: number;
      last_studied_at: string | null;
      ease_factor: number;
    }>;

  const violations: StudySchedulerStateInvariantViolation[] = [];

  for (const row of reviewWordsMissingAdmission) {
    violations.push({
      wordId: row.id,
      skillId: null,
      problem: 'review word missing admission state',
    });
  }

  for (const row of reviewWordsMissingSkill) {
    violations.push({
      wordId: row.id,
      skillId: row.skill_id,
      problem: 'review word missing skill state',
    });
  }

  for (const row of invalidSkillStates) {
    const problem =
      row.enabled === 0
        ? 'disabled scheduler skill'
        : row.interval_hours <= 0
          ? 'non-positive interval_hours'
          : row.last_studied_at === null || row.last_studied_at === ''
            ? 'missing last_studied_at'
            : 'non-positive ease_factor';
    violations.push({
      wordId: row.word_id,
      skillId: row.skill_id,
      problem,
    });
  }

  return violations;
}

export function getWordStatusCounts(): Record<WordStatus, number> {
  const rows = getDb()
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

export function getLearningPolicy(studyDayKey: string) {
  assertStudyDayKey(studyDayKey);
  return {
    dailyNewWordLimit: getDailyNewWordLimit(),
    learningCoverageDate: studyDayKey,
  };
}

export function setDailyNewWordLimit(dailyNewWordLimit: number) {
  assertDailyNewWordLimit(dailyNewWordLimit);
  getDb().prepare(`
    INSERT INTO app_metadata (
      key,
      value,
      updated_at
    ) VALUES ('daily_new_word_limit', ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `).run(String(dailyNewWordLimit), new Date().toISOString());

  return {
    dailyNewWordLimit,
  };
}

export function completeUnstudiedWordSession(wordId: string, studyDayKey: string): Word {
  assertStudyDayKey(studyDayKey);
  const existingWord = getDb()
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

  getDb().exec('BEGIN');

  try {
    getDb().prepare(`
      UPDATE words
      SET status = 'learning',
          learning_streak = 0,
          last_learning_success_on = NULL,
          last_learning_covered_on = ?
      WHERE id = ?
    `).run(today, wordId);

    getDb().prepare(`
      UPDATE user_word_priority
      SET required_for_next_session = 0,
          updated_at = ?
      WHERE word_id = ?
    `).run(new Date().toISOString(), wordId);

    incrementDailyNewStudyCount(studyDayKey);
    getDb().exec('COMMIT');
  } catch (error) {
    getDb().exec('ROLLBACK');
    throw error;
  }

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

export function getReviewFailureRateDays(limit = 14): ReviewFailureRateDay[] {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('Expected positive integer limit');
  }

  const rows = getDb()
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
      completedReviewActionSessions: row.completed_count,
      failedReviewActionSessions: row.failed_count,
      failureRate: calculateFailureRate(row.failed_count, row.completed_count),
      rolling3DayFailureRate: calculateFailureRate(rolling3.failedCount, rolling3.completedCount),
      rolling7DayFailureRate: calculateFailureRate(rolling7.failedCount, rolling7.completedCount),
    };
  });
}

export function getSessionActiveTimeMetrics(studyDayKey: string) {
  assertStudyDayKey(studyDayKey);
  const rolling3StartDayKey = addDaysToDateKey(studyDayKey, -2);
  const rolling7StartDayKey = addDaysToDateKey(studyDayKey, -6);
  const rows = getDb()
    .prepare(`
      SELECT day_key, active_duration_ms
      FROM review_session_summaries
      WHERE day_key >= ? AND day_key <= ?
    `)
    .all(rolling7StartDayKey, studyDayKey) as Array<{ day_key: string; active_duration_ms: number }>;

  let todayActiveDurationMs = 0;
  let rolling3DayActiveDurationMs = 0;
  let rolling7DayActiveDurationMs = 0;
  for (const row of rows) {
    rolling7DayActiveDurationMs += row.active_duration_ms;
    if (row.day_key >= rolling3StartDayKey) {
      rolling3DayActiveDurationMs += row.active_duration_ms;
    }
    if (row.day_key === studyDayKey) {
      todayActiveDurationMs += row.active_duration_ms;
    }
  }

  return {
    todayActiveDurationMs,
    rolling3DayAverageActiveDurationMs: rolling3DayActiveDurationMs / 3,
    rolling7DayAverageActiveDurationMs: rolling7DayActiveDurationMs / 7,
  };
}

export function recordReviewSessionSummary({
  sessionId,
  completedAt,
  completedReviewActionCount,
  failedReviewActionCount,
  activeDurationMs,
}: {
  sessionId: string;
  completedAt: string;
  completedReviewActionCount: number;
  failedReviewActionCount: number;
  activeDurationMs: number;
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

  getDb().prepare(`
    INSERT INTO review_session_summaries (
      session_id,
      completed_at,
      day_key,
      completed_count,
      failed_count,
      active_duration_ms
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      completed_at = excluded.completed_at,
      day_key = excluded.day_key,
      completed_count = excluded.completed_count,
      failed_count = excluded.failed_count,
      active_duration_ms = excluded.active_duration_ms
  `).run(
    normalizedSessionId,
    completedAt,
    completedAt.slice(0, 10),
    completedReviewActionCount,
    failedReviewActionCount,
    activeDurationMs,
  );
}

export function completeLearningWordSession(wordId: string, success: boolean): Word {
  const existingWord = getDb()
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

  getDb().exec('BEGIN');

  try {
    getDb().prepare(`
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
      initializeReviewSchedulerStateForWord(wordId, now, nextDueAt);
      upsertWordStudyAdmissionState(wordId, 'review', addHours(now, REVIEW_PHASE_RECENCY_GUARD_HOURS));
    }

    getDb().exec('COMMIT');
  } catch (error) {
    getDb().exec('ROLLBACK');
    throw error;
  }

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

export function dismissWordFromStudy(wordId: string): void {
  const existingWord = getDb()
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

  getDb().exec('BEGIN');

  try {
    getDb().prepare(`
      INSERT INTO user_word_priority (
        word_id,
        bump_count,
        force_top,
        priority_tier,
        required_for_next_session,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(word_id) DO UPDATE SET
        bump_count = excluded.bump_count,
        force_top = excluded.force_top,
        priority_tier = excluded.priority_tier,
        required_for_next_session = excluded.required_for_next_session,
        updated_at = excluded.updated_at
    `).run(wordId, 0, 0, PRIORITY_TIER_SUNK, 0, new Date().toISOString());

    if (existingWord.status !== 'unstudied') {
      getDb().prepare(`
        UPDATE words
        SET status = 'unstudied',
            learning_streak = 0,
            last_learning_success_on = NULL,
            last_learning_covered_on = NULL
        WHERE id = ?
      `).run(wordId);

      deleteStudySchedulerStateForWord(wordId);
      if (hasContrastClusterMembership(wordId)) {
        enableContextualSelectionWithoutTransaction({
          wordId,
          updatedAt: new Date().toISOString(),
          sourceEventId: null,
        });
      }
    }

    getDb().exec('COMMIT');
  } catch (error) {
    getDb().exec('ROLLBACK');
    throw error;
  }
}

export function initializeDatabase() {
  if (!dbExistedOnStartup) {
    createSchema();
    seedDatabase();
    backfillContrastClusterMemberEligibility();
    return;
  }

  try {
    applyLightweightSchemaMigrations();
    validateSchema();
    ensureIndexes();
    seedEmptyDevDatabase();
    backfillContrastClusterMemberEligibility();
  } catch (error) {
    if (!shouldRebuildDevDatabase(error)) {
      throw error;
    }

    rebuildDevDatabase(error);
    backfillContrastClusterMemberEligibility();
  }
}


function applyLightweightSchemaMigrations() {
  const wordColumns = getDb().prepare(`PRAGMA table_info(words)`).all() as Array<{ name: string }>;
  const hasWordsTable = wordColumns.length > 0;

  if (!hasWordsTable) {
    return;
  }

  const hasMeaningsJson = wordColumns.some((column) => column.name === 'meanings_json');
  if (!hasMeaningsJson) {
    getDb().exec(`ALTER TABLE words ADD COLUMN meanings_json TEXT NOT NULL DEFAULT '[]'`);
  }

  const hasPersonalNotes = wordColumns.some((column) => column.name === 'personal_notes');
  if (!hasPersonalNotes) {
    getDb().exec(`ALTER TABLE words ADD COLUMN personal_notes TEXT NOT NULL DEFAULT ''`);
  }

  getDb().exec(`
    CREATE TABLE IF NOT EXISTS app_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  ensureDefaultDailyNewWordLimit();

  getDb().exec(`
    CREATE TABLE IF NOT EXISTS user_word_priority (
      word_id TEXT PRIMARY KEY REFERENCES words(id) ON DELETE CASCADE,
      bump_count INTEGER NOT NULL DEFAULT 0,
      force_top INTEGER NOT NULL DEFAULT 0,
      priority_tier INTEGER NOT NULL DEFAULT 0,
      required_for_next_session INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
  `);

  ensureWordLookupAliasesSchema();

  getDb().exec(`
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

  getDb().exec(`
    CREATE TABLE IF NOT EXISTS daily_new_word_intake (
      day_key TEXT PRIMARY KEY,
      new_study_count INTEGER NOT NULL DEFAULT 0
    );
  `);

  getDb().exec(`
    CREATE TABLE IF NOT EXISTS word_study_admission_state (
      word_id TEXT PRIMARY KEY REFERENCES words(id) ON DELETE CASCADE,
      study_phase TEXT NOT NULL,
      earliest_next_study_at TEXT
    );
  `);

  getDb().exec(`
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

  getDb().exec(`
    CREATE TABLE IF NOT EXISTS review_session_summaries (
      session_id TEXT PRIMARY KEY,
      completed_at TEXT NOT NULL,
      day_key TEXT NOT NULL,
      completed_count INTEGER NOT NULL,
      failed_count INTEGER NOT NULL,
      active_duration_ms INTEGER NOT NULL DEFAULT 0
    );
  `);
  ensureReviewSessionSummariesActiveDurationSchema();

  getDb().exec(`
    CREATE TABLE IF NOT EXISTS study_sessions (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      processing_state TEXT NOT NULL,
      processed_at TEXT
    );
  `);

  getDb().exec(`
    CREATE TABLE IF NOT EXISTS study_attempt_events (
      id TEXT PRIMARY KEY,
      occurred_at TEXT NOT NULL,
      session_id TEXT NOT NULL REFERENCES study_sessions(id) ON DELETE CASCADE,
      session_action_id TEXT NOT NULL,
      session_event_sequence INTEGER NOT NULL,
      action_attempt_sequence INTEGER NOT NULL,
      action_kind TEXT NOT NULL,
      target_word_id TEXT NOT NULL REFERENCES words(id),
      sampled_skill_ids_json TEXT NOT NULL,
      response TEXT,
      outcome TEXT NOT NULL,
      rating TEXT,
      content_ref_json TEXT,
      metadata_json TEXT NOT NULL,
      projected_at TEXT
    );
  `);

  getDb().exec(`
    CREATE TABLE IF NOT EXISTS study_events (
      id TEXT PRIMARY KEY,
      occurred_at TEXT NOT NULL,
      session_id TEXT REFERENCES study_sessions(id) ON DELETE CASCADE,
      session_action_id TEXT,
      session_event_sequence INTEGER,
      event_type TEXT NOT NULL,
      target_word_id TEXT REFERENCES words(id),
      action_kind TEXT,
      sampled_skill_ids_json TEXT NOT NULL DEFAULT '[]',
      content_ref_json TEXT,
      payload_json TEXT NOT NULL,
      projected_at TEXT
    );
  `);

  getDb().exec(`
    CREATE TABLE IF NOT EXISTS word_skill_relevance (
      word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
      skill_id TEXT NOT NULL,
      relevance_state TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      source_event_id TEXT REFERENCES study_events(id) ON DELETE SET NULL,
      PRIMARY KEY (word_id, skill_id)
    );
  `);

  getDb().exec(`
    CREATE TABLE IF NOT EXISTS contrast_candidate_intake (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      target_word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
      source_event_id TEXT REFERENCES study_events(id) ON DELETE SET NULL,
      source_action_kind TEXT,
      source_content_ref_json TEXT,
      candidate_text TEXT,
      matched_word_id TEXT REFERENCES words(id) ON DELETE SET NULL,
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open'
    );
  `);

  getDb().exec(`
    CREATE TABLE IF NOT EXISTS study_content_feedback (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      target_word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
      action_kind TEXT NOT NULL,
      feedback_type TEXT NOT NULL,
      feedback_action TEXT NOT NULL DEFAULT 'reported',
      source_event_id TEXT REFERENCES study_events(id) ON DELETE SET NULL,
      note TEXT NOT NULL DEFAULT ''
    );
  `);
  ensureStudyContentFeedbackSchema();

  getDb().exec(`
    CREATE TABLE IF NOT EXISTS contrast_clusters (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS contrast_cluster_members (
      cluster_id TEXT NOT NULL REFERENCES contrast_clusters(id) ON DELETE CASCADE,
      word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
      nuance_note TEXT NOT NULL DEFAULT '',
      display_order INTEGER,
      PRIMARY KEY (cluster_id, word_id)
    );

    CREATE TABLE IF NOT EXISTS contrast_prompts (
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
  ensureReflectionSchema();
  ensureProductionCueSchema();

  const userPriorityColumns = getDb().prepare(`PRAGMA table_info(user_word_priority)`).all() as Array<{ name: string }>;
  const hasPriorityTier = userPriorityColumns.some((column) => column.name === 'priority_tier');
  if (!hasPriorityTier) {
    getDb().exec(`ALTER TABLE user_word_priority ADD COLUMN priority_tier INTEGER NOT NULL DEFAULT 0`);
    getDb().exec(`UPDATE user_word_priority SET priority_tier = CASE WHEN force_top != 0 THEN 1 ELSE 0 END`);
  }

  const hasRequiredForNextSession = userPriorityColumns.some((column) => column.name === 'required_for_next_session');
  if (!hasRequiredForNextSession) {
    getDb().exec(`ALTER TABLE user_word_priority ADD COLUMN required_for_next_session INTEGER NOT NULL DEFAULT 0`);
  }

  ensureWordLookupAliasesSchema();

  getDb().exec(`
    UPDATE user_word_priority
    SET priority_tier = 1
    WHERE force_top != 0
      AND priority_tier = 0
  `);

  backfillWordMeaningsFromWords();
}

function ensureStudyContentFeedbackSchema() {
  const columns = getDb().prepare(`PRAGMA table_info(study_content_feedback)`).all() as Array<{ name: string }>;
  if (columns.length === 0) {
    return;
  }

  const hasFeedbackAction = columns.some((column) => column.name === 'feedback_action');
  if (!hasFeedbackAction) {
    getDb().exec(`ALTER TABLE study_content_feedback ADD COLUMN feedback_action TEXT NOT NULL DEFAULT 'reported'`);
  }
}

function ensureWordLookupAliasesSchema() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS word_lookup_aliases (
      alias_text TEXT NOT NULL,
      normalized_alias TEXT NOT NULL,
      word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
      relation TEXT NOT NULL,
      source TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]',
      confidence REAL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (normalized_alias, word_id, source)
    );
  `);

  const columns = getDb().prepare(`PRAGMA table_info(word_lookup_aliases)`).all() as Array<{ name: string }>;
  const hasTagsJson = columns.some((column) => column.name === 'tags_json');
  if (!hasTagsJson) {
    getDb().exec(`ALTER TABLE word_lookup_aliases ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]'`);
  }

  migrateWordLookupAliasesPrimaryKey();
}

function migrateWordLookupAliasesPrimaryKey() {
  const columns = getDb().prepare(`PRAGMA table_info(word_lookup_aliases)`).all() as Array<{ name: string; pk: number }>;
  const primaryKeyColumns = columns
    .filter((column) => column.pk > 0)
    .sort((left, right) => left.pk - right.pk)
    .map((column) => column.name);

  if (primaryKeyColumns.join('\t') === 'normalized_alias\tword_id\tsource') {
    return;
  }

  getDb().exec('BEGIN');

  try {
    getDb().exec(`
      CREATE TABLE word_lookup_aliases_next (
        alias_text TEXT NOT NULL,
        normalized_alias TEXT NOT NULL,
        word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
        relation TEXT NOT NULL,
        source TEXT NOT NULL,
        tags_json TEXT NOT NULL DEFAULT '[]',
        confidence REAL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (normalized_alias, word_id, source)
      );

      INSERT OR IGNORE INTO word_lookup_aliases_next (
        alias_text,
        normalized_alias,
        word_id,
        relation,
        source,
        tags_json,
        confidence,
        created_at
      )
      SELECT
        alias_text,
        normalized_alias,
        word_id,
        relation,
        source,
        tags_json,
        confidence,
        created_at
      FROM word_lookup_aliases
      ORDER BY rowid ASC;

      DROP TABLE word_lookup_aliases;
      ALTER TABLE word_lookup_aliases_next RENAME TO word_lookup_aliases;
    `);
    getDb().exec('COMMIT');
  } catch (error) {
    getDb().exec('ROLLBACK');
    throw error;
  }
}

function migrateWordSkillStateLastStudiedAtNotNull() {
  const columns = getDb().prepare(`PRAGMA table_info(word_skill_state)`).all() as Array<{ name: string; notnull: number; pk: number }>;
  const lastStudiedAtColumn = columns.find((column) => column.name === 'last_studied_at');

  if (!lastStudiedAtColumn || lastStudiedAtColumn.notnull === 1 || lastStudiedAtColumn.pk !== 0) {
    return;
  }

  const nullCount = getDb()
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

  getDb().exec('BEGIN');

  try {
    getDb().exec(`
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

    getDb().exec('COMMIT');
  } catch (error) {
    getDb().exec('ROLLBACK');
    throw error;
  }
}

function backfillWordMeaningsFromWords() {
  const wordsWithoutMeanings = getDb()
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

  const insertMeaning = getDb().prepare(`
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

  getDb().exec('BEGIN');

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

    getDb().exec('COMMIT');
  } catch (error) {
    getDb().exec('ROLLBACK');
    throw error;
  }
}

function upsertWordStudyAdmissionState(
  wordId: string,
  studyPhase: WordStudyPhase,
  earliestNextStudyAt: string | null,
) {
  getDb().prepare(`
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

function initializeReviewSchedulerStateForWord(wordId: string, lastStudiedAt: string, nextDueAt: string | null) {
  for (const skillId of ['recognition', 'production'] as const) {
    upsertWordSkillState({
      wordId,
      skillId,
      enabled: true,
      intervalHours: 24,
      lastStudiedAt,
      nextDueAt,
      easeFactor: INITIAL_REVIEW_EASE_FACTOR,
    });
  }
}

function deleteStudySchedulerStateForWord(wordId: string) {
  getDb().prepare(`
    DELETE FROM word_skill_state
    WHERE word_id = ?
  `).run(wordId);

  getDb().prepare(`
    DELETE FROM word_study_admission_state
    WHERE word_id = ?
  `).run(wordId);
}

function getWordById(wordId: string): Word | null {
  const row = getDb()
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

function getContrastClusterContentById(clusterId: string): ContrastClusterContent {
  const cluster = getContrastClusterContent().find((candidate) => candidate.id === clusterId);
  if (!cluster) {
    throw new Error('Contrast cluster not found');
  }

  return cluster;
}

function normalizeContrastIntakeGroupSelector(input: ContrastIntakeGroupSelector): ContrastIntakeGroupSelector {
  const targetWordId = input.targetWordId.trim();
  assertNonEmptyString(targetWordId, 'Expected non-empty target word id');
  ensureWordExists(targetWordId);

  const matchedWordId = input.matchedWordId?.trim() ? input.matchedWordId.trim() : null;
  if (matchedWordId) {
    ensureWordExists(matchedWordId);
  }

  const candidateText = input.candidateText?.trim() ? normalizeContrastIntakeCandidateText(input.candidateText) : null;
  return {
    targetWordId,
    matchedWordId,
    candidateText,
  };
}

function normalizeContrastIntakeWordSelector(input: ContrastIntakeWordSelector): ContrastIntakeWordSelector {
  const targetWordId = input.targetWordId.trim();
  assertNonEmptyString(targetWordId, 'Expected non-empty target word id');
  ensureWordExists(targetWordId);
  return { targetWordId };
}

function normalizeCreateContrastIntakeClusterInput(input: CreateContrastIntakeClusterInput): CreateContrastIntakeClusterInput {
  const selector = normalizeContrastIntakeGroupSelector(input);
  const resolvedCandidateWordId = input.resolvedCandidateWordId.trim();
  assertNonEmptyString(resolvedCandidateWordId, 'Expected non-empty resolved candidate word id');
  ensureWordExists(resolvedCandidateWordId);

  if (resolvedCandidateWordId === selector.targetWordId) {
    throw new Error('Expected resolved candidate word to differ from target word');
  }

  const title = input.title.trim();
  assertNonEmptyString(title, 'Expected non-empty contrast cluster title');

  return {
    ...selector,
    resolvedCandidateWordId,
    extraMemberWordIds: normalizeExtraContrastIntakeMemberWordIds(input.extraMemberWordIds, [
      selector.targetWordId,
      resolvedCandidateWordId,
    ]),
    title,
    note: input.note?.trim() ?? '',
    targetNuanceNote: input.targetNuanceNote?.trim() ?? '',
    candidateNuanceNote: input.candidateNuanceNote?.trim() ?? '',
    prompt: normalizeContrastIntakePromptInput(input.prompt),
  };
}

function normalizeAddContrastIntakeToClusterInput(input: AddContrastIntakeToClusterInput): AddContrastIntakeToClusterInput {
  const selector = normalizeContrastIntakeGroupSelector(input);
  const clusterId = input.clusterId.trim();
  assertNonEmptyString(clusterId, 'Expected non-empty contrast cluster id');
  ensureContrastClusterExists(clusterId);

  const resolvedCandidateWordId = input.resolvedCandidateWordId.trim();
  assertNonEmptyString(resolvedCandidateWordId, 'Expected non-empty resolved candidate word id');
  ensureWordExists(resolvedCandidateWordId);

  if (resolvedCandidateWordId === selector.targetWordId) {
    throw new Error('Expected resolved candidate word to differ from target word');
  }

  return {
    ...selector,
    clusterId,
    resolvedCandidateWordId,
    extraMemberWordIds: normalizeExtraContrastIntakeMemberWordIds(input.extraMemberWordIds, [
      selector.targetWordId,
      resolvedCandidateWordId,
    ]),
    targetNuanceNote: input.targetNuanceNote?.trim() ?? '',
    candidateNuanceNote: input.candidateNuanceNote?.trim() ?? '',
    prompt: normalizeContrastIntakePromptInput(input.prompt),
  };
}

function normalizeExtraContrastIntakeMemberWordIds(
  wordIds: string[] | undefined,
  reservedWordIds: string[],
): string[] {
  if (!wordIds) {
    return [];
  }

  if (!Array.isArray(wordIds)) {
    throw new Error('Expected extra contrast member word ids array');
  }

  const reserved = new Set(reservedWordIds);
  const normalizedWordIds: string[] = [];
  const seen = new Set<string>();

  for (const wordId of wordIds) {
    const normalizedWordId = wordId.trim();
    assertNonEmptyString(normalizedWordId, 'Expected non-empty extra contrast member word id');
    ensureWordExists(normalizedWordId);

    if (reserved.has(normalizedWordId)) {
      throw new Error('Expected extra contrast member to differ from intake words');
    }

    if (!seen.has(normalizedWordId)) {
      normalizedWordIds.push(normalizedWordId);
      seen.add(normalizedWordId);
    }
  }

  return normalizedWordIds;
}

function normalizeAddContrastIntakePromptInput(input: AddContrastIntakePromptInput): AddContrastIntakePromptInput {
  const selector = normalizeContrastIntakeGroupSelector(input);
  const clusterId = input.clusterId.trim();
  assertNonEmptyString(clusterId, 'Expected non-empty contrast cluster id');
  ensureContrastClusterExists(clusterId);

  return {
    ...selector,
    clusterId,
    prompt: normalizeContrastIntakePromptInput(input.prompt),
  };
}

function normalizeContrastIntakePromptInput(input: ContrastIntakePromptInput): ContrastIntakePromptInput {
  const targetWordId = input.targetWordId.trim();
  const promptText = input.promptText.trim();
  assertNonEmptyString(targetWordId, 'Expected non-empty prompt target word id');
  assertNonEmptyString(promptText, 'Expected non-empty prompt text');

  return {
    targetWordId,
    promptText,
    explanation: input.explanation?.trim() ?? '',
  };
}

function updateContrastIntakeGroupStatusWithoutTransaction(
  selector: ContrastIntakeGroupSelector,
  status: ContrastCandidateIntake['status'],
) {
  const matchingRows = selectOpenContrastIntakeRowsForGroup(selector);
  if (matchingRows.length === 0) {
    throw new Error('Contrast intake group not found');
  }

  const update = getDb().prepare(`
    UPDATE contrast_candidate_intake
    SET status = ?
    WHERE id = ?
  `);

  for (const row of matchingRows) {
    update.run(status, row.id);
  }
}

function selectOpenContrastIntakeRowsForGroup(selector: ContrastIntakeGroupSelector): ContrastCandidateIntake[] {
  const normalizedSelector = normalizeContrastIntakeGroupSelector(selector);
  const rows = getContrastCandidateIntake().filter((row) => {
    if (row.status !== 'open' || row.targetWordId !== normalizedSelector.targetWordId) {
      return false;
    }

    if (normalizedSelector.matchedWordId) {
      return row.matchedWordId === normalizedSelector.matchedWordId;
    }

    return (
      row.matchedWordId === null &&
      normalizeContrastIntakeCandidateText(row.candidateText ?? '') === (normalizedSelector.candidateText ?? '')
    );
  });

  return rows;
}

function ensureContrastClusterMemberForIntakeWithoutTransaction({
  clusterId,
  wordId,
  nuanceNote,
}: {
  clusterId: string;
  wordId: string;
  nuanceNote: string;
}) {
  if (contrastClusterMemberExists(clusterId, wordId)) {
    enableContextualSelectionWithoutTransaction({
      wordId,
      updatedAt: new Date().toISOString(),
      sourceEventId: null,
    });
    return;
  }

  addContrastClusterMember({
    clusterId,
    wordId,
    nuanceNote,
    displayOrder: getNextContrastClusterMemberDisplayOrder(clusterId),
  });
}

function contrastClusterMemberExists(clusterId: string, wordId: string): boolean {
  const row = getDb()
    .prepare(`
      SELECT 1
      FROM contrast_cluster_members
      WHERE cluster_id = ?
        AND word_id = ?
      LIMIT 1
    `)
    .get(clusterId, wordId) as { '1': number } | undefined;

  return Boolean(row);
}

function hasContrastClusterMembership(wordId: string): boolean {
  const row = getDb().prepare(`
    SELECT 1
    FROM contrast_cluster_members
    WHERE word_id = ?
    LIMIT 1
  `).get(wordId) as { '1': number } | undefined;
  return Boolean(row);
}

function backfillContrastClusterMemberEligibility(): void {
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

function getNextContrastClusterMemberDisplayOrder(clusterId: string): number {
  const row = getDb()
    .prepare(`
      SELECT MAX(display_order) AS max_display_order
      FROM contrast_cluster_members
      WHERE cluster_id = ?
    `)
    .get(clusterId) as { max_display_order: number | null } | undefined;

  return (row?.max_display_order ?? 0) + 1;
}

function buildContrastIntakeGroupKey(selector: ContrastIntakeGroupSelector): string {
  const normalizedSelector = normalizeContrastIntakeGroupSelector(selector);
  if (normalizedSelector.matchedWordId) {
    return `${normalizedSelector.targetWordId}::word:${normalizedSelector.matchedWordId}`;
  }

  return `${normalizedSelector.targetWordId}::text:${normalizedSelector.candidateText ?? ''}`;
}

function normalizeContrastIntakeCandidateText(value: string): string {
  return value.trim().replace(/\s+/g, '');
}

function summarizeContrastIntakeCoverage({
  targetWordId,
  candidateWordIds,
  intakeWordIds,
  clusters,
}: {
  targetWordId: string;
  candidateWordIds: string[];
  intakeWordIds: string[];
  clusters: ContrastClusterContent[];
}): ContrastIntakeCoverage {
  const sharedClusters = clusters.filter((cluster) => {
    const memberIds = new Set(cluster.members.map((member) => member.wordId));
    return intakeWordIds.every((wordId) => memberIds.has(wordId));
  });
  const sharedClusterIds = sharedClusters.map((cluster) => cluster.id);
  const sharedClusterIdSet = new Set(sharedClusterIds);
  const sharedPrompts = clusters
    .filter((cluster) => sharedClusterIdSet.has(cluster.id))
    .flatMap((cluster) => cluster.prompts);
  const promptCountForTarget = sharedPrompts.filter((prompt) => prompt.targetWordId === targetWordId).length;
  const candidateWordIdSet = new Set(candidateWordIds);
  const promptCountForCandidate = sharedPrompts.filter((prompt) => candidateWordIdSet.has(prompt.targetWordId)).length;

  return {
    hasSharedCluster: sharedClusterIds.length > 0,
    sharedClusterIds,
    promptCountForTarget,
    promptCountForCandidate,
    usablePromptCount: promptCountForTarget + promptCountForCandidate,
  };
}

function summarizeClusterCompleteness(cluster: ContrastClusterContent): ContrastClusterCompletenessFlags {
  const hasAtLeastTwoMembers = cluster.members.length >= 2;
  const hasUsablePrompts = cluster.prompts.length > 0;
  return {
    hasAtLeastTwoMembers,
    hasUsablePrompts,
    incomplete: !hasAtLeastTwoMembers || !hasUsablePrompts,
  };
}

function countClusterSuggestedOverlap(cluster: ContrastClusterContent, suggestedWordIdSet: Set<string>): number {
  return cluster.members.filter((member) => suggestedWordIdSet.has(member.wordId)).length;
}

function mergeContrastClustersIntoDestination({
  destinationClusterId,
  sourceClusterIds,
}: {
  destinationClusterId: string;
  sourceClusterIds: string[];
}): void {
  const normalizedDestinationClusterId = destinationClusterId.trim();
  assertNonEmptyString(normalizedDestinationClusterId, 'Expected non-empty destination cluster id');
  ensureContrastClusterExists(normalizedDestinationClusterId);

  const normalizedSourceClusterIds = [...new Set(
    sourceClusterIds
      .map((clusterId) => clusterId.trim())
      .filter((clusterId) => clusterId.length > 0 && clusterId !== normalizedDestinationClusterId),
  )];
  if (normalizedSourceClusterIds.length === 0) {
    throw new Error('Expected at least one source cluster to merge');
  }

  normalizedSourceClusterIds.forEach(ensureContrastClusterExists);

  const destinationMembers = getContrastClusterMembers(normalizedDestinationClusterId);
  const destinationWordIds = new Set(destinationMembers.map((member) => member.wordId));
  let nextDisplayOrder = getNextContrastClusterDisplayOrder(destinationMembers);

  for (const sourceClusterId of normalizedSourceClusterIds) {
    const sourceMembers = getContrastClusterMembers(sourceClusterId);
    for (const member of sourceMembers) {
      if (destinationWordIds.has(member.wordId)) {
        continue;
      }

      addContrastClusterMember({
        clusterId: normalizedDestinationClusterId,
        wordId: member.wordId,
        nuanceNote: member.nuanceNote,
        displayOrder: nextDisplayOrder,
      });
      destinationWordIds.add(member.wordId);
      nextDisplayOrder += 1;
    }

    getDb().prepare(`
      UPDATE contrast_prompts
      SET cluster_id = ?
      WHERE cluster_id = ?
    `).run(normalizedDestinationClusterId, sourceClusterId);

    getDb().prepare(`
      DELETE FROM contrast_clusters
      WHERE id = ?
    `).run(sourceClusterId);
  }
}

function getNextContrastClusterDisplayOrder(members: ContrastClusterMember[]): number {
  const highestDisplayOrder = members.reduce<number>(
    (highest, member) => (member.displayOrder !== null ? Math.max(highest, member.displayOrder) : highest),
    0,
  );
  return Math.max(highestDisplayOrder, members.length) + 1;
}

function assertContrastIntakeRowsPresent(): never {
  throw new Error('Expected contrast intake rows');
}

function resolveContrastIntakeMatchedWords({
  candidateText,
  persistedMatchedWordId,
  wordsById,
}: {
  candidateText: string | null;
  persistedMatchedWordId: string | null;
  wordsById: Map<string, Word>;
}): Word[] {
  const matches = candidateText ? findWordsByHanzi(normalizeContrastIntakeCandidateText(candidateText)) : [];
  const persistedMatch = persistedMatchedWordId ? wordsById.get(persistedMatchedWordId) ?? null : null;
  if (persistedMatch && !matches.some((word) => word.id === persistedMatch.id)) {
    matches.push(persistedMatch);
  }
  return matches;
}

function ensureWordExists(wordId: string) {
  assertNonEmptyString(wordId, 'Expected non-empty word id');

  if (!getWordById(wordId)) {
    throw new Error('Word not found');
  }
}

function ensureContrastClusterExists(clusterId: string) {
  assertNonEmptyString(clusterId, 'Expected non-empty contrast cluster id');

  const row = getDb()
    .prepare(`
      SELECT id
      FROM contrast_clusters
      WHERE id = ?
    `)
    .get(clusterId) as { id: string } | undefined;

  if (!row) {
    throw new Error('Contrast cluster not found');
  }
}

function ensureContrastClusterMemberExists(clusterId: string, wordId: string) {
  assertNonEmptyString(clusterId, 'Expected non-empty contrast cluster id');
  assertNonEmptyString(wordId, 'Expected non-empty word id');

  const row = getDb()
    .prepare(`
      SELECT cluster_id
      FROM contrast_cluster_members
      WHERE cluster_id = ?
        AND word_id = ?
    `)
    .get(clusterId, wordId) as { cluster_id: string } | undefined;

  if (!row) {
    throw new Error('Contrast prompt target must be a cluster member');
  }
}

function getContrastPromptById(id: string): ContrastPrompt | null {
  assertNonEmptyString(id, 'Expected non-empty contrast prompt id');

  const row = getDb()
    .prepare(`
      SELECT
        id,
        cluster_id,
        target_word_id,
        prompt_text,
        explanation
      FROM contrast_prompts
      WHERE id = ?
    `)
    .get(id) as ContrastPromptRow | undefined;

  return row ? mapContrastPromptRow(row) : null;
}

function findWordsByHanzi(hanzi: string): Word[] {
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
      WHERE hanzi = ?
         OR traditional = ?
      ORDER BY status DESC, priority DESC, created_at ASC
    `)
    .all(hanzi, hanzi) as WordRow[];

  return rows.map(mapWordRow);
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

  getDb().close();

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

  setDb(openDatabase(dbPath));
  createSchema();
  seedDatabase();
}

function seedEmptyDevDatabase() {
  if (!config.seedSampleData) {
    return;
  }

  const counts = getDb()
    .prepare(`
      SELECT
        (SELECT COUNT(*) FROM words) AS word_count
    `)
    .get() as { word_count: number };

  if (counts.word_count === 0) {
    seedDatabase();
  }
}

function createSchema() {
  getDb().exec(`
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
      required_for_next_session INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE word_lookup_aliases (
      alias_text TEXT NOT NULL,
      normalized_alias TEXT NOT NULL,
      word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
      relation TEXT NOT NULL,
      source TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]',
      confidence REAL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (normalized_alias, word_id, source)
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
      failed_count INTEGER NOT NULL,
      active_duration_ms INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE study_sessions (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      processing_state TEXT NOT NULL,
      processed_at TEXT
    );

    CREATE TABLE study_attempt_events (
      id TEXT PRIMARY KEY,
      occurred_at TEXT NOT NULL,
      session_id TEXT NOT NULL REFERENCES study_sessions(id) ON DELETE CASCADE,
      session_action_id TEXT NOT NULL,
      session_event_sequence INTEGER NOT NULL,
      action_attempt_sequence INTEGER NOT NULL,
      action_kind TEXT NOT NULL,
      target_word_id TEXT NOT NULL REFERENCES words(id),
      sampled_skill_ids_json TEXT NOT NULL,
      response TEXT,
      outcome TEXT NOT NULL,
      rating TEXT,
      content_ref_json TEXT,
      metadata_json TEXT NOT NULL,
      projected_at TEXT
    );

    CREATE TABLE study_events (
      id TEXT PRIMARY KEY,
      occurred_at TEXT NOT NULL,
      session_id TEXT REFERENCES study_sessions(id) ON DELETE CASCADE,
      session_action_id TEXT,
      session_event_sequence INTEGER,
      event_type TEXT NOT NULL,
      target_word_id TEXT REFERENCES words(id),
      action_kind TEXT,
      sampled_skill_ids_json TEXT NOT NULL DEFAULT '[]',
      content_ref_json TEXT,
      payload_json TEXT NOT NULL,
      projected_at TEXT
    );

    CREATE TABLE word_skill_relevance (
      word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
      skill_id TEXT NOT NULL,
      relevance_state TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      source_event_id TEXT REFERENCES study_events(id) ON DELETE SET NULL,
      PRIMARY KEY (word_id, skill_id)
    );

    CREATE TABLE contrast_candidate_intake (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      target_word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
      source_event_id TEXT REFERENCES study_events(id) ON DELETE SET NULL,
      source_action_kind TEXT,
      source_content_ref_json TEXT,
      candidate_text TEXT,
      matched_word_id TEXT REFERENCES words(id) ON DELETE SET NULL,
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open'
    );

    CREATE TABLE study_content_feedback (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      target_word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
      action_kind TEXT NOT NULL,
      feedback_type TEXT NOT NULL,
      feedback_action TEXT NOT NULL DEFAULT 'reported',
      source_event_id TEXT REFERENCES study_events(id) ON DELETE SET NULL,
      note TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE contrast_clusters (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE contrast_cluster_members (
      cluster_id TEXT NOT NULL REFERENCES contrast_clusters(id) ON DELETE CASCADE,
      word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
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

  ensureReflectionSchema();
  ensureProductionCueSchema();
  ensureDefaultDailyNewWordLimit();
  ensureIndexes();
}

function ensureDefaultDailyNewWordLimit() {
  getDb().prepare(`
    INSERT OR IGNORE INTO app_metadata (
      key,
      value,
      updated_at
    ) VALUES ('daily_new_word_limit', ?, ?)
  `).run(String(DEFAULT_DAILY_NEW_WORD_LIMIT), new Date().toISOString());
}

function ensureIndexes() {
  getDb().exec(`
    CREATE INDEX IF NOT EXISTS idx_words_priority ON words(priority DESC, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_word_lookup_aliases_normalized_alias ON word_lookup_aliases(normalized_alias);
    CREATE INDEX IF NOT EXISTS idx_word_meanings_word_position ON word_meanings(word_id, position ASC);
    CREATE INDEX IF NOT EXISTS idx_user_word_priority_force_top ON user_word_priority(force_top DESC, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_user_word_priority_tier ON user_word_priority(priority_tier DESC, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_word_study_admission_next ON word_study_admission_state(earliest_next_study_at ASC);
    CREATE INDEX IF NOT EXISTS idx_word_skill_state_due ON word_skill_state(next_due_at ASC);
    CREATE INDEX IF NOT EXISTS idx_review_session_summaries_day ON review_session_summaries(day_key ASC);
    CREATE INDEX IF NOT EXISTS idx_study_attempt_events_session ON study_attempt_events(session_id ASC, session_event_sequence ASC);
    CREATE INDEX IF NOT EXISTS idx_study_attempt_events_projected ON study_attempt_events(projected_at ASC, session_id ASC);
    CREATE INDEX IF NOT EXISTS idx_study_events_session ON study_events(session_id ASC, session_event_sequence ASC);
    CREATE INDEX IF NOT EXISTS idx_study_events_projected ON study_events(projected_at ASC, occurred_at ASC);
    CREATE INDEX IF NOT EXISTS idx_word_skill_relevance_state ON word_skill_relevance(skill_id ASC, relevance_state ASC);
    CREATE INDEX IF NOT EXISTS idx_contrast_candidate_intake_status ON contrast_candidate_intake(status ASC, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_contrast_candidate_intake_target ON contrast_candidate_intake(target_word_id ASC, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_study_content_feedback_target ON study_content_feedback(target_type ASC, target_id ASC, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_study_content_feedback_word ON study_content_feedback(target_word_id ASC, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_contrast_cluster_members_word ON contrast_cluster_members(word_id ASC, cluster_id ASC);
    CREATE INDEX IF NOT EXISTS idx_contrast_prompts_cluster_target ON contrast_prompts(cluster_id ASC, target_word_id ASC);
    CREATE INDEX IF NOT EXISTS idx_contrast_prompts_target ON contrast_prompts(target_word_id ASC);
  `);
  ensureReflectionIndexes();
  ensureProductionCueIndexes();
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
  assertTableColumns('contrast_candidate_intake', [
    'id',
    'created_at',
    'target_word_id',
    'source_event_id',
    'source_action_kind',
    'source_content_ref_json',
    'candidate_text',
    'matched_word_id',
    'note',
    'status',
  ]);
  assertTableColumns('study_content_feedback', [
    'id',
    'created_at',
    'target_type',
    'target_id',
    'target_word_id',
    'action_kind',
    'feedback_type',
    'feedback_action',
    'source_event_id',
    'note',
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
  validateReflectionSchema();
  validateProductionCueSchema();
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
  const rows = getDb().prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string; notnull: number; pk: number }>;
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

  const seedData = withDevContrastSeedData(readSeedData() ?? buildSampleSeedData());

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
    INSERT INTO word_skill_state (
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
    effectivePriority: row.effective_priority,
    effectiveRank: row.effective_rank,
  };
}

function mapPrioritizedWordRowWithApproximateRank(
  row: WordRow & {
    bump_count: number;
    force_top: number;
    priority_tier: number;
    required_for_next_session: number;
    effective_priority: number;
  },
): PriorityWord {
  const bumpCount = row.bump_count;
  const forceTop = row.priority_tier === PRIORITY_TIER_TOP;
  const requiredForNextSession = row.required_for_next_session !== 0;
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
    requiredForNextSession,
    effectivePriority,
    effectiveRank,
  });
}

function buildPriorityWordFromParts({
  row,
  bumpCount,
  forceTop,
  requiredForNextSession,
  effectivePriority,
  effectiveRank,
}: {
  row: WordRow;
  bumpCount: number;
  forceTop: boolean;
  requiredForNextSession: boolean;
  effectivePriority: number;
  effectiveRank: number;
}): PriorityWord {
  return {
    word: mapWordRow(row),
    bumpCount,
    forceTop,
    requiredForNextSession,
    effectivePriority,
    effectiveRank,
  };
}

function mapReviewActionKindToStudySkill(actionKind: StudyActionKind): StudySkillId {
  switch (actionKind) {
    case 'recognition':
      return 'recognition';
    case 'production':
      return 'production';
    case 'contrast_selection':
      throw new Error('Cannot project contrast selection action as review scheduler state.');
    default:
      return assertUnreachableStudyActionKind(actionKind);
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

function getWordSkillState(wordId: string, skillId: StudySkillId): WordSkillState {
  const row = getDb()
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
      WHERE word_id = ?
        AND skill_id = ?
    `)
    .get(wordId, skillId) as WordSkillStateRow | undefined;

  if (!row) {
    throw new Error(`Word skill state not found for word "${wordId}" and skill "${skillId}"`);
  }

  return mapWordSkillStateRow(row);
}

function upsertWordSkillState(state: WordSkillState) {
  getDb().prepare(`
    INSERT INTO word_skill_state (
      word_id,
      skill_id,
      enabled,
      interval_hours,
      last_studied_at,
      next_due_at,
      ease_factor
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(word_id, skill_id) DO UPDATE SET
      enabled = excluded.enabled,
      interval_hours = excluded.interval_hours,
      last_studied_at = excluded.last_studied_at,
      next_due_at = excluded.next_due_at,
      ease_factor = excluded.ease_factor
  `).run(
    state.wordId,
    state.skillId,
    state.enabled ? 1 : 0,
    state.intervalHours,
    state.lastStudiedAt,
    state.nextDueAt,
    state.easeFactor,
  );
}

function mapStudySessionRow(row: StudySessionRow): StudySessionRecord {
  return {
    id: row.id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    processingState: row.processing_state,
    processedAt: row.processed_at,
  };
}

function mapStudyAttemptEventRow(row: StudyAttemptEventRow): StudyAttemptEvent {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    sessionId: row.session_id,
    sessionActionId: row.session_action_id,
    sessionEventSequence: row.session_event_sequence,
    actionAttemptSequence: row.action_attempt_sequence,
    actionKind: row.action_kind,
    targetWordId: row.target_word_id,
    sampledSkillIds: parseStudySkillIdsJson(row.sampled_skill_ids_json),
    response: row.response,
    outcome: row.outcome,
    rating: row.rating,
    contentRef: parseNullableContentRefJson(row.content_ref_json),
    metadata: parseMetadataJson(row.metadata_json),
  };
}

function mapStudyEventRow(row: StudyEventRow): StudyEvent {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    sessionId: row.session_id,
    sessionActionId: row.session_action_id,
    sessionEventSequence: row.session_event_sequence,
    eventType: row.event_type,
    targetWordId: row.target_word_id,
    actionKind: row.action_kind,
    sampledSkillIds: parseStudySkillIdsJson(row.sampled_skill_ids_json),
    contentRef: parseNullableContentRefJson(row.content_ref_json),
    payload: parsePayloadJson(row.payload_json),
    projectedAt: row.projected_at,
  };
}

function mapWordSkillRelevanceRow(row: WordSkillRelevanceRow): WordSkillRelevance {
  return {
    wordId: row.word_id,
    skillId: row.skill_id,
    relevanceState: row.relevance_state,
    updatedAt: row.updated_at,
    sourceEventId: row.source_event_id,
  };
}

function mapContrastCandidateIntakeRow(row: ContrastCandidateIntakeRow): ContrastCandidateIntake {
  return {
    id: row.id,
    createdAt: row.created_at,
    targetWordId: row.target_word_id,
    sourceEventId: row.source_event_id,
    sourceActionKind: row.source_action_kind,
    sourceContentRef: parseNullableContentRefJson(row.source_content_ref_json),
    candidateText: row.candidate_text,
    matchedWordId: row.matched_word_id,
    note: row.note,
    status: row.status,
  };
}

function mapStudyContentFeedbackRow(row: StudyContentFeedbackRow): StudyContentFeedback {
  return {
    id: row.id,
    createdAt: row.created_at,
    targetType: row.target_type,
    targetId: row.target_id,
    targetWordId: row.target_word_id,
    actionKind: row.action_kind,
    feedbackType: row.feedback_type,
    feedbackAction: row.feedback_action,
    sourceEventId: row.source_event_id,
    note: row.note,
  };
}

function mapContrastClusterRow(row: ContrastClusterRow): ContrastCluster {
  return {
    id: row.id,
    title: row.title,
    note: row.note,
  };
}

function mapContrastClusterMemberRow(row: ContrastClusterMemberRow): ContrastClusterMember {
  return {
    clusterId: row.cluster_id,
    wordId: row.word_id,
    nuanceNote: row.nuance_note,
    displayOrder: row.display_order,
  };
}

function mapContrastPromptRow(row: ContrastPromptRow): ContrastPrompt {
  return {
    id: row.id,
    clusterId: row.cluster_id,
    targetWordId: row.target_word_id,
    promptText: row.prompt_text,
    explanation: row.explanation,
  };
}

function assertStudySessionRecord(record: StudySessionRecord) {
  assertNonEmptyString(record.id, 'Expected non-empty study session id');
  assertIsoTimestamp(record.startedAt, 'Expected valid study session startedAt timestamp');

  if (record.endedAt !== null) {
    assertIsoTimestamp(record.endedAt, 'Expected valid study session endedAt timestamp');
  }

  if (!isStudySessionProcessingState(record.processingState)) {
    throw new Error(`Invalid study session processing state "${String(record.processingState)}"`);
  }

  if (record.processedAt !== null) {
    assertIsoTimestamp(record.processedAt, 'Expected valid study session processedAt timestamp');
  }
}

function assertStudyAttemptEvent(event: StudyAttemptEvent) {
  assertNonEmptyString(event.id, 'Expected non-empty study attempt event id');
  assertIsoTimestamp(event.occurredAt, 'Expected valid study attempt event occurredAt timestamp');
  assertNonEmptyString(event.sessionId, 'Expected non-empty study attempt event sessionId');
  assertNonEmptyString(event.sessionActionId, 'Expected non-empty study attempt event sessionActionId');
  assertPositiveInteger(event.sessionEventSequence, 'Expected positive integer sessionEventSequence');
  assertPositiveInteger(event.actionAttemptSequence, 'Expected positive integer actionAttemptSequence');

  if (!isStudyActionKind(event.actionKind)) {
    throw new Error(`Invalid study attempt action kind "${String(event.actionKind)}"`);
  }

  assertNonEmptyString(event.targetWordId, 'Expected non-empty study attempt event targetWordId');

  if (!Array.isArray(event.sampledSkillIds) || event.sampledSkillIds.length === 0) {
    throw new Error('Expected at least one sampled skill id');
  }

  for (const skillId of event.sampledSkillIds) {
    if (!isStudySkillId(skillId)) {
      throw new Error(`Invalid sampled skill id "${String(skillId)}"`);
    }
  }

  if (event.response !== null && typeof event.response !== 'string') {
    throw new Error('Expected study attempt response to be a string or null');
  }

  if (event.outcome !== 'correct' && event.outcome !== 'incorrect') {
    throw new Error(`Invalid study attempt outcome "${String(event.outcome)}"`);
  }

  if (event.rating !== null && !isReviewRating(event.rating)) {
    throw new Error(`Invalid study attempt rating "${String(event.rating)}"`);
  }

  assertContentRef(event.contentRef);

  if (!isPlainRecord(event.metadata)) {
    throw new Error('Expected study attempt metadata to be an object');
  }
}

function assertStudyManagementActionInput(input: RecordStudyManagementActionInput) {
  if (!isPlainRecord(input)) {
    throw new Error('Expected study management action input');
  }

  assertNonEmptyString(input.sessionId, 'Expected non-empty session id');
  assertNonEmptyString(input.sessionActionId, 'Expected non-empty session action id');
  assertNonEmptyString(input.targetWordId, 'Expected non-empty target word id');

  if (input.actionKind !== 'production' && input.actionKind !== 'contrast_selection') {
    throw new Error('Expected production or contrast selection action kind');
  }

  if (!Array.isArray(input.sampledSkillIds) || input.sampledSkillIds.length === 0) {
    throw new Error('Expected at least one sampled skill id');
  }

  for (const skillId of input.sampledSkillIds) {
    if (!isStudySkillId(skillId)) {
      throw new Error(`Invalid sampled skill id "${String(skillId)}"`);
    }
  }

  assertContentRef(input.contentRef);

  if (!isStudyManagementActionKind(input.managementAction)) {
    throw new Error(`Invalid study management action "${String(input.managementAction)}"`);
  }

  if (input.note !== undefined && typeof input.note !== 'string') {
    throw new Error('Expected note to be a string when provided');
  }

  if (input.candidateText !== undefined && input.candidateText !== null && typeof input.candidateText !== 'string') {
    throw new Error('Expected candidateText to be a string or null when provided');
  }

  assertStudyManagementActionMatchesActionKind(input);
}

function assertStudyManagementActionMatchesActionKind(input: RecordStudyManagementActionInput) {
  if (input.actionKind === 'production') {
    if (!input.sampledSkillIds.includes('production')) {
      throw new Error('Expected production management action to sample production');
    }

    if (
      input.managementAction !== 'suppress_skill' &&
      input.managementAction !== 'add_contrast_candidate' &&
      input.managementAction !== 'suppress_skill_and_add_contrast_candidate' &&
      input.managementAction !== 'bad_prompt'
    ) {
      throw new Error('Invalid production management action');
    }

    return;
  }

  if (!input.sampledSkillIds.includes('contextual_selection')) {
    throw new Error('Expected contrast management action to sample contextual selection');
  }

  if (input.managementAction !== 'bad_prompt') {
    throw new Error('Invalid contrast management action');
  }
}

function assertReviewAttemptCommitIntent(commitIntent: ReviewAttemptCommitIntent) {
  if (!isPlainRecord(commitIntent)) {
    throw new Error('Expected review attempt commit intent');
  }

  if (commitIntent.type !== 'commit-review-action-session') {
    throw new Error('Expected commit-review-action-session commit intent');
  }

  assertNonEmptyString(commitIntent.sessionActionId, 'Expected non-empty session action id');
  assertNonEmptyString(commitIntent.targetWordId, 'Expected non-empty target word id');

  if (commitIntent.actionKind !== 'recognition' && commitIntent.actionKind !== 'production') {
    throw new Error('Expected recognition or production review action kind');
  }

  if (!Array.isArray(commitIntent.sampledSkillIds) || commitIntent.sampledSkillIds.length === 0) {
    throw new Error('Expected at least one sampled skill id');
  }

  for (const skillId of commitIntent.sampledSkillIds) {
    if (!isStudySkillId(skillId)) {
      throw new Error(`Invalid sampled skill id "${String(skillId)}"`);
    }
  }

  if (!Number.isInteger(commitIntent.failureCount) || commitIntent.failureCount < 0) {
    throw new Error('Expected non-negative integer failureCount');
  }

  if (commitIntent.terminalRating !== null && !isReviewPassRating(commitIntent.terminalRating)) {
    throw new Error('Invalid terminal rating');
  }
}

function assertContrastSelectionCommitIntent(commitIntent: ContrastSelectionCommitIntent) {
  if (!isPlainRecord(commitIntent)) {
    throw new Error('Expected contrast selection commit intent');
  }

  if (commitIntent.type !== 'commit-contrast-selection-action-session') {
    throw new Error('Expected commit-contrast-selection-action-session commit intent');
  }

  assertNonEmptyString(commitIntent.sessionActionId, 'Expected non-empty session action id');
  assertNonEmptyString(commitIntent.targetWordId, 'Expected non-empty target word id');

  if (commitIntent.actionKind !== 'contrast_selection') {
    throw new Error('Expected contrast_selection action kind');
  }

  if (!stringArraysEqual(commitIntent.sampledSkillIds, ['contextual_selection'])) {
    throw new Error('Expected contrast selection commit to sample contextual_selection');
  }

  assertNonEmptyString(commitIntent.selectedWordId, 'Expected non-empty selectedWordId');
  assertNonEmptyString(commitIntent.promptTargetWordId, 'Expected non-empty promptTargetWordId');

  if (!Array.isArray(commitIntent.choiceWordIds) || commitIntent.choiceWordIds.length < 2) {
    throw new Error('Expected at least two contrast choice word ids');
  }

  for (const choiceWordId of commitIntent.choiceWordIds) {
    assertNonEmptyString(choiceWordId, 'Expected non-empty contrast choice word id');
  }

  if (!commitIntent.choiceWordIds.includes(commitIntent.selectedWordId)) {
    throw new Error('Expected selectedWordId to be one of the contrast choices');
  }

  if (!commitIntent.choiceWordIds.includes(commitIntent.promptTargetWordId)) {
    throw new Error('Expected promptTargetWordId to be one of the contrast choices');
  }

  if (!isReviewRating(commitIntent.rating)) {
    throw new Error('Invalid contrast selection rating');
  }

  const selectedCorrect = commitIntent.selectedWordId === commitIntent.promptTargetWordId;
  if (selectedCorrect && !isReviewPassRating(commitIntent.rating)) {
    throw new Error('Expected correct contrast selection rating to be hard, good, or easy');
  }

  if (!selectedCorrect && commitIntent.rating !== 'forgot') {
    throw new Error('Expected incorrect contrast selection rating to be forgot');
  }

  if (typeof commitIntent.practiceMore !== 'boolean') {
    throw new Error('Expected boolean practiceMore');
  }
}

function assertReviewAttemptBatchMatchesCommitIntent(
  events: StudyAttemptEvent[],
  commitIntent: ReviewAttemptCommitIntent,
) {
  const firstEvent = events[0] ?? assertAttemptEventBatchNotEmpty();

  if (
    firstEvent.sessionActionId !== commitIntent.sessionActionId ||
    firstEvent.targetWordId !== commitIntent.targetWordId ||
    firstEvent.actionKind !== commitIntent.actionKind
  ) {
    throw new Error('Accepted attempt events do not match supplied review action intent');
  }

  for (const event of events) {
    if (!stringArraysEqual(event.sampledSkillIds, commitIntent.sampledSkillIds)) {
      throw new Error('Accepted attempt events do not match supplied review action intent');
    }
  }
}

function assertContrastSelectionAttemptMatchesCommitIntent(
  event: StudyAttemptEvent,
  commitIntent: ContrastSelectionCommitIntent,
) {
  if (
    event.sessionActionId !== commitIntent.sessionActionId ||
    event.targetWordId !== commitIntent.targetWordId ||
    event.actionKind !== 'contrast_selection'
  ) {
    throw new Error('Accepted contrast attempt event does not match supplied contrast action intent');
  }

  if (!stringArraysEqual(event.sampledSkillIds, commitIntent.sampledSkillIds)) {
    throw new Error('Accepted contrast attempt event does not match supplied contrast action intent');
  }

  if (event.contentRef?.type !== 'contrast_prompt') {
    throw new Error('Expected contrast attempt event to reference a contrast prompt');
  }

  if (
    event.response !== commitIntent.selectedWordId ||
    event.rating !== commitIntent.rating ||
    event.outcome !== (commitIntent.selectedWordId === commitIntent.promptTargetWordId ? 'correct' : 'incorrect')
  ) {
    throw new Error('Accepted contrast attempt event does not match supplied contrast action intent');
  }

  if (
    event.metadata.promptTargetWordId !== commitIntent.promptTargetWordId ||
    event.metadata.practiceMore !== commitIntent.practiceMore ||
    !unknownStringArraysEqual(event.metadata.choiceWordIds, commitIntent.choiceWordIds)
  ) {
    throw new Error('Accepted contrast attempt event does not match supplied contrast action intent');
  }
}

function assertDerivedReviewCommitMatchesIntent(
  derivedCommitFields: ReviewCommitFields,
  commitIntent: ReviewAttemptCommitIntent,
) {
  if (
    derivedCommitFields.failureCount !== commitIntent.failureCount ||
    derivedCommitFields.terminalRating !== commitIntent.terminalRating
  ) {
    throw new Error('Accepted attempt events do not match supplied review commit intent');
  }
}

function assertAttemptEventBatchNotEmpty(): never {
  throw new Error('Expected at least one accepted attempt event');
}

function stringArraysEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function unknownStringArraysEqual(left: unknown, right: string[]) {
  return Array.isArray(left) &&
    left.length === right.length &&
    left.every((value, index) => typeof value === 'string' && value === right[index]);
}

function assertContentRef(contentRef: StudyContentRef | null) {
  if (contentRef === null) {
    return;
  }

  if (contentRef.type !== 'contrast_prompt' && contentRef.type !== 'example_sentence') {
    throw new Error(`Invalid study content ref type "${String(contentRef.type)}"`);
  }

  assertNonEmptyString(contentRef.id, 'Expected non-empty study content ref id');
}

function assertPersistedStudySession(sessionId: string): never {
  throw new Error(`Failed to persist study session "${sessionId}"`);
}

function parseStudySkillIdsJson(raw: string): StudySkillId[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed) || parsed.some((value) => !isStudySkillId(value))) {
    throw new Error(`Invalid study skill id list: ${raw}`);
  }

  return parsed;
}

function parseNullableContentRefJson(raw: string | null): StudyContentRef | null {
  if (raw === null) {
    return null;
  }

  const parsed = JSON.parse(raw) as unknown;
  if (!isContentRef(parsed)) {
    throw new Error(`Invalid study content ref: ${raw}`);
  }

  return parsed;
}

function parseMetadataJson(raw: string): Record<string, unknown> {
  const parsed = JSON.parse(raw) as unknown;
  if (!isPlainRecord(parsed)) {
    throw new Error(`Invalid study attempt metadata: ${raw}`);
  }

  return parsed;
}

function parsePayloadJson(raw: string): Record<string, unknown> {
  const parsed = JSON.parse(raw) as unknown;
  if (!isPlainRecord(parsed)) {
    throw new Error(`Invalid study event payload: ${raw}`);
  }

  return parsed;
}

function mapStudyManagementActionToEventType(action: StudyManagementActionKind): StudyEventType {
  switch (action) {
    case 'suppress_skill':
      return 'skill_relevance_changed';
    case 'add_contrast_candidate':
      return 'contrast_candidate_requested';
    case 'suppress_skill_and_add_contrast_candidate':
      return 'skill_relevance_changed_with_contrast_candidate';
    case 'bad_prompt':
      return 'bad_prompt_reported';
    default:
      return assertUnreachableStudyManagementAction(action);
  }
}

function getManagedSkillId(actionKind: Extract<StudyActionKind, 'production' | 'contrast_selection'>): StudySkillId {
  switch (actionKind) {
    case 'production':
      return 'production';
    case 'contrast_selection':
      return 'contextual_selection';
    default:
      return assertUnreachableStudyActionKind(actionKind);
  }
}

function isContentRef(value: unknown): value is StudyContentRef {
  return (
    isPlainRecord(value) &&
    (value.type === 'contrast_prompt' || value.type === 'example_sentence') &&
    typeof value.id === 'string' &&
    value.id.length > 0
  );
}

function getSessionItemBucketsWithWords(studyDayKey: string): SessionStudyItemBuckets {
  const now = new Date().toISOString();
  const today = getTodayKey();
  const remainingDailyNewWordSlots = getRemainingDailyNewWordSlots(studyDayKey);
  const reviewRows = getReviewSessionStudyItems(now);

  const learningRows = getDb()
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
      WHERE words.status = 'learning'
        AND (words.last_learning_covered_on IS NULL OR words.last_learning_covered_on != ?)
      ORDER BY words.created_at ASC, words.id ASC
    `)
    .all(today) as WordRow[];

  const unstudiedRows = getDb()
    .prepare(`
      WITH ranked_unstudied AS (
        SELECT
          words.id,
          words.priority AS base_priority,
          words.created_at,
          COALESCE(user_word_priority.bump_count, 0) AS bump_count,
          COALESCE(user_word_priority.force_top, 0) AS force_top,
          COALESCE(user_word_priority.priority_tier, 0) AS priority_tier,
          COALESCE(user_word_priority.required_for_next_session, 0) AS required_for_next_session,
          words.priority
            + COALESCE(user_word_priority.bump_count, 0) * ${PRIORITY_BUMP_UNIT} AS effective_priority
        FROM words
        LEFT JOIN user_word_priority ON user_word_priority.word_id = words.id
        WHERE words.status = 'unstudied'
      ),
      normal_selected AS (
        SELECT
          id,
          base_priority,
          created_at,
          priority_tier,
          effective_priority
        FROM ranked_unstudied
        ORDER BY
          priority_tier DESC,
          effective_priority DESC,
          base_priority DESC,
          created_at ASC
        LIMIT ?
      ),
      required_overflow AS (
        SELECT
          id,
          base_priority,
          created_at,
          priority_tier,
          effective_priority
        FROM ranked_unstudied
        WHERE required_for_next_session != 0
          AND priority_tier >= ${PRIORITY_TIER_REGULAR}
      ),
      selected_unstudied AS (
        SELECT * FROM normal_selected
        UNION
        SELECT * FROM required_overflow
      )
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
        words.last_learning_covered_on
      FROM words
      INNER JOIN selected_unstudied ON selected_unstudied.id = words.id
      ORDER BY
        selected_unstudied.priority_tier DESC,
        selected_unstudied.effective_priority DESC,
        words.priority DESC,
        words.created_at ASC,
        words.id ASC
    `)
    .all(remainingDailyNewWordSlots) as WordRow[];

  return {
    review: reviewRows,
    learning: learningRows.map(mapWordRow),
    unstudied: unstudiedRows.map(mapWordRow),
  };
}

function getReviewSessionStudyItems(now: string): SessionStudyItem[] {
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
        words.status,
        words.priority,
        words.created_at,
        words.learning_streak,
        words.last_learning_success_on,
        words.last_learning_covered_on,
        word_skill_state.skill_id,
        word_skill_state.enabled AS skill_enabled,
        word_skill_state.interval_hours AS skill_interval_hours,
        word_skill_state.last_studied_at AS skill_last_studied_at,
        word_skill_state.next_due_at AS skill_next_due_at,
        word_skill_state.ease_factor AS skill_ease_factor,
        word_study_admission_state.earliest_next_study_at,
        word_skill_relevance.relevance_state AS skill_relevance_state
      FROM word_skill_state
      INNER JOIN words ON words.id = word_skill_state.word_id
      INNER JOIN word_study_admission_state
        ON word_study_admission_state.word_id = word_skill_state.word_id
       AND word_study_admission_state.study_phase = 'review'
      LEFT JOIN word_skill_relevance
        ON word_skill_relevance.word_id = word_skill_state.word_id
       AND word_skill_relevance.skill_id = word_skill_state.skill_id
      WHERE words.status = 'review'
        AND word_skill_state.enabled != 0
        AND word_skill_state.skill_id IN ('recognition', 'production', 'contextual_selection')
        AND (
          word_study_admission_state.earliest_next_study_at IS NULL
          OR word_study_admission_state.earliest_next_study_at <= ?
        )
      ORDER BY words.id ASC, word_skill_state.skill_id ASC
    `)
    .all(now) as ReviewSessionItemWithSkillRow[];

  const bestCandidateByWordId = new Map<string, ReviewSessionItemCandidate>();
  const generatedPromptFeedback = getGeneratedPromptFeedbackState();
  const blockedContrastPromptIds = getBlockedContrastPromptIds();

  for (const row of rows) {
    if (!isReviewSkillCandidateAllowedByRelevancePolicy(row, generatedPromptFeedback)) {
      continue;
    }

    const content = getReviewSkillContentIfAvailable(row, blockedContrastPromptIds);
    if (content === undefined) {
      continue;
    }

    if (row.skill_interval_hours <= 0) {
      throw new Error(
        `Session composition invariant violated: word "${row.id}" skill "${row.skill_id}" has non-positive intervalHours.`,
      );
    }

    const elapsedHours = getElapsedHours(row.skill_last_studied_at, now);
    const urgency = elapsedHours / row.skill_interval_hours;
    if (urgency < 1) {
      continue;
    }

    const candidate: ReviewSessionItemCandidate = {
      item: mapReviewSessionItemWithSkillRow(row, content),
      wordId: row.id,
      skillId: row.skill_id,
      urgency,
      nextDueAt: row.skill_next_due_at,
    };
    const currentBest = bestCandidateByWordId.get(candidate.wordId);

    if (!currentBest || compareReviewSessionItemCandidates(candidate, currentBest) < 0) {
      bestCandidateByWordId.set(candidate.wordId, candidate);
    }
  }

  return dedupeContrastChoiceSets([...bestCandidateByWordId.values()]
    .sort(compareReviewSessionItemCandidates))
    .map((candidate) => candidate.item);
}

function dedupeContrastChoiceSets(candidates: ReviewSessionItemCandidate[]): ReviewSessionItemCandidate[] {
  const seenContrastChoiceSetKeys = new Set<string>();
  const selected: ReviewSessionItemCandidate[] = [];

  for (const candidate of candidates) {
    const contrastSelection = candidate.item.contrastSelection;
    if (candidate.item.actionKind === 'contrast_selection' && contrastSelection) {
      const choiceSetKey = [
        contrastSelection.clusterId,
        ...contrastSelection.choices.map((choice) => choice.word.id).sort(),
      ].join('/');

      if (seenContrastChoiceSetKeys.has(choiceSetKey)) {
        continue;
      }

      seenContrastChoiceSetKeys.add(choiceSetKey);
    }

    selected.push(candidate);
  }

  return selected;
}

function isReviewSkillCandidateAllowedByRelevancePolicy(
  row: ReviewSessionItemWithSkillRow,
  generatedPromptFeedback: GeneratedPromptFeedbackState,
) {
  if (row.skill_relevance_state === 'suppressed') {
    return false;
  }

  if (row.skill_id === 'production' && generatedPromptFeedback.badDefinitionBasedProductionPromptWordIds.has(row.id)) {
    return false;
  }

  return true;
}

function getReviewSkillContentIfAvailable(
  row: ReviewSessionItemWithSkillRow,
  blockedContrastPromptIds: Set<string>,
): { contentRef: StudyContentRef | null; contrastSelection: ContrastSelectionContent | null } | undefined {
  if (row.skill_id === 'contextual_selection') {
    if (row.skill_relevance_state !== 'normal') {
      return undefined;
    }
    const contrastSelection = getEligibleContrastSelectionContentForScheduledWord(row.id, blockedContrastPromptIds);
    return contrastSelection === null
      ? undefined
      : {
          contentRef: { type: 'contrast_prompt', id: contrastSelection.prompt.id },
          contrastSelection,
        };
  }

  return {
    contentRef: null,
    contrastSelection: null,
  };
}

type GeneratedPromptFeedbackState = {
  badDefinitionBasedProductionPromptWordIds: Set<string>;
};

function getGeneratedPromptFeedbackState(): GeneratedPromptFeedbackState {
  const badDefinitionBasedProductionPromptWordIds = new Set<string>();

  for (const feedback of getStudyContentFeedback()) {
    if (
      feedback.targetType !== 'generated_prompt' ||
      feedback.targetId !== 'definition_based_production' ||
      feedback.actionKind !== 'production' ||
      feedback.feedbackType !== 'bad_prompt'
    ) {
      continue;
    }

    if (feedback.feedbackAction === 'reported') {
      badDefinitionBasedProductionPromptWordIds.add(feedback.targetWordId);
    } else {
      badDefinitionBasedProductionPromptWordIds.delete(feedback.targetWordId);
    }
  }

  return {
    badDefinitionBasedProductionPromptWordIds,
  };
}

function getEligibleContrastSelectionContentForScheduledWord(
  wordId: string,
  blockedContrastPromptIds: Set<string>,
): ContrastSelectionContent | null {
  const candidates = getEligibleContrastDistractorPromptCandidatesForScheduledWord(wordId, blockedContrastPromptIds);
  const selectedCandidate = randomArrayElement(candidates);

  if (!selectedCandidate) {
    return null;
  }

  const scheduledPromptRows = selectedCandidate.candidatePrompts.filter((prompt) => prompt.targetWordId === wordId);
  const distractorPromptRows = selectedCandidate.candidatePrompts.filter((prompt) => prompt.targetWordId === selectedCandidate.distractorWordId);
  const selectedPrompt = randomArrayElement(selectedCandidate.candidatePrompts);

  if (!selectedPrompt) {
    return null;
  }

  const scheduledChoice = getContrastChoice(selectedCandidate.clusterId, wordId);
  const distractorChoice = getContrastChoice(selectedCandidate.clusterId, selectedCandidate.distractorWordId);

  if (!scheduledChoice || !distractorChoice) {
    return null;
  }

  const choices = [scheduledChoice, distractorChoice]
    .sort((left, right) => left.word.hanzi.localeCompare(right.word.hanzi, 'zh-Hans-CN'));

  if (choices.length < 2) {
    return null;
  }

  return {
    clusterId: selectedCandidate.clusterId,
    clusterTitle: selectedCandidate.clusterTitle,
    clusterNote: selectedCandidate.clusterNote,
    scheduledWordId: wordId,
    promptTargetWordId: selectedPrompt.targetWordId,
    prompt: {
      id: selectedPrompt.id,
      clusterId: selectedCandidate.clusterId,
      targetWordId: selectedPrompt.targetWordId,
      promptText: selectedPrompt.promptText,
      explanation: selectedPrompt.explanation,
    },
    choices,
  };
}

function randomArrayElement<T>(values: T[]): T | undefined {
  if (values.length === 0) {
    return undefined;
  }

  return values[Math.floor(Math.random() * values.length)];
}

type ContrastPromptCandidate = {
  id: string;
  targetWordId: string;
  promptText: string;
  explanation: string;
};

type ContrastDistractorPromptCandidate = {
  clusterId: string;
  clusterTitle: string;
  clusterNote: string;
  distractorWordId: string;
  candidatePrompts: ContrastPromptCandidate[];
};

function getEligibleContrastDistractorPromptCandidatesForScheduledWord(
  wordId: string,
  blockedPromptIds: Set<string>,
): ContrastDistractorPromptCandidate[] {
  const rows = getDb()
    .prepare(`
      SELECT
        contrast_clusters.id AS cluster_id,
        contrast_clusters.title AS cluster_title,
        contrast_clusters.note AS cluster_note,
        sibling_member.word_id AS distractor_word_id,
        contrast_prompts.id AS prompt_id,
        contrast_prompts.target_word_id AS prompt_target_word_id,
        contrast_prompts.prompt_text,
        contrast_prompts.explanation
      FROM contrast_cluster_members AS scheduled_member
      INNER JOIN contrast_clusters
        ON contrast_clusters.id = scheduled_member.cluster_id
      INNER JOIN contrast_cluster_members AS sibling_member
        ON sibling_member.cluster_id = scheduled_member.cluster_id
       AND sibling_member.word_id != scheduled_member.word_id
      LEFT JOIN contrast_prompts
        ON contrast_prompts.cluster_id = scheduled_member.cluster_id
       AND contrast_prompts.target_word_id IN (scheduled_member.word_id, sibling_member.word_id)
      WHERE scheduled_member.word_id = ?
      ORDER BY
        contrast_clusters.id ASC,
        sibling_member.display_order IS NULL ASC,
        sibling_member.display_order ASC,
        sibling_member.word_id ASC,
        CASE WHEN contrast_prompts.target_word_id = scheduled_member.word_id THEN 0 ELSE 1 END,
        contrast_prompts.id ASC
    `)
    .all(wordId) as Array<{
      cluster_id: string;
      cluster_title: string;
      cluster_note: string;
      distractor_word_id: string;
      prompt_id: string | null;
      prompt_target_word_id: string | null;
      prompt_text: string | null;
      explanation: string | null;
    }>;

  const candidatesByKey = new Map<string, ContrastDistractorPromptCandidate>();

  for (const row of rows) {
    const key = `${row.cluster_id}/${row.distractor_word_id}`;
    const candidate = candidatesByKey.get(key) ?? {
      clusterId: row.cluster_id,
      clusterTitle: row.cluster_title,
      clusterNote: row.cluster_note,
      distractorWordId: row.distractor_word_id,
      candidatePrompts: [],
    };

    if (
      row.prompt_id &&
      row.prompt_target_word_id &&
      row.prompt_text !== null &&
      row.explanation !== null &&
      !blockedPromptIds.has(row.prompt_id)
    ) {
      candidate.candidatePrompts.push({
        id: row.prompt_id,
        targetWordId: row.prompt_target_word_id,
        promptText: row.prompt_text,
        explanation: row.explanation,
      });
    }

    candidatesByKey.set(key, candidate);
  }

  return [...candidatesByKey.values()].filter((candidate) => candidate.candidatePrompts.length > 0);
}

function getContrastChoice(clusterId: string, wordId: string): ContrastSelectionContent['choices'][number] | null {
  const member = getDb()
    .prepare(`
      SELECT
        cluster_id,
        word_id,
        nuance_note,
        display_order
      FROM contrast_cluster_members
      WHERE cluster_id = ?
        AND word_id = ?
    `)
    .get(clusterId, wordId) as ContrastClusterMemberRow | undefined;
  const word = getWordById(wordId);

  return member && word
    ? {
        word,
        nuanceNote: member.nuance_note,
      }
    : null;
}

function mapReviewSessionItemWithSkillRow(
  row: ReviewSessionItemWithSkillRow,
  content: { contentRef: StudyContentRef | null; contrastSelection: ContrastSelectionContent | null },
): SessionStudyItem {
  const word = mapWordRow(row);
  return buildReviewSessionStudyItem({
    wordSkillState: {
      wordId: row.id,
      skillId: row.skill_id,
      enabled: row.skill_enabled !== 0,
      intervalHours: row.skill_interval_hours,
      lastStudiedAt: row.skill_last_studied_at,
      nextDueAt: row.skill_next_due_at,
      easeFactor: row.skill_ease_factor,
    },
    word,
    contentRef: content.contentRef,
    contrastSelection: content.contrastSelection,
  });
}

function compareReviewSessionItemCandidates(
  left: ReviewSessionItemCandidate,
  right: ReviewSessionItemCandidate,
) {
  const urgencyComparison = right.urgency - left.urgency;
  if (Math.abs(urgencyComparison) > REVIEW_SKILL_URGENCY_TIE_EPSILON) {
    return urgencyComparison;
  }

  const dueComparison = compareNullableIsoTimestamps(left.nextDueAt, right.nextDueAt);
  if (dueComparison !== 0) {
    return dueComparison;
  }

  const wordComparison = left.wordId.localeCompare(right.wordId);
  if (wordComparison !== 0) {
    return wordComparison;
  }

  return left.skillId.localeCompare(right.skillId);
}

function compareNullableIsoTimestamps(left: string | null, right: string | null) {
  if (left === right) {
    return 0;
  }

  if (left === null) {
    return 1;
  }

  if (right === null) {
    return -1;
  }

  return left.localeCompare(right);
}

function getElapsedHours(fromIso: string, toIso: string) {
  const fromTime = Date.parse(fromIso);
  const toTime = Date.parse(toIso);

  if (!Number.isFinite(fromTime) || !Number.isFinite(toTime)) {
    throw new Error(`Session composition invariant violated: expected valid ISO timestamps, got "${fromIso}" and "${toIso}".`);
  }

  return (toTime - fromTime) / (60 * 60 * 1000);
}

function scheduleWordSkillStateFromReviewAttempt(
  state: WordSkillState,
  failureCount: number,
  terminalRating: ReviewPassRating | null,
  reviewedAt: string,
): WordSkillState {
  if (failureCount > 0) {
    const penaltyEase = Math.max(1.8, Number((state.easeFactor - 0.15 * failureCount).toFixed(2)));

    return {
      ...state,
      intervalHours: 6,
      lastStudiedAt: reviewedAt,
      nextDueAt: addHours(reviewedAt, 6),
      easeFactor: penaltyEase,
    };
  }

  if (terminalRating === 'hard') {
    const nextInterval = Math.max(6, ceilIntervalHours(state.intervalHours * 1.5));

    return {
      ...state,
      intervalHours: nextInterval,
      lastStudiedAt: reviewedAt,
      nextDueAt: addHours(reviewedAt, nextInterval),
      easeFactor: Math.max(1.8, Number((state.easeFactor - 0.15).toFixed(2))),
    };
  }

  if (terminalRating === 'good') {
    const baseInterval = ceilIntervalHours(state.intervalHours * state.easeFactor);

    return {
      ...state,
      intervalHours: baseInterval,
      lastStudiedAt: reviewedAt,
      nextDueAt: addHours(reviewedAt, baseInterval),
      easeFactor: Number(state.easeFactor.toFixed(2)),
    };
  }

  if (terminalRating !== 'easy') {
    throw new Error('Expected terminal review rating');
  }

  const nextInterval = ceilIntervalHours(state.intervalHours * (state.easeFactor + 0.35));

  return {
    ...state,
    intervalHours: nextInterval,
    lastStudiedAt: reviewedAt,
    nextDueAt: addHours(reviewedAt, nextInterval),
    easeFactor: Number((state.easeFactor + 0.15).toFixed(2)),
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

function assertUnreachableStudyActionKind(actionKind: never): never {
  throw new Error(`Unsupported study action kind "${String(actionKind)}".`);
}

function assertUnreachableStudyManagementAction(action: never): never {
  throw new Error(`Unsupported study management action "${String(action)}".`);
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

// just used on the update path, intentionally fuzzy
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
        words.status,
        words.priority,
        words.created_at,
        words.learning_streak,
        words.last_learning_success_on,
        words.last_learning_covered_on,
        COALESCE(user_word_priority.bump_count, 0) AS bump_count,
        COALESCE(user_word_priority.force_top, 0) AS force_top,
        COALESCE(user_word_priority.priority_tier, 0) AS priority_tier,
        COALESCE(user_word_priority.required_for_next_session, 0) AS required_for_next_session,
        words.priority
          + COALESCE(user_word_priority.bump_count, 0) * ${PRIORITY_BUMP_UNIT} AS effective_priority
      FROM words
      LEFT JOIN user_word_priority ON user_word_priority.word_id = words.id
      WHERE words.id = ?
        AND words.status = 'unstudied'
    `)
    .get(wordId) as
    | (WordRow & {
      bump_count: number;
      force_top: number;
      priority_tier: number;
      required_for_next_session: number;
      effective_priority: number;
    })
    | undefined;

  if (!row) {
    throw new Error('Expected unstudied word');
  }

  const bumpCount = row.bump_count;
  const forceTop = row.priority_tier === PRIORITY_TIER_TOP;
  const requiredForNextSession = row.required_for_next_session !== 0;
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
    requiredForNextSession,
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
  return Math.max(0, getDailyNewWordLimit() - studiedCount);
}

function getDailyNewWordLimit(): number {
  const row = getDb()
    .prepare(`
      SELECT value
      FROM app_metadata
      WHERE key = 'daily_new_word_limit'
    `)
    .get() as { value: string } | undefined;

  if (!row) {
    return DEFAULT_DAILY_NEW_WORD_LIMIT;
  }

  const dailyNewWordLimit = Number(row.value);
  assertDailyNewWordLimit(dailyNewWordLimit);
  return dailyNewWordLimit;
}

function getDailyNewStudyCount(studyDayKey: string): number {
  const row = getDb()
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
  getDb().prepare(`
    INSERT INTO daily_new_word_intake (
      day_key,
      new_study_count
    ) VALUES (?, 1)
    ON CONFLICT(day_key) DO UPDATE SET
      new_study_count = daily_new_word_intake.new_study_count + 1
  `).run(studyDayKey);
}

function assertDailyNewWordLimit(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Expected non-negative integer dailyNewWordLimit');
  }
}

function assertNonEmptyString(value: string, message: string) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(message);
  }
}

function assertIsoTimestamp(value: string, message: string) {
  if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) {
    throw new Error(message);
  }
}

function assertPositiveInteger(value: number, message: string) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(message);
  }
}

function normalizeNullableDisplayOrder(value: number | null): number | null {
  if (value === null) {
    return null;
  }

  if (!Number.isInteger(value)) {
    throw new Error('Expected integer display order');
  }

  return value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isReviewRating(value: unknown): value is ReviewRating {
  return value === 'forgot' || value === 'hard' || value === 'good' || value === 'easy';
}

function isReviewPassRating(value: unknown): value is ReviewPassRating {
  return value === 'hard' || value === 'good' || value === 'easy';
}

function isStudyActionKind(value: unknown): value is StudyActionKind {
  return value === 'recognition' || value === 'production' || value === 'contrast_selection';
}

function isStudyManagementActionKind(value: unknown): value is StudyManagementActionKind {
  return (
    value === 'suppress_skill' ||
    value === 'add_contrast_candidate' ||
    value === 'suppress_skill_and_add_contrast_candidate' ||
    value === 'bad_prompt'
  );
}

function isStudySessionProcessingState(value: unknown): value is StudySessionProcessingState {
  return value === 'open' || value === 'ready_to_process' || value === 'processed';
}

function isStudySkillId(value: unknown): value is StudySkillId {
  return value === 'recognition' || value === 'production' || value === 'contextual_selection';
}

function isWordSkillRelevanceState(value: unknown): value is WordSkillRelevanceState {
  return value === 'normal' || value === 'suppressed';
}

function assertStudyDayKey(studyDayKey: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(studyDayKey)) {
    throw new Error('Invalid study day key');
  }
}

function ensureReviewSessionSummariesActiveDurationSchema() {
  const columns = getDb().prepare('PRAGMA table_info(review_session_summaries)').all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'active_duration_ms')) {
    getDb().exec('ALTER TABLE review_session_summaries ADD COLUMN active_duration_ms INTEGER NOT NULL DEFAULT 0');
  }
}
