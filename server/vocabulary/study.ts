import type { VocabularySessionPayload } from '../../src/domain/vocabulary-session-payload.ts';
import { selectSequentialBootstrapReveal } from '../../src/domain/word-content/reveal.ts';
import { reconcileVocabularyPreparationReserve } from './preparation-reserve.ts';
import { skillEnabled, eligible, introductions, compatibleIntroductions, teachingReady } from './teaching-readiness.ts';
import { vocabularyTeachingSource } from './teaching-source.ts';
import { vocabularyRevealSnapshot } from './reveal-snapshot.ts';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { normalizeProductionAnswerForProfile } from '../../src/study-profile.ts';
import type { VocabularyContent, VocabularyJson } from '../../src/domain/vocabulary-content.ts';
import type { VocabularyStudy, VocabularyStudyCommand, VocabularyStudyWord, VocabularySessionPreview } from '../../src/domain/vocabulary-study-api.ts';
import { getPendingVocabularySkills, isVocabularyWordReadyToCover, isVocabularyTeachingComplete, projectVocabularySession, advanceVocabularySession, VOCABULARY_SESSION_POLICY, type VocabularyEncounterSnapshot, type VocabularySessionAction, type VocabularySessionInitialContext,
  type VocabularySessionJson, type VocabularySessionProjection, type VocabularyTeachingRequirements } from '../../src/domain/vocabulary-session.ts';
import type { VocabularyPersistedSession } from '../../src/domain/vocabulary-session-api.ts';
import { getDb } from '../db/connection.ts';
import { allocateSessionBucketSlots, DEFAULT_SESSION_BUCKET_WEIGHTS } from '../../src/domain/session-limits.ts';
import { composeVocabularyStudy, type VocabularyComposition } from './composition.ts';
import { selectVocabularyPureCueCandidates } from './pure-cue-serving.ts';
import { isVocabularyProductionProxied } from './production-coverage.ts';
import { isVocabularyDefinitionFallback } from '../../src/domain/vocabulary-production-coverage.ts';
import { ensureVocabularySensesFromBootstrap } from './sense-readiness.ts';
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
  const row=getDb().prepare(`SELECT w.id AS wordId,w.hanzi,w.traditional,w.pinyin,w.meaning,
    COALESCE(s.personal_notes,'') AS personalNotes FROM lexical_words w
    LEFT JOIN learner_word_state s ON s.word_id=w.id AND s.learner_id=? WHERE w.id=?`)
    .get(requireLearnerId(),wordId) as VocabularyStudyWord|undefined;
  if(!row)throw new VocabularySessionInputError('Unknown lexical word');return {...row};
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
  for(const intro of compatibleIntroductions(wordId)) {
    const exercises=getVocabularyTeachingExercises(intro.contentId).filter((entry)=>eligible(entry)
      &&entry.kind==='exercise'&&skillEnabled(wordId,entry.skill));
    if(!exercises.some((entry)=>entry.kind==='exercise'&&entry.skill==='production'))continue;
    const recognition=exercises.some((entry)=>entry.kind==='exercise'&&entry.skill==='recognition')?null:baseline(wordId,'recognition','teaching');
    if(recognition)exercises.unshift(recognition);
    if(!exercises.some((entry)=>entry.kind==='exercise'&&entry.skill==='recognition'))continue;
    return {intro,exercises,requirements:{introductionContentId:intro.contentId,
      requiredExerciseContentIds:exercises.map((entry)=>entry.contentId),minimumRecognitionResponses:3,minimumProductionResponses:3}};
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
function availableGeneral(wordId:string,mode:'solidify'|'practice'|'maintain'):VocabularyContent[] {
  const allowFallback=mode==='solidify'||!isVocabularyProductionProxied(wordId);
  const pool=listVocabularyExercises({wordId,mode}).filter((entry)=>eligible(entry)&&entry.kind==='exercise'&&entry.exerciseType!=='pure_cue'
    &&(allowFallback||entry.skill!=='production'||!isVocabularyDefinitionFallback(entry))
    &&(isContrast(entry)?contrastEligible(entry,wordId):entry.skill==='recognition'?skillEnabled(wordId,'recognition'):skillEnabled(wordId,'production')));
  // Recognition remains its own self-assessed objective and never supplies production coverage.
  const recognize=baseline(wordId,'recognition','general');
  if(mode==='maintain') {
    if(pool.length)return pool;
    const direct=allowFallback?baseline(wordId,'production','general'):null;
    if(direct)emitBackendEvent({name:'vocabulary.maintain.baseline_selected',learnerId:requireLearnerId(),entityKind:'word',entityId:wordId,
      data:{contentId:direct.contentId,reason:'no eligible curated current exercise',curated:false}});
    return direct?[direct]:[];
  }
  if(!pool.some((entry)=>entry.kind==='exercise'&&entry.skill==='production'&&!isContrast(entry))) {
    const direct=allowFallback?baseline(wordId,'production','general'):null;if(direct)pool.push(direct);
  }
  if(recognize&&!pool.some((entry)=>entry.contentId===recognize.contentId))pool.push(recognize);
  return pool;
}
function sessionPayload(session:VocabularyPersistedSession):VocabularySessionPayload {
  const payload=session.context.payload;
  if(!payload||payload.version!==1)throw new VocabularySessionConflictError('This session predates the current player. Start a new session.');
  return payload;
}
function pureCandidates(session:VocabularyPersistedSession):VocabularyContent[] { return sessionPayload(session).pureCues; }
function snapshot(content:VocabularyContent,role:VocabularyEncounterSnapshot['role'],projection:VocabularySessionProjection):VocabularyEncounterSnapshot {
  const teachingSource=content.kind==='introduction'?vocabularyTeachingSource(content.body):undefined;
  const targetWordId=content.words.find(word=>word.relation==='target')?.wordId;
  const reveal=vocabularyRevealSnapshot(content,{fallbackIntroduction:wordId=>
    projection.encounters.findLast(encounter=>encounter.wordId===wordId&&encounter.snapshot.kind==='introduction'&&!encounter.presentationUndone)?.snapshot.body.material
      ??introductions(wordId)[0]?.body,
    ...(role==='teaching'&&content.kind==='exercise'&&content.skill==='recognition'?{
      completedTeachingRecognitionAttempts:projection.encounters.filter(encounter=>encounter.wordId===targetWordId&&encounter.snapshot.kind==='recognition')
        .reduce((count,encounter)=>count+encounter.effectiveResponses.length,0)}:{})});
  const body=object(content.body);const prompt=typeof body.prompt==='string'?body.prompt:content.kind==='introduction'?'Introduction':'';
  return {contentId:content.contentId,contentVersion:content.version,kind:content.kind==='introduction'?'introduction':content.skill==='recognition'?'recognition':isContrast(content)?'contrast':'production',role,
    body:{prompt,material:content.body,...reveal,...(teachingSource===undefined?{}:{teachingSource}),...(typeof body.answer==='string'?{answer:body.answer}:{}),...(typeof body.explanation==='string'?{explanation:body.explanation}:{})},
    assessment:content.kind==='introduction'?null:{acceptedAnswers:content.answers.flatMap((entry)=>entry.acceptedForms),criteria:content.assessment},
    ...(content.kind==='exercise'&&content.exerciseType==='pure_cue'?{schedulingScope:'pure_cue' as const,selectedThroughWordId:null}:{}),
    mappingSnapshot:content.words.map((word)=>({wordId:word.wordId,senseId:word.senseId??null,senseMappingEstablishedAt:word.senseMappingEstablishedAt??null})),
  };
}
/** Expensive content discovery happens once, before the first encounter. */
export function composeVocabularySessionPayload(context:VocabularySessionInitialContext):VocabularySessionPayload {
  const payload:VocabularySessionPayload={version:1,words:{},pureCues:[],snapshots:{}};
  const empty=projectVocabularySession(context,[]);
  const retain=(content:VocabularyContent,role:VocabularyEncounterSnapshot['role'])=>{
    payload.snapshots[`${content.contentId}/${role}`]=snapshot(content,role,empty);
  };
  for(const word of context.words) {
    const ready=teaching(word.wordId);
    const priming=ready?.intro??introductions(word.wordId)[0]??null;
    const general={solidify:availableGeneral(word.wordId,'solidify'),practice:availableGeneral(word.wordId,'practice'),maintain:availableGeneral(word.wordId,'maintain')};
    const recognition=baseline(word.wordId,'recognition','general');
    if(recognition&&!general.maintain.some(content=>content.kind==='exercise'&&content.skill==='recognition'))general.maintain.push(recognition);
    payload.words[word.wordId]={lexical:lexical(word.wordId),teaching:ready,priming,general};
    if(ready){retain(ready.intro,'teaching');ready.exercises.forEach(content=>retain(content,'teaching'));}
    if(priming)retain(priming,'priming');
    Object.values(general).flat().forEach(content=>retain(content,'general'));
  }
  for(const target of context.reviewOrder??[])if(target.kind==='pure_cue') {
    const content=getVocabularyContent(target.id);
    if(!content||!eligible(content))throw new Error('Admitted pure cue lost its content');
    payload.pureCues.push(content);retain(content,'general');
  }
  return payload;
}
function retainedSnapshot(session:VocabularyPersistedSession,content:VocabularyContent,role:VocabularyEncounterSnapshot['role'],projection:VocabularySessionProjection):VocabularyEncounterSnapshot {
  const template=sessionPayload(session).snapshots[`${content.contentId}/${role}`];
  if(!template)throw new Error('Session repertoire is missing a served snapshot');
  const result=structuredClone(template);
  // Teaching examples rotate within the retained source, without resolving it again.
  if(role==='teaching'&&result.kind==='recognition'&&result.body.wordReference
    &&!result.body.revealWords?.some(word=>word.sense)) {
    const wordId=content.words.find(word=>word.relation==='target')?.wordId;
    const count=projection.encounters.filter(entry=>entry.wordId===wordId&&entry.snapshot.kind==='recognition')
      .reduce((sum,entry)=>sum+entry.effectiveResponses.length,0);
    result.body.bootstrapReveal=selectSequentialBootstrapReveal(result.body.wordReference,count);
  }
  return result;
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
  },projection(){return advanceVocabularySession(session.context,session.actions,session.projection,additions);}};
}
function current(session:VocabularyPersistedSession) {return session.projection.encounters.filter((entry)=>!entry.presentationUndone).at(-1)??null;}
export function getVocabularyStudy(sessionId:string):VocabularyStudy {
  const session=getVocabularySession(sessionId);const encounter=current(session);const wordId=encounter?.wordId??null;
  const word=wordId?session.projection.words[wordId]:null;const active=session.status==='active'&&session.projection.phase!=='completed';
  const {payload,...publicContext}=session.context;
  const liveNotes=wordId?getDb().prepare('SELECT personal_notes FROM learner_word_state WHERE learner_id=? AND word_id=?').get(requireLearnerId(),wordId) as {personal_notes:string}|undefined:undefined;
  return {session:{...session,context:publicContext},words:payload?session.context.words.map(word=>({...payload.words[word.wordId].lexical,...(word.wordId===wordId?{personalNotes:liveNotes?.personal_notes??''}:{})})):session.context.words.map(word=>lexical(word.wordId)),currentEncounter:encounter,currentWordId:wordId,
    controls:{canNext:active,canSkip:active&&encounter!==null,canEnough:active&&word?.workStatus==='open'&&word.mode!=='unstudied',
      canMore:active&&word!==null&&!word.teachingDeferred&&(word.workStatus==='wrapped'||word.workStatus==='skipped'),canUndo:active&&session.projection.latestUndoableActionId!==null,
      canFinishForNow:active&&session.projection.phase==='active',canFinishImmediately:active&&session.projection.phase==='finishing',canChangeMode:active&&wordId!==null},
    notice:word?.teachingDeferred?'This word is now Unstudied. Fresh teaching will start in your next session.':session.projection.phase==='finishing'?'Finish the words already started, or finish immediately.':null};
}
function composeCurrentStudy(requestTeaching:(wordId:string)=>void, timeZone?:string):VocabularyComposition {
  return composeVocabularyStudy({teachingReady,timeZone,canUseSkill:(wordId,skill)=>{
    if(!skillEnabled(wordId,skill))return false;
    if(skill!=='contextual_selection')return true;
    const mode=getVocabularyLearnerWord(wordId)?.mode;
    return mode!==undefined&&mode!=='unstudied'&&listVocabularyExercises({wordId,mode}).some((entry)=>eligible(entry)&&contrastEligible(entry,wordId));
  },requestTeaching});
}
/** Shared final admission, including the independent pure-cue cap and interleaving. */
function planVocabularyStudy(composition:VocabularyComposition, samplingSeed:string, adoptPureCues:boolean) {
    const words:VocabularySessionInitialContext['words'][number][]=[];
    for(const wordId of composition.newWordIds) {
      words.push({wordId,mode:'unstudied'});
    }
    for(const wordId of composition.dueWordIds) {
      const candidate=getVocabularyLearnerWord(wordId);
      const selectedSkill=composition.reviewSelections.find((entry)=>entry.wordId===wordId)?.skillId;
      if(candidate) {
        const solidifySkills=candidate.mode==='solidify'?(['recognition','production'] as const).filter((skill)=>skillEnabled(wordId,skill)):undefined;
        if(solidifySkills?.length===0)continue;
        words.push({wordId,mode:candidate.mode,...(selectedSkill?{selectedSkill}:{}),...(solidifySkills?{solidifySkills}:{})});
      }
    }
    const reviewWords=words.filter((word)=>word.mode==='practice'||word.mode==='maintain');
    const pure=selectVocabularyPureCueCandidates({ordinaryReviewCount:reviewWords.length,sessionSeed:samplingSeed,adopt:adoptPureCues});
    const reviewOrder:{kind:'word'|'pure_cue';id:string}[]=reviewWords.map((word)=>({kind:'word',id:word.wordId}));
    for(const cue of pure) {
      const index=parseInt(createHash('sha256').update(`${samplingSeed}/${cue.contentId}`).digest('hex').slice(0,8),16)%(reviewOrder.length+1);
      reviewOrder.splice(index,0,{kind:'pure_cue',id:cue.contentId});
    }
    const slots=allocateSessionBucketSlots({review:reviewOrder.length,learning:words.filter((word)=>word.mode==='solidify').length,unstudied:words.filter((word)=>word.mode==='unstudied').length});
    const admittedReview=reviewOrder.slice(0,slots.review);
    const admittedWords=[...words.filter((word)=>word.mode==='unstudied').slice(0,slots.unstudied),
      ...words.filter((word)=>word.mode==='solidify').slice(0,slots.learning),
      ...admittedReview.filter((entry)=>entry.kind==='word').map((entry)=>reviewWords.find((word)=>word.wordId===entry.id)!)];
    return {words:admittedWords,reviewOrder:admittedReview};
}
export function previewVocabularyStudy(options:{requestTeaching?:(wordId:string)=>void;prepareReserve?:()=>void;previewSeed?:string;timeZone?:string}={}):VocabularySessionPreview {
  (options.prepareReserve??reconcileVocabularyPreparationReserve)();
  const previewSeed=options.previewSeed??randomUUID();
  const composition=composeCurrentStudy(()=>{}, options.timeZone);
  const planned=planVocabularyStudy(composition,previewSeed,false);
  // Preparation demand is the same bounded, idempotent queue used by Start.
  const request=options.requestTeaching??(()=>{});
  composition.requestedPreparationWordIds.forEach(request);
  return {previewSeed,itemCount:planned.words.length+planned.reviewOrder.filter((entry)=>entry.kind==='pure_cue').length,
    preparationPending:composition.requestedPreparationWordIds.length>0};
}
export function startVocabularyStudy(options:{requestTeaching?:(wordId:string)=>void;prepareReserve?:()=>void;previewSeed?:string;timeZone?:string}={}):VocabularyStudy {
  (options.prepareReserve??reconcileVocabularyPreparationReserve)();
  const composition=composeCurrentStudy(options.requestTeaching??(()=>{}), options.timeZone);
  return atomic(()=>{
    const sessionId=randomUUID();
    const planned=planVocabularyStudy(composition,options.previewSeed??sessionId,true);
    if(planned.words.length===0&&planned.reviewOrder.length===0)throw new VocabularySessionInputError(composition.requestedPreparationWordIds.length
      ?'Your new-word introductions are being prepared. Try starting again shortly; other ready work can be studied when available.'
      :'No ready study material is available.');
    for(const word of planned.words)if(word.mode==='unstudied') {
      if(!ensureVocabularySensesFromBootstrap(word.wordId))throw new Error('Ready teaching lost its sense source');
      enrollVocabularyDietWord(word.wordId);
      const ready=teaching(word.wordId);if(!ready)throw new Error('Ready teaching lost its exercise source');
      word.teachingRequirements=ready.requirements;
    }
    const context:VocabularySessionInitialContext={sessionId,words:planned.words,composition:composition.settings,reviewOrder:planned.reviewOrder};
    context.payload=composeVocabularySessionPayload(context);
    const created=createVocabularySession(context);
    return nextVocabularyExercise(created.sessionId,randomUUID());
  });
}
function sampleIndex(session:VocabularyPersistedSession,projection:VocabularySessionProjection,length:number,salt:string):number {
  const effective=projection.encounters.filter((entry)=>!entry.presentationUndone).map((entry)=>entry.encounterId).join('/');
  return parseInt(createHash('sha256').update(`${session.sessionId}/${effective}/${salt}`).digest('hex').slice(0,8),16)%length;
}
/** The old bucket mix applies to the new lifecycle names; the action log supplies queue state. */
type StudyTarget={kind:'word'|'pure_cue';id:string};
function selectNextWord(session:VocabularyPersistedSession,projection:VocabularySessionProjection,unavailable:ReadonlySet<string>):StudyTarget|undefined {
  const encounters=projection.encounters.filter((entry)=>!entry.presentationUndone);
  const available=Object.values(projection.words).filter((word)=>!unavailable.has(word.wordId)&&!word.teachingDeferred
    &&(word.workStatus==='open'||(projection.phase==='active'&&!word.admitted)));
  const cues=pureCandidates(session).filter((entry)=>{
    if(projection.excludedContentIds.includes(entry.contentId))return false;
    const seen=encounters.filter((encounter)=>encounter.snapshot.schedulingScope==='pure_cue'&&encounter.snapshot.contentId===entry.contentId);
    if(seen.some((encounter)=>encounter.skipped))return false;
    if(projection.pureCueOutcomes.some((outcome)=>outcome.contentId===entry.contentId&&outcome.covered))return false;
    return projection.phase==='active'||seen.length>0;
  });
  if(!available.length&&!cues.length)return undefined;
  const introductions=available.filter((word)=>word.mode==='unstudied'&&!word.teachingIntroductionPresented);
  const policy=session.context.composition??{introductionOrder:'random',introductionSpacing:3};
  if(introductions.length&&policy.introductionOrder!=='random') {
    const lastIntro=encounters.findLastIndex((entry)=>entry.snapshot.kind==='introduction'&&entry.snapshot.role==='teaching');
    const spacing=encounters.slice(lastIntro+1).filter((entry)=>entry.snapshot.kind!=='introduction').length;
    if(policy.introductionOrder==='first'||lastIntro<0||spacing>=policy.introductionSpacing||(!cues.length&&!available.some((word)=>word.mode!=='unstudied')))
      return {kind:'word',id:introductions[sampleIndex(session,projection,introductions.length,'intro')].wordId};
  }
  const lastPosition=(target:StudyTarget)=>encounters.findLastIndex((entry)=>target.kind==='word'?entry.wordId===target.id:entry.snapshot.schedulingScope==='pure_cue'&&entry.snapshot.contentId===target.id);
  const targets:StudyTarget[]=[...available.map((word)=>({kind:'word' as const,id:word.wordId})),...cues.map((cue)=>({kind:'pure_cue' as const,id:cue.contentId}))];
  const rested=targets.filter((target)=>lastPosition(target)<0||encounters.length-1-lastPosition(target)>=VOCABULARY_SESSION_POLICY.interveningExercisesBeforeWordReturn);
  const pool=rested.length?rested:targets;
  const bucket=(target:StudyTarget)=>target.kind==='pure_cue'?'review':projection.words[target.id].mode==='unstudied'?'unstudied':projection.words[target.id].mode==='solidify'?'learning':'review';
  const buckets=(['review','learning','unstudied'] as const).map((name)=>({name,targets:pool.filter((target)=>bucket(target)===name)}))
    .filter((entry)=>entry.targets.length&&(policy.introductionOrder!=='paced'||!introductions.length||entry.name!=='unstudied'));
  const candidates=buckets.length?buckets:[{name:'unstudied' as const,targets:pool}];
  let draw=sampleIndex(session,projection,candidates.reduce((sum,entry)=>sum+DEFAULT_SESSION_BUCKET_WEIGHTS[entry.name],0),'bucket');
  const chosen=candidates.find((entry)=>(draw-=DEFAULT_SESSION_BUCKET_WEIGHTS[entry.name])<0)!;
  if(chosen.name==='review') {
    const order=(target:StudyTarget)=>session.context.reviewOrder?.findIndex((entry)=>entry.kind===target.kind&&entry.id===target.id)??targets.indexOf(target);
    return [...chosen.targets].sort((a,b)=>lastPosition(a)-lastPosition(b)||order(a)-order(b))[0];
  }
  return chosen.targets[sampleIndex(session,projection,chosen.targets.length,'word')];
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
    const payload=sessionPayload(session);
    const builder=actionBuilder(session,clientActionId,input);const previous=current(session);
    if(options.another&&(!previous||previous.snapshot.role==='teaching'||previous.snapshot.kind==='introduction'||previous.snapshot.kind==='recognition'))
      throw new VocabularySessionInputError('This exercise does not support another way');
    const previousWordOpen=previous?.wordId?session.projection.words[previous.wordId]?.workStatus==='open':true;
    if(previous&&previousWordOpen&&!previous.skipped&&(previous.effectiveResponses.length===0||options.another)&&previous.snapshot.kind!=='introduction')builder.push({kind:'exercise_skip',payload:{encounterId:previous.encounterId}});
    if(options.another&&previous)builder.push({kind:'exercise_exclude',payload:{encounterId:previous.encounterId}});
    const unavailable = (notice:string) => {
      if(builder.additions.length)appendVocabularySessionActions(sessionId,builder.additions);
      return {...getVocabularyStudy(sessionId),notice};
    };
    let projection=builder.projection();
    let requestedWordId=options.another?undefined:options.wordId;
    if(options.wordId&&!projection.words[options.wordId])throw new VocabularySessionInputError('Word is outside this session');
    const unavailableWords=new Set<string>();
    for (;;) {
      const target:StudyTarget|undefined=requestedWordId?{kind:'word',id:requestedWordId}:selectNextWord(session,projection,unavailableWords);
      const wordId=target?.kind==='word'?target.id:undefined;
      requestedWordId=undefined;
      if(wordId) {
        let word=projection.words[wordId];
        if(word.teachingDeferred)return unavailable('Fresh teaching will start in your next session. Choose another word or finish for now.');
        if(word.workStatus==='wrapped'||word.workStatus==='skipped'){builder.push({kind:'word_more',payload:{wordId}});projection=builder.projection();word=projection.words[wordId];}
        let chosen:VocabularyContent|null=null;let role:VocabularyEncounterSnapshot['role']='general';
        const seen=projection.encounters.filter((entry)=>!entry.presentationUndone&&entry.wordId===wordId&&entry.workNumber===(word.workNumber||1));
        const excluded=new Set(projection.excludedContentIds);
        const pendingSkills=getPendingVocabularySkills(word);
        const pending=pendingSkills.length?pendingSkills:word.workNumber>1?(word.mode==='solidify'?word.solidifySkills:[word.selectedSkill]):pendingSkills;
        if(word.mode==='unstudied') {
          const ready=payload.words[wordId].teaching;if(!ready)return unavailable('Teaching material is unavailable.');
          const requirements=session.context.words.find((entry)=>entry.wordId===wordId)?.teachingRequirements;
          if(!requirements||ready.intro.contentId!==requirements.introductionContentId)return unavailable('The prepared introduction changed.');
          role='teaching';
          if(!word.teachingIntroductionPresented)chosen=ready.intro;
          else if(isVocabularyTeachingComplete(word)) {
            builder.push({kind:'teaching_complete',payload:{wordId}});projection=builder.projection();continue;
          } else {
            const skill=pending[sampleIndex(session,projection,pending.length,`skill/${wordId}`)];
            const pool=ready.exercises.filter((entry)=>entry.skill===skill);
            const counts=(id:string)=>seen.filter((entry)=>entry.snapshot.contentId===id).length;
            chosen=pool.sort((a,b)=>counts(a.contentId)-counts(b.contentId)||a.contentId.localeCompare(b.contentId))[0]??null;
          }
        }else {
          if(word.mode==='solidify'&&!projection.encounters.some((entry)=>entry.wordId===wordId&&!entry.presentationUndone&&entry.snapshot.kind==='introduction')) {
            chosen=payload.words[wordId].priming;role='priming';
          }
          if(!chosen) {
            role='general';
            const skill=pending[sampleIndex(session,projection,pending.length,`skill/${wordId}`)];
            const pool=payload.words[wordId].general[word.mode].filter((entry)=>!excluded.has(entry.contentId)&&(skill==='contextual_selection'?isContrast(entry):entry.skill===skill&&!isContrast(entry)));
            if(skill==='recognition')chosen=pool.find((entry)=>entry.kind==='exercise'&&entry.skill==='recognition')??null;
            else {
              const misses=unresolvedMisses(projection,wordId);const last=seen.at(-1);
              const retry=misses.find((id)=>last?.snapshot.contentId!==id);
              chosen=retry?pool.find((entry)=>entry.contentId===retry)??null:null;
              if(!chosen) {
                const count=(id:string)=>seen.filter((entry)=>entry.snapshot.contentId===id).length;
                const ordered=pool.sort((a,b)=>count(a.contentId)-count(b.contentId)||a.contentId.localeCompare(b.contentId));
                chosen=ordered.find((entry)=>entry.contentId!==last?.snapshot.contentId)??ordered[0]??null;
              }
            }
          }
        }
        if(!chosen) {
          // Exhaustion never fabricates coverage or blocks the rest of the session.
          // Keep the exclusion in the log even when explicitly revisiting this word.
          if(word.admitted)builder.push({kind:'word_skip',payload:{wordId}});
          unavailableWords.add(wordId);projection=builder.projection();
          continue;
        }
        builder.push({kind:'presentation',payload:{encounterId:randomUUID(),wordId,snapshot:retainedSnapshot(session,chosen,role,projection)}});
      }else if(target?.kind==='pure_cue') {
        const pure=payload.pureCues.find(content=>content.contentId===target.id);
        if(!pure)throw new Error('Selected pure cue disappeared');
        builder.push({kind:'presentation',payload:{encounterId:randomUUID(),wordId:null,snapshot:retainedSnapshot(session,pure,'general',projection)}});
      }else {
        if(projection.phase==='active')builder.push({kind:'finish_for_now',payload:{}});
        if(builder.additions.length)appendVocabularySessionActions(sessionId,builder.additions);
        return getVocabularyStudy(sessionId);
      }
      appendVocabularySessionActions(sessionId,builder.additions);return getVocabularyStudy(sessionId);
    }
  });
}
export function commandVocabularyStudy(sessionId:string,clientActionId:string,command:VocabularyStudyCommand):VocabularyStudy {
  return atomic(()=>{
    const session=getVocabularySession(sessionId);sessionPayload(session);const input=inputJson(command);
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
        if(word&&isVocabularyTeachingComplete(word))builder.push({kind:'teaching_complete',payload:{wordId:word.wordId}});
        else if(word&&word.workNumber===1&&isVocabularyWordReadyToCover(word))builder.push({kind:'word_wrap',payload:{wordId:word.wordId,reason:'policy'}});
        break;
      }
      case 'feedback':builder.push({kind:'feedback',payload:{encounterId:needEncounter().encounterId,feedback:command.feedback,...(command.comment?{comment:command.comment}:{})}});break;
      case 'skip':if(command.scope==='word'&&wordId)builder.push({kind:'word_skip',payload:{wordId:needWord()}});
        else builder.push({kind:'exercise_skip',payload:{encounterId:needEncounter().encounterId}});break;
      case 'enough':builder.push({kind:'word_wrap',payload:{wordId:needWord(),reason:'enough'}});break;
      case 'more':{const id=needWord();if(session.projection.words[id].teachingDeferred)throw new VocabularySessionInputError('Fresh teaching starts in the next session');builder.push({kind:'word_more',payload:{wordId:id}});break;}
      case 'requeue': {
        const id=needWord();const word=session.projection.words[id];
        if(!word.covered||word.teachingDeferred)throw new VocabularySessionInputError('Only covered words can be shuffled back into practice');
        if(word.workStatus==='open')throw new VocabularySessionConflictError('This word is already queued for practice');
        builder.push({kind:'word_more',payload:{wordId:id}});break;
      }
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
