import { allowsProductionUnderProxyPolicy } from '../src/domain/production-proxy.ts';
import { productionProxyCases } from './helpers/production-proxy-cases.ts';
import { selectPureCuesForSession, type PureCue } from '../src/domain/pure-cues.ts';
import { setDb } from '../server/db/connection.ts';
import { runWithLearnerId } from '../server/db/learner-context.ts';
import { isWordProductionProxied } from '../server/db/pure-cues.ts';
import { getActiveProductionCuesForWord } from '../server/db/production-cues.ts';
import { createVocabularyContent } from '../server/db/vocabulary-content.ts';
import { selectVocabularyPureCueCandidates, adoptVocabularyPureCues } from '../server/vocabulary/pure-cue-serving.ts';
import { selectVocabularyReviewSkills } from '../server/vocabulary/review-selection.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { before,after,beforeEach,afterEach,test } from 'node:test';
import { createBaselineFixture } from './helpers/baseline-database.ts';
import { migrateDatabase,schemaMigrations,type SchemaMigration } from '../server/db/migrations.ts';
import { importLegacyVocabulary,type VocabularyImportReport } from '../server/db/vocabulary-import.ts';
import type { VocabularyContent } from '../src/domain/vocabulary-content.ts';
import type { TeachingPackage,WordContentDocument } from '../src/domain/word-content/types.ts';
let root: string;
let baseline: string;
let db: DatabaseSync;
const timestamp = '2026-10-15T00:00:00.000Z';
const earlier = schemaMigrations.filter((migration) => migration.id < 'app_schema:0041');
const additions: SchemaMigration[] = ['0041_vocabulary_learner_state','0042_vocabulary_sessions','0043_vocabulary_import'].map((name) => ({
  id: `app_schema:${name}`,sql: fs.readFileSync(new URL(`../server/db/migrations/${name}.sql`,import.meta.url),'utf8'),
  ...(name.startsWith('0043') ? { after: (database: DatabaseSync) => { importLegacyVocabulary(database); } } : {}),
}));
before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(),'vocabulary-import-'));
  const initial = path.join(root,'baseline'); createBaselineFixture(initial); baseline = path.join(initial,'app.db');
});
after(() => fs.rmSync(root,{ recursive: true,force: true }));
beforeEach(() => {
  const location = path.join(root,`${Math.random()}.db`); fs.copyFileSync(baseline,location);
  db = new DatabaseSync(location); db.exec('PRAGMA foreign_keys=ON'); db.function('current_learner_id',() => 'a');
  migrateDatabase(db,earlier);
  db.prepare('INSERT INTO learners(learner_id,display_name,created_at) VALUES (?,?,?)').run('a','Learner A',timestamp);
  db.prepare('INSERT INTO learners(learner_id,display_name,created_at) VALUES (?,?,?)').run('b','Learner B',timestamp);
  for (const [wordId,hanzi] of [['w1','你好'],['w2','您好'],['w3','再见']]) db.prepare(`INSERT INTO lexical_words
    (id,hanzi,traditional,pinyin,meaning,meanings_json,examples_json,priority,created_at) VALUES (?,?,NULL,'ni','greeting','["greeting"]','[]',1,?)`).run(wordId,hanzi,timestamp);
  db.prepare(`INSERT INTO learner_word_state(learner_id,word_id,status) VALUES ('a','w1','learning')`).run();
});
afterEach(() => db.close());
function publication(kind: string,sourceId: string,status = 'available'): void {
  db.prepare(`INSERT INTO shared_content_publications(publication_id,content_kind,content_id,learning_purpose_key,
    publication_status,published_at,status_updated_at) VALUES (?,?,?,?,?,?,?)`).run(`pub:${kind}:${sourceId}`,kind,sourceId,'w1',status,timestamp,timestamp);
}
function bootstrap(sourceId = 'bootstrap-1',createdAt = timestamp,status = 'available'): WordContentDocument {
  const content: WordContentDocument = { schemaVersion: 1,id: sourceId,word: { wordId: 'w1',hanzi: '你好',traditional: null,pinyin: 'ni' },
    uses: [{ id: 'use-1',label: 'greeting',notes: ['greet'],exampleIds: ['example-1','example-shared'] },
      { id: 'use-2',label: 'attention',notes: ['call attention'],exampleIds: ['example-shared'] }],
    examples: [{ id: 'example-1',text: '你好！',translation: 'Hello!',pronunciation: 'ni' },
      { id: 'example-shared',text: '你好啊',translation: 'Hey there',pronunciation: 'ni' }] };
  publication('word_content',sourceId,status);
  db.prepare(`INSERT INTO word_content_documents(content_id,word_id,content_json,model,created_at,publication_id)
    VALUES (?,'w1',?,'legacy-model',?,?)`).run(sourceId,JSON.stringify(content),createdAt,`pub:word_content:${sourceId}`);
  return content;
}
function teaching(content: WordContentDocument,packageId: string,exampleId = 'example-1',status = 'available'): void {
  const text = content.examples.find((example) => example.id === exampleId)!.text;
  const pkg: TeachingPackage = { schemaVersion: 1,id: packageId,wordContentId: content.id,
    beats: [{ id: 'beat',parts: [{ kind: 'example',exampleId,field: 'sentence' }] }],
    rehearsals: [{ id: 'same-local-id',responseMode: 'hanzi_entry',contract: { kind: 'target_rehearsal',wordId: 'w1' },instruction: '',
      stimulus: { kind: 'example_cloze',example: { contentId: content.id,exampleId },blanks: [{ start: 0,end: 2,expectedText: text.slice(0,2) }],frame: null },
      acceptedAnswers: [{ wordId: 'w1',hanzi: '你好',traditional: null }] }] };
  publication('teaching_package',packageId,status);
  db.prepare(`INSERT INTO word_teaching_packages(package_id,word_id,content_id,package_json,model,created_at,publication_id)
    VALUES (?,'w1',?,?,'legacy-model',?,?)`).run(packageId,content.id,JSON.stringify(pkg),timestamp,`pub:teaching_package:${packageId}`);
}
function cue(cueId: string,scope: 'shared' | 'learner',status = 'available',withAnswers = true): void {
  if (scope === 'shared') publication('production_cue',cueId,status);
  db.prepare(`INSERT INTO scoped_production_cues(cue_id,task_id,cue_type,cue_text,created_at,origin_kind,origin_invocation_id,content_scope,owner_learner_id)
    VALUES (?,'production-task:w1:default_production','definition_gloss','a greeting',?,'manual',NULL,?,?)`).run(cueId,timestamp,scope,scope === 'learner' ? 'a' : null);
  if (withAnswers) db.prepare('INSERT INTO scoped_production_cue_accepted_words(cue_id,word_id,position) VALUES (?,\'w1\',0)').run(cueId);
}
function lookup(kind: string,sourceId: string,subId = ''): VocabularyContent {
  const row = db.prepare(`SELECT h.snapshot_json FROM legacy_content_imports i JOIN content_revision_history h
    ON h.content_id=i.content_id AND h.version=i.imported_content_version WHERE source_kind=? AND source_id=? AND source_sub_id=?`)
    .get(kind,sourceId,subId) as { snapshot_json: string } | undefined;
  assert.ok(row,`missing import ${kind}/${sourceId}/${subId}`);
  return JSON.parse(row.snapshot_json) as VocabularyContent;
}
function convert(): void { migrateDatabase(db,[...earlier,...additions]); }
function repeat(): VocabularyImportReport {
  db.exec('BEGIN');
  try { const report = importLegacyVocabulary(db); db.exec('COMMIT'); return report; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

test('actual offline migration imports scoped package exercises, exact material, conservative senses and teaching history', () => {
  const source = bootstrap(); teaching(source,'package-one'); teaching(source,'package-two','example-shared');
  db.prepare(`INSERT INTO learner_word_introduction_events(event_id,learner_id,word_id,package_id,event_kind,occurred_at)
    VALUES ('completed','a','w1','package-one','completed',?)`).run(timestamp);
  convert();
  const first = lookup('teaching_exercise','package-one','same-local-id');
  const second = lookup('teaching_exercise','package-two','same-local-id');
  assert.notEqual(first.contentId,second.contentId); assert.equal(first.kind,'exercise'); assert.equal(first.exerciseRole,'teaching');
  assert.equal((first.body as { prompt: string }).prompt,'____！');
  assert.ok(first.words[0]!.senseId); assert.equal(second.words[0]!.senseId,null);
  assert.ok(second.words[0]!.senseMappingEstablishedAt === null);
  const introduction = lookup('teaching_package','package-one');
  assert.equal(introduction.kind,'introduction');
  assert.deepEqual(introduction.teachingExercises,[{ exerciseId: first.contentId,exerciseVersion: 1 }]);
  const completed = db.prepare('SELECT * FROM teaching_completions').get()!;
  assert.equal(completed.completion_id,null); assert.equal(completed.source_kind,'legacy_import'); assert.equal(completed.source_id,'completed');
  assert.equal(JSON.parse(completed.snapshot_json as string).rehearsals[0].stimulus.text,'____！');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM session_actions').get()!.n,0);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('private/shared publication state and explicit deactivations survive conversion without exposing private supplements', () => {
  cue('shared','shared'); cue('quarantined','shared','quarantined'); cue('private','learner');
  db.prepare(`INSERT INTO scoped_production_cue_supplements(supplement_id,task_id,cue_id,english_frame,example_sentence,example_translation,
    created_at,origin_invocation_id,content_scope,owner_learner_id) VALUES ('private-supplement','production-task:w1:default_production','shared',
    'Hello frame','你好！','Hello!',?,NULL,'learner','a')`).run(timestamp);
  db.prepare(`INSERT INTO learner_owned_production_cue_lifecycle_events(event_id,learner_id,cue_id,task_id,lifecycle_kind,occurred_at)
    VALUES ('deactivate','a','shared','production-task:w1:default_production','deactivated',?)`).run(timestamp);
  db.prepare(`INSERT INTO learner_owned_production_cue_activation_state(learner_id,cue_id,active,latest_lifecycle_event_id,updated_at)
    VALUES ('a','shared',0,'deactivate',?)`).run(timestamp);
  convert();
  assert.equal(lookup('production_cue','quarantined').availability,'quarantined');
  assert.equal(lookup('production_cue','private').accessScope,'private');
  assert.equal(lookup('production_cue','private').ownerLearnerId,'a');
  const shared = lookup('production_cue','shared'); const supplement = lookup('production_cue_supplement','private-supplement');
  assert.equal(supplement.accessScope,'private'); assert.equal(supplement.ownerLearnerId,'a');
  assert.equal((shared.body as { reveal?: unknown }).reveal,undefined);
  assert.equal((supplement.body as { reveal: { exampleSentence: string } }).reveal.exampleSentence,'你好！');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM learner_content_deactivations').get()!.n,2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM content_items WHERE access_scope=\'shared\' AND owner_learner_id IS NOT NULL').get()!.n,0);
});

test('pure cue answer space and independent schedule carry forward even without word enrollment', () => {
  publication('pure_cue','pure');
  db.prepare("INSERT INTO pure_cues(id,stimulus,axis_note,teaching_note,created_at) VALUES ('pure','a greeting','politeness','compare forms',?)").run(timestamp);
  db.exec("INSERT INTO pure_cue_accepted_words VALUES ('pure','w1',0),('pure','w2',1)");
  db.prepare(`INSERT INTO learner_pure_cue_state(learner_id,pure_cue_id,interval_hours,ease_factor,last_studied_at,next_due_at,strong_since,strong_successes,adopted_at)
    VALUES ('b','pure',72,2.8,?,?,'2026-10-01T00:00:00.000Z',4,?)`).run(timestamp,'2026-10-18T00:00:00.000Z',timestamp);
  convert();
  const pure = lookup('pure_cue','pure'); assert.equal(pure.exerciseType,'pure_cue'); assert.equal(pure.answers!.length,2);
  const schedule = db.prepare('SELECT * FROM learner_pure_cue_schedules').get()!;
  assert.equal(schedule.content_id,pure.contentId); assert.equal(schedule.next_eligible_at,'2026-10-18T00:00:00.000Z');
  assert.equal(JSON.parse(schedule.scheduler_state_json as string).intervalHours,72);
  assert.equal(JSON.parse(schedule.scheduler_state_json as string).strongSuccesses,4);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM learner_words WHERE learner_id='b'").get()!.n,0);
});

for (const scenario of productionProxyCases) {
  test(`offline migration preserves proxy admission: ${scenario.name}`, () => {
    setDb(db);
    if (scenario.pure) {
      publication('pure_cue','proxy-greeting');
      db.prepare(`INSERT INTO pure_cues(id,stimulus,axis_note,teaching_note,created_at)
        VALUES ('proxy-greeting','a greeting','politeness','compare forms',?)`).run(timestamp);
      db.exec("INSERT INTO pure_cue_accepted_words VALUES ('proxy-greeting','w1',0),('proxy-greeting','w2',1)");
      // Proxy coverage is independent of whether the standalone cue is due today.
      db.prepare(`INSERT INTO learner_pure_cue_state(learner_id,pure_cue_id,interval_hours,ease_factor,last_studied_at,next_due_at,strong_since,strong_successes,adopted_at)
        VALUES ('a','proxy-greeting',72,2.8,?,'2026-10-18T00:00:00.000Z',NULL,0,?)`).run(timestamp,timestamp);
    }
    db.exec("UPDATE learner_word_state SET status='review' WHERE learner_id='a' AND word_id='w1'");
    db.prepare(`INSERT INTO learner_owned_word_skill_state
      (learner_id,word_id,skill_id,enabled,interval_hours,last_studied_at,next_due_at,ease_factor)
      VALUES ('a','w1','production',1,24,'2026-10-01T00:00:00.000Z',?,2.65)`).run(timestamp);
    if (scenario.recognition) db.prepare(`INSERT INTO learner_owned_word_skill_state
      (learner_id,word_id,skill_id,enabled,interval_hours,last_studied_at,next_due_at,ease_factor)
      VALUES ('a','w1','recognition',1,24,'2026-10-01T00:00:00.000Z',?,2.5)`).run(timestamp);
    db.prepare(`INSERT INTO learner_owned_word_skill_relevance
      (learner_id,word_id,skill_id,relevance_state,updated_at,source_event_id)
      VALUES ('a','w1','production','normal',?,NULL)`).run(timestamp);
    if (scenario.targeted) cue('distinct-greeting',scenario.targeted);
    if (scenario.targeted === 'learner') {
      db.prepare(`INSERT INTO learner_owned_production_cue_lifecycle_events
        (event_id,learner_id,cue_id,task_id,lifecycle_kind,occurred_at)
        VALUES ('activate-private','a','distinct-greeting','production-task:w1:default_production','activated',?)`).run(timestamp);
      db.prepare(`INSERT INTO learner_owned_production_cue_activation_state
        (learner_id,cue_id,active,latest_lifecycle_event_id,updated_at)
        VALUES ('a','distinct-greeting',1,'activate-private',?)`).run(timestamp);
    }

    const legacyState = () => ({
      skills: db.prepare('SELECT * FROM learner_owned_word_skill_state ORDER BY learner_id,word_id,skill_id').all(),
      relevance: db.prepare('SELECT * FROM learner_owned_word_skill_relevance ORDER BY learner_id,word_id,skill_id').all(),
      pure: db.prepare('SELECT * FROM learner_pure_cue_state ORDER BY learner_id,pure_cue_id').all(),
    });
    const before = legacyState();
    // These are the actual legacy coverage and usable-cue adapters used by
    // persistence.ts's review relevance gate, before any vocabulary conversion.
    const legacy = runWithLearnerId('a',() => ({
      proxied: isWordProductionProxied('w1'),
      targeted: getActiveProductionCuesForWord('w1').length > 0,
    }));
    assert.equal(legacy.proxied,scenario.proxied);
    const legacyProductionAdmitted = allowsProductionUnderProxyPolicy({ proxied: legacy.proxied, hasUsableTargetedCue: legacy.targeted });
    assert.equal(legacyProductionAdmitted,scenario.skills.some(skill => skill === 'production'));

    convert(); migrateDatabase(db);
    assert.deepEqual(legacyState(),before,'conversion preserves scheduler evidence and explicit relevance');
    const currentState = () => ({
      words: db.prepare('SELECT * FROM learner_word_schedules ORDER BY learner_id,word_id').all(),
      pure: db.prepare('SELECT * FROM learner_pure_cue_schedules ORDER BY learner_id,content_id').all(),
    });
    const imported = currentState();
    const selected = runWithLearnerId('a',() => selectVocabularyReviewSkills({now:timestamp}));
    assert.deepEqual(selected,scenario.skills.map(skillId => ({wordId:'w1',skillId})),
      'the migrated selector must preserve content-derived eligibility, not only copied due dates');
    assert.deepEqual(currentState(),imported,'admission does not rewrite schedules or adopt cues');
    assert.deepEqual(legacyState(),before,'derived proxy coverage never becomes stored learner relevance');
  });
}

test('contrast preserves choices, correct answer, explanations and supporting relationships', () => {
  publication('contrast_cluster','cluster');
  db.exec("INSERT INTO scoped_contrast_clusters(id,title,note,content_scope,owner_learner_id) VALUES ('cluster','greetings','politeness','shared',NULL)");
  db.exec("INSERT INTO scoped_contrast_cluster_members(cluster_id,word_id,nuance_note,display_order) VALUES ('cluster','w1','informal',0),('cluster','w2','respectful',1)");
  db.exec("INSERT INTO scoped_contrast_prompts(id,cluster_id,target_word_id,prompt_text,explanation) VALUES ('contrast','cluster','w2','Address a respected elder','Use respectful 您')");
  convert();
  const contrast = lookup('contrast_prompt','contrast');
  assert.equal(contrast.exerciseType,'contrast'); assert.equal(contrast.skill,'contextual_selection'); assert.deepEqual(contrast.answers,[{ wordId: 'w2',acceptedForms: ['您好'] }]);
  assert.deepEqual(contrast.words.map((word) => [word.wordId,word.relation]),[['w1','context'],['w2','target']]);
  assert.equal((contrast.body as { choices: unknown[] }).choices.length,2);
  assert.equal((contrast.body as { reveal: { explanation: string } }).reveal.explanation,'Use respectful 您');
});

test('bootstrap multiplicity has deterministic eligible catalog choice, retained source mappings and repeatable import', () => {
  bootstrap('old','2026-10-13T00:00:00.000Z'); bootstrap('new','2026-10-14T00:00:00.000Z');
  bootstrap('withdrawn','2026-10-16T00:00:00.000Z','retired'); cue('general','shared');
  convert();
  const states = db.prepare('SELECT source_content_id,s.status FROM legacy_sense_imports i JOIN senses s ON s.sense_id=i.sense_id ORDER BY source_content_id').all() as Array<{ source_content_id: string; status: string }>;
  assert.equal(states.filter((row) => row.status === 'active').length,2);
  assert.ok(states.filter((row) => row.status === 'active').every((row) => row.source_content_id === 'new'));
  const inventory = JSON.parse(db.prepare("SELECT data_json FROM backend_events WHERE name='vocabulary.bootstrap.inventory'").get()!.data_json as string);
  assert.equal(inventory.documentCount,3); assert.equal(inventory.selectedContentId,'new'); assert.equal(inventory.eligibleDocumentCount,2);
  const before = db.prepare('SELECT * FROM content_revision_history ORDER BY content_id,version').all();
  const second = repeat(); assert.equal(second.createdContent,0); assert.equal(second.createdSenses,0);
  assert.equal(second.importedPureSchedules,0); assert.equal(second.importedTeachingCompletions,0);
  assert.deepEqual(db.prepare('SELECT * FROM content_revision_history ORDER BY content_id,version').all(),before);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM backend_events WHERE name='vocabulary.bootstrap.inventory'").get()!.n,1);
});

test('incremental word materialization imports only the requested authored sources and preserves later edits on repeat', () => {
  convert();
  const source = bootstrap(); teaching(source,'after-cutover'); cue('after-cutover-general','shared');
  db.prepare(`INSERT INTO scoped_production_cues(cue_id,task_id,cue_type,cue_text,created_at,origin_kind,content_scope,owner_learner_id)
    VALUES ('unrelated','production-task:w2:default_production','definition_gloss','respectful greeting',?,'manual','learner','a')`).run(timestamp);
  db.exec("INSERT INTO scoped_production_cue_accepted_words VALUES ('unrelated','w2',0)");
  db.exec('BEGIN');
  const report = importLegacyVocabulary(db,{ wordId: 'w1' }); db.exec('COMMIT');
  assert.equal(report.createdContent,3); assert.equal(report.createdSenses,2);
  assert.equal(report.bootstrapInventory.length,1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM legacy_content_imports WHERE source_id='unrelated'").get()!.n,0);
  assert.equal(lookup('production_cue','after-cutover-general').availability,'active');
  assert.equal(lookup('teaching_exercise','after-cutover','same-local-id').exerciseRole,'teaching');
  const catalogVersion = db.prepare("SELECT sense_catalog_version FROM vocabulary_word_catalogs WHERE word_id='w1'").get()!.sense_catalog_version;
  const current = lookup('production_cue','after-cutover-general');
  const edited = { ...current,body: { prompt: 'human correction' },version: 2 };
  db.exec('BEGIN');
  db.prepare('UPDATE content_items SET version=2,body_json=? WHERE content_id=?').run(JSON.stringify(edited.body),current.contentId);
  db.prepare(`INSERT INTO content_revision_history(change_id,content_id,version,previous_version,snapshot_json,change_kind,
    write_strategy,actor_kind,actor_id,reason_json,recorded_at) VALUES ('human-edit',?,2,1,?,'updated','update_existing','operator','editor',NULL,?)`)
    .run(current.contentId,JSON.stringify(edited),timestamp);
  db.exec('COMMIT');
  db.exec('BEGIN'); const again = importLegacyVocabulary(db,{ wordId: 'w1' }); db.exec('COMMIT');
  assert.equal(again.createdContent,0); assert.equal(again.createdSenses,0);
  assert.equal(JSON.parse(db.prepare('SELECT body_json FROM content_items WHERE content_id=?').get(current.contentId)!.body_json as string).prompt,'human correction');
  assert.equal(db.prepare("SELECT sense_catalog_version FROM vocabulary_word_catalogs WHERE word_id='w1'").get()!.sense_catalog_version,catalogVersion);
});

test('failed conversion rolls back the entire migration batch and keeps original evidence', () => {
  const content = bootstrap(); teaching(content,'retained'); cue('valid','shared');
  const failing=additions.map((migration)=>migration.id.includes('0043')?{...migration,after:(database:DatabaseSync)=>{importLegacyVocabulary(database);throw new Error('simulated offline failure');}}:migration);
  assert.throws(() => migrateDatabase(db,[...earlier,...failing]),/simulated offline failure/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE name='legacy_sense_imports'").get()!.n,0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM content_items').get()!.n,0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM word_teaching_packages').get()!.n,1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM schema_migrations WHERE migration_id LIKE 'app_schema:%' AND migration_id >= 'app_schema:0041'").get()!.n,0);
});


test('unservable legacy cues without answer space remain retained with explicit exclusion inventory',()=>{
  cue('unservable','learner','available',false);convert();
  const report=repeat();assert.deepEqual(report.excludedUnsupportedContent,[{sourceKind:'production_cue',sourceId:'unservable',reason:'missing_accepted_answers'}]);
  assert.equal(db.prepare("SELECT count(*) AS n FROM scoped_production_cues WHERE cue_id='unservable'").get()!.n,1);
  assert.equal(db.prepare("SELECT count(*) AS n FROM legacy_content_imports WHERE source_kind='production_cue' AND source_id='unservable'").get()!.n,0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM backend_events WHERE name='vocabulary.content.import_excluded'").get()!.n,1);
});

// Exercise the real post-import serving adapter, not just the copied JSON.
test('import retains strong maintenance identity and the separate restoration quiet guard', () => {
  setDb(db);
  const cueBase: PureCue = {id:'',kind:'pure',stimulus:'a greeting',axisNote:'',teachingNote:'',acceptedWordIds:['w1','w2'],active:true,
    intervalHours:1234,easeFactor:2.65,lastStudiedAt:'2026-10-01T00:00:00.000Z',nextDueAt:'2030-01-01T00:00:00.000Z',
    strongSince:'2026-09-01T00:00:00.000Z',strongSuccesses:0};
  let legacyId='';
  for(let index=0;index<10000;index++) {
    const candidate=`legacy-strong-${index}`;
    if(selectPureCuesForSession({learnerId:'a',cues:[{...cueBase,id:candidate}],ordinaryReviewCount:10,now:timestamp,random:()=>0}).strong.length) {legacyId=candidate;break;}
  }
  assert.ok(legacyId,'fixture must qualify on this UTC day');
  publication('pure_cue',legacyId);
  db.prepare('INSERT INTO pure_cues(id,stimulus,axis_note,teaching_note,created_at) VALUES (?,?,?,?,?)').run(legacyId,'a greeting','','',timestamp);
  db.prepare("INSERT INTO pure_cue_accepted_words VALUES (?,'w1',0),(?,'w2',1)").run(legacyId,legacyId);
  db.prepare(`INSERT INTO learner_pure_cue_state VALUES ('a',?,?,?,?,?,?,?,?)`).run(legacyId,1234,2.65,cueBase.lastStudiedAt,cueBase.nextDueAt,cueBase.strongSince,0,timestamp);
  db.prepare("UPDATE learner_word_state SET status='review' WHERE learner_id='a' AND word_id='w1'").run();
  db.prepare(`INSERT INTO pure_cue_served_snapshots(learner_id,snapshot_id,pure_cue_id,served_at,stimulus,axis_note,accepted_answers_json)
    VALUES ('a','served',?,?,'a greeting','','[]')`).run(legacyId,timestamp);
  db.prepare(`INSERT INTO pure_cue_attempts VALUES ('a','attempt',?,'served','old-session','old-action',?,'[]',1,NULL)`).run(legacyId,timestamp);
  db.prepare(`INSERT INTO learner_owned_reflection_operation_invocations(learner_id,invocation_id,created_at,origin_kind,operation_kind,operation_version,operation_json,
    application_state,application_updated_at,effect_refs_json,satisfying_effect_refs_json)
    VALUES ('a','restore',?,'manual','reconcile_pure_cue_response',1,'{}','pending',?,'[]','[]')`).run(timestamp,timestamp);
  db.prepare(`INSERT INTO pure_cue_assessment_scheduler_snapshots VALUES ('a','attempt',?,?,?,'restore',?)`)
    .run(legacyId,timestamp,JSON.stringify(cueBase),timestamp);
  convert();migrateDatabase(db);
  const imported=lookup('pure_cue',legacyId);
  const row=db.prepare("SELECT * FROM learner_pure_cue_schedules WHERE learner_id='a'").get()!;
  const state=JSON.parse(String(row.scheduler_state_json));
  assert.equal(state.maintenanceIdentity,legacyId);
  assert.equal(state.resetUntil,'2026-10-15T06:00:00.000Z');
  assert.equal(row.next_eligible_at,cueBase.nextDueAt,'strong due date stays dormant, not replaced by the guard');
  const select=(at:string,seed='same')=>runWithLearnerId('a',()=>selectVocabularyPureCueCandidates({ordinaryReviewCount:10,sessionSeed:seed,now:at,adopt:false})).map(item=>item.contentId);
  assert.deepEqual(select('2026-10-15T05:59:59.999Z'),[]);
  assert.deepEqual(select('2026-10-15T06:00:00.000Z'),[imported.contentId]);
  assert.deepEqual(select('2026-10-15T06:00:00.000Z','another session'),[imported.contentId]);
  db.prepare("UPDATE learner_pure_cue_schedules SET last_practised_at='2026-10-08T06:00:00.001Z' WHERE content_id=?").run(imported.contentId);
  assert.deepEqual(select('2026-10-15T06:00:00.000Z'),[],'seven-day quiet period still applies after restoration guard expires');
  db.prepare("UPDATE learner_pure_cue_schedules SET last_practised_at='2026-10-08T06:00:00.000Z',next_eligible_at='2040-01-01T00:00:00.000Z',scheduler_state_json=json_set(scheduler_state_json,'$.intervalHours',720000,'$.easeFactor',9) WHERE content_id=?").run(imported.contentId);
  assert.deepEqual(select('2026-10-15T06:00:00.000Z'),[imported.contentId],'quiet-period boundary is inclusive and dormant SRS fields do not affect maintenance');
  // A copied source field on replacement content must not inherit the old daily draw.
  runWithLearnerId('a',()=>{
    assert.equal(imported.kind,'exercise');if(imported.kind!=='exercise')throw new Error('fixture');
    const {version,createdAt,updatedAt,...draft}=imported;
    createVocabularyContent({...draft,contentId:'replacement',originKind:'human'},{kind:'operator',id:'test'});
    adoptVocabularyPureCues(timestamp);
  });
  const replacement=JSON.parse(String(db.prepare("SELECT scheduler_state_json FROM learner_pure_cue_schedules WHERE content_id='replacement'").get()!.scheduler_state_json));
  assert.equal(replacement.maintenanceIdentity,undefined);
  assert.equal(replacement.strongSince,null);
});
