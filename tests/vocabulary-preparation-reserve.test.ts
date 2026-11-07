import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

test('vocabulary reserve preserves bounded preparation and lifecycle admission', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vocabulary-reserve-'));
  process.env.APP_MODE = 'study'; process.env.APP_AUTH_MODE = 'clerk'; process.env.APP_DATA_DIR = directory;
  const db = await import('../server/db.ts');
  const { reconcileVocabularyPreparationReserve: reconcile } = await import('../server/vocabulary/preparation-reserve.ts');
  const reserve = await import('../server/db/word-reserve.ts');
  const stages = await import('../server/db/word-introductions.ts');
  const { teachingReady } = await import('../server/vocabulary/teaching-readiness.ts');
  const { createVocabularyPracticePreparation } = await import('../server/vocabulary/preparation.ts');
  const { writeVocabularyDefaultUsefulSenses } = await import('../server/db/vocabulary-sense-coverage.ts');
  const { getVocabularySenses, getVocabularySenseCatalog, establishVocabularySenseCatalog, updateVocabularySense } = await import('../server/db/vocabulary-content.ts');
  const { getWordPreparationWork } = await import('../server/db/preparation-work.ts');
  const { getDb } = await import('../server/db/connection.ts');
  const learners = await import('../server/db/vocabulary-learners.ts');
  const { remainingVocabularyNewWordQuota } = await import('../server/vocabulary/composition.ts');
  const { startVocabularyStudy, getVocabularyStudy, composeVocabularySessionPayload } = await import('../server/vocabulary/study.ts');
  const sqlite = new DatabaseSync(path.join(directory, 'app.db'));
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.function('current_learner_id', () => 'reserve-a');
  const now = '2026-10-01T12:00:00.000Z';
  const owner = <T>(work: () => T) => db.runWithLearnerId('reserve-a', work);
  const count = (table: string) => Number(sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n);
  const setting = (name: string, value: unknown) => sqlite.prepare(`INSERT INTO learner_settings(learner_id,setting_key,value_json,updated_at)
    VALUES ('reserve-a',?,?,?) ON CONFLICT(learner_id,setting_key) DO UPDATE SET value_json=excluded.value_json`).run(name, JSON.stringify(value), now);
  let publication = 0;
  const publish = (wordId: string) => {
    const sequence = ++publication;
    const timestamp = new Date().toISOString(), expiry = new Date(Date.now()+60_000).toISOString();
    const content = { schemaVersion: 1 as const, id: `content-${wordId}-${sequence}`, word: { wordId, hanzi: '你好', traditional: null, pinyin: 'nǐ hǎo' },
      uses: [{ id: 'use', label: 'greeting', notes: ['A greeting.'], exampleIds: ['example'] }],
      examples: [{ id: 'example', text: '你好！', translation: 'Hello!', pronunciation: 'nǐ hǎo' }] };
    assert.equal(stages.claimSharedWordIntroductionStage(wordId,'bootstrap',`bootstrap-${sequence}`,timestamp,expiry),'claimed');
    stages.finishSharedWordIntroductionBootstrap(wordId,`bootstrap-${sequence}`,content,'fake');
    assert.equal(stages.claimSharedWordIntroductionStage(wordId,'teaching',`teaching-${sequence}`,timestamp,expiry),'claimed');
    stages.finishSharedWordIntroductionTeaching(wordId,`teaching-${sequence}`,{ schemaVersion: 1, id: `package-${wordId}-${sequence}`, wordContentId: content.id,
      beats: [{ id: 'beat', parts: [{ kind: 'example', exampleId: 'example', field: 'sentence' }] }],
      rehearsals: [{ id: 'rehearsal', responseMode: 'hanzi_entry', contract: { kind: 'target_rehearsal', wordId },
        instruction: 'Say hello', stimulus: { kind: 'direct_text', text: 'Hello' },
        acceptedAnswers: [{ wordId, hanzi: '你好', traditional: null }] }] }, 'fake');

  };
  try {
    for (const learnerId of ['reserve-a', 'reserve-b']) db.bootstrapLearner({ learnerId });
    for (let index = 0; index < 60; index++) {
      const id = `reserve-${String(index).padStart(2, '0')}`;
      sqlite.prepare(`INSERT INTO lexical_words(id,hanzi,traditional,pinyin,meaning,meanings_json,examples_json,priority,created_at)
        VALUES (?,'你好',NULL,'nǐ hǎo','hello','["hello"]','[]',10,?)`).run(id, now);
      if (index < 50) owner(() => learners.addVocabularyWord(id));
    }
    await t.test('configured daily limit, not remaining quota, sets a stable private reserve', () => owner(() => {
      db.setUnstudiedAdmissionSource('stash_only'); db.setDailyNewWordLimit(5);
      sqlite.prepare("INSERT INTO learner_owned_daily_new_word_intake(learner_id,day_key,new_study_count) VALUES ('reserve-a','2026-10-01',5)").run();
      assert.equal(remainingVocabularyNewWordQuota(now), 0);
      reconcile(now);
      const first = reserve.getWordReserveCandidates(); assert.equal(first.length, 10);
      assert.equal(count('word_preparation_work'), 20);
      assert.deepEqual(sqlite.prepare('SELECT DISTINCT stage FROM word_preparation_work ORDER BY stage').all().map(r => r.stage), ['bootstrap', 'teaching']);
      assert.equal(count('vocabulary_practice_preparation'), 0);
      reconcile(now); reconcile('2026-10-02T12:00:00.000Z');
      assert.deepEqual(reserve.getWordReserveCandidates(), first);
      sqlite.exec("UPDATE word_preparation_work SET status='paused',attempt_count=3 WHERE stage='bootstrap'");
      reconcile('2026-10-03T12:00:00.000Z');
      assert.deepEqual(reserve.getWordReserveCandidates(), first);
      assert.equal(count('word_preparation_work'), 20, 'failed members hold their slots without speculative replacement');
      db.runWithLearnerId('reserve-b', () => assert.deepEqual(reserve.getWordReserveCandidates(), []));
    }));
    await t.test('priority and durable lifecycle changes replace members; limit stays capped', () => owner(() => {
      const prior = reserve.getWordReserveCandidates();
      const top = Array.from({ length: 50 }, (_, i) => `reserve-${String(i).padStart(2, '0')}`).find(id => !prior.includes(id))!;
      sqlite.prepare(`INSERT INTO learner_owned_user_word_priority(learner_id,word_id,bump_count,force_top,priority_tier,required_for_next_session,updated_at)
        VALUES ('reserve-a',?,1,1,1,0,?)`).run(top, now);
      reconcile(now); assert.ok(reserve.getWordReserveCandidates().includes(top));
      assert.equal(reserve.getWordReserveCandidates().length, 10);
      const word = learners.getVocabularyLearnerWord(top)!;
      learners.changeVocabularyMode(top, 'solidify', word.stateVersion);
      reconcile(now); assert.ok(!reserve.getWordReserveCandidates().includes(top));
      assert.equal(reserve.getWordReserveCandidates().length, 10);
      const dismissed = reserve.getWordReserveCandidates().find(id => id !== top)!;
      learners.dismissVocabularyWord(dismissed); reconcile(now);
      assert.ok(!reserve.getWordReserveCandidates().includes(dismissed));
      assert.equal(reserve.getWordReserveCandidates().length, 10);
      db.setDailyNewWordLimit(20); reconcile(now); assert.equal(reserve.getWordReserveCandidates().length, 40);
      db.setDailyNewWordLimit(0); reconcile(now); assert.deepEqual(reserve.getWordReserveCandidates(), []);
    }));
    await t.test('changing admission source prepares diet candidates without enrolling them', () => owner(() => {
      db.setDailyNewWordLimit(2); db.setUnstudiedAdmissionSource('mixed'); setting('stash_diet_split', 0);
      reconcile(now); const diet = reserve.getWordReserveCandidates();
      assert.equal(diet.length, 4);
      assert.ok(diet.every(id => Number(id.slice(-2)) >= 50));
      assert.ok(diet.every(id => learners.getVocabularyLearnerWord(id) === null));
      reconcile('2026-10-04T12:00:00.000Z'); assert.deepEqual(reserve.getWordReserveCandidates(), diet);
      db.setUnstudiedAdmissionSource('stash_only'); reconcile(now);
      assert.equal(reserve.getWordReserveCandidates().length, 4);
      assert.ok(reserve.getWordReserveCandidates().every(id => learners.getVocabularyLearnerWord(id)?.inStash));
      assert.equal(count('vocabulary_practice_preparation'), 0);
    }));
    await t.test('new readiness is visible to the next Start without changing an existing payload', () => owner(() => {
      sqlite.prepare("DELETE FROM learner_owned_daily_new_word_intake WHERE learner_id='reserve-a'").run();
      const candidates = reserve.getWordReserveCandidates();
      publish(candidates[0]); reconcile();
      const first = startVocabularyStudy();
      assert.ok(first.session.context.words.some(word => word.wordId === candidates[0]));
      assert.ok(!first.session.context.words.some(word => word.wordId === candidates[1]));
      publish(candidates[1]); reconcile();
      assert.deepEqual(getVocabularyStudy(first.session.sessionId).session.context.words, first.session.context.words);
      const next = startVocabularyStudy();
      assert.ok(next.session.context.words.some(word => word.wordId === candidates[1]));
      assert.equal(count('vocabulary_practice_preparation'), 0, 'Start and teaching readiness do not enqueue general practice');
    }));
    await t.test('compatibility refresh is lazy, lease-fenced and preserves retained history', () => owner(() => {
      const wordId=reserve.getWordReserveCandidates()[0];
      const old=stages.getSharedWordIntroductionPreparation(wordId)!;
      assert.ok(old.contentId&&old.packageId);
      const retained=startVocabularyStudy();
      const state=sqlite.prepare('SELECT * FROM learner_words WHERE word_id=? ORDER BY learner_id').all(wordId);
      sqlite.prepare("UPDATE word_preparation_work SET status='ready',attempt_count=2 WHERE word_id=?").run(wordId);
      sqlite.prepare("UPDATE word_introduction_preparation SET preparation_epoch=0,active_stage='teaching',lease_token='held',lease_expires_at=? WHERE word_id=?")
        .run('2999-01-01T00:00:00.000Z',wordId);
      reconcile();
      assert.equal(stages.getSharedWordIntroductionPreparation(wordId)?.contentId,old.contentId,'live provider lease defers reset');
      assert.equal(teachingReady(wordId),false,'old preparation cannot enter a new teaching session');
      const historical=composeVocabularySessionPayload({sessionId:'historical-warmup',words:[{wordId,mode:'solidify'}]});
      assert.ok(historical.words[wordId].priming,'historical Solidify retains its banked introduction');
      assert.equal(historical.words[wordId].teaching,null,'historical material does not qualify for new teaching');
      assert.ok(sqlite.prepare("SELECT 1 FROM learner_word_reserve_requests WHERE learner_id='reserve-a'").get());
      sqlite.prepare("UPDATE word_introduction_preparation SET active_stage=NULL,lease_token=NULL,lease_expires_at=NULL WHERE word_id=?").run(wordId);
      // Explicit editorial fixture: the retained imported source is approved for practice.
      writeVocabularyDefaultUsefulSenses(wordId,0,getVocabularySenses(wordId).filter(sense=>sense.status==='active').map(sense=>sense.senseId),{kind:'service',id:'reserve-fixture'});
      const practice=createVocabularyPracticePreparation().ensure(wordId)!;
      reconcile();
      assert.equal(stages.getSharedWordIntroductionPreparation(wordId)?.contentId,old.contentId,'queued practice finishes against its retained source before refresh');
      sqlite.prepare("UPDATE vocabulary_practice_preparation SET status='ready' WHERE work_id=?").run(practice.workId);
      reconcile();
      assert.equal(stages.getSharedWordIntroductionPreparation(wordId)?.contentId,null);
      assert.equal(getWordPreparationWork(wordId,'bootstrap')?.attemptCount,0);
      assert.equal(getWordPreparationWork(wordId,'bootstrap')?.status,'queued');
      assert.ok(sqlite.prepare('SELECT 1 FROM word_content_documents WHERE content_id=?').get(old.contentId!));
      assert.ok(sqlite.prepare('SELECT 1 FROM word_teaching_packages WHERE package_id=?').get(old.packageId!));
      assert.deepEqual(sqlite.prepare('SELECT * FROM learner_words WHERE word_id=? ORDER BY learner_id').all(wordId),state);
      assert.deepEqual(getVocabularyStudy(retained.session.sessionId).session.context.words,retained.session.context.words);
      sqlite.prepare("UPDATE word_preparation_work SET attempt_count=1,last_error='transient' WHERE word_id=? AND stage='bootstrap'").run(wordId);
      reconcile();assert.equal(getWordPreparationWork(wordId,'bootstrap')?.attemptCount,1,'repeat reconciliation retains retry budget');
      publish(wordId);
      assert.equal(teachingReady(wordId),true);
      assert.notEqual(stages.getSharedWordTeachingPackageId(wordId),old.packageId,'current package wins over retained older package');
      assert.equal(count('vocabulary_practice_preparation'),1,'refresh adds no historical general-practice backfill');
    }));
    await t.test('established empty inventory leaves reserve without restashing or repeated preparation demand', () => owner(() => {
      const wordId=reserve.getWordReserveCandidates()[0];
      const actor={kind:'operator' as const,id:'reserve-fixture'};
      for(const sense of getVocabularySenses(wordId).filter(sense=>sense.status==='active')) {
        updateVocabularySense(sense.senseId,sense.version,{description:sense.description,status:'retired'},actor);
      }
      if(getVocabularySenseCatalog(wordId).establishedAt===null)establishVocabularySenseCatalog(wordId,getVocabularySenseCatalog(wordId).version,actor);
      const before=learners.getVocabularyLearnerWord(wordId);
      const workBefore=sqlite.prepare('SELECT * FROM word_preparation_work WHERE word_id=? ORDER BY stage').all(wordId);
      assert.equal(teachingReady(wordId),false);
      reconcile();reconcile();
      assert.equal(reserve.getWordReserveCandidates().includes(wordId),false);
      assert.deepEqual(learners.getVocabularyLearnerWord(wordId),before);
      assert.deepEqual(sqlite.prepare('SELECT * FROM word_preparation_work WHERE word_id=? ORDER BY stage').all(wordId),workBefore);
    }));
    await t.test('empty reserve retries later eligibility without another learner mutation',()=>{
      db.bootstrapLearner({learnerId:'reserve-empty'});
      db.runWithLearnerId('reserve-empty',()=>{
        db.setDailyNewWordLimit(1);db.setUnstudiedAdmissionSource('stash_only');learners.addVocabularyWord('reserve-58');
        sqlite.prepare("UPDATE learner_word_schedules SET next_eligible_at='2026-12-01T00:00:00.000Z' WHERE learner_id='reserve-empty'").run();
        reconcile('2026-11-01T00:00:00.000Z');assert.deepEqual(reserve.getWordReserveCandidates(),[]);
        assert.ok(reserve.listPendingWordReserveLearners().includes('reserve-empty'));
        reconcile('2026-12-02T00:00:00.000Z');assert.deepEqual(reserve.getWordReserveCandidates(),['reserve-58']);
      });
      sqlite.prepare("UPDATE learners SET disabled_at=? WHERE learner_id='reserve-empty'").run(now);
      assert.ok(!reserve.listPendingWordReserveLearners().includes('reserve-empty'),'disabled learners do not consume maintenance');
    });
    await t.test('explicit tops enter immediately at zero daily quota, newest forty win and eviction preserves work',()=>{
      db.bootstrapLearner({learnerId:'reserve-top'});
      db.runWithLearnerId('reserve-top',()=>{
        db.setDailyNewWordLimit(0);
        for(let i=0;i<45;i++){
          const id=`reserve-${String(i).padStart(2,'0')}`;learners.addVocabularyWord(id);
          sqlite.prepare(`INSERT INTO learner_owned_user_word_priority(learner_id,word_id,bump_count,force_top,priority_tier,required_for_next_session,updated_at)
            VALUES('reserve-top',?,1,1,1,0,?)`).run(id,new Date(Date.parse(now)+i*1000).toISOString());
        }
        const immediate=reserve.getWordReserveCandidates();
        assert.equal(immediate.length,40);assert.ok(immediate.includes('reserve-44'));assert.ok(!immediate.includes('reserve-00'));
        const victim=(sqlite.prepare("SELECT r.word_id FROM learner_word_preparation_reserve r JOIN learner_owned_user_word_priority p USING(learner_id,word_id) WHERE r.learner_id='reserve-top' ORDER BY p.updated_at,r.word_id LIMIT 1").get() as {word_id:string}).word_id;
        const artifacts=count('content_items'),work=sqlite.prepare('SELECT * FROM word_preparation_work ORDER BY work_id').all();
        sqlite.prepare("UPDATE learner_owned_user_word_priority SET updated_at='2999-01-01' WHERE learner_id='reserve-top' AND word_id='reserve-00'").run();
        assert.ok(reserve.getWordReserveCandidates().includes('reserve-00'));assert.ok(!reserve.getWordReserveCandidates().includes(victim));
        assert.equal(count('content_items'),artifacts);assert.deepEqual(sqlite.prepare('SELECT * FROM word_preparation_work ORDER BY work_id').all(),work);
        sqlite.prepare("UPDATE learner_word_schedules SET next_eligible_at='2999-01-01T00:00:00.000Z' WHERE learner_id='reserve-top' AND word_id='reserve-44'").run();
        reconcile();assert.equal(reserve.getWordReserveCandidates().length,40);
        assert.ok(reserve.getWordReserveCandidates().includes('reserve-44'),'future study date does not discard explicit preparation intent');
        assert.ok(getWordPreparationWork('reserve-44','bootstrap'),'explicit top still prepares with automatic daily intake zero');
        assert.equal(remainingVocabularyNewWordQuota(),0);
      });
    });
    await t.test('settled reserve audits see manual ready teaching despite paused old work, without session visits',async t=>{
      const content=await import('../server/db/vocabulary-content.ts');
      const {startWordPreparationRuntime}=await import('../server/word-content/preparation-runtime.ts');
      const {requireLearnerId}=await import('../server/db/learner-context.ts');
      sqlite.prepare("UPDATE service_controls SET enabled=0 WHERE control_key='provider_work_enabled'").run();
      const tickNow=Date.now();t.mock.timers.enable({apis:['Date','setInterval','setTimeout'],now:tickNow});
      const settle=async()=>{for(let i=0;i<30;i++)await new Promise<void>(resolve=>setImmediate(resolve));};
      const id='reserve-59';
      owner(()=>{
        learners.addVocabularyWord(id);db.setDailyNewWordLimit(1);db.setUnstudiedAdmissionSource('stash_only');
        reserve.replaceWordReserveCandidates([id]);reserve.setWordReserveReadiness(id,false,new Date().toISOString());reserve.finishWordReserveReconciliation();
        if(getVocabularySenseCatalog(id).establishedAt===null){content.createVocabularySense({wordId:id,description:{label:'ready'}},{kind:'operator',id:'test'});establishVocabularySenseCatalog(id,getVocabularySenseCatalog(id).version,{kind:'operator',id:'test'});}
        const exercise=content.createVocabularyContent({contentId:'audit-teach',kind:'exercise',payloadVersion:1,body:{prompt:'Ready'},exerciseType:'word',skill:'production',exerciseRole:'teaching',assessment:{match:'prepared'},answers:[{wordId:id,acceptedForms:['你好']}],accessScope:'shared',availability:'active',originKind:'human',words:[{wordId:id,relation:'target'}]},{kind:'operator',id:'test'});
        content.createVocabularyContent({contentId:'audit-intro',kind:'introduction',payloadVersion:1,body:{text:'Ready'},accessScope:'shared',availability:'active',originKind:'human',words:[{wordId:id,relation:'target'}],teachingExercises:[{exerciseId:exercise.contentId,exerciseVersion:exercise.version}]},{kind:'operator',id:'test'});
        getDb().prepare("INSERT OR IGNORE INTO word_preparation_work(work_id,word_id,stage,status,requested_by_learner_id,created_at,updated_at,next_attempt_at) VALUES('audit-paused',?,'bootstrap','paused','reserve-a',?,?,?)").run(id,now,now,now);
      });
      const paused=sqlite.prepare("SELECT * FROM word_preparation_work WHERE work_id='audit-paused'").get();
      db.runWithLearnerId('reserve-top',()=>reserve.requestWordReserveReconciliation());
      assert.ok(paused,'fixture retains a real paused job');
      const calls:string[]=[];let fail=true;
      const runtime=startWordPreparationRuntime({reconcile:()=>{const learner=requireLearnerId();calls.push(learner);if(learner==='reserve-top'&&fail){fail=false;throw new Error('Transient fixture');}reconcile();}});
      try{
        runtime.wake();runtime.wake();assert.equal(calls.length,0,'wakes never execute maintenance synchronously');await settle();
        assert.equal(calls.filter(id=>id==='reserve-top').length,1,'overlapping wakes use one pass');
        assert.ok(reserve.listPendingWordReserveLearners().includes('reserve-top'),'failure retains durable retry');
        assert.equal(owner(()=>reserve.getReadyWordReserveCandidates(new Date().toISOString()).some(row=>row.wordId===id)),false);
        t.mock.timers.tick(300_000);await settle();
        assert.ok(owner(()=>reserve.getReadyWordReserveCandidates(new Date().toISOString()).some(row=>row.wordId===id)),'periodic audit discovers publication without a request');
        assert.deepEqual(sqlite.prepare("SELECT * FROM word_preparation_work WHERE work_id='audit-paused'").get(),paused,'usable manual teaching does not reset old paused failure');
        const before=calls.length;
        sqlite.prepare("UPDATE service_controls SET enabled=1 WHERE control_key='maintenance_mode'").run();
        runtime.wake();await settle();assert.equal(calls.length,before);
        await runtime.stop();t.mock.timers.tick(300_000);runtime.wake();await settle();assert.equal(calls.length,before);
      }finally{await runtime.stop();t.mock.timers.reset();sqlite.prepare("UPDATE service_controls SET enabled=0 WHERE control_key='maintenance_mode'").run();sqlite.prepare("UPDATE service_controls SET enabled=1 WHERE control_key='provider_work_enabled'").run();}
    });
    await t.test('runtime polls reserve requests every 30 seconds and explicit wakes retain the twice-daily-limit buffer', async t => {
      const { startWordPreparationRuntime } = await import('../server/word-content/preparation-runtime.ts');
      sqlite.prepare("UPDATE service_controls SET enabled=0 WHERE control_key='provider_work_enabled'").run();
      owner(() => { db.setDailyNewWordLimit(0); reconcile(); });
      t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: Date.now() });
      const settle = async () => {for(let i=0;i<12;i++)await new Promise<void>(resolve => setImmediate(resolve));};
      const runtime = startWordPreparationRuntime();
      try {
        await settle();
        owner(() => { db.setDailyNewWordLimit(2); reserve.requestWordReserveReconciliation(); });
        t.mock.timers.tick(29_999); await settle();
        assert.equal(owner(() => reserve.getWordReserveCandidates().length), 0);
        assert.ok(reserve.listPendingWordReserveLearners().includes('reserve-a'));
        t.mock.timers.tick(1); await settle();
        assert.equal(owner(() => reserve.getWordReserveCandidates().length), 4);
        assert.equal(reserve.listPendingWordReserveLearners().includes('reserve-a'), false);

        owner(() => { db.setDailyNewWordLimit(3); reserve.requestWordReserveReconciliation(); });
        runtime.wake(); await settle();
        assert.equal(owner(() => reserve.getWordReserveCandidates().length), 6);
        assert.equal(reserve.listPendingWordReserveLearners().includes('reserve-a'), false);
        await runtime.stop();
        owner(() => { db.setDailyNewWordLimit(0); reserve.requestWordReserveReconciliation(); });
        t.mock.timers.tick(30_000); await settle();
        assert.equal(owner(() => reserve.getWordReserveCandidates().length), 6);
        assert.ok(reserve.listPendingWordReserveLearners().includes('reserve-a'));
        const restarted=startWordPreparationRuntime();
        try{await settle();assert.equal(owner(()=>reserve.getWordReserveCandidates().length),0);
          assert.ok(!reserve.listPendingWordReserveLearners().includes('reserve-a'),'new runtime consumes durable demand without a session visit');
        }finally{await restarted.stop();}
      } finally {
        await runtime.stop(); t.mock.timers.reset();
        sqlite.prepare("UPDATE service_controls SET enabled=1 WHERE control_key='provider_work_enabled'").run();
      }
    });
  } finally {
    sqlite.close();
    const { closeDbConnection } = await import('../server/db/connection.ts'); closeDbConnection();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
