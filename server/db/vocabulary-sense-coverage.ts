import { createHash,randomUUID } from 'node:crypto';
import type { VocabularyActor } from '../../src/domain/vocabulary-content.ts';
import type { VocabularyEffectiveSenseCoverage,VocabularyWordSenseCoverage,VocabularyCaseSenseCoverage,VocabularySenseCoverageWorkspace } from '../../src/domain/vocabulary-sense-coverage.ts';
import { config,getDb } from './connection.ts';
import { isOperatorSubject,parseOperatorAllowlist } from '../operator-access.ts';
import { emitBackendEvent,getVocabularySenses } from './vocabulary-content.ts';

export class VocabularySenseCoverageConflict extends Error {}
function authorize(actorId:string):void {
  if(!isOperatorSubject(actorId,parseOperatorAllowlist(),config.authMode))throw new Error('Operator access required');
}
function wordExists(wordId:string):void {
  if(!getDb().prepare('SELECT 1 FROM lexical_words WHERE id=?').get(wordId))throw new Error('Unknown vocabulary word');
}
export function getVocabularyWordSenseCoverage(wordId:string):VocabularyWordSenseCoverage {
  wordExists(wordId);
  const row=getDb().prepare('SELECT version,excluded_sense_ids_json,default_useful_sense_ids_json FROM vocabulary_word_sense_coverage WHERE word_id=?').get(wordId) as {version:number;excluded_sense_ids_json:string;default_useful_sense_ids_json:string|null}|undefined;
  return {wordId,version:row?.version??0,excludedSenseIds:row?JSON.parse(row.excluded_sense_ids_json) as string[]:[],defaultUsefulSenseIds:row?.default_useful_sense_ids_json?JSON.parse(row.default_useful_sense_ids_json) as string[]:null};
}
/** Shared word policy only. Historical case scopes are retained as audit records. */
export function resolveVocabularySenseCoverage(wordId:string):VocabularyEffectiveSenseCoverage {
  const word=getVocabularyWordSenseCoverage(wordId);
  const active=getVocabularySenses(wordId).filter(sense=>sense.status==='active').map(sense=>sense.senseId).sort();
  const selectionEstablished=word.defaultUsefulSenseIds!==null;
  const includedSenseIds=selectionEstablished?active.filter(id=>word.defaultUsefulSenseIds!.includes(id)):[];
  const fingerprint=createHash('sha256').update(JSON.stringify({word,active,includedSenseIds,selectionEstablished})).digest('hex');
  return {word,review:null,includedSenseIds,selectionEstablished,fingerprint};
}
export function getVocabularySenseCoverageWorkspace(scope:'word',wordId:string,actorId:string):VocabularySenseCoverageWorkspace {
  authorize(actorId);
  const counts=getDb().prepare(`SELECT w.sense_id,count(DISTINCT c.content_id) AS count FROM content_words w JOIN content_items c USING(content_id)
    WHERE w.word_id=? AND w.relation='target' AND w.sense_id IS NOT NULL AND c.kind='exercise' AND c.exercise_role='general' AND c.skill='production' AND c.availability='active' GROUP BY w.sense_id`).all(wordId) as {sense_id:string;count:number}[];
  return {...resolveVocabularySenseCoverage(wordId),senses:getVocabularySenses(wordId),productionExerciseCounts:Object.fromEntries(counts.map(row=>[row.sense_id,row.count]))};
}
function ids(value:string[],wordId:string):string[] {
  const known=new Set(getVocabularySenses(wordId).filter(sense=>sense.status==='active').map(sense=>sense.senseId));
  if(!Array.isArray(value)||value.some(id=>typeof id!=='string'||!known.has(id))||new Set(value).size!==value.length)throw new Error('Expected distinct active senses belonging to this word');
  return [...value].sort();
}
function atomic<T>(work:()=>T):T {
  const db=getDb(),point=`coverage_${randomUUID().replaceAll('-','')}`;db.exec(`SAVEPOINT ${point}`);
  try{const result=work();db.exec(`RELEASE ${point}`);return result;}catch(error){db.exec(`ROLLBACK TO ${point}; RELEASE ${point}`);throw error;}
}
function history(scope:'word'|'case',id:string,version:number,snapshot:VocabularyWordSenseCoverage|VocabularyCaseSenseCoverage,actor:VocabularyActor):void {
  if(!actor.id.trim()||(actor.kind!=='operator'&&actor.kind!=='service'))throw new Error('Expected explicit coverage actor');
  const actorId=actor.id;
  const at=new Date().toISOString();
  const attributed={...snapshot,...(actor.reason===undefined?{}:{reason:actor.reason})};
  getDb().prepare('INSERT INTO vocabulary_sense_coverage_history(change_id,scope,subject_id,version,snapshot_json,actor_id,recorded_at) VALUES (?,?,?,?,?,?,?)').run(randomUUID(),scope,id,version,JSON.stringify(attributed),actorId,at);
  emitBackendEvent({name:'vocabulary.sense_coverage.updated',entityKind:scope==='word'?'word':'vocabulary_reflection_case',entityId:id,actorKind:actor.kind,actorId,data:{scope,...attributed}});
}
/** Explicit shared selection. NULL is reserved for unreviewed legacy state, never a writer default. */
export function writeVocabularyDefaultUsefulSenses(wordId:string,expectedVersion:number,includedSenseIds:string[],actor:VocabularyActor):VocabularyEffectiveSenseCoverage {
  return atomic(()=>{
    const before=getVocabularyWordSenseCoverage(wordId);if(before.version!==expectedVersion)throw new VocabularySenseCoverageConflict('Word sense coverage changed; reload before saving');
    const included=ids(includedSenseIds,wordId),excluded=getVocabularySenses(wordId).filter(sense=>sense.status==='active'&&!included.includes(sense.senseId)).map(sense=>sense.senseId).sort(),version=before.version+1;
    getDb().prepare('INSERT INTO vocabulary_word_sense_coverage(word_id,version,excluded_sense_ids_json,default_useful_sense_ids_json,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(word_id) DO UPDATE SET version=excluded.version,excluded_sense_ids_json=excluded.excluded_sense_ids_json,default_useful_sense_ids_json=excluded.default_useful_sense_ids_json,updated_at=excluded.updated_at').run(wordId,version,JSON.stringify(excluded),JSON.stringify(included),new Date().toISOString());
    history('word',wordId,version,{wordId,version,excludedSenseIds:excluded,defaultUsefulSenseIds:included},actor);return resolveVocabularySenseCoverage(wordId);
  });
}
/** Backward-compatible operator exclusion control explicitly establishes the complementary selection. */
export function writeVocabularyWordSenseCoverage(wordId:string,expectedVersion:number,excludedSenseIds:string[],actor:VocabularyActor):VocabularyEffectiveSenseCoverage {
  const excluded=ids(excludedSenseIds,wordId);
  return writeVocabularyDefaultUsefulSenses(wordId,expectedVersion,getVocabularySenses(wordId).filter(sense=>sense.status==='active'&&!excluded.includes(sense.senseId)).map(sense=>sense.senseId),actor);
}
export function setVocabularyWordSenseCoverage(wordId:string,expectedVersion:number,excludedSenseIds:string[],actorId:string):VocabularySenseCoverageWorkspace {
  authorize(actorId);writeVocabularyWordSenseCoverage(wordId,expectedVersion,excludedSenseIds,{kind:'operator',id:actorId});return getVocabularySenseCoverageWorkspace('word',wordId,actorId);
}
export function setVocabularyDefaultUsefulSenses(wordId:string,expectedVersion:number,includedSenseIds:string[],actorId:string):VocabularySenseCoverageWorkspace {
  authorize(actorId);writeVocabularyDefaultUsefulSenses(wordId,expectedVersion,includedSenseIds,{kind:'operator',id:actorId});return getVocabularySenseCoverageWorkspace('word',wordId,actorId);
}

/** Read-only operator finding; any explicit policy, including [], resolves unknown-selection attention. */
export function getVocabularyDefaultSelectionFinding(wordId:string):import('../../src/domain/vocabulary-sense-coverage.ts').VocabularyDefaultSelectionFinding|null {
  if(getVocabularyWordSenseCoverage(wordId).defaultUsefulSenseIds!==null)return null;
  const row=getDb().prepare("SELECT last_error,invocation_id,recommendation_json FROM vocabulary_default_selection_readiness WHERE word_id=? AND status='failed'").get(wordId) as {last_error:string|null;invocation_id:string|null;recommendation_json:string|null}|undefined;
  if(!row)return null;
  const recommendation=row.recommendation_json?JSON.parse(row.recommendation_json) as {senseIds?:unknown}:null;
  return {status:'needs_operator',reason:row.last_error==='default_selection_failed'?'Default useful selection could not finish after its bounded retries. Select useful senses or retry initialization.':row.last_error??'Default useful selection needs operator review.',invocationId:row.invocation_id,recommendedSenseIds:Array.isArray(recommendation?.senseIds)?recommendation.senseIds.filter((id:unknown):id is string=>typeof id==='string'):[]};
}

/** Word-level attention survives completion or approval of the originating assessment. */
export function listVocabularyDefaultSelectionFindings(actorId:string):import('../../src/domain/vocabulary-sense-coverage.ts').VocabularyDefaultSelectionAttention[] {
  authorize(actorId);
  const rows=getDb().prepare(`SELECT r.word_id AS wordId,w.hanzi,j.case_id AS caseId
    FROM vocabulary_default_selection_readiness r JOIN lexical_words w ON w.id=r.word_id
    LEFT JOIN vocabulary_word_sense_coverage c ON c.word_id=r.word_id
    LEFT JOIN vocabulary_reflection_jobs j ON j.job_id=r.workflow_id
    WHERE r.status='failed' AND c.default_useful_sense_ids_json IS NULL
    ORDER BY r.updated_at,r.word_id`).all() as {wordId:string;hanzi:string;caseId:string|null}[];
  return rows.map(row=>{const finding=getVocabularyDefaultSelectionFinding(row.wordId);if(!finding)throw new Error('Unknown selection attention lost its finding during a synchronous read');return {...row,...finding};});
}
