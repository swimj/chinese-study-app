import { resolveVocabularySenseCoverage } from './vocabulary-sense-coverage.ts';
import { randomUUID } from 'node:crypto';
import { vocabularyAuthoredPromptBody,vocabularyPhraseClozeError } from '../../src/domain/vocabulary-production-coverage.ts';
import type { VocabularyActor, VocabularyBackendEvent, VocabularyContent, VocabularyContentDraft,
  VocabularyJson, VocabularyMode, VocabularySense, VocabularySenseCatalog, VocabularyTeachingBinding,
  VocabularyWordRelationship } from '../../src/domain/vocabulary-content.ts';
import { getDb } from './connection.ts';
import { requireLearnerId } from './learner-context.ts';

/** Explicit internal writers are called only after the caller establishes operator/service authority.
 * Shared authored bodies must contain content, never private encounter or learner evidence. */
export class VocabularyContentConflict extends Error {}
function atomic<T>(operation: () => T): T {
  const db = getDb();
  const nested = db.isTransaction;
  const savepoint = `vocabulary_${randomUUID().replaceAll('-', '')}`;
  db.exec(nested ? `SAVEPOINT ${savepoint}` : 'BEGIN IMMEDIATE');
  try {
    const value = operation();
    db.exec(nested ? `RELEASE ${savepoint}` : 'COMMIT');
    return value;
  } catch (error) {
    db.exec(nested ? `ROLLBACK TO ${savepoint}` : 'ROLLBACK');
    if (nested) db.exec(`RELEASE ${savepoint}`);
    throw error;
  }
}
function nonempty(value: string, label: string): void {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Expected ${label}`);
}
function positive(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Expected positive ${label}`);
}
function json(value: VocabularyJson): string {
  function check(item: unknown): void {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (Array.isArray(item)) { item.forEach(check); return; }
    if (typeof item === 'object' && item !== null && Object.getPrototypeOf(item) === Object.prototype) {
      Object.values(item).forEach(check); return;
    }
    throw new Error('Expected finite JSON content');
  }
  check(value);
  return JSON.stringify(value);
}
function actorCheck(actor: VocabularyActor): void {
  if (actor.kind !== 'operator' && actor.kind !== 'service') throw new Error('Expected explicit operator/service actor');
  nonempty(actor.id, 'actor identity');
  if (actor.reason !== undefined) json(actor.reason);
}
function now(): string { return new Date().toISOString(); }
function time(value: string): void {
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error('Expected canonical UTC timestamp');
}

/** Diagnostic references deliberately need not exist; authoritative effects emit inside their writer transaction. */
export function emitBackendEvent(event: VocabularyBackendEvent): string {
  nonempty(event.name, 'event name');
  const id = randomUUID();
  const recordedAt = now();
  const occurredAt = event.occurredAt ?? recordedAt;
  time(occurredAt);
  positive(event.payloadVersion ?? 1, 'event payload version');
  getDb().prepare(`INSERT INTO backend_events(event_id,occurred_at,recorded_at,name,payload_version,data_json,
    actor_kind,actor_id,learner_id,session_id,job_id,causal_event_id,entity_kind,entity_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, occurredAt, recordedAt, event.name, event.payloadVersion ?? 1, json(event.data),
    event.actorKind ?? null, event.actorId ?? null, event.learnerId ?? null, event.sessionId ?? null,
    event.jobId ?? null, event.causalEventId ?? null, event.entityKind ?? null, event.entityId ?? null);
  return id;
}
function effect(name: string, entityKind: string, entityId: string, data: VocabularyJson, actor: VocabularyActor): void {
  emitBackendEvent({ name, entityKind, entityId, data, actorKind: actor.kind, actorId: actor.id });
}

type ContentRow = {
  content_id: string; kind: 'exercise' | 'introduction'; payload_version: number; body_json: string;
  exercise_type: string | null; skill: string | null; exercise_role: 'teaching' | 'general' | null;
  assessment_json: string | null; access_scope: 'shared' | 'private'; owner_learner_id: string | null;
  availability: 'active' | 'quarantined' | 'retired'; origin_kind: 'model' | 'human' | 'import';
  author_kind: string | null; author_id: string | null; version: number; created_at: string; updated_at: string;
};
function readContent(id: string): VocabularyContent | null {
  const row = getDb().prepare('SELECT * FROM content_items WHERE content_id = ?').get(id) as ContentRow | undefined;
  if (!row) return null;
  const words = getDb().prepare(`SELECT word_id AS wordId,relation,sense_id AS senseId,
    sense_mapping_established_at AS senseMappingEstablishedAt FROM content_words WHERE content_id = ? ORDER BY word_id`)
    .all(id) as VocabularyWordRelationship[];
  const plainWords = words.map((word) => ({ ...word }));
  const base = { contentId: row.content_id, payloadVersion: row.payload_version, body: JSON.parse(row.body_json) as VocabularyJson,
    accessScope: row.access_scope, ownerLearnerId: row.owner_learner_id, availability: row.availability,
    originKind: row.origin_kind, authorKind: row.author_kind, authorId: row.author_id, words: plainWords,
    version: row.version, createdAt: row.created_at, updatedAt: row.updated_at };
  if (row.kind === 'introduction') {
    const teachingExercises = getDb().prepare(`SELECT exercise_id AS exerciseId,exercise_version AS exerciseVersion
      FROM introduction_exercises WHERE introduction_id = ? ORDER BY position`).all(id) as VocabularyTeachingBinding[];
    return { ...base, kind: 'introduction', teachingExercises: teachingExercises.map((binding) => ({ ...binding })) };
  }
  const answers = (getDb().prepare(`SELECT word_id,accepted_forms_json FROM exercise_answer_words
    WHERE exercise_id = ? ORDER BY word_id`).all(id) as Array<{ word_id: string; accepted_forms_json: string }>)
    .map((answer) => ({ wordId: answer.word_id, acceptedForms: JSON.parse(answer.accepted_forms_json) as string[] }));
  return { ...base, kind: 'exercise', exerciseType: row.exercise_type!, skill: row.skill!, exerciseRole: row.exercise_role!,
    assessment: JSON.parse(row.assessment_json!) as VocabularyJson, answers };
}
/** Internal maintenance only. This bypasses learner visibility, not suitable for an HTTP learner read. */
export function getVocabularyContentForMaintenance(contentId: string): VocabularyContent | null { return readContent(contentId); }
export function getVocabularyContent(contentId: string): VocabularyContent | null {
  const learnerId = requireLearnerId();
  const content = readContent(contentId);
  return content && (content.accessScope === 'shared' || content.ownerLearnerId === learnerId) ? content : null;
}
/** Exact retained authored version; mappings in it are those known when authored, not later enrichment. */
export function getVocabularyContentVersion(contentId: string, version: number): VocabularyContent | null {
  if (!getVocabularyContent(contentId)) return null;
  const row = getDb().prepare('SELECT snapshot_json FROM content_revision_history WHERE content_id = ? AND version = ?')
    .get(contentId, version) as { snapshot_json: string } | undefined;
  return row ? JSON.parse(row.snapshot_json) as VocabularyContent : null;
}
function requiredContent(id: string): VocabularyContent {
  const content = readContent(id);
  if (!content) throw new Error(`Unknown vocabulary content ${id}`);
  return content;
}
function expectVersion(content: VocabularyContent, expected: number): void {
  positive(expected, 'expected version');
  if (content.version !== expected) throw new VocabularyContentConflict('Vocabulary content changed; reload before saving');
}
function validateDraft(draft: VocabularyContentDraft): void {
  positive(draft.payloadVersion, 'payload version');
  json(draft.body);
  const clozeError=draft.availability==='retired'?null:vocabularyPhraseClozeError(draft.body);if(clozeError)throw new Error(clozeError);
  if (draft.contentId !== undefined) nonempty(draft.contentId, 'content identity');
  if ((draft.accessScope === 'private') !== (typeof draft.ownerLearnerId === 'string' && draft.ownerLearnerId.trim().length > 0)) {
    throw new Error('Private content requires its owner; shared content has no owner');
  }
  if (draft.accessScope === 'shared' && draft.ownerLearnerId != null) throw new Error('Shared content has no owner');
  const words = new Set<string>();
  for (const word of draft.words) {
    nonempty(word.wordId, 'word identity');
    if (words.has(word.wordId)) throw new Error('Duplicate content word');
    words.add(word.wordId);
    if (word.senseId != null && word.senseMappingEstablishedAt == null) throw new Error('A sense mapping needs its establishment time');
    if (word.senseMappingEstablishedAt != null) time(word.senseMappingEstablishedAt);
  }
  if (draft.kind === 'exercise') {
    nonempty(draft.exerciseType, 'exercise type'); nonempty(draft.skill, 'skill'); json(draft.assessment);
    if (draft.answers.length === 0) throw new Error('Exercise requires accepted answer words');
    const answers = new Set<string>();
    for (const answer of draft.answers) {
      if (!words.has(answer.wordId) || answers.has(answer.wordId)) throw new Error('Answers require unique content-word relationships');
      answers.add(answer.wordId);
      if (!answer.acceptedForms.length || new Set(answer.acceptedForms).size !== answer.acceptedForms.length) throw new Error('Expected distinct accepted forms');
      answer.acceptedForms.forEach((form) => nonempty(form, 'accepted form'));
    }
    const assessment = draft.assessment !== null && typeof draft.assessment === 'object' && !Array.isArray(draft.assessment) ? draft.assessment : {};
    if (draft.exerciseType === 'contrast' || assessment.responseMode === 'word_choice') {
      const body = draft.body !== null && typeof draft.body === 'object' && !Array.isArray(draft.body) ? draft.body : {};
      if (!Array.isArray(body.choices) || body.choices.length < 2) throw new Error('Word choice requires at least two choices');
      const choices = new Set<string>();
      for (const choice of body.choices) {
        const wordId = choice !== null && typeof choice === 'object' && !Array.isArray(choice) ? choice.wordId : null;
        if (typeof wordId !== 'string' || !words.has(wordId) || choices.has(wordId)) throw new Error('Word choices require distinct content-word relationships');
        choices.add(wordId);
      }
      const correct = assessment.correctWordId;
      if (assessment.responseMode !== 'word_choice' || typeof correct !== 'string' || !choices.has(correct)
        || draft.answers.length !== 1 || draft.answers[0]!.wordId !== correct
        || !draft.words.some((word) => word.wordId === correct && word.relation === 'target')) {
        throw new Error('Word choice correct answer must agree with its target and accepted answer');
      }
      const reveal = body.reveal;
      if (reveal !== null && typeof reveal === 'object' && !Array.isArray(reveal)
        && reveal.correctWordId !== undefined && reveal.correctWordId !== correct) throw new Error('Word choice reveal disagrees with correct answer');
    }
  } else if (draft.kind === 'introduction') {
    for (const binding of draft.teachingExercises) { nonempty(binding.exerciseId, 'exercise identity'); positive(binding.exerciseVersion, 'exercise version'); }
  } else throw new Error('Unknown vocabulary content kind');
}
function writeRelations(id: string, draft: VocabularyContentDraft): void {
  const db = getDb();
  db.prepare('DELETE FROM exercise_answer_words WHERE exercise_id = ?').run(id);
  db.prepare('DELETE FROM introduction_exercises WHERE introduction_id = ?').run(id);
  // Keep surviving mappings intact. Updating authored text never implicitly clears enrichment.
  const retained = new Set(draft.words.map((word) => word.wordId));
  const previous = db.prepare('SELECT word_id FROM content_words WHERE content_id = ?').all(id) as Array<{ word_id: string }>;
  for (const word of previous) if (!retained.has(word.word_id)) db.prepare('DELETE FROM content_words WHERE content_id = ? AND word_id = ?').run(id, word.word_id);
  for (const word of draft.words) {
    db.prepare(`INSERT INTO content_words(content_id,word_id,relation,sense_id,sense_mapping_established_at) VALUES (?,?,?,?,?)
      ON CONFLICT(content_id,word_id) DO UPDATE SET relation = excluded.relation`)
      .run(id, word.wordId, word.relation, word.senseId ?? null, word.senseMappingEstablishedAt ?? null);
  }
  if (draft.kind === 'exercise') {
    for (const answer of draft.answers) db.prepare('INSERT INTO exercise_answer_words(exercise_id,word_id,accepted_forms_json) VALUES (?,?,?)')
      .run(id, answer.wordId, JSON.stringify(answer.acceptedForms));
  } else {
    draft.teachingExercises.forEach((binding, position) => db.prepare(`INSERT INTO introduction_exercises
      (introduction_id,position,exercise_id,exercise_version) VALUES (?,?,?,?)`).run(id, position, binding.exerciseId, binding.exerciseVersion));
  }
}
function history(content: VocabularyContent, actor: VocabularyActor, strategy: 'create' | 'update_existing' | 'replace'): void {
  getDb().prepare(`INSERT INTO content_revision_history(change_id,content_id,version,previous_version,snapshot_json,
    change_kind,write_strategy,actor_kind,actor_id,reason_json,recorded_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(randomUUID(), content.contentId, content.version, content.version === 1 ? null : content.version - 1,
      JSON.stringify(content), content.version === 1 ? 'created' : content.availability === 'retired' ? 'retired' : 'updated',
      strategy, actor.kind, actor.id, actor.reason === undefined ? null : json(actor.reason), content.updatedAt);
}
function create(draft: VocabularyContentDraft, actor: VocabularyActor, strategy: 'create' | 'replace'): VocabularyContent {
  validateDraft(draft);
  const id = draft.contentId ?? randomUUID();
  const timestamp = now();
  getDb().prepare(`INSERT INTO content_items(content_id,kind,payload_version,body_json,exercise_type,skill,exercise_role,
    assessment_json,access_scope,owner_learner_id,availability,origin_kind,author_kind,author_id,version,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`).run(id,draft.kind,draft.payloadVersion,json(draft.body),
    draft.kind === 'exercise' ? draft.exerciseType : null,draft.kind === 'exercise' ? draft.skill : null,
    draft.kind === 'exercise' ? draft.exerciseRole : null,draft.kind === 'exercise' ? json(draft.assessment) : null,
    draft.accessScope,draft.ownerLearnerId ?? null,draft.availability,draft.originKind,draft.authorKind ?? null,draft.authorId ?? null,timestamp,timestamp);
  writeRelations(id, draft);
  const content = requiredContent(id);
  history(content, actor, strategy);
  effect('vocabulary.content.created','content',id,{ version: content.version, strategy },actor);
  return content;
}
export function createVocabularyContent(draft: VocabularyContentDraft, actor: VocabularyActor): VocabularyContent {
  actorCheck(actor);
  return atomic(() => create(draft, actor, 'create'));
}
function update(id: string, expectedVersion: number, draft: VocabularyContentDraft, actor: VocabularyActor,
  strategy: 'update_existing' | 'replace'): VocabularyContent {
  const old = requiredContent(id); expectVersion(old, expectedVersion); validateDraft(draft);
  draft = { ...draft, body: vocabularyAuthoredPromptBody(old.body, draft.body) };
  if ((draft.contentId !== undefined && draft.contentId !== id) || old.kind !== draft.kind
    || old.accessScope !== draft.accessScope || (old.ownerLearnerId ?? null) !== (draft.ownerLearnerId ?? null)
    || old.originKind !== draft.originKind || (old.authorKind ?? null) !== (draft.authorKind ?? null)
    || (old.authorId ?? null) !== (draft.authorId ?? null)
    || (old.kind === 'exercise' && draft.kind === 'exercise' && old.exerciseRole !== draft.exerciseRole)) {
    throw new Error('Identity, origin, ownership and serving role require replacement');
  }
  for (const word of draft.words) {
    const previous = old.words.find((entry) => entry.wordId === word.wordId);
    if (previous && ((word.senseId !== undefined && word.senseId !== (previous.senseId ?? null))
      || (word.senseMappingEstablishedAt !== undefined && word.senseMappingEstablishedAt !== (previous.senseMappingEstablishedAt ?? null)))) {
      throw new Error('Use the explicit sense-mapping operation to change an established relationship');
    }
  }
  getDb().prepare(`UPDATE content_items SET payload_version=?,body_json=?,exercise_type=?,skill=?,assessment_json=?,
    availability=?,version=version+1,updated_at=? WHERE content_id=? AND version=?`).run(draft.payloadVersion,json(draft.body),
    draft.kind === 'exercise' ? draft.exerciseType : null,draft.kind === 'exercise' ? draft.skill : null,
    draft.kind === 'exercise' ? json(draft.assessment) : null,draft.availability,now(),id,expectedVersion);
  writeRelations(id,draft);
  const content = requiredContent(id); history(content,actor,strategy);
  effect('vocabulary.content.updated','content',id,{ previousVersion: expectedVersion, version: content.version, strategy },actor);
  return content;
}
export function updateVocabularyContent(contentId: string, expectedVersion: number, draft: VocabularyContentDraft,
  actor: VocabularyActor): VocabularyContent {
  actorCheck(actor); return atomic(() => update(contentId,expectedVersion,draft,actor,'update_existing'));
}
export function replaceVocabularyContent(contentId: string, expectedVersion: number, replacement: VocabularyContentDraft,
  actor: VocabularyActor): { previous: VocabularyContent; replacement: VocabularyContent } {
  actorCheck(actor);
  return atomic(() => {
    const old = requiredContent(contentId); expectVersion(old,expectedVersion);
    if (replacement.contentId === contentId) throw new Error('Replacement requires a new content identity');
    if (replacement.accessScope !== old.accessScope || (replacement.ownerLearnerId ?? null) !== (old.ownerLearnerId ?? null)) {
      throw new Error('Replacement preserves ownership and access scope');
    }
    const next = create({ ...replacement, body: vocabularyAuthoredPromptBody(old.body, replacement.body) },actor,'replace');
    const previous = update(contentId,expectedVersion,{ ...old, availability: 'retired' },actor,'replace');
    effect('vocabulary.content.replaced','content',contentId,{ replacementId: next.contentId, previousVersion: previous.version },actor);
    return { previous, replacement: next };
  });
}

/** Base content eligibility only; caller must also apply learner deactivations and scheduling.
 * General pool only. Maintain requires explicit curation of the current authored version. */
export function listVocabularyExercises(input: { wordId: string; mode: VocabularyMode }): VocabularyContent[] {
  const learnerId = requireLearnerId();
  if (!['solidify','practice','maintain'].includes(input.mode)) throw new Error('Unknown vocabulary mode');
  const rows = getDb().prepare(`SELECT c.content_id FROM content_items c
    JOIN content_words w ON w.content_id=c.content_id AND w.word_id=? AND w.relation='target'
    LEFT JOIN content_mode_suitability s ON s.content_id=c.content_id AND s.mode=?
    WHERE c.kind='exercise' AND c.exercise_role='general' AND c.availability='active'
    AND (c.access_scope='shared' OR c.owner_learner_id=?)
    AND (? != 'maintain' OR (s.suitability='curated' AND s.assessed_content_version=c.version))
    ORDER BY c.content_id`).all(input.wordId,input.mode,learnerId,input.mode) as Array<{ content_id: string }>;
  const coverage=resolveVocabularySenseCoverage(input.wordId),included=new Set(coverage.includedSenseIds),excluded=new Set(coverage.word.excludedSenseIds);
  return rows.map((row) => requiredContent(row.content_id)).filter(content=>content.kind!=='exercise'||content.skill!=='production'||!content.words.some(word=>word.wordId===input.wordId&&word.senseId!=null&&(coverage.selectionEstablished?!included.has(word.senseId):excluded.has(word.senseId))));
}
/** Resolves exact teaching versions, but current retirement/quarantine/access always gates fresh serving. */
export function getVocabularyTeachingExercises(introductionId: string): VocabularyContent[] {
  const intro = getVocabularyContent(introductionId);
  if (!intro || intro.kind !== 'introduction' || intro.availability !== 'active') return [];
  const result: VocabularyContent[] = [];
  for (const binding of intro.teachingExercises) {
    const current = getVocabularyContent(binding.exerciseId);
    if (!current || current.kind !== 'exercise' || current.exerciseRole !== 'teaching' || current.availability !== 'active') return [];
    const version = getVocabularyContentVersion(binding.exerciseId,binding.exerciseVersion);
    if (!version || version.kind !== 'exercise' || version.exerciseRole !== 'teaching') throw new Error('Invalid retained teaching binding');
    // The binding pins authored material, while enrichment belongs to the live content-word identity.
    // Never add words introduced after the retained authored version to this encounter.
    const currentMappings = new Map(current.words.map((word) => [word.wordId,word]));
    result.push({ ...version,words: version.words.map((word) => {
      const mapping = currentMappings.get(word.wordId);
      return { ...word,senseId: mapping?.senseId ?? null,senseMappingEstablishedAt: mapping?.senseMappingEstablishedAt ?? null };
    }) });
  }
  return result;
}
export function mapVocabularyContentSense(input: {
  contentId: string; wordId: string; expectedContentVersion: number; expectedCatalogVersion?: number;
  expectedMapping: { senseId: string | null; establishedAt: string | null };
  senseId: string | null; establishedAt?: string;
}, actor: VocabularyActor): void {
  actorCheck(actor);
  atomic(() => {
    const content = requiredContent(input.contentId); expectVersion(content,input.expectedContentVersion);
    if (input.expectedCatalogVersion !== undefined && getVocabularySenseCatalog(input.wordId).version !== input.expectedCatalogVersion) {
      throw new VocabularyContentConflict('Sense catalog changed; reconsider the captured mapping input');
    }
    const word = content.words.find((item) => item.wordId === input.wordId);
    if (!word) throw new Error('Unknown content-word relationship');
    if ((word.senseId ?? null) !== input.expectedMapping.senseId || (word.senseMappingEstablishedAt ?? null) !== input.expectedMapping.establishedAt) {
      throw new VocabularyContentConflict('Sense mapping changed; reload before mapping');
    }
    const timestamp = input.establishedAt ?? now(); time(timestamp);
    getDb().prepare(`UPDATE content_words SET sense_id=?,sense_mapping_established_at=? WHERE content_id=? AND word_id=?`)
      .run(input.senseId,timestamp,input.contentId,input.wordId);
    effect('vocabulary.sense_mapping.established','content',input.contentId,
      { wordId: input.wordId, before: input.expectedMapping, after: { senseId: input.senseId, establishedAt: timestamp } },actor);
  });
}
export function curateVocabularyContent(input: { contentId: string; expectedVersion: number; mode: VocabularyMode;
  suitability: 'candidate' | 'curated' }, actor: VocabularyActor): void {
  actorCheck(actor);
  atomic(() => {
    const content = requiredContent(input.contentId); expectVersion(content,input.expectedVersion);
    const before = getDb().prepare(`SELECT suitability,assessed_content_version AS assessedContentVersion
      FROM content_mode_suitability WHERE content_id=? AND mode=?`).get(input.contentId,input.mode) as { suitability: string; assessedContentVersion: number } | undefined;
    getDb().prepare(`INSERT INTO content_mode_suitability(content_id,mode,suitability,assessed_content_version) VALUES (?,?,?,?)
      ON CONFLICT(content_id,mode) DO UPDATE SET suitability=excluded.suitability,assessed_content_version=excluded.assessed_content_version`)
      .run(input.contentId,input.mode,input.suitability,input.expectedVersion);
    effect('vocabulary.content.curated','content',input.contentId,{ mode: input.mode, before: before ? { ...before } : null,
      after: { suitability: input.suitability, assessedContentVersion: input.expectedVersion } },actor);
  });
}

type SenseRow = { sense_id: string; word_id: string; description_json: string; status: 'active' | 'retired';
  version: number; created_at: string; updated_at: string };
function senseFromRow(row: SenseRow): VocabularySense {
  return { senseId: row.sense_id, wordId: row.word_id, description: JSON.parse(row.description_json) as VocabularyJson,
    status: row.status, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at };
}
export function getVocabularySenses(wordId: string): VocabularySense[] {
  return (getDb().prepare('SELECT * FROM senses WHERE word_id=? ORDER BY created_at,sense_id').all(wordId) as SenseRow[]).map(senseFromRow);
}
export function getVocabularySenseCatalog(wordId: string): VocabularySenseCatalog {
  if (!getDb().prepare('SELECT 1 FROM lexical_words WHERE id=?').get(wordId)) throw new Error('Unknown lexical word');
  const row = getDb().prepare('SELECT sense_catalog_version,senses_established_at FROM vocabulary_word_catalogs WHERE word_id=?')
    .get(wordId) as { sense_catalog_version: number; senses_established_at: string | null } | undefined;
  return { wordId, version: row?.sense_catalog_version ?? 0, establishedAt: row?.senses_established_at ?? null };
}
function advanceCatalog(wordId: string, timestamp: string, establish: boolean): void {
  getDb().prepare(`INSERT INTO vocabulary_word_catalogs(word_id,sense_catalog_version,senses_established_at) VALUES (?,1,?)
    ON CONFLICT(word_id) DO UPDATE SET sense_catalog_version=sense_catalog_version+1,
    senses_established_at=CASE WHEN ? THEN COALESCE(senses_established_at,?) ELSE senses_established_at END`)
    .run(wordId,establish ? timestamp : null,establish ? 1 : 0,timestamp);
}
/** Explicitly distinguishes an established empty catalog from an unknown one. */
export function establishVocabularySenseCatalog(wordId: string, expectedVersion: number, actor: VocabularyActor): VocabularySenseCatalog {
  actorCheck(actor);
  return atomic(() => {
    const before = getVocabularySenseCatalog(wordId);
    if (before.version !== expectedVersion) throw new VocabularyContentConflict('Sense catalog changed');
    if (before.establishedAt !== null) return before;
    advanceCatalog(wordId,now(),true);
    const after = getVocabularySenseCatalog(wordId);
    effect('vocabulary.sense_catalog.established','word',wordId,{ before, after },actor);
    return after;
  });
}
function senseHistory(sense: VocabularySense, actor: VocabularyActor): void {
  getDb().prepare(`INSERT INTO sense_revision_history(change_id,sense_id,version,previous_version,snapshot_json,change_kind,
    actor_kind,actor_id,reason_json,recorded_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(),sense.senseId,sense.version,
    sense.version === 1 ? null : sense.version-1,JSON.stringify(sense),sense.version === 1 ? 'created' : sense.status === 'retired' ? 'retired' : 'updated',
    actor.kind,actor.id,actor.reason === undefined ? null : json(actor.reason),sense.updatedAt);
}
/** Creating a sense advances catalog inventory; establishing catalog scope is an explicit separate operation. */
export function createVocabularySense(input: { senseId?: string; wordId: string; description: VocabularyJson;
  status?: 'active' | 'retired' }, actor: VocabularyActor): VocabularySense {
  actorCheck(actor);
  return atomic(() => {
    const timestamp = now();
    const sense: VocabularySense = { senseId: input.senseId ?? randomUUID(),wordId: input.wordId,description: input.description,
      status: input.status ?? 'active',version: 1,createdAt: timestamp,updatedAt: timestamp };
    nonempty(sense.senseId,'sense identity');
    getDb().prepare('INSERT INTO senses(sense_id,word_id,description_json,status,version,created_at,updated_at) VALUES (?,?,?,?,1,?,?)')
      .run(sense.senseId,sense.wordId,json(sense.description),sense.status,timestamp,timestamp);
    senseHistory(sense,actor); advanceCatalog(sense.wordId,timestamp,false);
    effect('vocabulary.sense.created','sense',sense.senseId,{ wordId: sense.wordId, version: 1 },actor);
    return sense;
  });
}
export function updateVocabularySense(senseId: string, expectedVersion: number,
  input: { description: VocabularyJson; status: 'active' | 'retired' }, actor: VocabularyActor): VocabularySense {
  actorCheck(actor);
  return atomic(() => {
    const row = getDb().prepare('SELECT * FROM senses WHERE sense_id=?').get(senseId) as SenseRow | undefined;
    if (!row) throw new Error('Unknown sense');
    if (row.version !== expectedVersion) throw new VocabularyContentConflict('Sense changed; reload before saving');
    const sense = { ...senseFromRow(row),...input,version: row.version+1,updatedAt: now() };
    getDb().prepare('UPDATE senses SET description_json=?,status=?,version=?,updated_at=? WHERE sense_id=?')
      .run(json(input.description),input.status,sense.version,sense.updatedAt,senseId);
    senseHistory(sense,actor); advanceCatalog(sense.wordId,sense.updatedAt,false);
    effect('vocabulary.sense.updated','sense',senseId,{ previousVersion: expectedVersion,version: sense.version },actor);
    return sense;
  });
}
