import type { JsonSchema } from '../../src/domain/reflection-result-schema.ts';
import type { VocabularyContent, VocabularyJson, VocabularySense } from '../../src/domain/vocabulary-content.ts';
import type { VocabularyReflectionJob, VocabularyPureCueReferral } from '../../src/domain/vocabulary-reflection.ts';
import { getEffectiveVocabularyEncounterReactions } from '../../src/domain/vocabulary-session.ts';
import { getDb } from '../db/connection.ts';
import { validateJsonSchema } from '../llm/json-schema-validator.ts';
import type { Word } from './pure-cue-promotion.ts';

const text:JsonSchema={type:'string'};
const object=(properties:Record<string,JsonSchema>):JsonSchema=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
export const vocabularySingleImprovementSchema=object({
  summary:text,
  source:object({decision:{type:'string',enum:['keep','revise','retire']},prompt:{type:['string','null']}}),
  sharedExercise:{anyOf:[{type:'null'},object({answers:{type:'array',items:text,minItems:2,maxItems:8},prompt:text,teachingNote:text,rationale:text})]},
  additionalExercises:{type:'array',items:object({answer:text,role:{type:'string',enum:['refinement','enrichment']},prompt:text,rationale:text})},
});
export type ExerciseImprovementOutput={
  summary:string;source:{decision:'keep'|'revise'|'retire';prompt:string|null};
  sharedExercise:null|{answers:string[];prompt:string;teachingNote:string;rationale:string};
  additionalExercises:{answer:string;role:'refinement'|'enrichment';prompt:string;rationale:string}[];
};
type SuppliedWord={ref:string;form:string;word:Word|null};
const wordQuery='SELECT id AS wordId,hanzi,traditional,pinyin,meaning FROM lexical_words';

/** References denote supplied forms. Ambiguous forms remain available for shared identity review. */
export function vocabularyImprovementWords(job:VocabularyReflectionJob):SuppliedWord[] {
  const target=getDb().prepare(`${wordQuery} WHERE id=?`).get(job.evidence.wordId) as Word|undefined;
  if(!target)throw new Error('Improvement target is unavailable');
  const words:SuppliedWord[]=[{ref:'target',form:target.hanzi,word:target}];
  const forms=[...new Set(job.evidence.evidence.flatMap(encounter=>encounter.responses.flatMap(response=>response.payload.response?.trim()?[response.payload.response.trim()]:[])))];
  for(const form of forms){
    if(form===target.hanzi||form===target.traditional)continue;
    const matches=getDb().prepare(`${wordQuery} WHERE hanzi=? OR traditional=? ORDER BY id`).all(form,form) as Word[];
    const word=matches.length===1?matches[0]!:null;
    if(word&&words.some(candidate=>candidate.word?.wordId===word.wordId))continue;
    words.push({ref:`response_${words.length}`,form,word});
  }
  return words;
}
function exerciseText(body:VocabularyJson):{prompt:string;instruction:string;postAnswer:VocabularyJson} {
  if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('Exercise has no authored body');
  const stimulus=body.stimulus;
  const prompt=typeof body.prompt==='string'?body.prompt:stimulus&&typeof stimulus==='object'&&!Array.isArray(stimulus)&&typeof stimulus.text==='string'
    ?[typeof stimulus.frame==='string'?stimulus.frame:'',stimulus.text].filter(Boolean).join('\n'):null;
  if(prompt===null)throw new Error('Exercise has no visible prompt');
  const material=body.material&&typeof body.material==='object'&&!Array.isArray(body.material)?body.material:body;
  const postAnswer:Record<string,VocabularyJson>={};
  if(material.reveal!==undefined)postAnswer.reveal=material.reveal;
  if(body.explanation!==undefined)postAnswer.explanation=body.explanation;
  if(body.answer!==undefined)postAnswer.answer=body.answer;
  if(body.bootstrapReveal!==undefined)postAnswer.bootstrapReveal=body.bootstrapReveal;
  if(Array.isArray(body.revealWords))postAnswer.words=body.revealWords.map(word=>{
    if(!word||typeof word!=='object'||Array.isArray(word))throw new Error('Invalid frozen lexical reveal');
    const sense=word.sense&&typeof word.sense==='object'&&!Array.isArray(word.sense)?word.sense.description:null;
    return {hanzi:word.hanzi??null,traditional:word.traditional??null,pinyin:word.pinyin??null,meaning:word.meaning??null,sense:sense??null};
  });
  return {prompt,instruction:typeof material.instruction==='string'?material.instruction:'',postAnswer:Object.keys(postAnswer).length?postAnswer:null};
}
export function projectVocabularyImprovementInput(job:VocabularyReflectionJob,original:VocabularyContent,intendedSense:VocabularySense) {
  return {
    words:vocabularyImprovementWords(job).map(({ref,form,word})=>({ref,form,lexical:word?{hanzi:word.hanzi,traditional:word.traditional,pinyin:word.pinyin,meaning:word.meaning}:null,canAuthorIndividual:word!==null})),
    source:exerciseText(original.body),intendedSense:{description:intendedSense.description},
    ...(job.reassessmentSource?{assessmentOrigin:'operator_reassessment; encounters retain their historical served cues'}:{}),
    encounters:job.evidence.evidence.map(encounter=>({...exerciseText(encounter.snapshot.body),
      responses:encounter.responses.map(response=>({response:response.payload.response,outcome:response.payload.outcome,effective:encounter.effectiveResponses.some(effective=>effective.actionId===response.actionId)})),
      reactions:getEffectiveVocabularyEncounterReactions(encounter).map(({payload})=>({reaction:payload.feedback,...(payload.comment!==undefined?{comment:payload.comment}:{})})),
      skipped:encounter.skipped,presentationUndone:encounter.presentationUndone})),
  };
}

/** Translate editorial intent into the established persistence contract; identity is application-owned. */
export function adaptVocabularyImprovementOutput(job:VocabularyReflectionJob,original:VocabularyContent,value:unknown) {
  if(validateJsonSchema(value,vocabularySingleImprovementSchema).length)throw new Error('Improvement output failed its strict schema');
  const output=value as ExerciseImprovementOutput;
  const nonempty=(text:string)=>{if(!text.trim())throw new Error('Improvement output contains empty text');};
  nonempty(output.summary);
  if(output.source.decision==='revise'){
    if(output.source.prompt===null)throw new Error('Revised source requires a prompt');nonempty(output.source.prompt);
  }else if(output.source.prompt!==null)throw new Error('Keep and retire cannot carry a revised prompt');
  if(original.kind!=='exercise')throw new Error('Improvement requires an exercise');
  const words=vocabularyImprovementWords(job);
  const lookup=(ref:string)=>{const word=words.find(word=>word.ref===ref);if(!word)throw new Error('Unknown supplied word reference');return word;};
  const acceptedAnswers=original.answers.flatMap(answer=>answer.acceptedForms);
  const operations:{sourceContentId:string;strategy:'update_existing'|'retire'|'create';rationale:string;prompt:string;acceptedAnswers:string[]}[]=[];
  const roles:('source_repair'|'refinement'|'enrichment')[]=[];
  if(output.source.decision!=='keep'){
    operations.push({sourceContentId:original.contentId,strategy:output.source.decision==='revise'?'update_existing':'retire',rationale:output.summary,prompt:output.source.prompt??'',acceptedAnswers});
    roles.push('source_repair');
  }
  const responseExercises:{wordId:string;prompt:string;rationale:string}[]=[];
  const responseRoles:('refinement'|'enrichment')[]=[];
  for(const exercise of output.additionalExercises){
    nonempty(exercise.prompt);nonempty(exercise.rationale);
    const word=lookup(exercise.answer);
    if(!word.word)throw new Error('Individual exercise requires a supplied unambiguous word');
    if(exercise.answer==='target'){
      operations.push({sourceContentId:original.contentId,strategy:'create',rationale:exercise.rationale,prompt:exercise.prompt,acceptedAnswers});roles.push(exercise.role);
    }else{
      responseExercises.push({wordId:word.word.wordId,prompt:exercise.prompt,rationale:exercise.rationale});responseRoles.push(exercise.role);
    }
  }
  let pureCueReferral:VocabularyPureCueReferral|null=null;
  if(output.sharedExercise){
    const shared=output.sharedExercise;
    nonempty(shared.prompt);nonempty(shared.teachingNote);nonempty(shared.rationale);
    if(!shared.answers.includes('target')||new Set(shared.answers).size!==shared.answers.length)throw new Error('Shared answers require target and distinct supplied responses');
    pureCueReferral={candidateWords:shared.answers.map(ref=>lookup(ref).form),sharedPurpose:shared.prompt,rationale:shared.rationale,draft:{prompt:shared.prompt,teachingNote:shared.teachingNote}};
  }
  return {legacy:{diagnosis:output.summary,operations,responseExercises,pureCueReferral},roles:[...roles,...responseRoles]};
}
