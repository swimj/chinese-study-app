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
function caseWord(caseId:string):string {
  const row=getDb().prepare('SELECT word_id FROM reflection_cases WHERE case_id=?').get(caseId) as {word_id:string|null}|undefined;
  if(!row?.word_id)throw new Error('Unknown vocabulary word review');
  return row.word_id;
}
export function getVocabularyWordSenseCoverage(wordId:string):VocabularyWordSenseCoverage {
  wordExists(wordId);
  const row=getDb().prepare('SELECT version,excluded_sense_ids_json,default_useful_sense_ids_json FROM vocabulary_word_sense_coverage WHERE word_id=?').get(wordId) as {version:number;excluded_sense_ids_json:string;default_useful_sense_ids_json:string|null}|undefined;
  return {wordId,version:row?.version??0,excludedSenseIds:row?JSON.parse(row.excluded_sense_ids_json) as string[]:[],defaultUsefulSenseIds:row?.default_useful_sense_ids_json?JSON.parse(row.default_useful_sense_ids_json) as string[]:null};
}
function reviewCoverage(caseId:string,wordId:string):VocabularyCaseSenseCoverage {
  const row=getDb().prepare('SELECT version,included_sense_ids_json FROM vocabulary_case_sense_coverage WHERE case_id=?').get(caseId) as {version:number;included_sense_ids_json:string|null}|undefined;
  return {caseId,wordId,version:row?.version??0,includedSenseIds:row?.included_sense_ids_json?JSON.parse(row.included_sense_ids_json) as string[]:null};
}
export function resolveVocabularySenseCoverage(wordId:string,caseId?:string):VocabularyEffectiveSenseCoverage {
  const word=getVocabularyWordSenseCoverage(wordId),review=caseId?reviewCoverage(caseId,wordId):null;
  const active=getVocabularySenses(wordId).filter(sense=>sense.status==='active').map(sense=>sense.senseId).sort();
  const selected=review?.includedSenseIds;
  const selectionEstablished=(selected!==null&&selected!==undefined)||word.defaultUsefulSenseIds!==null;
  const includedSenseIds=selectionEstablished?active.filter(id=>selected!==null&&selected!==undefined?selected.includes(id):word.defaultUsefulSenseIds!.includes(id)):[];
  // Policy context is metadata; generation captures its own targets independently.
  const fingerprint=createHash('sha256').update(JSON.stringify({word,review,active,includedSenseIds,selectionEstablished})).digest('hex');
  return {word,review,includedSenseIds,selectionEstablished,fingerprint};
}
export function getVocabularySenseCoverageWorkspace(scope:'word'|'case',id:string,actorId:string):VocabularySenseCoverageWorkspace {
  authorize(actorId);const wordId=scope==='word'?id:caseWord(id);
  const counts=getDb().prepare(`SELECT w.sense_id,count(DISTINCT c.content_id) AS count FROM content_words w JOIN content_items c USING(content_id)
    WHERE w.word_id=? AND w.relation='target' AND w.sense_id IS NOT NULL AND c.kind='exercise' AND c.exercise_role='general' AND c.skill='production' AND c.availability='active' GROUP BY w.sense_id`).all(wordId) as {sense_id:string;count:number}[];
  return {...resolveVocabularySenseCoverage(wordId,scope==='case'?id:undefined),senses:getVocabularySenses(wordId),productionExerciseCounts:Object.fromEntries(counts.map(row=>[row.sense_id,row.count]))};
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
export function writeVocabularyCaseSenseCoverage(caseId:string,expectedVersion:number,includedSenseIds:string[]|null,actor:VocabularyActor):VocabularyEffectiveSenseCoverage {
  const actorId=actor.id;return atomic(()=>{
    const wordId=caseWord(caseId),before=reviewCoverage(caseId,wordId);if(before.version!==expectedVersion)throw new VocabularySenseCoverageConflict('Review sense coverage changed; reload before saving');
    const included=includedSenseIds===null?null:ids(includedSenseIds,wordId),version=before.version+1;
    getDb().prepare('INSERT INTO vocabulary_case_sense_coverage(case_id,version,included_sense_ids_json,updated_at) VALUES (?,?,?,?) ON CONFLICT(case_id) DO UPDATE SET version=excluded.version,included_sense_ids_json=excluded.included_sense_ids_json,updated_at=excluded.updated_at').run(caseId,version,included===null?null:JSON.stringify(included),new Date().toISOString());
    history('case',caseId,version,{caseId,wordId,version,includedSenseIds:included},actor);return resolveVocabularySenseCoverage(wordId,caseId);
  });
}
export function inheritVocabularyCaseSenseCoverage(sourceCaseId:string,childCaseId:string,actorId:string):void {
  const row=getDb().prepare('SELECT included_sense_ids_json FROM vocabulary_case_sense_coverage WHERE case_id=?').get(sourceCaseId) as {included_sense_ids_json:string|null}|undefined;
  if(!row?.included_sense_ids_json)return;
  const source=reviewCoverage(sourceCaseId,caseWord(sourceCaseId));
  if(source.includedSenseIds!==null)setVocabularyCaseSenseCoverage(childCaseId,0,source.includedSenseIds,actorId);
}

export function setVocabularyWordSenseCoverage(wordId:string,expectedVersion:number,excludedSenseIds:string[],actorId:string):VocabularySenseCoverageWorkspace {
  authorize(actorId);writeVocabularyWordSenseCoverage(wordId,expectedVersion,excludedSenseIds,{kind:'operator',id:actorId});return getVocabularySenseCoverageWorkspace('word',wordId,actorId);
}
export function setVocabularyCaseSenseCoverage(caseId:string,expectedVersion:number,includedSenseIds:string[]|null,actorId:string):VocabularySenseCoverageWorkspace {
  authorize(actorId);writeVocabularyCaseSenseCoverage(caseId,expectedVersion,includedSenseIds,{kind:'operator',id:actorId});return getVocabularySenseCoverageWorkspace('case',caseId,actorId);
}

export function setVocabularyDefaultUsefulSenses(wordId:string,expectedVersion:number,includedSenseIds:string[],actorId:string):VocabularySenseCoverageWorkspace {
  authorize(actorId);writeVocabularyDefaultUsefulSenses(wordId,expectedVersion,includedSenseIds,{kind:'operator',id:actorId});return getVocabularySenseCoverageWorkspace('word',wordId,actorId);
}
