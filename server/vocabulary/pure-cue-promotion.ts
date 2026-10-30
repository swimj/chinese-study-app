import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { JsonSchema } from '../../src/domain/reflection-result-schema.ts';
import type { VocabularyContent, VocabularyContentDraft } from '../../src/domain/vocabulary-content.ts';
import type { VocabularyPureCueReferral, VocabularyPureCuePromotion, VocabularyProposalOperation, VocabularyReflectionJob } from '../../src/domain/vocabulary-reflection.ts';
import { getVocabularyEncounterReactions } from '../../src/domain/vocabulary-session.ts';
import { getDb } from '../db/connection.ts';
import { getVocabularyContentForMaintenance } from '../db/vocabulary-content.ts';

const text:JsonSchema={type:'string'};
const object=(properties:Record<string,JsonSchema>):JsonSchema=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
export const vocabularyPureCueReferralSchema:JsonSchema={anyOf:[{type:'null'},object({candidateWords:{type:'array',items:text,minItems:2,maxItems:8},sharedPurpose:text,rationale:text})]};
export const vocabularyPureCuePromotionSchema=object({decision:{type:'string',enum:['reject','reuse','extend','create']},rationale:text,
  existingContentId:{type:['string','null']},prompt:{type:['string','null']},semanticAxis:{type:['string','null']},teachingNote:{type:['string','null']},memberWordIds:{type:'array',items:text}});
export type Word={wordId:string;hanzi:string;traditional:string|null;pinyin:string;meaning:string};
type Decision={decision:'reject'|'reuse'|'extend'|'create';rationale:string;existingContentId:string|null;prompt:string|null;semanticAxis:string|null;teachingNote:string|null;memberWordIds:string[]};
export type PromotionResult={assessment:VocabularyPureCuePromotion;operations:VocabularyProposalOperation[];bases:{contentId:string;expectedVersion:number}[]};
const wordQuery='SELECT id AS wordId,hanzi,traditional,pinyin,meaning FROM lexical_words';

export function validateVocabularyPureCueReferral(referral:VocabularyPureCueReferral):void {
  if(!referral.sharedPurpose.trim()||!referral.rationale.trim()||referral.candidateWords.some(word=>!word.trim()||word!==word.trim())
    ||new Set(referral.candidateWords).size!==referral.candidateWords.length)throw new Error('Invalid pure-cue referral');
}
export function pureCueIdentityOptions(targetId:string,referral:VocabularyPureCueReferral):{form:string;choices:Word[]}[] {
  const target=getDb().prepare(`${wordQuery} WHERE id=?`).get(targetId) as Word|undefined;
  if(!target)throw new Error('Pure-cue target disappeared');
  return referral.candidateWords.map(form=>({form,choices:form===target.hanzi||form===target.traditional?[target]:
    (getDb().prepare(`${wordQuery} WHERE hanzi=? OR traditional=? ORDER BY id`).all(form,form) as Word[])})).map(option=>({...option,choices:option.choices.map(word=>({...word}))}));
}
export const PURE_CUE_RESOLUTION_CONTRACT='operator-pure-cue-resolution-v1';
export type PureCueResolution={actorId:string;recordedAt:string;sourceJobId:string;original:VocabularyContent;
  admission:import('../../src/domain/vocabulary-reflection.ts').VocabularyImprovementAdmission;
  diagnosis:import('../../src/domain/vocabulary-content.ts').VocabularyJson;referral:VocabularyPureCueReferral;
  selections:Record<string,string>;candidates:Word[]};
export function getPureCueResolution(jobId:string):PureCueResolution|null {
  const row=getDb().prepare("SELECT result_json FROM vocabulary_improvement_stages WHERE job_id=? AND stage='pure_cue_promotion' AND input_hash=?")
    .get(jobId,PURE_CUE_RESOLUTION_CONTRACT) as {result_json:string}|undefined;
  return row?JSON.parse(row.result_json) as PureCueResolution:null;
}
/** Referral forms are suggestions. Resolve exact lexical identities; never pick a pronunciation arbitrarily. */
export function prepareVocabularyPureCuePromotion(job:VocabularyReflectionJob,original:VocabularyContent,referral:VocabularyPureCueReferral,selections:Record<string,string>={}):{
  input:{referral:VocabularyPureCueReferral;candidates:Word[];existingCues:VocabularyContent[]};
  attention:PromotionResult|null;contents:VocabularyContent[];fence:()=>void;
  normalize:(value:unknown,invocationId?:string|null)=>PromotionResult;
} {
  validateVocabularyPureCueReferral(referral);
  const targetId=job.evidence.wordId;
  if(!targetId)throw new Error('Pure-cue referral requires a word target');
  const target=getDb().prepare(`${wordQuery} WHERE id=?`).get(targetId) as Word|undefined;
  if(!target)throw new Error('Pure-cue target disappeared');
  const resolve=()=>pureCueIdentityOptions(targetId,referral).map(({form,choices})=>{
    const selected=selections[form];
    if(!selected)return choices;
    const word=choices.find(word=>word.wordId===selected);
    if(!word)throw new Error('Selected pure-cue lexical identity no longer matches the referral');
    return [word];
  });
  const matches=resolve();
  const candidates=[...new Map(matches.filter(items=>items.length===1).map(items=>[items[0]!.wordId,items[0]!])).values()];
  const ids=candidates.map(word=>word.wordId);
  const unresolved=matches.some(items=>items.length!==1)||ids.length<2||!ids.includes(targetId);
  const rows=unresolved?[]:getDb().prepare(`SELECT DISTINCT c.content_id FROM content_items c
    JOIN exercise_answer_words a ON a.exercise_id=c.content_id
    WHERE c.exercise_type='pure_cue' AND c.kind='exercise' AND c.exercise_role='general' AND c.skill='production'
      AND c.availability='active' AND c.access_scope=? AND c.owner_learner_id IS ?
      AND a.word_id IN (${ids.map(()=>'?').join(',')}) ORDER BY c.content_id`)
    .all(original.accessScope,original.ownerLearnerId??null,...ids) as {content_id:string}[];
  const existingCues=rows.map(row=>{
    const content=getVocabularyContentForMaintenance(row.content_id);
    if(!content)throw new Error('Pure-cue lookup returned missing content');return content;
  });
  const fence=()=>{
    if(!isDeepStrictEqual(getDb().prepare(`${wordQuery} WHERE id=?`).get(targetId),target)||!isDeepStrictEqual(resolve(),matches))throw new Error('Pure-cue lexical identities changed');
    for(const cue of existingCues){
      const current=getVocabularyContentForMaintenance(cue.contentId);
      if(!isDeepStrictEqual(current,cue))throw new Error('Pure-cue candidate changed during promotion');
    }
  };
  const attention:PromotionResult|null=unresolved?{assessment:{outcome:'needs_operator',rationale:'Referral written forms do not resolve to at least two unambiguous lexical identities including the target. Review the candidate words before promotion.',candidateWordIds:ids,existingContentId:null},operations:[],bases:[]}:null;
  return {input:{referral,candidates,existingCues},attention,contents:existingCues,fence,normalize(value,invocationId){
    const output=value as Decision;
    const fail=(message:string):never=>{throw new Error(`Invalid pure-cue promotion: ${message}`);};
    if(!output.rationale.trim()||new Set(output.memberWordIds).size!==output.memberWordIds.length)fail('empty rationale or duplicate members');
    const assessment:VocabularyPureCuePromotion={outcome:output.decision,rationale:output.rationale,candidateWordIds:ids,existingContentId:output.existingContentId,...(invocationId?{invocationId}:{})};
    if(output.decision==='reject'){
      if(output.existingContentId!==null||output.prompt!==null||output.semanticAxis!==null||output.teachingNote!==null||output.memberWordIds.length)fail('rejection must not carry a draft');
      return {assessment,operations:[],bases:[]};
    }
    const existing=existingCues.find(cue=>cue.contentId===output.existingContentId);
    if(output.decision==='create'?output.existingContentId!==null:!existing)fail('unknown existing cue identity');
    if(existing&&existing.kind!=='exercise')fail('expected exercise');
    const existingAnswers=existing?.kind==='exercise'?existing.answers:[];
    const allowed=new Set([...ids,...existingAnswers.map(answer=>answer.wordId)]);
    if(output.memberWordIds.length<2||!output.memberWordIds.includes(targetId)||output.memberWordIds.some(id=>!allowed.has(id))
      ||!output.memberWordIds.some(id=>id!==targetId&&ids.includes(id)))fail('members must include target and another resolved referral candidate');
    const bases=existing?[{contentId:existing.contentId,expectedVersion:existing.version}]:[];
    if(output.decision==='reuse'){
      if(output.prompt!==null||output.semanticAxis!==null||output.teachingNote!==null||output.memberWordIds.some(id=>!existingAnswers.some(answer=>answer.wordId===id)))fail('reuse cannot author text or add members');
      return {assessment,operations:[],bases};
    }
    if(output.decision==='extend'&&(output.prompt!==null||output.semanticAxis!==null
      ||existingAnswers.some(answer=>!output.memberWordIds.includes(answer.wordId))
      ||output.memberWordIds.every(id=>existingAnswers.some(answer=>answer.wordId===id))))fail('extension must preserve stimulus, axis and all existing members, and add a member');
    if(typeof output.teachingNote!=='string'||!output.teachingNote.trim())fail('creation and extension require a teaching note');
    const teachingNote=output.teachingNote!;
    const privateFragments=job.evidence.evidence.flatMap(encounter=>[
      ...getVocabularyEncounterReactions(encounter).flatMap(reaction=>reaction.payload.comment?[reaction.payload.comment.trim()]:[]),
      ...encounter.responses.flatMap(response=>response.payload.response&&response.payload.response.length>=12?[response.payload.response]:[]),
    ]).filter(fragment=>fragment.length>=4);
    const authoredText=[output.prompt,output.semanticAxis,teachingNote].filter((value):value is string=>typeof value==='string');
    if(original.accessScope==='shared'&&privateFragments.some(fragment=>authoredText.some(value=>value.includes(fragment))))fail('shared cue copies private learner evidence');
    const answers=output.memberWordIds.map(id=>{
      const retained=existingAnswers.find(answer=>answer.wordId===id);if(retained)return retained;
      const word=candidates.find(word=>word.wordId===id);if(!word)return fail('new member not supplied');
      return {wordId:id,acceptedForms:[...new Set([word.hanzi,...(word.traditional?[word.traditional]:[])])]};
    });
    let content:VocabularyContentDraft;
    if(output.decision==='extend'&&existing?.kind==='exercise'){
      const {version:_version,createdAt:_created,updatedAt:_updated,...draft}=existing;
      const body=draft.body;
      if(body===null||typeof body!=='object'||Array.isArray(body))return fail('existing cue requires an object body');
      const reveal=body.reveal;
      if(reveal!==undefined&&(reveal===null||typeof reveal!=='object'||Array.isArray(reveal)))return fail('existing cue requires an object reveal');
      content={...draft,body:{...body,reveal:{...reveal,teachingNote}},answers,words:[...draft.words.map(word=>output.memberWordIds.includes(word.wordId)?{...word,relation:'target' as const}:word),...output.memberWordIds.filter(id=>!draft.words.some(word=>word.wordId===id)).map(wordId=>({wordId,relation:'target' as const}))]};
    }else{
      if(!output.prompt?.trim()||!output.semanticAxis?.trim())fail('new cue requires stimulus and semantic axis');
      const prompt=output.prompt!,axis=output.semanticAxis!;
      content={contentId:randomUUID(),kind:'exercise',payloadVersion:1,body:{prompt,instruction:'',stimulus:{kind:'direct_text',text:prompt},reveal:{axisNote:axis,teachingNote},
        source:{kind:'vocabulary_pure_cue_promotion',assessedContentId:original.contentId,invocationId:invocationId??null}},
        exerciseType:'pure_cue',skill:'production',exerciseRole:'general',assessment:{match:'exact'},answers,
        words:output.memberWordIds.map(wordId=>({wordId,relation:'target'})),accessScope:original.accessScope,ownerLearnerId:original.ownerLearnerId??null,
        availability:'active',originKind:'model',authorKind:'service',authorId:'vocabulary-reflection'};
    }
    const body=content.body as {prompt?:string};
    if(!body.prompt||answers.some(answer=>answer.acceptedForms.some(form=>body.prompt!.includes(form))))fail('stimulus exposes an accepted answer');
    const common={operationKey:'pure-cue-promotion',scope:original.accessScope==='shared'?{kind:'shared' as const}:{kind:'learner' as const,learnerId:original.ownerLearnerId!},rationale:output.rationale,content};
    const operation:VocabularyProposalOperation=existing?{...common,strategy:'update_existing',sourceContentId:existing.contentId,expectedVersion:existing.version}:{...common,strategy:'create'};
    return {assessment,operations:[operation],bases};
  }};
}
