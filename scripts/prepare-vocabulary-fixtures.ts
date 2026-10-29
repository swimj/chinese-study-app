import fs from 'node:fs';
import path from 'node:path';
import { readStrictArguments, requireArgument } from './lib/hosted-runtime.ts';
import { buildUiAnnotationSeed } from '../server/seeds/ui-annotation-data.ts';
import type { VocabularySessionAction, VocabularySessionActionPayload } from '../src/domain/vocabulary-session.ts';

// Claim a fresh directory before importing database modules. Existing runs stay intact.
const args=readStrictArguments(['data-dir']);
const dataDir=path.resolve(requireArgument(args,'data-dir'));
fs.mkdirSync(path.dirname(dataDir),{recursive:true});fs.mkdirSync(dataDir);
const now=new Date(),seedPath=path.join(dataDir,'vocabulary-fixture-seed.json');
fs.writeFileSync(seedPath,JSON.stringify(buildUiAnnotationSeed(now),null,2));
Object.assign(process.env,{APP_MODE:'dev',APP_AUTH_MODE:'trusted_local',APP_STUDY_PROFILE:'mandarin',
  APP_LEARNER_ID:'dev-learner',APP_DATA_DIR:dataDir,APP_SEED_DATA_PATH:seedPath,APP_INCLUDE_DEV_CONTRAST_SEED:'true'});
const {getDb,closeDbConnection}=await import('../server/db/connection.ts');
try {
  const {prepareUiAnnotationFixtures}=await import('../server/seeds/ui-annotations.ts');
  const annotation=prepareUiAnnotationFixtures(now);
  const {prepareVocabularySessionPracticeFixtures}=await import('../server/seeds/vocabulary-session-fixtures.ts');
  const {runWithLearnerId}=await import('../server/db/learner-context.ts');
  const {addVocabularyWord,getVocabularyLearnerWord,getVocabularyWordSchedule}=await import('../server/db/vocabulary-learners.ts');
  const {getVocabularyContent,createVocabularyContent}=await import('../server/db/vocabulary-content.ts');
  const {createVocabularySession,appendVocabularySessionActions,stageVocabularySessionCompletion,closeVocabularySessionCompletion}=await import('../server/db/vocabulary-sessions.ts');
  const {selectVocabularyReviewSkills}=await import('../server/vocabulary/review-selection.ts');
  const {importLegacyVocabulary}=await import('../server/db/vocabulary-import.ts');
  const {setHostedServiceControl}=await import('../server/db/hosted-operations.ts');
  setHostedServiceControl({key:'provider_work_enabled',enabled:false,actorId:'vocabulary-fixture'});
  const db=getDb();db.exec('BEGIN IMMEDIATE');
  let scenarios;
  try {
    importLegacyVocabulary(db);
    scenarios=runWithLearnerId('dev-learner',()=>{
      const content=prepareVocabularySessionPracticeFixtures();
      const practice=[annotation.words.review,...content.practiceWordIds];
      const solidify=[...annotation.words.learning,content.heldWordId];
      const all=[...annotation.words.introduction,...solidify,...practice];
      for(const wordId of all){
        addVocabularyWord(wordId);
        const index=solidify.indexOf(wordId);
        const mode=index>=0?'solidify':practice.includes(wordId)?'practice':'unstudied';
        // These are deliberately synthetic starting states, not learner mode choices.
        db.prepare('UPDATE learner_words SET mode=?,automatic_promotion_paused=0 WHERE learner_id=? AND word_id=?')
          .run(mode,'dev-learner',wordId);
        const schedule=getVocabularyWordSchedule(wordId)!;
        db.prepare('UPDATE learner_word_schedules SET next_eligible_at=NULL,scheduler_state_json=? WHERE learner_id=? AND word_id=?')
          .run(JSON.stringify({...schedule.schedulerState,cleanCoveredSessions:index<0?0:Math.min(index,2)}),'dev-learner',wordId);
      }
      // Give all six review words stable, overdue histories on both independent skills.
      // Alternating urgency creates three recognition and three production objectives.
      for (const [index,wordId] of practice.entries()) {
        const recognitionFirst=index%2===1;
        const productionLast=new Date(now.getTime()-(recognitionFirst?2:8)*86_400_000).toISOString();
        const recognitionLast=new Date(now.getTime()-(recognitionFirst?8:2)*86_400_000).toISOString();
        const due=new Date(now.getTime()-86_400_000).toISOString();
        const schedule=getVocabularyWordSchedule(wordId)!;
        db.prepare(`UPDATE learner_word_schedules SET last_practised_at=?,next_eligible_at=?,scheduler_state_json=?
          WHERE learner_id=? AND word_id=?`).run(productionLast,due,
          JSON.stringify({...schedule.schedulerState,enabled:1,intervalHours:48,easeFactor:2.5,cleanCoveredSessions:0}),'dev-learner',wordId);
        for(const [skill,last,interval] of [['recognition',recognitionLast,24],['production',productionLast,48]] as const) {
          db.prepare(`INSERT INTO learner_owned_word_skill_state(learner_id,word_id,skill_id,enabled,interval_hours,last_studied_at,next_due_at,ease_factor)
            VALUES (?,?,?,1,?,?,?,2.5) ON CONFLICT(learner_id,word_id,skill_id) DO UPDATE SET
              enabled=1,interval_hours=excluded.interval_hours,last_studied_at=excluded.last_studied_at,next_due_at=excluded.next_due_at,ease_factor=excluded.ease_factor`)
            .run('dev-learner',wordId,skill,interval,last,due);
          db.prepare(`UPDATE learner_owned_word_skill_relevance SET relevance_state='active' WHERE learner_id=? AND word_id=? AND skill_id=?`)
            .run('dev-learner',wordId,skill);
        }
        db.prepare(`INSERT INTO learner_owned_word_study_admission_state(learner_id,word_id,study_phase,earliest_next_study_at)
          VALUES (?,?,'review',?) ON CONFLICT(learner_id,word_id) DO UPDATE SET study_phase='review',earliest_next_study_at=excluded.earliest_next_study_at`)
          .run('dev-learner',wordId,due);
        db.prepare(`UPDATE learner_owned_word_skill_state SET next_due_at=? WHERE learner_id=? AND word_id=? AND skill_id='contextual_selection'`)
          .run(new Date(now.getTime()+365*86_400_000).toISOString(),'dev-learner',wordId);
      }
      // Freeze incidental seed admissions out of this walkthrough, including independent skills.
      const future=new Date(now.getTime()+365*86_400_000).toISOString();
      const placeholders=all.map(()=>'?').join(',');
      db.prepare(`UPDATE learner_word_schedules SET next_eligible_at=? WHERE learner_id=? AND word_id NOT IN (${placeholders})`)
        .run(future,'dev-learner',...all);
      db.prepare(`UPDATE learner_owned_word_skill_state SET next_due_at=? WHERE learner_id=? AND word_id NOT IN (${placeholders})`)
        .run(future,'dev-learner',...all);
      db.prepare(`INSERT INTO learner_settings(learner_id,setting_key,value_json,updated_at) VALUES (?,?,?,?)
        ON CONFLICT(learner_id,setting_key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`)
        .run('dev-learner','daily_new_word_limit','2',now.toISOString());

      // Exercise the real finalization path for a previous-day declined recommendation.
      // Content/state is authored fixture material; this log is a synthetic learner history.
      // Leave room for completion's 16 seconds without crossing into today's UTC date.
      const previousAt=new Date(Date.parse(`${now.toISOString().slice(0,10)}T00:00:00.000Z`)-86_400_000).toISOString();
      const sessionId='vocabulary-fixture-kept-solidifying';
      const wordId=content.heldWordId;
      const exercise=getVocabularyContent(content.exerciseIdsByWord[wordId]![0]!)!;
      if(exercise.kind!=='exercise'||exercise.skill!=='production')throw new Error('Held fixture needs production content');
      const body=exercise.body as Record<string,unknown>;
      if(typeof body.prompt!=='string')throw new Error('Held fixture needs a visible prompt');
      const recognition=createVocabularyContent({contentId:`vocabulary-session-fixture:${wordId}:prior-recognition`,kind:'exercise',payloadVersion:1,
        exerciseType:'recognition',skill:'recognition',exerciseRole:'general',accessScope:'shared',availability:'active',originKind:'human',
        body:{prompt:'花卉',answer:'Flowering plants, especially in horticulture.'},assessment:{responseMode:'self_assessment'},
        words:[{wordId,relation:'target'}],answers:[{wordId,acceptedForms:['花卉']}]},{kind:'operator',id:'vocabulary-session-fixture'});
      if(recognition.kind!=='exercise')throw new Error('Held fixture needs recognition content');
      createVocabularySession({sessionId,words:[{wordId,mode:'solidify'}]},previousAt);
      const inputs:VocabularySessionActionPayload[]=[
        {kind:'presentation',payload:{encounterId:'held-recognition',wordId,snapshot:{contentId:recognition.contentId,contentVersion:recognition.version,
          kind:'recognition',role:'general',body:{prompt:'花卉',material:recognition.body},
          assessment:{acceptedAnswers:recognition.answers.flatMap(answer=>answer.acceptedForms),criteria:recognition.assessment}}}},
        {kind:'response',payload:{encounterId:'held-recognition',response:null,selfAssessment:'accepted',outcome:'accepted'}},
        {kind:'presentation',payload:{encounterId:'held-encounter',wordId,snapshot:{contentId:exercise.contentId,contentVersion:exercise.version,
          kind:'production',role:'general',body:{prompt:body.prompt,material:exercise.body},
          assessment:{acceptedAnswers:exercise.answers.flatMap(answer=>answer.acceptedForms),criteria:exercise.assessment}}}},
        {kind:'response',payload:{encounterId:'held-encounter',response:exercise.answers[0]!.acceptedForms[0]!,outcome:'accepted'}},
        {kind:'word_wrap',payload:{wordId,reason:'policy'}},
      ];
      const action=(input:VocabularySessionActionPayload,index:number):VocabularySessionAction=>({...input,protocolVersion:1,
        sequence:index+1,actionId:`held-${index+1}`,clientActionId:`held-${index+1}`,occurredAt:previousAt});
      const eligible=appendVocabularySessionActions(sessionId,inputs.map(action),previousAt);
      if(eligible.projection.words[wordId]!.recommendedMode!=='practice')throw new Error('Held fixture must first qualify for graduation');
      appendVocabularySessionActions(sessionId,[
        action({kind:'mode_change',payload:{wordId,mode:'solidify'}},inputs.length),
        action({kind:'finish_for_now',payload:{}},inputs.length+1),
      ],previousAt);
      const completion=stageVocabularySessionCompletion(sessionId,inputs.length+2,previousAt);
      closeVocabularySessionCompletion(sessionId,completion.completionId,new Date(Date.parse(previousAt)+16_000).toISOString());
      if(!getVocabularyLearnerWord(wordId)!.automaticPromotionPaused)throw new Error('Previous explicit choice was not persisted');
      // Exactly one prepared past session; actual observation ingestion still belongs to the worker.
      const reviewSelections=selectVocabularyReviewSkills({now:now.toISOString()}).filter(entry=>practice.includes(entry.wordId));
      return {practice,reviewSelections,solidify,teaching:[...annotation.words.introduction],practiceExerciseIds:content.exerciseIdsByWord,
        solidifyProgress:solidify.map(id=>({wordId:id,cleanCoveredSessions:getVocabularyWordSchedule(id)!.schedulerState.cleanCoveredSessions,
          automaticPromotionPaused:getVocabularyLearnerWord(id)!.automaticPromotionPaused,
          expectedOnCleanCoverage:id===wordId?'stay_solidify_manual_choice':id===annotation.words.learning[2]?'recommend_practice':'stay_solidify_below_threshold'})),
        previousChoice:{sessionId,completionId:completion.completionId,wordId,occurredAt:previousAt,recommendedMode:'practice',chosenMode:'solidify'}};
    });
    db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  const manifest={...annotation,fixtureVersion:3,scenarios};
  fs.writeFileSync(path.join(dataDir,'fixture-manifest.json'),JSON.stringify(manifest,null,2));
  console.log(JSON.stringify({dataDir,providerWorkEnabled:false,...manifest},null,2));
}finally{closeDbConnection();}
