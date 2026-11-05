import type {JsonSchema} from '../../src/domain/reflection-result-schema.ts';
import type {ExerciseFidelityCase} from './exercise-fidelity-cases.ts';
import type {ExerciseImprovementOutput} from '../../server/vocabulary/exercise-improvement-authoring.ts';

const text:JsonSchema={type:'string'};
const object=(properties:Record<string,JsonSchema>):JsonSchema=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
/** Frozen schema v4; baseline trials must not import the current authoring contract. */
export function legacySingleImprovementTrialSchema():JsonSchema {
  return object({diagnosis:text,operations:{type:'array',items:object({sourceContentId:text,strategy:{type:'string',enum:['create','update_existing','replace','retire']},rationale:text,prompt:text,acceptedAnswers:{type:'array',items:text}})},
    responseExercises:{type:'array',items:object({wordId:text,prompt:text,rationale:text})},
    pureCueReferral:{anyOf:[{type:'null'},object({candidateWords:{type:'array',items:text,minItems:2,maxItems:8},sharedPurpose:text,rationale:text,
      draft:object({prompt:text,semanticAxis:text,teachingNote:text})})]}});
}
type FixtureWord={wordId:string;hanzi:string;traditional:string|null;pinyin:string;meaning:string};
type FixtureBody={prompt:string;instruction?:string;reveal?:unknown};
type FixtureInput={word:FixtureWord;responseCandidates?:FixtureWord[];sourceContent:{body:FixtureBody};intendedSense:{description:unknown};
  evidence:{encounters:{served:{body:FixtureBody};responses:{response:string|null;outcome:string;effective:boolean}[];reactions:unknown[];skipped:boolean;presentationUndone:boolean}[]}};
/** Mirrors the production projection over synthetic lexical snapshots without opening a database. */
export function projectExerciseAuthoringTrial(fixture:ExerciseFidelityCase) {
  const input=fixture.input as unknown as FixtureInput;
  const target=input.word;
  const words:Array<{ref:string;form:string;lexical:Omit<FixtureWord,'wordId'>|null;canAuthorIndividual:boolean}>=[];
  const lexical=(word:FixtureWord)=>({hanzi:word.hanzi,traditional:word.traditional,pinyin:word.pinyin,meaning:word.meaning});
  words.push({ref:'target',form:target.hanzi,lexical:lexical(target),canAuthorIndividual:true});
  const seenIds=new Set([target.wordId]);
  const forms=[...new Set(input.evidence.encounters.flatMap(encounter=>encounter.responses.flatMap(response=>response.response?.trim()?[response.response.trim()]:[])))];
  for(const form of forms){
    if(form===target.hanzi||form===target.traditional)continue;
    const candidates=(input.responseCandidates??[]).filter(word=>word.hanzi===form||word.traditional===form);
    const candidate=candidates.length===1?candidates[0]!:null;
    if(candidate&&seenIds.has(candidate.wordId))continue;
    if(candidate)seenIds.add(candidate.wordId);
    words.push({ref:`response_${words.length}`,form,lexical:candidate?lexical(candidate):null,canAuthorIndividual:candidate!==null});
  }
  const content=(body:FixtureBody)=>({prompt:body.prompt,instruction:body.instruction??'',postAnswer:body.reveal===undefined?null:{reveal:body.reveal}});
  return {words,source:content(input.sourceContent.body),intendedSense:{description:input.intendedSense.description},
    encounters:input.evidence.encounters.map(encounter=>({...content(encounter.served.body),responses:encounter.responses.map(({response,outcome,effective})=>({response,outcome,effective})),
      reactions:encounter.reactions,skipped:encounter.skipped,presentationUndone:encounter.presentationUndone}))};
}
export function exerciseAuthoringTrialErrors(fixture:ExerciseFidelityCase,value:unknown):string[] {
  const output=value as ExerciseImprovementOutput,words=projectExerciseAuthoringTrial(fixture).words,errors:string[]=[];
  const promptErrors=(prompt:string,refs:string[])=>{
    if(!prompt.trim())errors.push('Empty retrieval prompt');
    for(const ref of refs){
      const word=words.find(word=>word.ref===ref);
      if(!word){errors.push('Unknown supplied word reference');continue;}
      if([word.form,word.lexical?.hanzi,word.lexical?.traditional].some(form=>form&&prompt.includes(form)))errors.push('Retrieval prompt exposes an answer');
    }
  };
  if(!output.summary.trim())errors.push('Empty operator summary');
  if(output.source.decision==='revise'){
    if(output.source.prompt===null)errors.push('Revision lacks prompt');else promptErrors(output.source.prompt,['target']);
  }else if(output.source.prompt!==null)errors.push('Keep or retire carries a prompt');
  for(const exercise of output.additionalExercises){
    if(!words.find(word=>word.ref===exercise.answer)?.canAuthorIndividual)errors.push('Individual exercise requires resolved supplied word');
    if(!exercise.rationale.trim())errors.push('Empty exercise rationale');
    promptErrors(exercise.prompt,[exercise.answer]);
  }
  if(output.sharedExercise){
    const shared=output.sharedExercise;
    if(!shared.answers.includes('target')||new Set(shared.answers).size!==shared.answers.length)errors.push('Shared task lacks target or repeats answers');
    if(!shared.rationale.trim()||!shared.teachingNote.trim())errors.push('Incomplete shared exercise');
    promptErrors(shared.prompt,shared.answers);
  }
  return errors;
}
