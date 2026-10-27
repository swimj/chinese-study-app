import { pureCueStimulusRepairErrors } from '../../src/domain/pure-cue-repair.ts';
import { isDeepStrictEqual } from 'node:util';
import type { JsonSchema } from '../../src/domain/reflection-result-schema.ts';
import type { VocabularyContent, VocabularyJson } from '../../src/domain/vocabulary-content.ts';
import type { VocabularyReflectionJob, VocabularyReflectionResult, VocabularyProposalOperation } from '../../src/domain/vocabulary-reflection.ts';
import { getVocabularyEncounterReactions } from '../../src/domain/vocabulary-session.ts';
import { getDb } from '../db/connection.ts';
import { getVocabularyContentForMaintenance } from '../db/vocabulary-content.ts';
import { validateJsonSchema } from '../llm/json-schema-validator.ts';

const text:JsonSchema={type:'string'};
const properties:Record<string,JsonSchema>={diagnosis:text,decision:{type:'string',enum:['extend','repair','explanation_only']},
  reason:{type:['string','null'],enum:[null,'does_not_fit','uncertain','no_change']},addedWordIds:{type:'array',items:text},
  prompt:{type:['string','null']},teachingNote:{type:['string','null']}};
export const vocabularyPureCueImprovementSchema:JsonSchema={type:'object',properties,required:Object.keys(properties),additionalProperties:false};
type Word={wordId:string;hanzi:string;traditional:string|null;pinyin:string;meaning:string};
type Output={diagnosis:string;decision:'extend'|'repair'|'explanation_only';reason:null|'does_not_fit'|'uncertain'|'no_change';addedWordIds:string[];prompt:string|null;teachingNote:string|null};
const wordQuery='SELECT id AS wordId,hanzi,traditional,pinyin,meaning FROM lexical_words';
function record(value:VocabularyJson|undefined):Record<string,VocabularyJson>{
  if(value===undefined)return {};
  if(value===null||typeof value!=='object'||Array.isArray(value))throw new Error('Pure-cue authored fields must be objects');
  return value;
}
/** Reviews this shared task only. Candidate resolution never admits or edits an individual word. */
export function prepareVocabularyPureCueImprovement(job:VocabularyReflectionJob,original:VocabularyContent){
  if(original.kind!=='exercise'||original.exerciseType!=='pure_cue'||original.skill!=='production'||original.exerciseRole!=='general')throw new Error('Pure-cue review requires a general production pure cue');
  if(original.accessScope==='private'&&original.ownerLearnerId!==job.learnerId)throw new Error('Pure-cue review source access mismatch');
  const rawResponses=[...new Set(job.evidence.evidence.filter(encounter=>!encounter.presentationUndone).flatMap(encounter=>encounter.effectiveResponses
    .filter(response=>response.payload.outcome==='rejected').flatMap(response=>response.payload.response?.trim()?[response.payload.response]:[])))];
  const members=()=>original.answers.map(answer=>{
    const word=getDb().prepare(`${wordQuery} WHERE id=?`).get(answer.wordId) as Word|undefined;
    if(!word)throw new Error('Pure-cue member lexical identity is missing');return word;
  });
  const resolve=()=>rawResponses.map(rawResponse=>({rawResponse,words:getDb().prepare(`${wordQuery} WHERE hanzi=? OR traditional=? ORDER BY id`).all(rawResponse.trim(),rawResponse.trim()) as Word[]}));
  const currentMembers=members(),responseCandidates=resolve();
  const candidates=responseCandidates.filter(item=>item.words.length===1).map(item=>item.words[0]!).filter(word=>!original.answers.some(answer=>answer.wordId===word.wordId));
  const fence=()=>{
    if(!isDeepStrictEqual(getVocabularyContentForMaintenance(original.contentId),original)||original.availability!=='active')throw new Error('Pure-cue review source changed');
    if(!isDeepStrictEqual(members(),currentMembers)||!isDeepStrictEqual(resolve(),responseCandidates))throw new Error('Pure-cue review lexical evidence changed');
  };
  return {input:{currentMembers,responseCandidates},fence,normalize(value:unknown,invocationId?:string|null):VocabularyReflectionResult{
    if(validateJsonSchema(value,vocabularyPureCueImprovementSchema).length)throw new Error('Pure-cue review failed strict output schema');
    const output=value as Output;
    if(!output.diagnosis.trim()||new Set(output.addedWordIds).size!==output.addedWordIds.length)throw new Error('Invalid pure-cue review diagnosis or duplicate members');
    const commonResult={diagnosis:{decision:output.decision,reason:output.reason,assessment:output.diagnosis},...(invocationId?{invocationId}:{})};
    if(output.decision==='explanation_only'){
      if(!output.reason||output.addedWordIds.length||output.prompt!==null||output.teachingNote!==null)throw new Error('Explanation-only pure-cue review cannot carry a draft');
      return {kind:'exercise_improvement',result:{...commonResult,proposal:null}};
    }
    if(output.reason!==null)throw new Error('Pure-cue repair or extension cannot have an explanation-only reason');
    const body=record(original.body);
    let updatedBody=body,answers=original.answers,words=original.words;
    if(output.decision==='extend'){
      if(!output.addedWordIds.length||output.prompt!==null||!output.teachingNote?.trim()||output.addedWordIds.some(id=>!candidates.some(word=>word.wordId===id)))throw new Error('Pure-cue extension requires new unambiguous submitted words and a complete teaching note');
      answers=[...answers,...output.addedWordIds.map(id=>{const word=candidates.find(word=>word.wordId===id)!;return {wordId:id,acceptedForms:[...new Set([word.hanzi,...(word.traditional?[word.traditional]:[])])]};})];
      words=[...words.map(word=>output.addedWordIds.includes(word.wordId)?{...word,relation:'target' as const}:word),...output.addedWordIds.filter(id=>!words.some(word=>word.wordId===id)).map(wordId=>({wordId,relation:'target' as const}))];
      updatedBody={...body,reveal:{...record(body.reveal),teachingNote:output.teachingNote!}};
    }else{
      if(output.addedWordIds.length||output.teachingNote!==null||!output.prompt?.trim())throw new Error('Pure-cue stimulus repair must preserve membership and teaching');
      const repairErrors=pureCueStimulusRepairErrors(body.prompt,output.prompt);
      if(repairErrors.length)throw new Error(repairErrors.join('; '));
      updatedBody={...body,prompt:output.prompt!,...('stimulus' in body?{stimulus:{kind:'direct_text',text:output.prompt!}}:{})};
    }
    const privateFragments=job.evidence.evidence.flatMap(encounter=>[
      ...getVocabularyEncounterReactions(encounter).flatMap(reaction=>reaction.payload.comment?[reaction.payload.comment.trim()]:[]),
      ...encounter.responses.flatMap(response=>response.payload.response&&response.payload.response.length>=12?[response.payload.response]:[]),
    ]).filter(fragment=>fragment.length>=4);
    if(original.accessScope==='shared'&&privateFragments.some(fragment=>[output.prompt,output.teachingNote].some(authored=>authored?.includes(fragment))))throw new Error('Shared pure-cue text cannot copy private learner evidence');
    const prompt=updatedBody.prompt;
    if(typeof prompt!=='string'||answers.some(answer=>answer.acceptedForms.some(form=>prompt.includes(form))))throw new Error('Pure-cue stimulus exposes an accepted answer');
    const {version:_version,createdAt:_created,updatedAt:_updated,...draft}=original;
    const operation:VocabularyProposalOperation={operationKey:'pure-cue-review',scope:original.accessScope==='shared'?{kind:'shared'}:{kind:'learner',learnerId:original.ownerLearnerId!},
      strategy:'update_existing',sourceContentId:original.contentId,expectedVersion:original.version,rationale:output.diagnosis,content:{...draft,body:updatedBody,answers,words}};
    return {kind:'exercise_improvement',result:{...commonResult,proposal:{operations:[operation],rationale:output.diagnosis,bases:[{contentId:original.contentId,expectedVersion:original.version}],...(invocationId?{invocationId}:{})}}};
  }};
}
