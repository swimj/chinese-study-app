import type {
  ReflectionExistingContentV0,
  ReflectionWordSnapshotV1,
  SessionReflectionBundleV1,
} from '../../src/domain/reflection.ts';
import {
  parseInitialReflectionMilestoneBundle,
  parseSessionReflectionEvidenceSupplement,
  type ProductionMistakeEvidenceSupplementV1,
} from '../../src/domain/reflection-evidence.ts';
import { getConfig, getDb } from '../db/connection.ts';

export type ReflectionEvidenceErrorCode =
  | 'invalid_supplement'
  | 'no_qualifying_evidence'
  | 'session_not_found'
  | 'session_not_completed'
  | 'referenced_entity_not_found'
  | 'invalid_reference';

export class ReflectionEvidenceError extends Error {
  readonly httpStatus: 400 | 404;

  constructor(
    readonly code: ReflectionEvidenceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ReflectionEvidenceError';
    this.httpStatus = (
      code === 'session_not_found' || code === 'referenced_entity_not_found'
    ) ? 404 : 400;
  }
}

type SessionRow = {
  id: string;
  started_at: string;
  ended_at: string | null;
};

type CompletionRow = {
  completed_at: string;
};

type AttemptRow = {
  id: string;
  occurred_at: string;
  session_id: string;
  session_action_id: string;
  session_event_sequence: number;
  action_kind: string;
  target_word_id: string;
  sampled_skill_ids_json: string;
  response: string | null;
  outcome: string;
  projected_at: string | null;
};

type WordRow = {
  id: string;
  hanzi: string;
  pinyin: string;
  meaning: string;
  meanings_json: string;
};

type ClusterRow = {
  cluster_id: string;
  title: string;
  cluster_note: string;
  member_word_id: string;
  nuance_note: string;
  display_order: number | null;
  prompt_count: number;
};

/**
 * Deliberately small dogfood guardrail. The initial reflection flow should
 * prefer a complete, useful result for a bounded number of mistakes over a
 * potentially truncated result for an entire session.
 */
export const INITIAL_REFLECTION_MAX_EVIDENCE_ITEMS = 10;

export type InitialReflectionBundleBuild = {
  bundle: SessionReflectionBundleV1;
  eligibleItemCount: number;
  includedItemCount: number;
};

export function buildInitialReflectionBundle(
  sessionId: string,
  supplementValue: unknown,
  generatedAt = new Date().toISOString(),
): SessionReflectionBundleV1 {
  return buildInitialReflectionBundleWithMetrics(
    sessionId,
    supplementValue,
    generatedAt,
  ).bundle;
}

/**
 * Builds the canonical provider bundle and exposes only the bounded-selection
 * facts needed by reflection generation observability. The counts intentionally
 * do not become part of the model-facing bundle schema or artifact provenance.
 */
export function buildInitialReflectionBundleWithMetrics(
  sessionId: string,
  supplementValue: unknown,
  generatedAt = new Date().toISOString(),
): InitialReflectionBundleBuild {
  const normalizedSessionId = sessionId.trim();
  if (normalizedSessionId.length === 0) {
    throw new ReflectionEvidenceError('invalid_reference', 'A non-empty session id is required.');
  }

  let supplement;
  try {
    supplement = parseSessionReflectionEvidenceSupplement(supplementValue);
  } catch {
    throw new ReflectionEvidenceError(
      'invalid_supplement',
      'The reflection evidence supplement is invalid.',
    );
  }
  if (supplement.items.length === 0) {
    throw new ReflectionEvidenceError(
      'no_qualifying_evidence',
      'At least one qualifying typed production mistake is required.',
    );
  }

  const session = getDb().prepare(`
    SELECT id, started_at, ended_at
    FROM study_sessions
    WHERE id = ?
  `).get(normalizedSessionId) as SessionRow | undefined;
  if (!session) {
    throw new ReflectionEvidenceError('session_not_found', 'Study session not found.');
  }

  const completion = getDb().prepare(`
    SELECT completed_at
    FROM review_session_summaries
    WHERE session_id = ?
  `).get(normalizedSessionId) as CompletionRow | undefined;
  if (!completion) {
    throw new ReflectionEvidenceError(
      'session_not_completed',
      'The study session does not have an explicit completed review summary.',
    );
  }

  const eligibleItems = supplement.items.flatMap((item) => {
    const built = buildProductionMistakeItem(normalizedSessionId, item);
    return built === null ? [] : [built];
  });
  if (eligibleItems.length === 0) {
    throw new ReflectionEvidenceError(
      'no_qualifying_evidence',
      'No typed production mistakes remain after excluding managed study actions.',
    );
  }
  const items = eligibleItems.slice(0, INITIAL_REFLECTION_MAX_EVIDENCE_ITEMS);

  const bundle: SessionReflectionBundleV1 = {
    schemaVersion: 'session_reflection_bundle.v1',
    generatedAt,
    session: {
      sessionId: normalizedSessionId,
      startedAt: session.started_at,
      endedAt: session.ended_at ?? completion.completed_at,
      studyProfile: getConfig().studyProfile,
    },
    items,
  };

  try {
    return {
      bundle: parseInitialReflectionMilestoneBundle(bundle),
      eligibleItemCount: eligibleItems.length,
      includedItemCount: items.length,
    };
  } catch {
    throw new ReflectionEvidenceError(
      'invalid_reference',
      'Durable study evidence could not form a valid initial reflection bundle.',
    );
  }
}

function buildProductionMistakeItem(
  sessionId: string,
  supplement: ProductionMistakeEvidenceSupplementV1,
): SessionReflectionBundleV1['items'][number] | null {
  const targetWord = getWordSnapshot(supplement.targetWordId);
  const attempts = getActionAttempts(sessionId, supplement.sessionActionId);
  assertCompleteAttemptReferences(sessionId, supplement, attempts);

  const firstAttempt = attempts[0];
  if (!firstAttempt) {
    throw invalidReference('The referenced study action has no durable attempts.');
  }
  if (
    firstAttempt.outcome !== 'incorrect'
    || firstAttempt.response === null
    || firstAttempt.response.trim().length === 0
    || firstAttempt.response !== supplement.rawResponse
  ) {
    throw invalidReference(
      'The first referenced attempt must be the matching typed incorrect response.',
    );
  }
  if (hasExcludingManagementAction(sessionId, supplement.sessionActionId)) {
    return null;
  }

  const submittedWord = getExactSubmittedWordSnapshot(supplement.rawResponse);

  return {
    itemId: supplement.itemId,
    source: 'production_mistake',
    sourceActionKind: 'production',
    sessionActionId: supplement.sessionActionId,
    occurredAt: firstAttempt.occurred_at,
    targetWord,
    sessionNote: null,
    existingContent: getExistingContent(
      submittedWord
        ? [targetWord.wordId, submittedWord.wordId]
        : [targetWord.wordId],
    ),
    cuesAsShown: supplement.cuesAsShown.map((cue) => ({
      ...cue,
      displayedMeanings: [...cue.displayedMeanings],
    })),
    rawResponse: supplement.rawResponse,
    submittedWord,
    responseKind: submittedWord === null ? 'unmatched_text' : 'matched_known_word',
  };
}

function getActionAttempts(sessionId: string, sessionActionId: string): AttemptRow[] {
  return getDb().prepare(`
    SELECT
      id,
      occurred_at,
      session_id,
      session_action_id,
      session_event_sequence,
      action_kind,
      target_word_id,
      sampled_skill_ids_json,
      response,
      outcome,
      projected_at
    FROM study_attempt_events
    WHERE session_id = ?
      AND session_action_id = ?
    ORDER BY action_attempt_sequence ASC, session_event_sequence ASC, occurred_at ASC, id ASC
  `).all(sessionId, sessionActionId) as AttemptRow[];
}

function assertCompleteAttemptReferences(
  sessionId: string,
  supplement: ProductionMistakeEvidenceSupplementV1,
  attempts: AttemptRow[],
) {
  const referencedRows = getDb().prepare(`
    SELECT id
    FROM study_attempt_events
    WHERE id IN (${supplement.attemptIds.map(() => '?').join(', ')})
  `).all(...supplement.attemptIds) as Array<{ id: string }>;
  if (referencedRows.length !== supplement.attemptIds.length) {
    throw new ReflectionEvidenceError(
      'referenced_entity_not_found',
      'A referenced attempt does not exist.',
    );
  }
  if (attempts.length === 0) {
    throw invalidReference(
      'Referenced attempts do not belong to the stated session action.',
    );
  }
  if (
    attempts.length !== supplement.attemptIds.length
    || attempts.some((attempt, index) => attempt.id !== supplement.attemptIds[index])
  ) {
    throw invalidReference(
      'Attempt references must exactly match the complete ordered durable action batch.',
    );
  }

  for (const attempt of attempts) {
    const sampledSkillIds = parseStringArray(attempt.sampled_skill_ids_json);
    if (
      attempt.session_id !== sessionId
      || attempt.session_action_id !== supplement.sessionActionId
      || attempt.target_word_id !== supplement.targetWordId
      || attempt.action_kind !== 'production'
      || !sampledSkillIds.includes('production')
      || attempt.projected_at === null
    ) {
      throw invalidReference(
        'A referenced attempt does not match the completed production action.',
      );
    }
  }
}

function hasExcludingManagementAction(
  sessionId: string,
  sessionActionId: string,
): boolean {
  const row = getDb().prepare(`
    SELECT 1 AS present
    FROM study_events
    WHERE session_id = ?
      AND session_action_id = ?
      AND projected_at IS NOT NULL
      AND event_type IN (
        'bad_prompt_reported',
        'skill_relevance_changed',
        'skill_relevance_changed_with_contrast_candidate'
      )
    LIMIT 1
  `).get(sessionId, sessionActionId) as { present: 1 } | undefined;
  return row !== undefined;
}

function getWordSnapshot(wordId: string): ReflectionWordSnapshotV1 {
  const row = getDb().prepare(`
    SELECT id, hanzi, pinyin, meaning, meanings_json
    FROM words
    WHERE id = ?
  `).get(wordId) as WordRow | undefined;
  if (!row) {
    throw new ReflectionEvidenceError(
      'referenced_entity_not_found',
      'A referenced word does not exist.',
    );
  }

  const meaningRows = getDb().prepare(`
    SELECT text
    FROM word_meanings
    WHERE word_id = ?
    ORDER BY position ASC, id ASC
  `).all(row.id) as Array<{ text: string }>;
  const meanings = meaningRows.length > 0
    ? meaningRows.map((meaning) => meaning.text)
    : parseWordMeanings(row.meanings_json, row.meaning);

  return {
    wordId: row.id,
    hanzi: row.hanzi,
    pinyin: row.pinyin,
    meanings,
  };
}

function getExactSubmittedWordSnapshot(rawResponse: string): ReflectionWordSnapshotV1 | null {
  const row = getDb().prepare(`
    SELECT id
    FROM words
    WHERE hanzi = ?
      OR traditional = ?
    ORDER BY id ASC
    LIMIT 1
  `).get(rawResponse.trim(), rawResponse.trim()) as { id: string } | undefined;
  return row ? getWordSnapshot(row.id) : null;
}

function getExistingContent(wordIds: string[]): ReflectionExistingContentV0 {
  const uniqueWordIds = [...new Set(wordIds)];
  const placeholders = uniqueWordIds.map(() => '?').join(', ');
  const rows = getDb().prepare(`
    SELECT
      clusters.id AS cluster_id,
      clusters.title,
      clusters.note AS cluster_note,
      members.word_id AS member_word_id,
      members.nuance_note,
      members.display_order,
      (
        SELECT COUNT(*)
        FROM contrast_prompts
        WHERE contrast_prompts.cluster_id = clusters.id
      ) AS prompt_count
    FROM contrast_clusters AS clusters
    INNER JOIN contrast_cluster_members AS members
      ON members.cluster_id = clusters.id
    WHERE clusters.id IN (
      SELECT DISTINCT cluster_id
      FROM contrast_cluster_members
      WHERE word_id IN (${placeholders})
    )
    ORDER BY
      clusters.id ASC,
      members.display_order IS NULL ASC,
      members.display_order ASC,
      members.word_id ASC
  `).all(...uniqueWordIds) as ClusterRow[];

  const clustersById = new Map<string, ReflectionExistingContentV0['contrastClusters'][number]>();
  for (const row of rows) {
    const cluster = clustersById.get(row.cluster_id) ?? {
      clusterId: row.cluster_id,
      title: row.title,
      memberWordIds: [],
      promptCount: row.prompt_count,
      notes: row.cluster_note.length > 0 ? [row.cluster_note] : [],
    };
    cluster.memberWordIds.push(row.member_word_id);
    if (row.nuance_note.length > 0) cluster.notes.push(row.nuance_note);
    clustersById.set(row.cluster_id, cluster);
  }

  return {
    contrastClusters: [...clustersById.values()],
    knownAcceptedAlternates: [],
  };
}

function parseStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) && parsed.every((value) => typeof value === 'string')) {
      return parsed;
    }
  } catch {
    // Invalid durable JSON is handled as an invalid reference below.
  }
  return [];
}

function parseWordMeanings(raw: string, fallback: string): string[] {
  const meanings = parseStringArray(raw);
  if (meanings.length > 0) return meanings;
  return fallback.length > 0 ? [fallback] : [];
}

function invalidReference(message: string): ReflectionEvidenceError {
  return new ReflectionEvidenceError('invalid_reference', message);
}
