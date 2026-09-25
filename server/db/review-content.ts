import { randomUUID } from 'node:crypto';
import type { ContentExercise, WordContentDocument } from '../../src/domain/word-content/types.ts';
import type { ReviewSupplementSource } from '../../src/domain/word-content/review-compat.ts';
import { adaptTargetedReviewExercise, toProductionExerciseSnapshot } from '../../src/domain/word-content/review-compat.ts';
import { materializeExercise, resolveWordExample } from '../../src/domain/word-content/materialize.ts';
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
type Scope = { content_scope: 'learner' | 'shared'; owner_learner_id: string | null };

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

function checkSource(wordId: string | null, sourceId: string | null, contents: WordContentDocument[]): void {
  if (sourceId === null) return;
  if (wordId === null) throw new Error('Pure cue cannot pin word content');
  const source = contents.find((item) => item.id === sourceId);
  if (!source || source.word.wordId !== wordId) throw new Error('Pinned review source is missing or wrong word');
  const row = getDb().prepare(`
    SELECT content_json FROM word_content_documents WHERE content_id = ? AND word_id = ?
  `).get(sourceId, wordId) as { content_json: string } | undefined;
  if (!row || row.content_json !== JSON.stringify(source)) {
    throw new Error('Pinned review source differs from immutable word content');
  }
}

function legacyScope(kind: CanonicalReviewKind, id: string): Scope | null {
  if (kind === 'pure_cue') {
    return getDb().prepare('SELECT 1 FROM pure_cues WHERE id = ?').get(id)
      ? { content_scope: 'shared', owner_learner_id: null } : null;
  }
  const table = kind === 'production_cue' ? 'scoped_production_cues' : 'scoped_production_cue_supplements';
  return getDb().prepare(`SELECT content_scope, owner_learner_id FROM ${table} WHERE ${kind === 'production_cue' ? 'cue_id' : 'supplement_id'} = ?`)
    .get(id) as Scope | undefined ?? null;
}

function append(kind: CanonicalReviewKind, contentId: string, wordId: string | null,
  sourceWordContentId: string | null, document: object, createdAt: string, model: string | null,
  exerciseId: string | null): Row {
  const learnerId = requireLearnerId();
  const scope = legacyScope(kind, contentId);
  if (!scope || (scope.content_scope === 'learner' && scope.owner_learner_id !== learnerId)) {
    throw new Error('Review content projection is unavailable to this learner');
  }
  const latest = getDb().prepare(`
    SELECT MAX(revision) AS revision FROM scoped_review_content_records
    WHERE kind = ? AND content_id = ?
  `).get(kind, contentId) as { revision: number | null };
  if (kind !== 'pure_cue' && latest.revision !== null) {
    throw new Error('Cue and supplement canonical identities cannot be revised');
  }
  const revision = (latest.revision ?? 0) + 1;
  const recordId = randomUUID();
  const documentJson = JSON.stringify(document);
  getDb().prepare(`
    INSERT INTO scoped_review_content_records (
      record_id, kind, content_id, exercise_id, revision, word_id, source_word_content_id,
      document_json, created_at, model
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(recordId, kind, contentId, exerciseId, revision, wordId, sourceWordContentId,
    documentJson, createdAt, model);
  return { record_id: recordId, kind, content_id: contentId, exercise_id: exerciseId, revision, word_id: wordId,
    source_word_content_id: sourceWordContentId, document_json: documentJson, created_at: createdAt, model };
}

function lexicalAnswers(ids: readonly string[]): Array<{ wordId: string; hanzi: string; traditional: string | null }> {
  return ids.map((id) => {
    const word = getDb().prepare(`SELECT id, hanzi, traditional FROM lexical_words WHERE id = ?`)
      .get(id) as { id: string; hanzi: string; traditional: string | null } | undefined;
    if (!word) throw new Error(`Unknown accepted review word ${id}`);
    return { wordId: word.id, hanzi: word.hanzi, traditional: word.traditional };
  });
}

export function appendCanonicalReviewExercise(input: {
  kind: 'production_cue' | 'pure_cue'; contentId: string; exercise: ContentExercise;
  contents: readonly WordContentDocument[]; sourceWordContentId?: string | null; createdAt?: string;
  model?: string | null;
}): CanonicalReviewExerciseRecord {
  requireLearnerId();
  const exercise = parseContentExercise(input.exercise);
  const sourceContents = documents(input.contents);
  const sourceId = input.sourceWordContentId ?? null;
  const createdAt = canonicalTime(input.createdAt ?? new Date().toISOString());
  if (input.kind === 'production_cue') {
    const cue = getDb().prepare(`
      SELECT cue.cue_id, cue.task_id, cue.cue_type, cue.cue_text, task.word_id
      FROM production_cues AS cue JOIN production_tasks AS task ON task.task_id = cue.task_id
      WHERE cue.cue_id = ?
    `).get(input.contentId) as {
      cue_id: string; task_id: string; cue_type: 'definition_gloss' | 'minimal_context' | 'circumstance';
      cue_text: string; word_id: string;
    } | undefined;
    if (!cue) throw new Error('Projected production cue is unavailable');
    checkSource(cue.word_id, sourceId, sourceContents);
    const compatible = adaptTargetedReviewExercise(exercise, sourceContents, {
      taskId: cue.task_id, cueId: cue.cue_id, cueType: cue.cue_type, supplement: null,
    });
    const snapshot = toProductionExerciseSnapshot(compatible);
    const acceptedIds = (getDb().prepare(`
      SELECT word_id FROM production_cue_accepted_words WHERE cue_id = ? ORDER BY position
    `).all(cue.cue_id) as Array<{ word_id: string }>).map((row) => row.word_id);
    if (snapshot.text !== cue.cue_text
      || JSON.stringify(snapshot.acceptedAnswers) !== JSON.stringify(lexicalAnswers(acceptedIds))) {
      throw new Error('Canonical exercise differs from projected production cue');
    }
    const row = append(input.kind, input.contentId, cue.word_id, sourceId,
      { schemaVersion: 1, exercise, contents: sourceContents }, createdAt, input.model ?? null, exercise.id);
    return freezeContent({ kind: input.kind, contentId: row.content_id, recordId: row.record_id,
      revision: row.revision, wordId: row.word_id, sourceWordContentId: row.source_word_content_id,
      createdAt: row.created_at, model: row.model, exercise, contents: sourceContents });
  }
  if (sourceId !== null) throw new Error('Pure cue cannot pin word content');
  const pure = getDb().prepare('SELECT id, stimulus, axis_note FROM pure_cues WHERE id = ?')
    .get(input.contentId) as { id: string; stimulus: string; axis_note: string } | undefined;
  if (!pure || exercise.contract.kind !== 'pure_review' || exercise.contract.axisNote !== pure.axis_note
    || exercise.instruction !== '') {
    throw new Error('Canonical pure exercise does not match durable pure cue');
  }
  const acceptedIds = (getDb().prepare(`
    SELECT word_id FROM pure_cue_accepted_words WHERE pure_cue_id = ? ORDER BY position
  `).all(pure.id) as Array<{ word_id: string }>).map((row) => row.word_id);
  if (materializeExercise(exercise, sourceContents).stimulus.text !== pure.stimulus
    || JSON.stringify(exercise.acceptedAnswers) !== JSON.stringify(lexicalAnswers(acceptedIds))) {
    throw new Error('Canonical pure exercise differs from durable pure cue');
  }
  const row = append(input.kind, input.contentId, null, null,
    { schemaVersion: 1, exercise, contents: sourceContents }, createdAt, input.model ?? null, exercise.id);
  return freezeContent({ kind: input.kind, contentId: row.content_id, recordId: row.record_id,
    revision: row.revision, wordId: null, sourceWordContentId: null,
    createdAt: row.created_at, model: row.model, exercise, contents: sourceContents });
}

function supplementSnapshot(source: ReviewSupplementSource, contents: WordContentDocument[], wordId: string) {
  if (source.kind === 'snapshot') return { ...source.value };
  if (!source.supplementId.trim() || !source.englishFrame.trim()) {
    throw new Error('Review supplement needs an identity and English frame');
  }
  const content = contents.find((item) => item.id === source.example.contentId);
  if (!content || content.word.wordId !== wordId) throw new Error('Supplement example belongs to another word');
  const example = resolveWordExample(source.example, contents);
  if (!example.text.includes(content.word.hanzi)
    && (content.word.traditional === null || !example.text.includes(content.word.traditional))) {
    throw new Error('Supplement example must show reviewed word');
  }
  return { supplementId: source.supplementId, englishFrame: source.englishFrame,
    exampleSentence: example.text, exampleTranslation: example.translation };
}

export function appendCanonicalReviewSupplement(input: {
  supplementId: string; source: ReviewSupplementSource; contents: readonly WordContentDocument[];
  sourceWordContentId?: string | null; createdAt?: string; model?: string | null;
}): CanonicalReviewSupplementRecord {
  requireLearnerId();
  const row = getDb().prepare(`
    SELECT supplement.supplement_id, supplement.task_id, supplement.cue_id,
      supplement.english_frame, supplement.example_sentence, supplement.example_translation,
      task.word_id
    FROM production_cue_supplements AS supplement
    JOIN production_tasks AS task ON task.task_id = supplement.task_id
    WHERE supplement.supplement_id = ?
  `).get(input.supplementId) as {
    supplement_id: string; task_id: string; cue_id: string | null;
    english_frame: string; example_sentence: string; example_translation: string; word_id: string;
  } | undefined;
  if (!row) throw new Error('Projected supplement is unavailable');
  const sourceContents = documents(input.contents);
  const sourceId = input.sourceWordContentId ?? null;
  checkSource(row.word_id, sourceId, sourceContents);
  const rendered = supplementSnapshot(input.source, sourceContents, row.word_id);
  if (rendered.supplementId !== row.supplement_id || rendered.englishFrame !== row.english_frame
    || rendered.exampleSentence !== row.example_sentence
    || rendered.exampleTranslation !== row.example_translation) {
    throw new Error('Canonical supplement differs from projected supplement');
  }
  const createdAt = canonicalTime(input.createdAt ?? new Date().toISOString());
  const copiedSource: ReviewSupplementSource = input.source.kind === 'snapshot'
    ? { kind: 'snapshot', value: { ...input.source.value } }
    : { ...input.source, example: { ...input.source.example } };
  const record = append('production_cue_supplement', input.supplementId, row.word_id, sourceId,
    { schemaVersion: 1, source: copiedSource, contents: sourceContents }, createdAt, input.model ?? null, null);
  return freezeContent({ kind: 'production_cue_supplement', contentId: record.content_id,
    recordId: record.record_id, revision: record.revision, wordId: record.word_id,
    sourceWordContentId: record.source_word_content_id, createdAt: record.created_at, model: record.model,
    source: copiedSource, contents: sourceContents });
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

/** Historical read remains possible; live selection must call this eligibility gate. */
export function isCanonicalReviewSourceEligible(kind: CanonicalReviewKind, contentId: string): boolean {
  const record = getCanonicalReviewContent(kind, contentId);
  if (!record || record.sourceWordContentId === null) return true;
  const row = getDb().prepare(`
    SELECT publication.publication_status AS status
    FROM word_content_documents AS content
    JOIN shared_content_publications AS publication ON publication.publication_id = content.publication_id
    WHERE content.content_id = ?
  `).get(record.sourceWordContentId) as { status: string } | undefined;
  return row?.status === 'shared_trial' || row?.status === 'available';
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

export function getWordReviewPreparation(wordId: string): {
  sourceContentId: string; ready: boolean;
} | null {
  requireLearnerId();
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

export function claimWordReviewPreparation(
  wordId: string, sourceContentId: string, token: string, now: string, expiresAt: string,
): 'claimed' | 'busy' | 'ready' {
  requireLearnerId();
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

export function releaseWordReviewPreparation(wordId: string, token: string): void {
  requireLearnerId();
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

export function finishWordReviewPreparation(
  wordId: string, token: string, exercises: readonly AuthoredReviewExercise[], model: string,
): { cueIds: string[]; supplementIds: string[] } {
  requireLearnerId();
  if (!Array.isArray(exercises) || exercises.length < 1 || exercises.length > 3) {
    throw new Error('Review preparation needs one to three authored exercises');
  }
  if (!model.trim()) throw new Error('Review model name is required');
  return transaction(() => {
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
      if (forms.some((form) => snapshot.text.includes(form))) {
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
      appendCanonicalReviewExercise({ kind: 'production_cue', contentId: exercise.id,
        exercise, contents: [content], sourceWordContentId: content.id, createdAt: now, model });
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
        appendCanonicalReviewSupplement({ supplementId: supplement.supplementId,
          source: authored.supplement, contents: [content], sourceWordContentId: content.id,
          createdAt: now, model });
        supplementIds.push(supplement.supplementId);
      }
    }
    if (!contextual) throw new Error('First review set needs a contextual exercise');
    getDb().prepare(`
      UPDATE word_review_preparation
      SET ready_at = ?, lease_token = NULL, lease_expires_at = NULL WHERE word_id = ?
    `).run(now, wordId);
    return { cueIds, supplementIds };
  });
}
