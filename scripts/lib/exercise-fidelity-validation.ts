import type { GeneralExerciseSource } from '../../server/vocabulary/general-exercise-authoring.ts';
import type { JsonSchema } from '../../src/domain/reflection-result-schema.ts';
import { parseContentExercise } from '../../src/domain/word-content/validation.ts';
import { validateJsonSchema } from '../../server/llm/json-schema-validator.ts';
import { validatePracticeExercises } from '../../server/word-content/authoring.ts';

/** A trial uses its rendered reference contract, including historical null bindings. */
export function fidelityGeneralContentErrors(source:GeneralExerciseSource,value:unknown,schema:JsonSchema):string[] {
  const issues=validateJsonSchema(value,schema);
  if(issues.length)return issues;
  try {
    const output=value as {exercises:Array<{id:string;stimulus:unknown}>};
    const exercises=output.exercises.map(item=>parseContentExercise({id:item.id,responseMode:'hanzi_entry',
      contract:{kind:'target_rehearsal',wordId:source.word.wordId},instruction:'',stimulus:item.stimulus,
      acceptedAnswers:[{wordId:source.word.wordId,hanzi:source.word.hanzi,traditional:source.word.traditional}]}));
    if(exercises.length)validatePracticeExercises(exercises,source.word);
    return [];
  }catch(error){return [error instanceof Error?error.message:'General stimulus validation failed'];}
}
