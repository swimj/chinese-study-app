import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

// Use the complete preparation command and real composition/command/finalization
// paths: a plausible manifest alone does not establish a usable walkthrough.
test('full vocabulary fixture serves progression boundaries and persists a declined graduation', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'full-vocabulary-fixture-test-'));
  const dataDir=path.join(root,'fresh');
  const run=()=>spawnSync(process.execPath,['--import','tsx','scripts/prepare-vocabulary-fixtures.ts',`--data-dir=${dataDir}`],{encoding:'utf8'});
  try {
    const prepared=run();assert.equal(prepared.status,0,prepared.stderr);
    const manifest=JSON.parse(fs.readFileSync(path.join(dataDir,'fixture-manifest.json'),'utf8'));
    const before=fs.readFileSync(path.join(dataDir,'app.db'));
    assert.notEqual(run().status,0);assert.deepEqual(fs.readFileSync(path.join(dataDir,'app.db')),before,'fixture refuses to overwrite existing study data');
    Object.assign(process.env,{APP_MODE:'dev',APP_AUTH_MODE:'trusted_local',APP_STUDY_PROFILE:'mandarin',APP_LEARNER_ID:'dev-learner',
      APP_DATA_DIR:dataDir,APP_SEED_DATA_PATH:path.join(dataDir,'vocabulary-fixture-seed.json')});
    await import('../server/db.ts');
    const {getDb,closeDbConnection}=await import('../server/db/connection.ts');
    const {runWithLearnerId}=await import('../server/db/learner-context.ts');
    const {startVocabularyStudy,nextVocabularyExercise,commandVocabularyStudy}=await import('../server/vocabulary/study.ts');
    const {getVocabularyLearnerWord,getVocabularyWordSchedule}=await import('../server/db/vocabulary-learners.ts');
    const {getVocabularyContent}=await import('../server/db/vocabulary-content.ts');
    const {vocabularyRevealSnapshot}=await import('../server/vocabulary/reveal-snapshot.ts');
    const {stageVocabularySessionCompletion,closeVocabularySessionCompletion,getVocabularySession}=await import('../server/db/vocabulary-sessions.ts');
    try {
      runWithLearnerId('dev-learner',()=>{
        const expected=[...manifest.scenarios.teaching,...manifest.scenarios.solidify,...manifest.scenarios.practice] as string[];
        let study=startVocabularyStudy();const sessionId=study.session.sessionId;
        assert.equal(manifest.fixtureVersion,3);
        assert.equal(expected.length,12);
        for(const wordId of ['hc-馋-chán','hc-百分点-bǎiu5ffēnu5fdiǎn']) {
          for(const variant of [1,2,3]) {
            const content=getVocabularyContent(`vocabulary-session-fixture:${wordId}:${variant}`)!;
            assert.equal(content.kind,'exercise');
            const revealed=vocabularyRevealSnapshot(content).revealWords![0]!;
            assert.equal(revealed.sense?.version,1);
            const description=revealed.sense!.description as {label:string;source:{synthetic:boolean}};
            assert.equal(description.source.synthetic,true);
            if(variant===3)assert.equal(description.label,(content.body as {prompt:string}).prompt);
            if(wordId==='hc-馋-chán') {
              assert.equal(revealed.meaning,'gluttonous');
              assert.equal(description.label,'To crave tasty food; to have your appetite tempted by something delicious.');
            }
          }
        }
        const unmapped=getVocabularyContent('vocabulary-session-fixture:hc-部署-bùu5fshǔ:1')!;
        assert.equal(vocabularyRevealSnapshot(unmapped).revealWords![0]!.sense,undefined);
        assert.deepEqual(new Set(study.session.context.words.map(word=>word.wordId)),new Set(expected));
        const reviewSelections=manifest.scenarios.reviewSelections as {wordId:string;skillId:string}[];
        assert.equal(reviewSelections.length,6);
        assert.equal(reviewSelections.filter(entry=>entry.skillId==='recognition').length,3);
        assert.equal(reviewSelections.filter(entry=>entry.skillId==='production').length,3);
        for(const selection of reviewSelections) {
          assert.equal(study.session.context.words.find(word=>word.wordId===selection.wordId)?.selectedSkill,selection.skillId);
        }
        assert.deepEqual(manifest.scenarios.solidifyProgress.map((word:{cleanCoveredSessions:number})=>word.cleanCoveredSessions),[0,1,2,3]);
        const heldId=manifest.scenarios.previousChoice.wordId as string;
        assert.equal(getVocabularyLearnerWord(heldId)!.automaticPromotionPaused,true);
        const prior=getVocabularySession(manifest.scenarios.previousChoice.sessionId);
        assert.equal(prior.status,'closed');
        assert.equal(prior.projection.words[heldId]!.skillProgress.recognition.acceptedResponses,1);
        assert.equal(prior.projection.words[heldId]!.skillProgress.production.acceptedResponses,1);
        assert.equal(prior.actions.length,7);
        assert.ok(prior.actions.some(action=>action.kind==='mode_change'&&action.payload.mode==='solidify'));
        let serial=0;
        function cover(wordId:string) {
          study=nextVocabularyExercise(sessionId,`fixture-${++serial}`,{wordId});
          for(let tries=0;tries<12&&!study.session.projection.words[wordId]!.covered;tries++) {
            const encounter=study.currentEncounter!;
            if(encounter.snapshot.kind!=='introduction') {
              const answer=encounter.snapshot.assessment!.acceptedAnswers[0]!;
              study=commandVocabularyStudy(sessionId,`fixture-${++serial}`,{type:'response',response:answer,
                ...(encounter.snapshot.kind==='recognition'?{selfAssessment:'accepted' as const}:{})});
            }
            if(!study.session.projection.words[wordId]!.covered)study=nextVocabularyExercise(sessionId,`fixture-${++serial}`,{wordId});
          }
          assert.equal(study.session.projection.words[wordId]!.covered,true,wordId);
        }
        for(const id of manifest.scenarios.practice as string[])cover(id);
        for(const id of manifest.scenarios.solidify as string[])cover(id);
        assert.equal(study.session.projection.words['word-bukan']!.recommendedMode,null);
        assert.equal(study.session.projection.words['word-shichen-dahai']!.recommendedMode,null);
        assert.equal(study.session.projection.words['word-weisuoyuwei']!.recommendedMode,'practice');
        assert.equal(study.session.projection.words[heldId]!.recommendedMode,null);
        study=commandVocabularyStudy(sessionId,`fixture-${++serial}`,{type:'mode',wordId:'word-weisuoyuwei',mode:'solidify'});
        assert.equal(study.session.projection.words['word-weisuoyuwei']!.recommendedMode,null);
        study=commandVocabularyStudy(sessionId,`fixture-${++serial}`,{type:'finishForNow'});
        if(study.session.projection.phase!=='completed')study=commandVocabularyStudy(sessionId,`fixture-${++serial}`,{type:'finishImmediately'});
        const staged=stageVocabularySessionCompletion(sessionId,study.session.projection.throughSequence);
        const tomorrow=new Date(Date.now()+86_400_000).toISOString();
        closeVocabularySessionCompletion(sessionId,staged.completionId,tomorrow);
        assert.equal(getVocabularyLearnerWord('word-weisuoyuwei')!.mode,'solidify');
        assert.equal(getVocabularyLearnerWord('word-weisuoyuwei')!.automaticPromotionPaused,true);
        assert.equal(getVocabularyLearnerWord(heldId)!.mode,'solidify');
        assert.equal(getVocabularyWordSchedule(heldId)!.schedulerState.cleanCoveredSessions,4);
        assert.deepEqual(getDb().prepare('PRAGMA foreign_key_check').all(),[]);
      });
    }finally{closeDbConnection();}
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
