import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { createBaselineFixture } from './helpers/baseline-database.ts';
import { migrateDatabase } from '../server/db/migrations.ts';
import { setDb } from '../server/db/connection.ts';
import { runWithLearnerId } from '../server/db/learner-context.ts';
import { addVocabularyWord, getVocabularyLearnerWord, getVocabularyWordSchedule, VocabularyStateConflict } from '../server/db/vocabulary-learners.ts';
import { createVocabularyContent, createVocabularySense, establishVocabularySenseCatalog, getVocabularySenseCatalog, listVocabularyExercises, updateVocabularySense } from '../server/db/vocabulary-content.ts';
import { getVocabularyWordSenseCoverage, writeVocabularyDefaultUsefulSenses } from '../server/db/vocabulary-sense-coverage.ts';
import { resolveVocabularyLearnerSenseScope, vocabularyLearnerSenseIsEligible, writeVocabularyLearnerSenseScope } from '../server/db/vocabulary-learner-senses.ts';
import { canServeVocabularyReviewProduction, isVocabularyProductionProxied } from '../server/vocabulary/production-coverage.ts';

let root: string; let baseline: string; let db: DatabaseSync;
const actor = {kind:'service' as const,id:'fixture'};
const owner = <T>(fn: () => T) => runWithLearnerId('a',fn);
before(() => {
  root=fs.mkdtempSync(path.join(os.tmpdir(),'learner-senses-'));
  createBaselineFixture(path.join(root,'baseline'));baseline=path.join(root,'baseline','app.db');
});
after(() => fs.rmSync(root,{recursive:true,force:true}));
beforeEach(() => {
  const file=path.join(root,`${Math.random()}.db`);fs.copyFileSync(baseline,file);db=new DatabaseSync(file);
  db.function('current_learner_id',()=> 'a');db.exec('PRAGMA foreign_keys=ON');migrateDatabase(db);setDb(db);
  const now=new Date().toISOString();
  db.prepare("INSERT INTO learners(learner_id,display_name,created_at) VALUES ('a','A',?),('b','B',?)").run(now,now);
  for (const wordId of ['w','other']) db.prepare(`INSERT INTO lexical_words(id,hanzi,pinyin,meaning,meanings_json,examples_json,priority,created_at)
    VALUES (?,?,'cí','word','["word"]','[]',1,?)`).run(wordId,wordId,now);
  for (const senseId of ['s1','s2','s3']) createVocabularySense({senseId,wordId:'w',description:{label:senseId,notes:[]}},actor);
  createVocabularySense({senseId:'foreign',wordId:'other',description:{label:'other'}},actor);
  establishVocabularySenseCatalog('w',getVocabularySenseCatalog('w').version,actor);
  for (const learner of ['a','b']) runWithLearnerId(learner,()=>addVocabularyWord('w'));
});
afterEach(() => db.close());
function defaults(ids: string[]) {writeVocabularyDefaultUsefulSenses('w',getVocabularyWordSenseCoverage('w').version,ids,actor);}
function choose(ids: string[], targetSenseId?: string) {
  const scope=resolveVocabularyLearnerSenseScope('w');
  return writeVocabularyLearnerSenseScope('w',{senseIds:ids,targetSenseId,expectedStateVersion:scope.stateVersion!,
    expectedCatalogVersion:scope.catalogVersion,expectedSelectionVersion:scope.selectionVersion,surface:'test'});
}
function exercise(id:string,senseId:string|null,skill='production',pure=false) {
  return createVocabularyContent({contentId:id,kind:'exercise',payloadVersion:1,body:{prompt:id},accessScope:'shared',availability:'active',originKind:'human',
    words:[{wordId:'w',relation:'target',senseId,senseMappingEstablishedAt:senseId?new Date().toISOString():null}],exerciseType:pure?'pure_cue':'word',skill,exerciseRole:'general',assessment:{match:'prepared'},answers:[{wordId:'w',acceptedForms:['w']}]},actor);
}

for (const selected of [null,[],['s1','s2']] as const) test(`effective scope with ${JSON.stringify(selected)} defaults applies private overrides and omits retired identities`,()=>owner(()=>{
  if (selected!==null) defaults([...selected]);
  const without=resolveVocabularyLearnerSenseScope('w');assert.deepEqual(without.includedSenseIds,selected??[]);
  db.exec("INSERT INTO learner_senses VALUES ('a','w','s1','excluded'),('a','w','s3','active')");
  const scope=resolveVocabularyLearnerSenseScope('w');
  assert.equal(scope.selectionEstablished,selected!==null);
  assert.deepEqual(scope.includedSenseIds,selected?.length?['s2','s3']:['s3']);
  assert.equal(vocabularyLearnerSenseIsEligible(scope,'s1'),false);
  assert.equal(vocabularyLearnerSenseIsEligible(scope,'s3'),true);
  assert.equal(vocabularyLearnerSenseIsEligible(scope,'s2'),selected===null||selected.length>0);
  assert.deepEqual(runWithLearnerId('b',()=>resolveVocabularyLearnerSenseScope('w').includedSenseIds),selected??[]);
  updateVocabularySense('s3',1,{description:{label:'retired'},status:'retired'},actor);
  assert.ok(!resolveVocabularyLearnerSenseScope('w').includedSenseIds.includes('s3'));
  assert.equal(db.prepare("SELECT disposition FROM learner_senses WHERE learner_id='a' AND sense_id='s3'").get()!.disposition,'active');
}));

test('confirmation stores only deviations plus target, preserves scheduling, and follows later defaults',()=>owner(()=>{
  defaults(['s1','s2']);const schedule=getVocabularyWordSchedule('w');const original=getVocabularyLearnerWord('w')!;
  const chosen=choose(['s1','s3'],'s1');
  assert.deepEqual(chosen.choices,[{senseId:'s1',disposition:'active'},{senseId:'s2',disposition:'excluded'},{senseId:'s3',disposition:'active'}]);
  assert.equal(chosen.stateVersion,original.stateVersion+1);assert.ok(chosen.scopeEstablishedAt);
  assert.deepEqual(getVocabularyWordSchedule('w'),schedule);assert.equal(getVocabularyLearnerWord('w')!.mode,original.mode);
  defaults(['s2']);assert.deepEqual(resolveVocabularyLearnerSenseScope('w').includedSenseIds,['s1','s3']);
  const reset=choose(['s2']);assert.deepEqual(reset.choices,[]);
  defaults(['s1','s2']);assert.deepEqual(resolveVocabularyLearnerSenseScope('w').includedSenseIds,['s1','s2']);
  assert.equal(db.prepare("SELECT count(*) AS n FROM backend_events WHERE name='vocabulary.learner_senses.changed' AND learner_id='a'").get()!.n,2);
}));

test('confirmation preserves retired history and other words and can save private context',()=>owner(()=>{
  defaults(['s1']);choose(['s1','s3']);updateVocabularySense('s3',1,{description:{label:'retired'},status:'retired'},actor);
  addVocabularyWord('other');db.exec("INSERT INTO learner_senses VALUES ('a','other','foreign','active')");
  const scope=resolveVocabularyLearnerSenseScope('w');writeVocabularyLearnerSenseScope('w',{senseIds:['s1'],expectedStateVersion:scope.stateVersion!,
    expectedCatalogVersion:scope.catalogVersion,expectedSelectionVersion:scope.selectionVersion,surface:'chat',intendedUseText:'private context'});
  assert.equal(getVocabularyLearnerWord('w')!.intendedUseText,'private context');
  assert.equal(runWithLearnerId('b',()=>getVocabularyLearnerWord('w')!.intendedUseText),null);
  assert.equal(db.prepare("SELECT count(*) AS n FROM learner_senses WHERE learner_id='a'").get()!.n,2);
}));

test('invalid and stale confirmations roll back all learner changes',()=>owner(()=>{
  assert.throws(()=>choose(['s1']),/Wait for/);defaults(['s1']);const before=resolveVocabularyLearnerSenseScope('w');
  for (const ids of [[],['foreign'],['s1','s1']]) assert.throws(()=>choose(ids),/sense/i);
  assert.throws(()=>choose(['s1'],'s2'),/target/i);
  for (const field of ['expectedStateVersion','expectedCatalogVersion','expectedSelectionVersion'] as const) {
    const input={senseIds:['s2'],expectedStateVersion:before.stateVersion!,expectedCatalogVersion:before.catalogVersion,expectedSelectionVersion:before.selectionVersion,surface:'test'};
    input[field]++;assert.throws(()=>writeVocabularyLearnerSenseScope('w',input),VocabularyStateConflict);
  }
  assert.deepEqual(resolveVocabularyLearnerSenseScope('w'),before);
}));

test('serving changes mapped production only and keeps learners and pure cues independent',()=>owner(()=>{
  defaults(['s1']);exercise('default','s1');exercise('custom','s2');exercise('unmapped',null);exercise('recognition','s1','recognition');exercise('pure','s1','production',true);
  choose(['s2']);
  assert.deepEqual(listVocabularyExercises({wordId:'w',mode:'practice'}).map(item=>item.contentId),['custom','pure','recognition','unmapped']);
  assert.deepEqual(runWithLearnerId('b',()=>listVocabularyExercises({wordId:'w',mode:'practice'}).map(item=>item.contentId)),['default','pure','recognition','unmapped']);
  assert.equal(db.prepare("SELECT count(*) AS n FROM content_items WHERE availability='active'").get()!.n,5);
}));

test('a taken-up sense restores production admission under explicit-none defaults without changing shared proxy policy',()=>owner(()=>{
  defaults([]);exercise('custom','s2');assert.equal(canServeVocabularyReviewProduction('w','practice'),false);
  choose(['s2']);assert.equal(canServeVocabularyReviewProduction('w','practice'),true);
  assert.equal(runWithLearnerId('b',()=>canServeVocabularyReviewProduction('w','practice')),false);
  exercise('pure',null,'production',true);assert.equal(isVocabularyProductionProxied('w'),true);
  assert.equal(canServeVocabularyReviewProduction('w','practice'),true);
}));
