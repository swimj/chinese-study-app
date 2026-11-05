import { vocabularySenseReferences } from './model-sense-references.ts';
import { readFileSync } from 'node:fs';
import type { WordContentDocument } from '../../src/domain/word-content/types.ts';
import type { JsonSchema } from '../../src/domain/reflection-result-schema.ts';
import { parseContentExercise } from '../../src/domain/word-content/validation.ts';
import { validatePracticeExercises } from '../word-content/authoring.ts';
import { validateJsonSchema } from '../llm/json-schema-validator.ts';

/** Authoring needs lexical evidence, not a completed teaching/bootstrap document. */
export type GeneralExerciseSource = Pick<WordContentDocument,'word'|'uses'|'examples'>;
export type GeneralExerciseOutput = { exercises: Array<{ id:string; sourceUseId:string;
  stimulus:{kind:'direct_text';text:string}|{kind:'phrase_cloze';frame:string;text:string};teachingNote:string|null }> };
const prompt = readFileSync(new URL('../word-content-lab/vocabulary-experiments/prompts/general-exercises-v5.md',import.meta.url),'utf8');
const text:JsonSchema={type:'string'};
const object=(properties:Record<string,JsonSchema>):JsonSchema=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
export function generalExerciseSchema(content:GeneralExerciseSource):JsonSchema {
  return object({exercises:{type:'array',items:object({id:text,
    sourceUseId:{type:'string',enum:content.uses.map(use=>use.id)},
    stimulus:{anyOf:[object({kind:{type:'string',enum:['direct_text']},text}),object({kind:{type:'string',enum:['phrase_cloze']},frame:text,text})]},
    teachingNote:{type:['string','null']}})}});
}
export const GENERAL_EXERCISE_CONTRACT = {systemPrompt:prompt,outputSchemaName:'vocabulary_general_exercises_v2',
  promptName:'vocabulary-general-exercises',promptVersion:'v5',schemaVersion:'2',inputProjectionVersion:'general-exercises-v2'};
/** Both callers use this exact prompt, response schema, and provenance contract. */
export function generalExerciseInvocation(content:GeneralExerciseSource) {
  const refs=vocabularySenseReferences(content.uses.map(use=>use.id));
  const examples=new Map(content.examples.map((example,index)=>[example.id,`e${index+1}`]));
  const projected={...content,uses:content.uses.map(use=>({...use,id:refs.alias(use.id),exampleIds:use.exampleIds.map(id=>{
    const alias=examples.get(id);if(!alias)throw new Error('Unregistered source example reference');return alias;
  })})),examples:content.examples.map(example=>({...example,id:examples.get(example.id)!}))};
  return {...GENERAL_EXERCISE_CONTRACT,userPrompt:JSON.stringify({role:'general_exercises',content:projected}),outputSchema:generalExerciseSchema(projected)};
}
export function validateGeneralExerciseOutput(content:GeneralExerciseSource,value:unknown):GeneralExerciseOutput {
  if(validateJsonSchema(value,generalExerciseSchema(content)).length)throw new Error('Vocabulary practice output failed validation');
  const output=value as GeneralExerciseOutput;
  const exercises=output.exercises.map(item=>parseContentExercise({id:item.id,responseMode:'hanzi_entry',contract:{kind:'target_rehearsal',wordId:content.word.wordId},
    instruction:'',stimulus:item.stimulus,acceptedAnswers:[{wordId:content.word.wordId,hanzi:content.word.hanzi,traditional:content.word.traditional}]}));
  // Empty output records that no faithful exact-target exercise was authored;
  // it neither excludes the selected senses nor changes the teaching contract.
  if(exercises.length)validatePracticeExercises(exercises,content.word);
  return output;
}

/** Decode the provider's local use IDs before ordinary canonical-source validation. */
export function normalizeGeneralExerciseReferences(content:GeneralExerciseSource,value:unknown):unknown {
  const schema=generalExerciseInvocation(content).outputSchema;
  if(validateJsonSchema(value,schema).length)throw new Error('Vocabulary practice output failed validation');
  const refs=vocabularySenseReferences(content.uses.map(use=>use.id));
  const output=value as GeneralExerciseOutput;
  return {...output,exercises:output.exercises.map(exercise=>({...exercise,sourceUseId:refs.canonical(exercise.sourceUseId)}))};
}
