import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import type { VocabularyContent, VocabularyJson } from '../../src/domain/vocabulary-content.ts';
import type { VocabularyContentProposal, VocabularyProposalOperation } from '../../src/domain/vocabulary-reflection.ts';

export const SHARED_DICTIONARY_BASELINES_MIGRATION = 'app_schema:0058_shared_dictionary_baselines';
const baselineAuthor = 'vocabulary-dictionary-baseline-v1';
const object = (value: VocabularyJson): Record<string, VocabularyJson> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
const same = isDeepStrictEqual;

type Candidate = { content_id: string; version: number; owner_learner_id: string; availability: VocabularyContent['availability'];
  body_json: string; assessment_json: string; snapshot_json: string; original_json: string };
type Promotion = { before: VocabularyContent; after: VocabularyContent };

/** Only stock corpus material is eligible; edits and privately imported content are outside this repair. */
function stockBaseline(db: DatabaseSync, row: Candidate): VocabularyContent | null {
  const content = JSON.parse(row.snapshot_json) as VocabularyContent;
  const original = JSON.parse(row.original_json) as VocabularyContent;
  if (content.kind !== 'exercise' || original.kind !== 'exercise' || content.authorKind !== 'service'
    || content.authorId !== baselineAuthor || content.accessScope !== 'private' || content.ownerLearnerId !== row.owner_learner_id
    || !['recognition','production'].includes(content.skill) || content.payloadVersion !== 1 || original.payloadVersion !== 1
    || content.exerciseType !== (content.skill === 'recognition' ? 'recognition' : 'definition')
    || original.exerciseType !== content.exerciseType || content.words.length !== 1 || content.words[0]!.relation !== 'target'
    || content.contentId !== `vocabulary:baseline:v1:${row.owner_learner_id}:${content.skill}:${content.exerciseRole}:${content.words[0]!.wordId}`) return null;
  const body = object(content.body), source = body && object(body.source ?? null);
  const keys = content.skill === 'production' ? ['instruction','prompt','source'] : ['answer','pinyin','prompt','source'];
  if (!body || !source || !same(Object.keys(body).sort(), keys.sort()) || !same(Object.keys(source).sort(), ['kind','wordId'])
    || source.kind !== 'dictionary_baseline' || source.wordId !== content.words[0]!.wordId || typeof body.prompt !== 'string'
    || (content.skill === 'production' ? body.instruction !== 'Give the Mandarin word.' : typeof body.answer !== 'string' || typeof body.pinyin !== 'string')
    || !same(content.body, original.body) || !same(content.answers, original.answers) || !same(content.assessment, original.assessment)
    || !same(content.body, JSON.parse(row.body_json)) || !same(content.assessment, JSON.parse(row.assessment_json))) return null;
  const answers = db.prepare('SELECT word_id,accepted_forms_json FROM exercise_answer_words WHERE exercise_id=? ORDER BY word_id')
    .all(row.content_id) as {word_id:string;accepted_forms_json:string}[];
  if (!same(content.answers, answers.map(answer => ({wordId:answer.word_id,acceptedForms:JSON.parse(answer.accepted_forms_json)})))) return null;
  const words = db.prepare(`SELECT word_id AS wordId,relation,sense_id AS senseId,sense_mapping_established_at AS senseMappingEstablishedAt
    FROM content_words WHERE content_id=? ORDER BY word_id`).all(row.content_id) as VocabularyContent['words'];
  if (words.length !== 1 || words[0]!.wordId !== source.wordId || words[0]!.relation !== 'target') return null;
  return {...content, version:row.version, availability:row.availability, words};
}
function event(db: DatabaseSync, name: string, id: string, data: unknown, at: string): void {
  db.prepare(`INSERT INTO backend_events(event_id,occurred_at,recorded_at,name,payload_version,data_json,actor_kind,actor_id,entity_kind,entity_id)
    VALUES(?,?,?,?,1,?,'service',?,?,?)`).run(randomUUID(),at,at,name,JSON.stringify(data),SHARED_DICTIONARY_BASELINES_MIGRATION,name.startsWith('vocabulary.content.')?'content':'reflection',id);
}

/** Offline runner owns the transaction; existing historical snapshots and learner state stay intact. */
export function migrateSharedDictionaryBaselines(db: DatabaseSync): void {
  if (!db.isTransaction) throw new Error('Dictionary baseline migration requires the offline migration transaction');
  const rows = db.prepare(`SELECT c.content_id,c.version,c.owner_learner_id,c.availability,c.body_json,c.assessment_json,
      h.snapshot_json,initial.snapshot_json AS original_json FROM content_items c
    JOIN content_revision_history h ON h.content_id=c.content_id AND h.version=c.version
    JOIN content_revision_history initial ON initial.content_id=c.content_id AND initial.version=1
    WHERE c.kind='exercise' AND c.access_scope='private' AND c.author_kind='service' AND c.author_id=?
      AND json_extract(c.body_json,'$.source.kind')='dictionary_baseline'`).all(baselineAuthor) as Candidate[];
  const promotions = new Map<string, Promotion>();
  const at = new Date().toISOString();
  for (const row of rows) {
    const before = stockBaseline(db,row);
    if (before) promotions.set(row.content_id,{before,after:{...before,accessScope:'shared',ownerLearnerId:null,version:before.version+1,updatedAt:at}});
  }
  if (!promotions.size) return;
  const trigger = db.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name='vocabulary_content_identity'").get() as {sql:string} | undefined;
  if (!trigger) throw new Error('Dictionary baseline migration requires the content identity guard');
  db.exec('DROP TRIGGER vocabulary_content_identity');
  for (const {before,after} of promotions.values()) {
    db.prepare("UPDATE content_items SET access_scope='shared',owner_learner_id=NULL,version=?,updated_at=? WHERE content_id=? AND version=?")
      .run(after.version,at,after.contentId,before.version);
    db.prepare(`INSERT INTO content_revision_history(change_id,content_id,version,previous_version,snapshot_json,change_kind,
      write_strategy,actor_kind,actor_id,reason_json,recorded_at) VALUES(?,?,?,?,?,'updated','update_existing','service',?,?,?)`)
      .run(randomUUID(),after.contentId,after.version,before.version,JSON.stringify(after),SHARED_DICTIONARY_BASELINES_MIGRATION,
        JSON.stringify({migration:SHARED_DICTIONARY_BASELINES_MIGRATION,scopeOnly:true}),at);
    event(db,'vocabulary.content.dictionary_baseline_shared',after.contentId,{previousVersion:before.version,version:after.version},at);
  }
  db.exec(trigger.sql);

  const proposals = db.prepare(`SELECT p.proposal_id,p.version,h.snapshot_json FROM content_proposals p
    JOIN proposal_revision_history h ON h.proposal_id=p.proposal_id AND h.version=p.version
    WHERE p.status IN ('draft','awaiting_review','approved') AND p.author_kind='service' AND p.author_id='vocabulary-reflection'
      AND h.actor_kind='service' AND h.actor_id='vocabulary-reflection'`)
    .all() as {proposal_id:string;version:number;snapshot_json:string}[];
  for (const row of proposals) {
    const previous = JSON.parse(row.snapshot_json) as VocabularyContentProposal;
    const bases = db.prepare('SELECT content_id AS contentId,expected_content_version AS expectedVersion FROM proposal_content_bases WHERE proposal_id=? ORDER BY content_id')
      .all(row.proposal_id) as VocabularyContentProposal['bases'];
    if (!previous.operations.length || !bases.length || bases.some(base => promotions.get(base.contentId)?.before.version !== base.expectedVersion)) continue;
    const operations: VocabularyProposalOperation[] = [];
    for (const op of previous.operations) {
      if(op.strategy!=='create'&&op.strategy!=='update_existing'&&op.strategy!=='replace')break;
      const body = object(op.content.body), source = body && object(body.source ?? null);
      const promotion = source && typeof source.assessedContentId === 'string' ? promotions.get(source.assessedContentId) : undefined;
      if (!promotion || source?.kind !== 'vocabulary_repertoire' || source.assessedContentVersion !== promotion.before.version
        || op.scope.kind !== 'learner' || op.scope.learnerId !== promotion.before.ownerLearnerId
        || op.content.accessScope !== 'private' || op.content.ownerLearnerId !== promotion.before.ownerLearnerId
        || (op.strategy !== 'create' && (op.sourceContentId !== promotion.before.contentId || op.expectedVersion !== promotion.before.version))) break;
      const content = {...op.content,accessScope:'shared' as const,ownerLearnerId:null};
      const common = {operationKey:op.operationKey,rationale:op.rationale,scope:{kind:'shared' as const},content};
      operations.push(op.strategy === 'create' ? {...common,strategy:'create'}
        : {...common,strategy:op.strategy,sourceContentId:op.sourceContentId,expectedVersion:promotion.after.version});
    }
    if (operations.length !== previous.operations.length) continue;
    const next: VocabularyContentProposal = {...previous,version:row.version+1,status:'awaiting_review',operations,
      bases:bases.map(base => ({...base,expectedVersion:promotions.get(base.contentId)!.after.version}))};
    db.prepare("UPDATE content_proposals SET version=?,status='awaiting_review',operations_json=?,updated_at=? WHERE proposal_id=?")
      .run(next.version,JSON.stringify(operations),at,row.proposal_id);
    for (const base of next.bases) db.prepare('UPDATE proposal_content_bases SET expected_content_version=? WHERE proposal_id=? AND content_id=?')
      .run(base.expectedVersion,row.proposal_id,base.contentId);
    db.prepare('INSERT INTO proposal_revision_history VALUES(?,?,?,\'service\',?,?)')
      .run(row.proposal_id,next.version,JSON.stringify(next),SHARED_DICTIONARY_BASELINES_MIGRATION,at);
    event(db,'vocabulary.reflection.repertoire_scope_corrected',row.proposal_id,{previousVersion:row.version,version:next.version},at);
  }
}

/** Permit the audited scope-only revision, while substantive authoring drift keeps the ordinary fence. */
export function resolveSharedDictionaryBaselineRevision(db: DatabaseSync, content: VocabularyContent): VocabularyContent {
  if (content.accessScope !== 'private' || content.authorId !== baselineAuthor) return content;
  const row = db.prepare(`SELECT h.snapshot_json,h.reason_json FROM content_items c JOIN content_revision_history h
    ON h.content_id=c.content_id AND h.version=c.version
    WHERE c.content_id=? AND c.version=? AND c.access_scope='shared' AND c.owner_learner_id IS NULL
      AND h.actor_kind='service' AND h.actor_id=?`).get(content.contentId,content.version+1,SHARED_DICTIONARY_BASELINES_MIGRATION) as {snapshot_json:string;reason_json:string} | undefined;
  if (!row || !same(JSON.parse(row.reason_json),{migration:SHARED_DICTIONARY_BASELINES_MIGRATION,scopeOnly:true})) return content;
  const promoted = JSON.parse(row.snapshot_json) as VocabularyContent;
  // Sense mappings are mutable identity relationships, independently fenced by admission.
  const expected = {...content,accessScope:'shared',ownerLearnerId:null,version:content.version+1,updatedAt:promoted.updatedAt};
  return same({...promoted,words:content.words},expected) ? promoted : content;
}
