import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { before, after, test } from 'node:test';
import { createBaselineFixture } from './helpers/baseline-database.ts';
import { assertSchemaCurrent, migrateDatabase, schemaMigrations } from '../server/db/migrations.ts';
import { SHARED_DICTIONARY_BASELINES_MIGRATION } from '../server/db/dictionary-baseline-sharing.ts';
import { setDb } from '../server/db/connection.ts';
import { createVocabularyContent, updateVocabularyContent } from '../server/db/vocabulary-content.ts';
import type { VocabularyContent } from '../src/domain/vocabulary-content.ts';
import type { VocabularyContentProposal, VocabularyProposalOperation } from '../src/domain/vocabulary-reflection.ts';

const at = '2026-10-01T00:00:00.000Z';
const index = schemaMigrations.findIndex(entry => entry.id === SHARED_DICTIONARY_BASELINES_MIGRATION);
let dir: string;
before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(),'shared-baseline-migration-')); createBaselineFixture(path.join(dir,'baseline')); });
after(() => fs.rmSync(dir,{recursive:true,force:true}));
function previous(name: string) {
  const file = path.join(dir,`${name}.db`); fs.copyFileSync(path.join(dir,'baseline','app.db'),file);
  const db = new DatabaseSync(file); db.function('current_learner_id',()=> 'alice');
  migrateDatabase(db,schemaMigrations.slice(0,index)); setDb(db);
  db.exec(`INSERT INTO learners VALUES('alice','Alice','${at}',NULL),('bob','Bob','${at}',NULL);
    INSERT INTO lexical_words(id,hanzi,pinyin,meaning,meanings_json,examples_json,priority,created_at)
    VALUES('word','字','zi','character; word','[]','[]',0,'${at}');`);
  return db;
}
function baseline(owner='alice',skill:'production'|'recognition'='production') {
  return createVocabularyContent({contentId:`vocabulary:baseline:v1:${owner}:${skill}:general:word`,kind:'exercise',payloadVersion:1,
    body:skill==='production'?{prompt:'character; word',instruction:'Give the Mandarin word.',source:{kind:'dictionary_baseline',wordId:'word'}}
      :{prompt:'字',answer:'character; word',pinyin:'zi',source:{kind:'dictionary_baseline',wordId:'word'}},
    exerciseType:skill==='production'?'definition':'recognition',skill,exerciseRole:'general',
    assessment:skill==='production'?{match:'prepared_answer_membership'}:{responseMode:'self_assessment'},
    accessScope:'private',ownerLearnerId:owner,availability:'active',originKind:'human',authorKind:'service',authorId:'vocabulary-dictionary-baseline-v1',
    answers:[{wordId:'word',acceptedForms:['字']}],words:[{wordId:'word',relation:'target'}]}, {kind:'service',id:'vocabulary-dictionary-baseline-v1'});
}
function proposal(db:DatabaseSync,id:string,source:VocabularyContent,status:VocabularyContentProposal['status']='awaiting_review',authorKind:'service'|'operator'='service') {
  const {version:_v,createdAt:_c,updatedAt:_u,...draft} = source;
  const operations: VocabularyProposalOperation[] = (['replace','create'] as const).map((strategy,i)=>{
    const common = {operationKey:`op${i}`,scope:{kind:'learner' as const,learnerId:source.ownerLearnerId!},rationale:'Useful distinct cue',
      content:{...draft,contentId:`${id}:result:${i}`,body:{prompt:`A useful distinct situation ${i}`,instruction:'',stimulus:{kind:'direct_text',text:`A useful distinct situation ${i}`},
        source:{kind:'vocabulary_repertoire',assessedContentId:source.contentId,assessedContentVersion:source.version,invocationId:null}}}};
    return strategy==='create'?{...common,strategy}:{...common,strategy,sourceContentId:source.contentId,expectedVersion:source.version};
  });
  const value:VocabularyContentProposal = {proposalId:id,caseId:null,version:1,status,operations,rationale:'Split the broad dictionary task',
    bases:[{contentId:source.contentId,expectedVersion:source.version}],invocationId:null,authorKind,authorId:authorKind==='service'?'vocabulary-reflection':'editor'};
  db.exec('BEGIN');
  db.prepare(`INSERT INTO content_proposals(proposal_id,version,status,operations_json,rationale,author_kind,author_id,created_at,updated_at)
    VALUES(?,1,?,?,?,?,?,?,?)`).run(id,status,JSON.stringify(operations),value.rationale,value.authorKind,value.authorId,at,at);
  db.prepare('INSERT INTO proposal_revision_history VALUES(?,1,?,?,?,?)').run(id,JSON.stringify(value),value.authorKind,value.authorId,at);
  db.prepare('INSERT INTO proposal_content_bases VALUES(?,?,?)').run(id,source.contentId,source.version);
  if(status==='approved')db.prepare("INSERT INTO proposal_reviews VALUES(?, ?,1,'editor','approved','{}',?)").run(`${id}:review`,id,at);
  db.exec('COMMIT'); return value;
}
const all = (db:DatabaseSync,table:string) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
const schema = (db:DatabaseSync) => db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();

test('populated offline upgrade corrects stock baselines and versions pending repertoires without publishing drafts or rewriting history',()=>{
  const db=previous('populated');
  try {
    const source=baseline(); const bob=baseline('bob'); baseline('alice','recognition');
    updateVocabularyContent(bob.contentId,1,{...bob,availability:'quarantined'},{kind:'operator',id:'editor'});
    proposal(db,'stale',bob);
    const edited=baseline('bob','recognition'); updateVocabularyContent(edited.contentId,1,{...edited,body:{prompt:'A manually authored recognition task'}},{kind:'operator',id:'editor'});
    const pending=proposal(db,'pending',source,'approved'); proposal(db,'closed',source,'closed'); proposal(db,'manual',source,'awaiting_review','operator');
    const serviceEdited={...proposal(db,'operator-edited-service',source),version:2,rationale:'Operator-edited rationale'};
    db.exec('BEGIN');
    db.prepare("UPDATE content_proposals SET version=2,rationale=? WHERE proposal_id='operator-edited-service'").run(serviceEdited.rationale);
    db.prepare("INSERT INTO proposal_revision_history VALUES('operator-edited-service',2,?,'operator','editor',?)").run(JSON.stringify(serviceEdited),at);
    db.exec('COMMIT');
    db.prepare('INSERT INTO learner_content_deactivations VALUES(?,?,?)').run('alice',source.contentId,at);
    const history=all(db,'content_revision_history'),proposalHistory=all(db,'proposal_revision_history'),reviews=all(db,'proposal_reviews');
    const controls=all(db,'learner_content_deactivations'),count=all(db,'content_items').length,guard=schema(db);
    assert.deepEqual(migrateDatabase(db),[SHARED_DICTIONARY_BASELINES_MIGRATION]);
    const current=db.prepare('SELECT * FROM content_items WHERE content_id=?').get(source.contentId)!;
    assert.equal(current.access_scope,'shared');assert.equal(current.owner_learner_id,null);assert.equal(current.version,2);
    assert.equal(db.prepare('SELECT access_scope FROM content_items WHERE content_id=?').get(edited.contentId)!.access_scope,'private');
    assert.equal(all(db,'content_items').length,count);assert.equal(all(db,'proposal_applications').length,0);
    for(const old of history)assert.deepEqual(db.prepare('SELECT * FROM content_revision_history WHERE change_id=?').get(old.change_id),old);
    for(const old of proposalHistory)assert.deepEqual(db.prepare('SELECT * FROM proposal_revision_history WHERE proposal_id=? AND version=?').get(old.proposal_id,old.version),old);
    assert.deepEqual(all(db,'proposal_reviews'),reviews);assert.deepEqual(all(db,'learner_content_deactivations'),controls);
    const next=JSON.parse(String(db.prepare("SELECT snapshot_json FROM proposal_revision_history WHERE proposal_id='pending' AND version=2").get()!.snapshot_json)) as VocabularyContentProposal;
    assert.equal(next.status,'awaiting_review');assert.deepEqual(next.bases,[{contentId:source.contentId,expectedVersion:2}]);
    assert.deepEqual(next.operations.map(op=>op.content.contentId),pending.operations.map(op=>op.content.contentId));
    for(const [i,op] of next.operations.entries()){
      assert.deepEqual(op.scope,{kind:'shared'});assert.equal(op.content.accessScope,'shared');assert.equal(op.content.ownerLearnerId,null);
      assert.deepEqual(op.content.body,pending.operations[i]!.content.body);if(op.strategy!=='create')assert.equal(op.expectedVersion,2);
    }
    assert.equal(db.prepare("SELECT status FROM content_proposals WHERE proposal_id='pending'").get()!.status,'awaiting_review');
    assert.equal(db.prepare("SELECT version FROM content_proposals WHERE proposal_id='operator-edited-service'").get()!.version,2);
    assert.deepEqual(db.prepare("SELECT operations_json FROM content_proposals WHERE proposal_id='operator-edited-service'").get()!.operations_json,JSON.stringify(serviceEdited.operations));
    for(const id of ['closed','manual','stale'])assert.equal(db.prepare('SELECT version FROM content_proposals WHERE proposal_id=?').get(id)!.version,1);
    assert.deepEqual(schema(db),guard);assertSchemaCurrent(db);
    assert.throws(()=>db.prepare("UPDATE content_items SET access_scope='private',owner_learner_id='alice' WHERE content_id=?").run(source.contentId),/immutable/);
    assert.throws(()=>db.exec("UPDATE proposal_revision_history SET actor_id='rewritten'"),/immutable/);
    const after=all(db,'content_revision_history');assert.deepEqual(migrateDatabase(db),[]);assert.deepEqual(all(db,'content_revision_history'),after);
  }finally{db.close();}
});

test('failed migration rolls back scope, proposal revision, audit events and the identity guard together',()=>{
  const db=previous('rollback');
  try{
    const source=baseline();proposal(db,'pending',source);
    const tables=['content_items','content_revision_history','content_proposals','proposal_content_bases','proposal_revision_history','backend_events','schema_migrations'];
    const before=tables.map(table=>all(db,table)),beforeSchema=schema(db);
    const target=schemaMigrations[index]!;
    assert.throws(()=>migrateDatabase(db,[...schemaMigrations.slice(0,index),{...target,after:connection=>{target.after!(connection);throw new Error('Injected after-hook failure');}}]),/Injected/);
    assert.deepEqual(tables.map(table=>all(db,table)),before);assert.deepEqual(schema(db),beforeSchema);
    assert.deepEqual(migrateDatabase(db),[SHARED_DICTIONARY_BASELINES_MIGRATION]);
  }finally{db.close();}
});

test('fresh installation and populated upgrade retain identical schema definitions',()=>{
  const old=previous('old-schema');baseline();migrateDatabase(old);
  const file=path.join(dir,'fresh.db');fs.copyFileSync(path.join(dir,'baseline','app.db'),file);const fresh=new DatabaseSync(file);fresh.function('current_learner_id',()=> 'alice');
  try{migrateDatabase(fresh);assert.deepEqual(schema(old),schema(fresh));assertSchemaCurrent(fresh);}finally{old.close();fresh.close();}
});

for(const edit of ['exerciseType','payloadVersion'] as const)test(`authored ${edit} edits exclude a fallback from automatic scope correction`,()=>{
  const db=previous(`edited-${edit}`);
  try{
    const source=baseline();
    const edited=updateVocabularyContent(source.contentId,source.version,{...source,...(edit==='exerciseType'?{exerciseType:'word'}:{payloadVersion:2})},{kind:'operator',id:'editor'});
    migrateDatabase(db);
    const row=db.prepare('SELECT access_scope,version FROM content_items WHERE content_id=?').get(source.contentId)!;
    assert.equal(row.access_scope,'private');assert.equal(row.version,edited.version);assertSchemaCurrent(db);
  }finally{db.close();}
});
