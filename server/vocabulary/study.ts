import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { normalizeProductionAnswerForProfile } from '../../src/study-profile.ts';
import type { VocabularyContent, VocabularyJson } from '../../src/domain/vocabulary-content.ts';
import type { VocabularyStudy, VocabularyStudyCommand, VocabularyStudyWord } from '../../src/domain/vocabulary-study-api.ts';
import { projectVocabularySession, VOCABULARY_SESSION_POLICY, type VocabularyEncounterSnapshot, type VocabularySessionAction, type VocabularySessionInitialContext,
  type VocabularySessionJson, type VocabularySessionProjection, type VocabularyTeachingRequirements } from '../../src/domain/vocabulary-session.ts';
import type { VocabularyPersistedSession } from '../../src/domain/vocabulary-session-api.ts';
import { getDb } from '../db/connection.ts';
import { composeVocabularyStudy } from './composition.ts';
import { selectVocabularyPureCueCandidates } from './pure-cue-serving.ts';
import { enqueueWordPreparation } from '../db/preparation-work.ts';
import { requireLearnerId } from '../db/learner-context.ts';
import { getVocabularyLearnerWord, enrollVocabularyDietWord } from '../db/vocabulary-learners.ts';
import { createVocabularyContent, emitBackendEvent, getVocabularyContent, getVocabularyTeachingExercises, listVocabularyExercises } from '../db/vocabulary-content.ts';
import { appendVocabularySessionActions, createVocabularySession, getVocabularySession, VocabularySessionConflictError,
  VocabularySessionInputError } from '../db/vocabulary-sessions.ts';

type ActionInput = VocabularySessionAction extends infer A ? A extends VocabularySessionAction ? Pick<A, 'kind' | 'payload'> : never : never;
let savepoint = 0;
function atomic<T>(work: () => T): T {
  const db=getDb();const nested=db.isTransaction;const name=`vocabulary_study_${++savepoint}`;
  db.exec(nested?`SAVEPOINT ${name}`:'BEGIN IMMEDIATE');
  try{const result=work();db.exec(nested?`RELEASE ${name}`:'COMMIT');return result;}
  catch(error){db.exec(nested?`ROLLBACK TO ${name}`:'ROLLBACK');if(nested)db.exec(`RELEASE ${name}`);throw error;}
}
function object(value: VocabularyJson): Record<string,VocabularyJson> {return value!==null&&typeof value==='object'&&!Array.isArray(value)?value:{};}
function lexical(wordId:string):VocabularyStudyWord {
  const row=getDb().prepare('SELECT id AS wordId,hanzi,traditional,pinyin,meaning FROM lexical_words WHERE id=?').get(wordId) as VocabularyStudyWord|undefined;
  if(!row)throw new VocabularySessionInputError('Unknown lexical word');return {...row};
}
function skillEnabled(wordId:string,skill:'recognition'|'production'|'contextual_selection'):boolean {
  const disabled=getDb().prepare('SELECT enabled FROM learner_owned_word_skill_state WHERE learner_id=? AND word_id=? AND skill_id=?')
    .get(requireLearnerId(),wordId,skill) as {enabled:number}|undefined;
  const relevance=getDb().prepare('SELECT relevance_state FROM learner_owned_word_skill_relevance WHERE learner_id=? AND word_id=? AND skill_id=?')
    .get(requireLearnerId(),wordId,skill) as {relevance_state:string}|undefined;
  return disabled?.enabled!==0&&relevance?.relevance_state!=='suppressed';
}
function suppressed(wordId:string):boolean {return !skillEnabled(wordId,'production');}
function eligible(content:VocabularyContent):boolean {
  return content.availability==='active'&&(content.accessScope==='shared'||content.ownerLearnerId===requireLearnerId())
    &&!getDb().prepare('SELECT 1 FROM learner_content_deactivations WHERE learner_id=? AND content_id=?').get(requireLearnerId(),content.contentId)
;
}
function recognitionDue(wordId:string):boolean {
  if(!skillEnabled(wordId,'recognition'))return false;
  return Boolean(getDb().prepare("SELECT 1 FROM learner_owned_word_skill_state WHERE learner_id=? AND word_id=? AND skill_id='recognition' AND enabled=1 AND (next_due_at IS NULL OR next_due_at<=?)")
    .get(requireLearnerId(),wordId,new Date().toISOString()));
}
function dueRecognitionWordIds():string[] {
  return (getDb().prepare(`SELECT s.word_id FROM learner_owned_word_skill_state s JOIN learner_words w USING(learner_id,word_id)
    WHERE s.learner_id=? AND s.skill_id='recognition' AND s.enabled=1 AND w.mode!='unstudied' AND w.dismissed_at IS NULL
    AND (s.next_due_at IS NULL OR s.next_due_at<=?) ORDER BY s.next_due_at,s.word_id LIMIT 12`).all(requireLearnerId(),new Date().toISOString()) as {word_id:string}[]).map((row)=>row.word_id).filter((wordId)=>skillEnabled(wordId,'recognition'));
}
function introductions(wordId:string):VocabularyContent[] {
  return (getDb().prepare(`SELECT c.content_id FROM content_items c JOIN content_words w USING(content_id)
    WHERE w.word_id=? AND w.relation='target' AND c.kind='introduction' ORDER BY c.created_at,c.content_id`).all(wordId) as {content_id:string}[])
    .map((row)=>getVocabularyContent(row.content_id)).filter((content):content is VocabularyContent=>content!==null&&eligible(content));
}
function baseline(wordId:string,kind:'recognition'|'production',role:'teaching'|'general'):VocabularyContent|null {
  if(!skillEnabled(wordId,kind))return null;
  const word=lexical(wordId);const id=`vocabulary:baseline:v1:${requireLearnerId()}:${kind}:${role}:${wordId}`;
  const existing=getVocabularyContent(id);if(existing)return eligible(existing)?existing:null;
  const content=createVocabularyContent({contentId:id,kind:'exercise',payloadVersion:1,
    body:kind==='recognition'?{prompt:word.hanzi,answer:word.meaning,pinyin:word.pinyin,source:{kind:'dictionary_baseline',wordId}}
      :{prompt:word.meaning,instruction:'Give the Mandarin word.',source:{kind:'dictionary_baseline',wordId}},
    exerciseType:kind==='recognition'?'recognition':'definition',skill:kind,exerciseRole:role,
    assessment:kind==='recognition'?{responseMode:'self_assessment'}:{match:'prepared_answer_membership'},
    answers:[{wordId,acceptedForms:[...new Set([word.hanzi,word.traditional].filter((value):value is string=>Boolean(value)))]}],
    accessScope:'private',ownerLearnerId:requireLearnerId(),availability:'active',originKind:'human',authorKind:'service',authorId:'vocabulary-dictionary-baseline-v1',
    words:[{wordId,relation:'target'}]}, {kind:'service',id:'vocabulary-dictionary-baseline-v1',reason:{source:'existing lexical dictionary facts',senseMapping:'unresolved'}});
  return eligible(content)?content:null;
}
function teaching(wordId:string):{intro:VocabularyContent;exercises:VocabularyContent[];requirements:VocabularyTeachingRequirements}|null {
  for(const intro of introductions(wordId)) {
    const exercises=getVocabularyTeachingExercises(intro.contentId).filter(eligible);
    if(!exercises.some((entry)=>entry.kind==='exercise'&&entry.skill==='production'))continue;
    const recognition=exercises.some((entry)=>entry.kind==='exercise'&&entry.skill==='recognition')?null:baseline(wordId,'recognition','teaching');
    if(recognition)exercises.unshift(recognition);
    if(!exercises.some((entry)=>entry.kind==='exercise'&&entry.skill==='recognition'))continue;
    return {intro,exercises,requirements:{introductionContentId:intro.contentId,
      requiredExerciseContentIds:exercises.map((entry)=>entry.contentId),minimumRecognitionResponses:1,minimumProductionResponses:1}};
  }
  return null;
}
function isContrast(content:VocabularyContent):boolean {
  return content.kind==='exercise'&&(content.exerciseType==='contrast'||content.skill==='contextual_selection'||object(content.assessment).responseMode==='word_choice');
}
function contrastEligible(content:VocabularyContent,wordId:string):boolean {
  if(!isContrast(content)||!skillEnabled(wordId,'contextual_selection'))return false;
  const state=getDb().prepare("SELECT 1 FROM learner_owned_word_skill_state WHERE learner_id=? AND word_id=? AND skill_id='contextual_selection' AND enabled=1 AND (next_due_at IS NULL OR next_due_at<=?)")
    .get(requireLearnerId(),wordId,new Date().toISOString());
  if(!state)return false;
  const choices=object(content.body).choices;
  return Array.isArray(choices)&&choices.length>=2&&choices.every((choice)=>{
    const id=object(choice).wordId;if(typeof id!=='string')return false;
    const member=getVocabularyLearnerWord(id);return member!==null&&member.dismissedAt===null&&member.mode!=='unstudied';
  });
}
function dueContextualWordIds():string[] {
  return (getDb().prepare(`SELECT s.word_id FROM learner_owned_word_skill_state s JOIN learner_words w USING(learner_id,word_id)
    WHERE s.learner_id=? AND s.skill_id='contextual_selection' AND s.enabled=1 AND w.mode!='unstudied' AND w.dismissed_at IS NULL
    AND (s.next_due_at IS NULL OR s.next_due_at<=?) ORDER BY s.next_due_at,s.word_id LIMIT 12`).all(requireLearnerId(),new Date().toISOString()) as {word_id:string}[])
    .map((row)=>row.word_id).filter((wordId)=>listVocabularyExercises({wordId,mode:getVocabularyLearnerWord(wordId)!.mode as 'solidify'|'practice'|'maintain'}).some((entry)=>eligible(entry)&&contrastEligible(entry,wordId)));
}
function availableGeneral(wordId:string,mode:'solidify'|'practice'|'maintain'):VocabularyContent[] {
  const pool=listVocabularyExercises({wordId,mode}).filter((entry)=>eligible(entry)&&entry.kind==='exercise'&&entry.exerciseType!=='pure_cue'&&(isContrast(entry)?contrastEligible(entry,wordId):entry.skill==='recognition'?skillEnabled(wordId,'recognition'):skillEnabled(wordId,'production')));
  // Recognition remains its own self-assessed objective and never supplies production coverage.
  const recognize=baseline(wordId,'recognition','general');
  if(mode==='maintain') {
    if(pool.length)return pool;
    const direct=baseline(wordId,'production','general');
    if(direct)emitBackendEvent({name:'vocabulary.maintain.baseline_selected',learnerId:requireLearnerId(),entityKind:'word',entityId:wordId,
      data:{contentId:direct.contentId,reason:'no eligible curated current exercise',curated:false}});
    return direct?[direct]:[];
  }
  if(!pool.some((entry)=>entry.kind==='exercise'&&entry.skill==='production'&&!isContrast(entry))) {
    const direct=baseline(wordId,'production','general');if(direct)pool.push(direct);
  }
  if(recognize&&!pool.some((entry)=>entry.contentId===recognize.contentId))pool.push(recognize);
  return pool;
}
function pureCandidates(session?:VocabularyPersistedSession):VocabularyContent[] {
  return selectVocabularyPureCueCandidates({ordinaryReviewCount:session?.context.words.filter((word)=>word.mode==='practice'||word.mode==='maintain').length??0,
    sessionSeed:session?.sessionId??`adoption/${requireLearnerId()}`});
}
function snapshot(content:VocabularyContent,role:VocabularyEncounterSnapshot['role']):VocabularyEncounterSnapshot {
  const body=object(content.body);const prompt=typeof body.prompt==='string'?body.prompt:content.kind==='introduction'?'Introduction':'';
  return {contentId:content.contentId,contentVersion:content.version,kind:content.kind==='introduction'?'introduction':content.skill==='recognition'?'recognition':isContrast(content)?'contrast':'production',role,
    body:{prompt,material:content.body,...(typeof body.answer==='string'?{answer:body.answer}:{}),...(typeof body.explanation==='string'?{explanation:body.explanation}:{})},
    assessment:content.kind==='introduction'?null:{acceptedAnswers:content.answers.flatMap((entry)=>entry.acceptedForms),criteria:content.assessment},
    ...(content.kind==='exercise'&&content.exerciseType==='pure_cue'?{schedulingScope:'pure_cue' as const,selectedThroughWordId:null}:{}),
    mappingSnapshot:content.words.map((word)=>({wordId:word.wordId,senseId:word.senseId??null,senseMappingEstablishedAt:word.senseMappingEstablishedAt??null})),
  };
}
function inputJson(value:unknown):VocabularySessionJson{return JSON.parse(JSON.stringify(value)) as VocabularySessionJson;}
function commandRetry(session:VocabularyPersistedSession,clientId:string,input:VocabularySessionJson):boolean {
  if(!clientId.trim())throw new VocabularySessionInputError('Expected command identity');
  const old=session.actions.find((action)=>action.clientActionId===clientId);
  if(!old)return false;
  if(!isDeepStrictEqual(old.commandInput,input))throw new VocabularySessionConflictError('Command identity already has different input');
  return true;
}
function actionBuilder(session:VocabularyPersistedSession,clientId:string,input:VocabularySessionJson) {
  const additions:VocabularySessionAction[]=[];
  return {additions,push(action:ActionInput){
    const offset=additions.length;const suffix=offset===0?'':`:${offset}`;
    additions.push({...action,protocolVersion:1,sequence:session.actions.length+offset+1,actionId:createHash('sha256').update(`${session.sessionId}/${clientId}${suffix}`).digest('hex'),
      clientActionId:`${clientId}${suffix}`,transitionId:clientId,occurredAt:new Date().toISOString(),...(offset===0?{commandInput:input}:{})});
  },projection(){return projectVocabularySession(session.context,[...session.actions,...additions]);}};
}
function current(session:VocabularyPersistedSession) {return session.projection.encounters.filter((entry)=>!entry.presentationUndone).at(-1)??null;}
export function getVocabularyStudy(sessionId:string):VocabularyStudy {
  const session=getVocabularySession(sessionId);const encounter=current(session);const wordId=encounter?.wordId??null;
  const word=wordId?session.projection.words[wordId]:null;const active=session.status==='active'&&session.projection.phase!=='completed';
  const pending=encounter!==null&&!encounter.skipped&&encounter.effectiveResponses.length===0;
  return {session,words:session.context.words.map((word)=>lexical(word.wordId)),currentEncounter:encounter,currentWordId:wordId,
    controls:{canNext:active,canSkip:active&&encounter!==null,canEnough:active&&word?.workStatus==='open'&&word.mode!=='unstudied'&&!session.context.words.find((entry)=>entry.wordId===wordId)?.recognitionOnly&&!session.context.words.find((entry)=>entry.wordId===wordId)?.contextualOnly,
      canMore:active&&word!==null&&!word.teachingDeferred&&(word.workStatus==='wrapped'||word.workStatus==='skipped'),canUndo:active&&session.projection.latestUndoableActionId!==null,
      canFinishForNow:active&&session.projection.phase==='active',canFinishImmediately:active&&session.projection.phase==='finishing',canChangeMode:active&&wordId!==null},
    notice:word?.teachingDeferred?'This word is now Unstudied. Fresh teaching will start in your next session.':session.projection.phase==='finishing'?'Finish the words already started, or finish immediately.':active&&pending?null:active?'Choose another exercise or finish for now.':null};
}
function teachingReady(wordId:string):boolean {
  return skillEnabled(wordId,'recognition')&&!suppressed(wordId)&&introductions(wordId).some((intro)=>getVocabularyTeachingExercises(intro.contentId)
    .some((entry)=>eligible(entry)&&entry.kind==='exercise'&&entry.skill==='production'));
}
export function startVocabularyStudy(options:{requestTeaching?:(wordId:string)=>void}={}):VocabularyStudy {
  // Capture preparation demand before the session transaction: no-ready must not roll it back.
  const composition=composeVocabularyStudy({teachingReady,requestTeaching:options.requestTeaching??((wordId)=>{enqueueWordPreparation(wordId,'teaching');})});
  return atomic(()=>{
    const words:VocabularySessionInitialContext['words'][number][]=[];
    for(const wordId of composition.newWordIds) {
      enrollVocabularyDietWord(wordId);
      const ready=teaching(wordId);if(ready)words.push({wordId,mode:'unstudied',teachingRequirements:ready.requirements});
    }
    for(const wordId of composition.dueWordIds) {
      const candidate=getVocabularyLearnerWord(wordId);
      if(candidate&&!suppressed(wordId))words.push({wordId,mode:candidate.mode});
    }
    for(const wordId of dueContextualWordIds()) {
      if(words.length>=12)break;
      if(words.some((word)=>word.wordId===wordId))continue;
      const word=getVocabularyLearnerWord(wordId);
      if(word)words.push({wordId,mode:word.mode,contextualOnly:true});
    }
    for(const wordId of dueRecognitionWordIds()) {
      if(words.length>=12)break;
      if(words.some((word)=>word.wordId===wordId))continue;
      const word=getVocabularyLearnerWord(wordId);
      if(word)words.push({wordId,mode:word.mode,recognitionOnly:true});
    }
    if(words.length===0&&pureCandidates().length===0)throw new VocabularySessionInputError(composition.requestedPreparationWordIds.length
      ?'Your new-word introductions are being prepared. Try starting again shortly; other ready work can be studied when available.'
      :'No ready study material is available.');
    const created=createVocabularySession({sessionId:randomUUID(),words,composition:composition.settings});
    return nextVocabularyExercise(created.sessionId,randomUUID());
  });
}
function selectUnadmittedWord(session:VocabularyPersistedSession,projection:VocabularySessionProjection):string|undefined {
  const available=Object.values(projection.words).filter((word)=>!word.admitted&&(!suppressed(word.wordId)||session.context.words.find((entry)=>entry.wordId===word.wordId)?.recognitionOnly||session.context.words.find((entry)=>entry.wordId===word.wordId)?.contextualOnly));
  if(!available.length)return undefined;
  const introductions=available.filter((word)=>word.initialMode==='unstudied');
  const ordinary=available.filter((word)=>word.initialMode!=='unstudied');
  const policy=session.context.composition??{introductionOrder:'random',introductionSpacing:3};
  if(policy.introductionOrder==='first')return (introductions[0]??ordinary[0])?.wordId;
  if(policy.introductionOrder==='paced') {
    const lastIntro=projection.encounters.reduce((last,entry,index)=>entry.snapshot.kind==='introduction'&&entry.snapshot.role==='teaching'&&!entry.presentationUndone?index:last,-1);
    const since=projection.encounters.slice(lastIntro+1).filter((entry)=>entry.snapshot.kind!=='introduction'&&entry.snapshot.role==='general'&&!entry.presentationUndone).length;
    return ((lastIntro<0||since>=policy.introductionSpacing||ordinary.length===0?introductions[0]:undefined)??ordinary[0]??introductions[0])?.wordId;
  }
  const ordinal=parseInt(createHash('sha256').update(`${session.sessionId}/${projection.throughSequence}`).digest('hex').slice(0,8),16);
  return available[ordinal%available.length]?.wordId;
}
function unresolvedMisses(projection:VocabularySessionProjection,wordId:string):string[] {
  const encounters=projection.encounters.filter((entry)=>entry.wordId===wordId&&entry.snapshot.role==='general'&&entry.snapshot.kind==='production'&&!entry.skipped);
  const ids=[...new Set(encounters.filter((entry)=>entry.effectiveResponses.some((response)=>response.payload.outcome==='rejected')).map((entry)=>entry.snapshot.contentId))];
  return ids.filter((id)=>{
    const last=encounters.filter((entry)=>entry.snapshot.contentId===id).at(-1);
    return last?.effectiveResponses.at(-1)?.payload.outcome==='rejected';
  });
}
/** Serving always reads an authorized immutable content version, never a caller-authored snapshot. */
export function nextVocabularyExercise(sessionId:string,clientActionId:string,options:{wordId?:string;another?:boolean}={}):VocabularyStudy {
  return atomic(()=>{
    const session=getVocabularySession(sessionId);const input=inputJson({type:'next',...options});
    if(commandRetry(session,clientActionId,input))return getVocabularyStudy(sessionId);
    if(session.status!=='active'||session.projection.phase==='completed')throw new VocabularySessionConflictError('Session is not accepting new work');
    const builder=actionBuilder(session,clientActionId,input);const previous=current(session);
    const previousWordOpen=previous?.wordId?session.projection.words[previous.wordId]?.workStatus==='open':true;
    if(previous&&previousWordOpen&&!previous.skipped&&(previous.effectiveResponses.length===0||options.another)&&previous.snapshot.kind!=='introduction')builder.push({kind:'exercise_skip',payload:{encounterId:previous.encounterId}});
    const unavailable = (notice:string) => {
      if(builder.additions.length)appendVocabularySessionActions(sessionId,builder.additions);
      return {...getVocabularyStudy(sessionId),notice};
    };
    let projection=builder.projection();
    let wordId=options.wordId;
    if(wordId&&!projection.words[wordId])throw new VocabularySessionInputError('Word is outside this session');
    if(!wordId)wordId=Object.values(projection.words).find((word)=>word.workStatus==='open')?.wordId
      ??(projection.phase==='active'?selectUnadmittedWord(session,projection):undefined);
    if(wordId) {
      let word=projection.words[wordId];
      if(word.teachingDeferred)return unavailable('Fresh teaching will start in your next session. Choose another word or finish for now.');
      if(word.workStatus==='wrapped'||word.workStatus==='skipped'){builder.push({kind:'word_more',payload:{wordId}});projection=builder.projection();word=projection.words[wordId];}
      let chosen:VocabularyContent|null=null;let role:VocabularyEncounterSnapshot['role']='general';
      const seen=projection.encounters.filter((entry)=>entry.wordId===wordId&&entry.workNumber===(word.workNumber||1));
      const wordContext=session.context.words.find((entry)=>entry.wordId===wordId);
      const recognitionOnly=wordContext?.recognitionOnly;
      if(wordContext?.contextualOnly) {chosen=availableGeneral(wordId,word.mode as 'solidify'|'practice'|'maintain').find((entry)=>isContrast(entry))??null;}
      else if(recognitionOnly) {chosen=baseline(wordId,'recognition','general');}
      else if(word.mode==='unstudied') {
        const ready=teaching(wordId);if(!ready)return unavailable('Teaching material is unavailable. Stop work on this word or finish for now.');
        const requirements=session.context.words.find((entry)=>entry.wordId===wordId)?.teachingRequirements;
        if(!requirements||ready.intro.contentId!==requirements.introductionContentId)return unavailable('The prepared introduction changed. Stop work on this word or finish for now.');
        role='teaching';
        chosen=!seen.some((entry)=>entry.snapshot.kind==='introduction')?ready.intro
          :ready.exercises.find((entry)=>!seen.some((encounter)=>encounter.snapshot.contentId===entry.contentId&&encounter.effectiveResponses.some((response)=>response.payload.outcome==='accepted')))??null;
        if(!chosen) {
          builder.push({kind:'teaching_complete',payload:{wordId}});
          const updated=appendVocabularySessionActions(sessionId,builder.additions);
          return getVocabularyStudy(updated.sessionId);
        }
      }else {
        if(word.mode==='solidify'&&!projection.encounters.some((entry)=>entry.wordId===wordId&&!entry.presentationUndone&&entry.snapshot.kind==='introduction')) {
          const ready=teaching(wordId);chosen=ready?.intro??null;role='priming';
        }
        if(!chosen) {
          role='general';const pool=availableGeneral(wordId,word.mode).filter((entry)=>!isContrast(entry)||!seen.some((encounter)=>encounter.snapshot.contentId===entry.contentId&&encounter.effectiveResponses.length>0));
          const misses=unresolvedMisses(projection,wordId);
          const dueRecognition=recognitionDue(wordId)&&!seen.some((entry)=>entry.snapshot.kind==='recognition'&&entry.effectiveResponses.length>0)
            ?pool.find((entry)=>entry.kind==='exercise'&&entry.skill==='recognition'):null;
          const last=seen.at(-1);const retry=misses.find((id)=>last?.snapshot.contentId!==id);
          chosen=dueRecognition??pool.find((entry)=>isContrast(entry))??(retry?pool.find((entry)=>entry.contentId===retry)??null:null);
          if(!chosen) {
            const ordered=[...pool].sort((a,b)=>{
              const count=(id:string)=>seen.filter((entry)=>entry.snapshot.contentId===id).length;
              const order=count(a.contentId)-count(b.contentId);
              if(order)return order;
              return a.contentId.localeCompare(b.contentId);
            });
            // Interleave another content item before retry when alternatives exist.
            chosen=ordered.find((entry)=>entry.contentId!==last?.snapshot.contentId)??ordered[0]??null;
          }
        }
      }
      if(!chosen)return unavailable('No ready exercise is available. Finish work on this word or finish for now.');
      builder.push({kind:'presentation',payload:{encounterId:randomUUID(),wordId,snapshot:snapshot(chosen,role)}});
    }else {
      const purePool=pureCandidates(session);
      const pureMisses=purePool.filter((entry)=>{const last=projection.encounters.filter((encounter)=>encounter.snapshot.contentId===entry.contentId).at(-1);return last&&!last.skipped&&last.effectiveResponses.at(-1)?.payload.outcome==='rejected';});
      const pure=pureMisses.find((entry)=>entry.contentId!==previous?.snapshot.contentId)
        ??purePool.find((entry)=>!projection.encounters.some((encounter)=>encounter.snapshot.contentId===entry.contentId))??pureMisses[0];
      if(!pure||projection.phase!=='active') {
        if(projection.phase==='active')builder.push({kind:'finish_for_now',payload:{}});
        if(builder.additions.length)appendVocabularySessionActions(sessionId,builder.additions);
        return getVocabularyStudy(sessionId);
      }
      builder.push({kind:'presentation',payload:{encounterId:randomUUID(),wordId:null,snapshot:snapshot(pure,'general')}});
    }
    appendVocabularySessionActions(sessionId,builder.additions);return getVocabularyStudy(sessionId);
  });
}
export function commandVocabularyStudy(sessionId:string,clientActionId:string,command:VocabularyStudyCommand):VocabularyStudy {
  return atomic(()=>{
    const session=getVocabularySession(sessionId);const input=inputJson(command);
    if(commandRetry(session,clientActionId,input))return getVocabularyStudy(sessionId);
    if(session.status!=='active')throw new VocabularySessionConflictError('Cancel the completion revision before resuming study');
    const builder=actionBuilder(session,clientActionId,input);const encounter=current(session);const wordId=('wordId'in command?command.wordId:undefined)??encounter?.wordId;
    const needEncounter=()=>{if(!encounter)throw new VocabularySessionInputError('No current exercise');return encounter;};
    const needWord=()=>{if(!wordId||!session.projection.words[wordId])throw new VocabularySessionInputError('No current word');return wordId;};
    switch(command.type) {
      case 'response': {
        const target=needEncounter();if(target.snapshot.kind==='introduction')throw new VocabularySessionInputError('Continue from the introduction before answering');
        if(target.effectiveResponses.length||target.skipped)throw new VocabularySessionConflictError('Exercise already answered or skipped');
        if(target.snapshot.kind==='recognition'&&command.selfAssessment===undefined)throw new VocabularySessionInputError('Recognition requires remembered/not-remembered assessment');
        if(command.selfAssessment!==undefined&&target.snapshot.kind!=='recognition')throw new VocabularySessionInputError('Self assessment is only available for recognition');
        const normalize=(value:string)=>normalizeProductionAnswerForProfile(value,'mandarin');
        let accepted=command.selfAssessment!==undefined?command.selfAssessment==='accepted':command.response!==null&&normalize(command.response).length>0
          &&target.snapshot.assessment!.acceptedAnswers.some((answer)=>normalize(answer)===normalize(command.response!));
        if(target.snapshot.kind==='contrast') {
          const criteria=object(target.snapshot.assessment?.criteria??null);const choices=object(target.snapshot.body.material??null).choices;
          if(!command.selectedWordId||!Array.isArray(choices)||!choices.some((choice)=>object(choice).wordId===command.selectedWordId))throw new VocabularySessionInputError('Select one of the served contrast choices');
          accepted=command.selectedWordId===criteria.correctWordId;
        } else if(command.selectedWordId!==undefined)throw new VocabularySessionInputError('Word choice requires a contrast exercise');
        builder.push({kind:'response',payload:{encounterId:target.encounterId,response:command.response,outcome:accepted?'accepted':'rejected',
          ...(command.selfAssessment?{selfAssessment:command.selfAssessment}:{}),...(command.selectedWordId?{selectedWordId:command.selectedWordId}:{})}});
        const projected=builder.projection();const word=target.wordId?projected.words[target.wordId]:null;
        if(word&&(session.context.words.find((entry)=>entry.wordId===word.wordId)?.recognitionOnly||session.context.words.find((entry)=>entry.wordId===word.wordId)?.contextualOnly)) {
          builder.push({kind:'word_skip',payload:{wordId:word.wordId}});
        } else if(word&&word.mode!=='unstudied'&&word.workNumber===1&&word.successfulProductionResponses>=VOCABULARY_SESSION_POLICY.productionResponsesToCover)
          builder.push({kind:'word_wrap',payload:{wordId:word.wordId,reason:'policy'}});
        if(word&&word.mode==='unstudied') {
          const requirement=session.context.words.find((entry)=>entry.wordId===word.wordId)?.teachingRequirements;
          const teachingEncounters=projected.encounters.filter((entry)=>entry.wordId===word.wordId&&entry.snapshot.role==='teaching');
          if(requirement&&requirement.requiredExerciseContentIds.every((id)=>teachingEncounters.some((entry)=>entry.snapshot.contentId===id&&!entry.skipped&&entry.effectiveResponses.some((response)=>response.payload.outcome==='accepted'))))
            builder.push({kind:'teaching_complete',payload:{wordId:word.wordId}});
        }
        break;
      }
      case 'feedback':builder.push({kind:'feedback',payload:{encounterId:needEncounter().encounterId,feedback:command.feedback,...(command.comment?{comment:command.comment}:{})}});break;
      case 'skip':if(command.scope==='word'&&wordId)builder.push({kind:'word_skip',payload:{wordId:needWord()}});
        else builder.push({kind:'exercise_skip',payload:{encounterId:needEncounter().encounterId}});break;
      case 'enough':builder.push({kind:'word_wrap',payload:{wordId:needWord(),reason:'enough'}});break;
      case 'more':{const id=needWord();if(session.projection.words[id].teachingDeferred)throw new VocabularySessionInputError('Fresh teaching starts in the next session');builder.push({kind:'word_more',payload:{wordId:id}});break;}
      case 'mode':builder.push({kind:'mode_change',payload:{wordId:needWord(),mode:command.mode}});break;
      case 'undo': {
        const latest=session.projection.latestUndoableActionId;if(!latest)throw new VocabularySessionConflictError('No latest transition can be undone');
        builder.push({kind:'undo',payload:{undoesActionId:latest}});break;
      }
      case 'resume':builder.push({kind:'resume',payload:{}});break;
      case 'finishForNow':builder.push({kind:'finish_for_now',payload:{}});break;
      case 'finishImmediately':builder.push({kind:'finish_immediately',payload:{}});break;
    }
    appendVocabularySessionActions(sessionId,builder.additions);return getVocabularyStudy(sessionId);
  });
}
