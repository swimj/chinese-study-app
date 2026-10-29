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
      publish(candidates[0]);
      const first = startVocabularyStudy();
      assert.ok(first.session.context.words.some(word => word.wordId === candidates[0]));
      assert.ok(!first.session.context.words.some(word => word.wordId === candidates[1]));
      publish(candidates[1]);
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
  } finally {
    sqlite.close();
    const { closeDbConnection } = await import('../server/db/connection.ts'); closeDbConnection();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
