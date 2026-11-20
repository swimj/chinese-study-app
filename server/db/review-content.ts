import { importLegacyVocabularyWord } from './vocabulary-import.ts';
import { linkVocabularyPublicationOutput } from './vocabulary-provenance.ts';
import { randomUUID } from 'node:crypto';
import type { ContentExercise, WordContentDocument } from '../../src/domain/word-content/types.ts';
import type { ReviewSupplementSource } from '../../src/domain/word-content/review-compat.ts';
import { adaptTargetedReviewExercise, toProductionExerciseSnapshot } from '../../src/domain/word-content/review-compat.ts';
import { freezeContent, parseContentExercise, parseWordContent } from '../../src/domain/word-content/validation.ts';
import { getDb } from './connection.ts';
import { requireLearnerId } from './learner-context.ts';
import type { AuthoredReviewExercise } from '../word-content/review-authoring.ts';

export type CanonicalReviewKind = 'production_cue' | 'production_cue_supplement' | 'pure_cue';
type Header = {
  kind: CanonicalReviewKind; contentId: string; recordId: string; revision: number;
  wordId: string | null; sourceWordContentId: string | null; createdAt: string; model: string | null;
};
export type CanonicalReviewExerciseRecord = Header & {
  kind: 'production_cue' | 'pure_cue'; exercise: ContentExercise; contents: WordContentDocument[];
};
export type CanonicalReviewSupplementRecord = Header & {
  kind: 'production_cue_supplement'; source: ReviewSupplementSource; contents: WordContentDocument[];
};
export type CanonicalReviewContentRecord = CanonicalReviewExerciseRecord | CanonicalReviewSupplementRecord;
type Row = {
  record_id: string; kind: CanonicalReviewKind; content_id: string; exercise_id: string | null; revision: number;
  word_id: string | null; source_word_content_id: string | null; document_json: string; created_at: string;
  model: string | null;
};

function canonicalTime(value: string): string {
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error('Review content timestamp must be canonical UTC ISO time');
  }
  return value;
}

function documents(input: readonly WordContentDocument[]): WordContentDocument[] {
  if (!Array.isArray(input)) throw new Error('Review content documents must be an array');
  const parsed = input.map(parseWordContent);
  if (new Set(parsed.map((item) => item.id)).size !== parsed.length) {
    throw new Error('Duplicate review source content identity');
  }
  return parsed;
}

export function getCanonicalReviewContent(kind: CanonicalReviewKind, contentId: string): CanonicalReviewContentRecord | null {
  requireLearnerId();
  const row = getDb().prepare(`
    SELECT record_id, kind, content_id, exercise_id, revision, word_id, source_word_content_id,
      document_json, created_at, model
    FROM review_content_records WHERE kind = ? AND content_id = ? ORDER BY revision DESC LIMIT 1
  `).get(kind, contentId) as Row | undefined;
  if (!row) return null;
  const envelope = JSON.parse(row.document_json) as {
    schemaVersion: number; exercise?: ContentExercise; source?: ReviewSupplementSource;
    contents: WordContentDocument[];
  };
  if (envelope.schemaVersion !== 1) throw new Error('Unknown canonical review schema version');
  const sourceContents = documents(envelope.contents);
  const header = { kind: row.kind, contentId: row.content_id, recordId: row.record_id,
    revision: row.revision, wordId: row.word_id, sourceWordContentId: row.source_word_content_id,
    createdAt: row.created_at, model: row.model };
  if (row.kind === 'production_cue_supplement') {
    if (!envelope.source) throw new Error('Canonical supplement source missing');
    return freezeContent({ ...header, kind: row.kind, source: envelope.source, contents: sourceContents });
  }
  if (!envelope.exercise) throw new Error('Canonical review exercise missing');
  return freezeContent({ ...header, kind: row.kind,
    exercise: parseContentExercise(envelope.exercise), contents: sourceContents });
}

function transaction<T>(operation: () => T): T {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

type PreparationRow = {
  word_id: string; source_content_id: string; ready_at: string | null;
  lease_token: string | null; lease_expires_at: string | null;
};
function preparationRow(wordId: string): PreparationRow | null {
  return getDb().prepare(`
    SELECT word_id, source_content_id, ready_at, lease_token, lease_expires_at
    FROM word_review_preparation WHERE word_id = ?
  `).get(wordId) as PreparationRow | undefined ?? null;
}

export function getSharedWordReviewPreparation(wordId: string): {
  sourceContentId: string; ready: boolean;
} | null {
  const row = preparationRow(wordId);
  return row ? { sourceContentId: row.source_content_id, ready: row.ready_at !== null } : null;
}

function eligibleSharedContent(wordId: string, contentId: string): WordContentDocument | null {
  const row = getDb().prepare(`
    SELECT content.content_json
    FROM word_content_documents AS content
    JOIN shared_content_publications AS publication ON publication.publication_id = content.publication_id
    WHERE content.word_id = ? AND content.content_id = ?
      AND publication.publication_status IN ('shared_trial', 'available')
  `).get(wordId, contentId) as { content_json: string } | undefined;
  return row ? parseWordContent(JSON.parse(row.content_json)) : null;
}

export function claimSharedWordReviewPreparation(
  wordId: string, sourceContentId: string, token: string, now: string, expiresAt: string,
): 'claimed' | 'busy' | 'ready' {
  if (!wordId.trim() || !sourceContentId.trim() || !token.trim()) {
    throw new Error('Review preparation requires word, source, and token');
  }
  canonicalTime(now);
  canonicalTime(expiresAt);
  if (expiresAt <= now) throw new Error('Review preparation lease must expire after claim');
  return transaction(() => {
    const existing = preparationRow(wordId);
    if (existing && existing.ready_at !== null) return 'ready';
    if (!eligibleSharedContent(wordId, sourceContentId)) {
      throw new Error('Eligible review source word content not found');
    }
    getDb().prepare(`
      INSERT OR IGNORE INTO word_review_preparation (word_id, source_content_id) VALUES (?, ?)
    `).run(wordId, sourceContentId);
    const row = preparationRow(wordId)!;
    if (row.source_content_id !== sourceContentId) {
      throw new Error('Review preparation already pins another word content document');
    }
    if (row.lease_token !== null && row.lease_expires_at !== null && row.lease_expires_at > now) {
      return 'busy';
    }
    getDb().prepare(`
      UPDATE word_review_preparation SET lease_token = ?, lease_expires_at = ? WHERE word_id = ?
    `).run(token, expiresAt, wordId);
    return 'claimed';
  });
}

export function releaseSharedWordReviewPreparation(wordId: string, token: string): void {
  if (!token.trim()) return;
  transaction(() => {
    getDb().prepare(`
      UPDATE word_review_preparation SET lease_token = NULL, lease_expires_at = NULL
      WHERE word_id = ? AND lease_token = ? AND ready_at IS NULL
    `).run(wordId, token);
  });
}

function publishReviewProjection(kind: 'production_cue' | 'production_cue_supplement',
  contentId: string, taskId: string, now: string): void {
  const publicationId = randomUUID();
  getDb().prepare(`
    INSERT INTO shared_content_publications (
      publication_id, content_kind, content_id, learning_purpose_key,
      publication_status, published_at, status_updated_at
    ) VALUES (?, ?, ?, ?, 'shared_trial', ?, ?)
  `).run(publicationId, kind, contentId, taskId, now, now);
  getDb().prepare(`
    INSERT INTO shared_content_publication_events (
      event_id, publication_id, from_status, to_status, actor_kind, actor_id, reason, occurred_at
    ) VALUES (?, ?, NULL, 'shared_trial', 'source_authorization', NULL, ?, ?)
  `).run(randomUUID(), publicationId, 'automatic validated bootstrap review publication', now);
}

export function finishSharedWordReviewPreparation(
  wordId: string, token: string, exercises: readonly AuthoredReviewExercise[], model: string, invocationId?: string | null, assertPublication?: () => void,
): { cueIds: string[]; supplementIds: string[] } {
  if (!Array.isArray(exercises) || exercises.length < 1 || exercises.length > 3) {
    throw new Error('Review preparation needs one to three authored exercises');
  }
  if (!model.trim()) throw new Error('Review model name is required');
  return transaction(() => {
    assertPublication?.();
    const prepared = preparationRow(wordId);
    if (!prepared || prepared.ready_at !== null || prepared.lease_token !== token
      || prepared.lease_expires_at === null || prepared.lease_expires_at <= new Date().toISOString()) {
      throw new Error('Review preparation lease is not active');
    }
    const content = eligibleSharedContent(wordId, prepared.source_content_id);
    if (!content) throw new Error('Pinned review source is withdrawn');
    const task = getDb().prepare(`
      SELECT task_id FROM production_tasks WHERE word_id = ? AND task_kind = 'default_production'
    `).get(wordId) as { task_id: string } | undefined;
    if (!task) throw new Error('Default production task not found');
    const ids = new Set<string>();
    const cueIds: string[] = [];
    const supplementIds: string[] = [];
    let contextual = false;
    const now = new Date().toISOString();
    for (const authored of exercises) {
      const exercise = parseContentExercise(authored.exercise);
      if (exercise.contract.kind !== 'targeted_review' || exercise.contract.wordId !== wordId
        || exercise.instruction !== '' || ids.has(exercise.id)) {
        throw new Error('Authored review contract or identity is invalid');
      }
      ids.add(exercise.id);
      if (authored.cueType === 'circumstance' || exercise.stimulus.kind === 'example_cloze') contextual = true;
      const compatible = adaptTargetedReviewExercise(exercise, [content], {
        taskId: task.task_id, cueId: exercise.id, cueType: authored.cueType, supplement: authored.supplement,
      });
      const snapshot = toProductionExerciseSnapshot(compatible);
      if (snapshot.acceptedAnswers.length !== 1 || snapshot.acceptedAnswers[0].wordId !== wordId
        || snapshot.acceptedAnswers[0].hanzi !== content.word.hanzi
        || snapshot.acceptedAnswers[0].traditional !== content.word.traditional) {
        throw new Error('Authored review must accept exactly its lexical target');
      }
      const forms = [content.word.hanzi, content.word.traditional].filter((form): form is string => form !== null);
      if (exercise.stimulus.kind === 'direct_text' && forms.some((form) => snapshot.text.includes(form))) {
        throw new Error('Authored review stimulus reveals its target');
      }
      getDb().prepare(`
        INSERT INTO scoped_production_cues (
          cue_id, task_id, cue_type, cue_text, created_at, origin_kind,
          origin_invocation_id, content_scope, owner_learner_id
        ) VALUES (?, ?, ?, ?, ?, 'manual', NULL, 'shared', NULL)
      `).run(exercise.id, task.task_id, snapshot.cueType, snapshot.text, now);
      getDb().prepare(`
        INSERT INTO scoped_production_cue_accepted_words (cue_id, word_id, position) VALUES (?, ?, 0)
      `).run(exercise.id, wordId);
      publishReviewProjection('production_cue', exercise.id, task.task_id, now);
      insertSharedReviewRecord('production_cue', exercise.id, exercise.id, wordId, content,
        { schemaVersion: 1, exercise, contents: [content] }, now, model);
      cueIds.push(exercise.id);
      if (authored.supplement !== null) {
        const supplement = snapshot.supplement;
        if (!supplement || snapshot.cueType !== 'definition_gloss') {
          throw new Error('Authored review supplement needs a definition cue');
        }
        getDb().prepare(`
          INSERT INTO scoped_production_cue_supplements (
            supplement_id, task_id, cue_id, english_frame, example_sentence,
            example_translation, created_at, origin_invocation_id, content_scope, owner_learner_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'shared', NULL)
        `).run(supplement.supplementId, task.task_id, exercise.id, supplement.englishFrame,
          supplement.exampleSentence, supplement.exampleTranslation, now);
        publishReviewProjection('production_cue_supplement', supplement.supplementId, task.task_id, now);
        insertSharedReviewRecord('production_cue_supplement', supplement.supplementId, null, wordId, content,
          { schemaVersion: 1, source: authored.supplement, contents: [content] }, now, model);
        supplementIds.push(supplement.supplementId);
      }
    }
    if (!contextual) throw new Error('First review set needs a contextual exercise');
    getDb().prepare(`
      UPDATE word_review_preparation
      SET ready_at = ?, lease_token = NULL, lease_expires_at = NULL WHERE word_id = ?
    `).run(now, wordId);
    importLegacyVocabularyWord(getDb(),wordId,{ originKind: 'model' });
    for (const cueId of cueIds) linkVocabularyPublicationOutput(getDb(),invocationId,'production_cue',cueId);
    for (const supplementId of supplementIds) linkVocabularyPublicationOutput(getDb(),invocationId,'production_cue_supplement',supplementId);
    return { cueIds, supplementIds };
  });
}

export function claimWordReviewPreparation(wordId: string, sourceContentId: string, token: string, now: string, expiresAt: string) {
  requireLearnerId();
  return claimSharedWordReviewPreparation(wordId, sourceContentId, token, now, expiresAt);
}

export function finishWordReviewPreparation(wordId: string, token: string, exercises: readonly AuthoredReviewExercise[], model: string) {
  requireLearnerId();
  return finishSharedWordReviewPreparation(wordId, token, exercises, model);
}

// Only called after the shared preparation lease and complete materialized projection validate.
function insertSharedReviewRecord(kind: 'production_cue' | 'production_cue_supplement',
  contentId: string, exerciseId: string | null, wordId: string, content: WordContentDocument,
  document: object, now: string, model: string): void {
  getDb().prepare(`INSERT INTO scoped_review_content_records
    (record_id, kind, content_id, exercise_id, revision, word_id, source_word_content_id,
     document_json, created_at, model) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`)
    .run(randomUUID(), kind, contentId, exerciseId, wordId, content.id, JSON.stringify(document), now, model);
}
