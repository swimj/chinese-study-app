import { readFileSync } from 'node:fs';
import type { WordContentDocument } from '../../src/domain/word-content/types.ts';
import type { JsonSchema } from '../../src/domain/reflection-result-schema.ts';
import { parseContentExercise } from '../../src/domain/word-content/validation.ts';
import { validatePracticeExercises } from '../word-content/authoring.ts';
import { validateJsonSchema } from '../llm/json-schema-validator.ts';

/** Authoring needs lexical evidence, not a completed teaching/bootstrap document. */
export type GeneralExerciseSource = Pick<WordContentDocument,'word'|'uses'|'examples'>;
export type GeneralExerciseOutput = { exercises: Array<{ id:string; sourceUseId:string|null;
  stimulus:{kind:'direct_text';text:string}|{kind:'phrase_cloze';frame:string;text:string};teachingNote:string|null }> };
const prompt = readFileSync(new URL('../word-content-lab/vocabulary-experiments/prompts/general-exercises-v4.md',import.meta.url),'utf8');
const text:JsonSchema={type:'string'};
const object=(properties:Record<string,JsonSchema>):JsonSchema=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
export function generalExerciseSchema(content:GeneralExerciseSource):JsonSchema {
  return object({exercises:{type:'array',items:object({id:text,
    sourceUseId:{type:['string','null'],enum:[null,...content.uses.map(use=>use.id)]},
    stimulus:{anyOf:[object({kind:{type:'string',enum:['direct_text']},text}),object({kind:{type:'string',enum:['phrase_cloze']},frame:text,text})]},
    teachingNote:{type:['string','null']}}),minItems:1}});
}
export const GENERAL_EXERCISE_CONTRACT = {systemPrompt:prompt,outputSchemaName:'vocabulary_general_exercises_v1',
  promptName:'vocabulary-general-exercises',promptVersion:'v4',schemaVersion:'1',inputProjectionVersion:'general-exercises-v1'};
/** Both callers use this exact prompt, response schema, and provenance contract. */
export function generalExerciseInvocation(content:GeneralExerciseSource) {
  return {...GENERAL_EXERCISE_CONTRACT,userPrompt:JSON.stringify({role:'general_exercises',content}),outputSchema:generalExerciseSchema(content)};
}
export function validateGeneralExerciseOutput(content:GeneralExerciseSource,value:unknown):GeneralExerciseOutput {
  if(validateJsonSchema(value,generalExerciseSchema(content)).length)throw new Error('Vocabulary practice output failed validation');
  const output=value as GeneralExerciseOutput;
  const exercises=output.exercises.map(item=>parseContentExercise({id:item.id,responseMode:'hanzi_entry',contract:{kind:'target_rehearsal',wordId:content.word.wordId},
    instruction:'',stimulus:item.stimulus,acceptedAnswers:[{wordId:content.word.wordId,hanzi:content.word.hanzi,traditional:content.word.traditional}]}));
  validatePracticeExercises(exercises,content.word);
  return output;
}
