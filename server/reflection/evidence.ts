import type {
  ReflectionExistingContentV0,
  ReflectionServedCueSnapshotV1,
  ReflectionWordSnapshotV1,
  SessionReflectionBundleV3,
} from '../../src/domain/reflection.ts';
import { normalizeProductionAnswerForProfile } from '../../src/study-profile.ts';
import {
  parseSessionReflectionEvidenceSupplement,
  parseSessionReflectionEvidenceSupplementV2,
  parseSessionReflectionBundleV3,
  type ProductionMistakeEvidenceSupplementV1,
} from '../../src/domain/reflection-evidence.ts';
import { getConfig, getDb } from '../db/connection.ts';
import {
  defaultProductionTaskId,
  getProductionCue,
  type ProductionCueAttemptResultV0,
} from '../db/production-cues.ts';

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
  rating: string;
  content_ref_json: string | null;
  metadata_json: string;
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
export const INITIAL_REFLECTION_MAX_EVIDENCE_ITEMS = 25;

export type InitialReflectionBundleBuild = {
  bundle: SessionReflectionBundleV3;
  eligibleItemCount: number;
  includedItemCount: number;
};

export function buildInitialReflectionBundle(
  sessionId: string,
  supplementValue: unknown,
  generatedAt = new Date().toISOString(),
): SessionReflectionBundleV3 {
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
    supplement = (
      typeof supplementValue === 'object'
      && supplementValue !== null
      && 'schemaVersion' in supplementValue
      && supplementValue.schemaVersion === 'session_reflection_evidence_supplement.v2'
    )
      ? parseSessionReflectionEvidenceSupplementV2(supplementValue)
      : parseSessionReflectionEvidenceSupplement(supplementValue);
  } catch {
    throw new ReflectionEvidenceError(
      'invalid_supplement',
      'The reflection evidence supplement is invalid.',
    );
  }
  if (supplement.items.length === 0) {
    throw new ReflectionEvidenceError(
      'no_qualifying_evidence',
      'At least one qualifying production reflection item is required.',
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
      'No qualifying production reflection evidence remains after excluding managed study actions.',
    );
  }
  const items = eligibleItems.slice(0, INITIAL_REFLECTION_MAX_EVIDENCE_ITEMS);
  const bundle = {
    schemaVersion: 'session_reflection_bundle.v3' as const,
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
      bundle: parseSessionReflectionBundleV3(bundle),
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
  supplement: ProductionMistakeEvidenceSupplementV1 & { learnerRequestedReview?: true },
): SessionReflectionBundleV3['items'][number] | null {
  const targetWord = getWordSnapshot(supplement.targetWordId);
  const attempts = getActionAttempts(sessionId, supplement.sessionActionId);
  assertCompleteAttemptReferences(sessionId, supplement, attempts);

  const firstAttempt = attempts[0];
  if (!firstAttempt) {
    throw invalidReference('The referenced study action has no durable attempts.');
  }
  if (
    (!supplement.learnerRequestedReview && firstAttempt.outcome !== 'incorrect')
    || (!supplement.learnerRequestedReview && firstAttempt.response !== supplement.rawResponse)
    || (!supplement.learnerRequestedReview && supplement.responseKind === 'typed'
      && (firstAttempt.response === null || firstAttempt.response.trim().length === 0))
    || (!supplement.learnerRequestedReview && supplement.responseKind === 'no_clue' && firstAttempt.response !== null)
  ) {
    throw invalidReference(
      'The first referenced attempt must be the matching failed production response.',
    );
  }
  if (hasExcludingManagementAction(sessionId, supplement.sessionActionId)) {
    return null;
  }
  const taskId = defaultProductionTaskId(targetWord.wordId);
  const attemptMetadata = parseProductionAttemptMetadata(firstAttempt.metadata_json);
  const sourceSupplement = supplement.learnerRequestedReview && firstAttempt.response !== null
    ? { ...supplement, rawResponse: firstAttempt.response, responseKind: 'typed' as const }
    : supplement;
  if (supplement.responseKind === 'no_clue' && attemptMetadata === null) {
    throw invalidReference(
      'No-clue reflection evidence requires explicit durable no-clue provenance.',
    );
  }
  if (attemptMetadata !== null) {
    validateProductionAttemptMetadata(
      firstAttempt,
      sourceSupplement,
      attemptMetadata,
      taskId,
    );
  } else if (
    sourceSupplement.rawResponse !== null
    && isTargetWordResponse(sourceSupplement.rawResponse, sourceSupplement.targetWordId)
    && !supplement.learnerRequestedReview
  ) {
    return null;
  }
  if (attemptMetadata !== null && attemptMetadata.result !== 'rejected' && !supplement.learnerRequestedReview) return null;

  const submittedWord = attemptMetadata?.submittedWordId
    ? getWordSnapshot(attemptMetadata.submittedWordId)
    : null;
  const servedCue = productionServedCue(
    firstAttempt,
    sourceSupplement,
    attemptMetadata,
  );

  return {
    itemId: supplement.itemId,
    source: 'production_mistake',
    sourceActionKind: 'production',
    sourceAttemptId: firstAttempt.id,
    sessionActionId: supplement.sessionActionId,
    occurredAt: firstAttempt.occurred_at,
    targetWord,
    sessionNote: null,
    existingContent: getExistingContent(
      submittedWord
        ? [targetWord.wordId, submittedWord.wordId]
        : [targetWord.wordId],
    ),
    servedCue,
    rawResponse: sourceSupplement.rawResponse,
    submittedWord,
    responseKind: supplement.learnerRequestedReview && firstAttempt.outcome === 'correct'
      ? null
      : sourceSupplement.responseKind === 'no_clue'
        ? 'no_clue'
        : submittedWord !== null
          ? 'matched_known_word'
          : 'unmatched_text',
    ...(supplement.learnerRequestedReview ? { learnerRequestedReview: true as const } : {}),
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
      rating,
      content_ref_json,
      metadata_json,
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

function productionServedCue(
  attempt: AttemptRow,
  supplement: ProductionMistakeEvidenceSupplementV1,
  metadata: ProductionAttemptMetadataV0 | null,
): ReflectionServedCueSnapshotV1 {
  const suppliedCue = supplement.cuesAsShown[0];
  if (supplement.cuesAsShown.length !== 1 || suppliedCue === undefined) {
    throw invalidReference('Expected exactly one supplied production cue snapshot.');
  }
  if (metadata !== null) {
    if (
      suppliedCue.cueId !== metadata.cueId
      || suppliedCue.cueType !== metadata.cueType
      || suppliedCue.text !== metadata.text
    ) {
      throw invalidReference('The supplied production cue does not match the attempt snapshot.');
    }
    return {
      cueId: metadata.cueId,
      cueType: metadata.cueType,
      text: metadata.text,
      acceptedWordIds: [...metadata.acceptedWordIds],
    };
  }
  if (suppliedCue.cueId !== null) {
    throw invalidReference('A durable production cue attempt is missing its exact snapshot metadata.');
  }
  if (suppliedCue.cueType !== 'definition_gloss') {
    throw invalidReference('Legacy production fallback evidence must be definition gloss content.');
  }
  return {
    cueId: null,
    cueType: 'definition_gloss',
    text: suppliedCue.text,
    acceptedWordIds: [attempt.target_word_id],
  };
}

type ProductionAttemptMetadataV0 = {
  taskId: string;
  cueId: string | null;
  cueType: 'definition_gloss' | 'minimal_context' | 'circumstance';
  text: string;
  acceptedWordIds: string[];
  anchorWordId: string;
  responseKind: 'typed' | 'no_clue';
  submittedText: string | null;
  submittedWordId: string | null;
  result: ProductionCueAttemptResultV0;
};

function parseProductionAttemptMetadata(raw: string): ProductionAttemptMetadataV0 | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw invalidReference('The production attempt metadata is invalid JSON.');
  }
  if (!isRecord(parsed) || !isRecord(parsed.production)) return null;
  const production = parsed.production;
  const responseKind = production.responseKind === undefined ? 'typed' : production.responseKind;
  if (
    typeof production.taskId !== 'string'
    || (production.cueId !== null && typeof production.cueId !== 'string')
    || (
      production.cueType !== 'definition_gloss'
      && production.cueType !== 'minimal_context'
      && production.cueType !== 'circumstance'
    )
    || typeof production.text !== 'string'
    || production.text.trim().length === 0
    || !Array.isArray(production.acceptedWordIds)
    || production.acceptedWordIds.length === 0
    || production.acceptedWordIds.some((wordId) => typeof wordId !== 'string')
    || new Set(production.acceptedWordIds).size !== production.acceptedWordIds.length
    || typeof production.anchorWordId !== 'string'
    || (responseKind !== 'typed' && responseKind !== 'no_clue')
    || (responseKind === 'typed' && typeof production.submittedText !== 'string')
    || (responseKind === 'no_clue' && production.submittedText !== null)
    || (production.submittedWordId !== null && typeof production.submittedWordId !== 'string')
    || (
      production.result !== 'accepted_anchor'
      && production.result !== 'accepted_non_anchor'
      && production.result !== 'rejected'
    )
  ) {
    throw invalidReference('The production attempt snapshot metadata is malformed.');
  }
  return { ...production, responseKind } as ProductionAttemptMetadataV0;
}

function validateProductionAttemptMetadata(
  attempt: AttemptRow,
  supplement: ProductionMistakeEvidenceSupplementV1,
  metadata: ProductionAttemptMetadataV0,
  taskId: string,
): void {
  if (
    metadata.taskId !== taskId
    || metadata.anchorWordId !== attempt.target_word_id
    || metadata.submittedText !== attempt.response
    || metadata.submittedText !== supplement.rawResponse
    || (metadata.responseKind === 'no_clue'
      && (supplement.responseKind !== 'no_clue'
        || metadata.submittedWordId !== null
        || metadata.result !== 'rejected'))
    || (metadata.responseKind === 'typed' && supplement.responseKind !== 'typed')
    || !metadata.acceptedWordIds.includes(metadata.anchorWordId)
    || !isProductionResultCoherent(metadata)
    || !isProductionAttemptOutcomeCoherent(attempt, metadata.result)
  ) {
    throw invalidReference('The production attempt snapshot does not match its durable attempt.');
  }

  const contentRef = parseNullableObjectJson(attempt.content_ref_json);
  if (metadata.cueId === null) {
    if (metadata.cueType !== 'definition_gloss' || contentRef !== null) {
      throw invalidReference('Fallback production evidence has an invalid cue reference.');
    }
    return;
  }
  if (
    contentRef?.type !== 'production_cue'
    || contentRef.taskId !== metadata.taskId
    || contentRef.cueId !== metadata.cueId
  ) {
    throw invalidReference('Production attempt content reference does not match its cue snapshot.');
  }
  const cue = getProductionCue(metadata.cueId);
  if (
    !cue
    || cue.taskId !== taskId
    || cue.cueType !== metadata.cueType
    || cue.text !== metadata.text
    || cue.acceptedWordIds.length !== metadata.acceptedWordIds.length
    || cue.acceptedWordIds.some((wordId, index) => wordId !== metadata.acceptedWordIds[index])
  ) {
    throw invalidReference('Production attempt metadata does not match its immutable cue.');
  }
}

function isProductionAttemptOutcomeCoherent(
  attempt: AttemptRow,
  result: ProductionCueAttemptResultV0,
): boolean {
  if (result === 'rejected') {
    return attempt.outcome === 'incorrect' && attempt.rating === 'forgot';
  }
  return attempt.rating === 'forgot'
    ? attempt.outcome === 'incorrect'
    : attempt.outcome === 'correct';
}

function isProductionResultCoherent(metadata: ProductionAttemptMetadataV0): boolean {
  switch (metadata.result) {
    case 'accepted_anchor':
      return metadata.submittedWordId === metadata.anchorWordId;
    case 'accepted_non_anchor':
      return metadata.submittedWordId !== null
        && metadata.submittedWordId !== metadata.anchorWordId
        && metadata.acceptedWordIds.includes(metadata.submittedWordId);
    case 'rejected':
      return metadata.submittedWordId === null
        || !metadata.acceptedWordIds.includes(metadata.submittedWordId);
  }
}

function parseNullableObjectJson(raw: string | null): Record<string, unknown> | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isRecord(parsed)) return parsed;
  } catch {
    // Fall through to the durable-reference error below.
  }
  throw invalidReference('The production attempt content reference is invalid.');
}

function isTargetWordResponse(rawResponse: string, targetWordId: string): boolean {
  const row = getDb().prepare(`
    SELECT hanzi, traditional
    FROM words
    WHERE id = ?
  `).get(targetWordId) as { hanzi: string; traditional: string | null } | undefined;
  if (!row) return false;
  const normalizedResponse = normalizeProductionAnswerForProfile(
    rawResponse,
    getConfig().studyProfile,
  );
  return [row.hanzi, row.traditional]
    .filter((form): form is string => form !== null)
    .some((form) => normalizeProductionAnswerForProfile(
      form,
      getConfig().studyProfile,
    ) === normalizedResponse);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
