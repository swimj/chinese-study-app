import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {exerciseFidelityCases,DEFAULT_FIDELITY_CASES,type ExerciseFidelityCase} from './lib/exercise-fidelity-cases.ts';
import {generalExerciseInvocation,generalExerciseSchema} from '../server/vocabulary/general-exercise-authoring.ts';
import {vocabularySingleImprovementSchema} from '../server/vocabulary/reflection-provider.ts';
import {vocabularySenseMappingSchema} from '../server/vocabulary/improvement-admission.ts';
import {validateJsonSchema} from '../server/llm/json-schema-validator.ts';
import {createOpenAiCompatibleAdapter} from '../server/llm/openai-compatible.ts';
import {fetchImplementationForProvider} from '../server/llm/proxy-fetch.ts';
import {fidelityGeneralContentErrors} from './lib/exercise-fidelity-validation.ts';
import {projectVocabularySenseReferences} from '../server/vocabulary/model-sense-references.ts';
import {reflectionConfigForChoice} from '../server/reflection/model-routing.ts';
import {isReflectionModelChoice,LUNA_REFLECTION_MODEL_CHOICE} from '../server/reflection/model-arms.ts';
import type {JsonSchema} from '../src/domain/reflection-result-schema.ts';

const {values}=parseArgs({options:{archive:{type:'string'},variant:{type:'string'},cases:{type:'string'},'baseline-revision':{type:'string'},'model-choice':{type:'string',default:LUNA_REFLECTION_MODEL_CHOICE},profile:{type:'string',default:'auto'},'allow-provider-calls':{type:'boolean',default:false}}});
const repository=fileURLToPath(new URL('..',import.meta.url));
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
function required(value:string|undefined,label:string):string {if(!value?.trim())throw new Error(`Expected --${label}`);return value;}
const archive=path.resolve(required(values.archive,'archive')),variant=required(values.variant,'variant');
if(!/^[A-Za-z0-9_-]+$/.test(variant))throw new Error('Expected a file-safe variant');
const revision=values['baseline-revision'];
if(revision&&!/^[A-Za-z0-9_./-]+$/.test(revision))throw new Error('Invalid baseline revision');
async function source(relative:string):Promise<string> {return revision?execFileSync('git',['show',`${revision}:${relative}`],{cwd:repository,encoding:'utf8'}):readFile(path.join(repository,relative),'utf8');}
const choice=values['model-choice']!;
if(!isReflectionModelChoice(choice))throw new Error('Expected a registered --model-choice');
const config=reflectionConfigForChoice(choice);
if(!['auto','preparation','reflection'].includes(values.profile!))throw new Error('Expected --profile auto, preparation, or reflection');
async function requestFor(fixture:ExerciseFidelityCase) {
  let systemPrompt:string,outputSchema:JsonSchema,outputSchemaName:string;
  let userPrompt=JSON.stringify(fixture.input),decodeAliases=false;
  if(fixture.kind==='general') {
    const shared=generalExerciseInvocation(fixture.generalSource!);
    const frozen=revision?await source('server/vocabulary/general-exercise-authoring.ts'):null;
    const brief=frozen?.match(/general-exercises-v(\d+)\.md/)?.[1];
    if(revision&&brief!=='4'&&brief!=='5')throw new Error('Baseline supports the general v4/v5 contracts');
    systemPrompt=revision?await source(`server/word-content-lab/vocabulary-experiments/prompts/general-exercises-v${brief}.md`):shared.systemPrompt;
    decodeAliases=!revision||frozen!.includes('general-exercises-v2');
    outputSchema=structuredClone(decodeAliases?shared.outputSchema:generalExerciseSchema(fixture.generalSource!));
    if(decodeAliases)userPrompt=shared.userPrompt;
    if(revision&&/sourceUseId:\s*\{type:\['string','null'\]/.test(frozen!)){
      const ids=decodeAliases?(JSON.parse(userPrompt).content.uses as Array<{id:string}>).map(use=>use.id):fixture.generalSource!.uses.map(use=>use.id);
      outputSchema.properties!.exercises.items!.properties!.sourceUseId={type:['string','null'],enum:[null,...ids]};
    }
    if(brief==='4')outputSchema.properties!.exercises.minItems=1;
    outputSchemaName=brief==='4'?'vocabulary_general_exercises_v1':shared.outputSchemaName;
  } else {
    // The active provider prepends its empty shared-reasoning section to these
    // task-specific briefs; preserve the exact leading separator too.
    systemPrompt=`\n\n${await source(`server/vocabulary/reflection-prompts/${fixture.kind==='mapping'?'sense-mapping':'single-improvement'}.md`)}`;
    outputSchema=structuredClone(fixture.kind==='mapping'?vocabularySenseMappingSchema:vocabularySingleImprovementSchema);
    const oldSingle=revision&&fixture.kind==='single'&&!(await source('server/vocabulary/reflection-provider.ts')).includes("'replace','retire'");
    if(oldSingle)outputSchema.properties!.operations.items!.properties!.strategy.enum=['create','update_existing','replace'];
    outputSchemaName=fixture.kind==='mapping'?'vocabulary_reflection_sense_mapping_v1':oldSingle?'vocabulary_reflection_single_improvement_v2':'vocabulary_reflection_single_improvement_v3';
    decodeAliases=!revision||(await source('server/vocabulary/reflection-provider.ts')).includes('projectVocabularySenseReferences');
    if(decodeAliases){
      const projected=projectVocabularySenseReferences(fixture.input);userPrompt=JSON.stringify(projected.input);
      if(fixture.kind==='mapping')outputSchema.properties!.senseIds.items={type:'string',enum:(projected.input as {senses:Array<{senseId:string}>}).senses.map(sense=>sense.senseId)};
    }
  }
  const preparation=values.profile==='preparation'||(values.profile==='auto'&&fixture.kind==='general');
  if(preparation&&fixture.kind!=='general')throw new Error('Preparation profile requires general cases');
  return {decodeAliases,request:{model:config.providerModel,reasoningEffort:config.reasoningEffort,systemPrompt,userPrompt,outputSchemaName,outputSchema,
    maxOutputTokens:preparation?24000:config.maxOutputTokens,temperature:null,timeoutMs:preparation?180000:config.timeoutMs,cachePrompt:true}};
}
function applicationErrors(fixture:ExerciseFidelityCase,value:unknown,schema:JsonSchema):string[] {
  if(fixture.kind==='general')return fidelityGeneralContentErrors(fixture.generalSource!,value,schema);
  if(fixture.kind==='mapping')return [];
  const result=value as {operations:Array<{sourceContentId:string;strategy:string;prompt:string;acceptedAnswers:string[]}>};
  const errors:string[]=[];
  for(const op of result.operations){
    if(op.sourceContentId!==fixture.sourceId||JSON.stringify([...op.acceptedAnswers].sort())!==JSON.stringify([...fixture.targetForms].sort()))errors.push('Source identity or accepted forms changed');
    if(op.strategy==='retire'){if(op.prompt!=='')errors.push('Retirement carries replacement prompt');if(result.operations.length!==1)errors.push('Retirement also authors local practice');}
    else if(!op.prompt.trim()||fixture.targetForms.some(form=>op.prompt.includes(form)))errors.push('Empty prompt or exposed answer');
  }
  // Source/version, ownership and application fences require the database-backed
  // current-path tests; this standalone experiment never initializes a database.
  return errors;
}
await mkdir(archive,{recursive:true,mode:0o700});
const all=exerciseFidelityCases(),selected=all.filter(c=>(values.cases?.split(',')??DEFAULT_FIDELITY_CASES).includes(c.name));
if(!selected.length||selected.length>8||values.cases?.split(',').some(name=>!all.some(c=>c.name===name)))throw new Error('Select one to eight known cases');
const index=path.join(archive,`${variant}-index.json`);
await writeFile(index,JSON.stringify({variant,revision:revision??'working-tree',synthetic:true,modelChoice:choice,profile:values.profile,cases:selected.map(c=>c.name),live:values['allow-provider-calls']},null,2),{flag:'wx',mode:0o600});
const apiKey=process.env[config.apiKeyEnvironmentVariable]?.trim();
const baseUrl=config.baseUrlEnvironmentVariable?process.env[config.baseUrlEnvironmentVariable]?.trim()||null:null;
if(values['allow-provider-calls']&&!apiKey)throw new Error(`${config.apiKeyEnvironmentVariable} is not configured`);
const adapter=createOpenAiCompatibleAdapter({id:config.provider,defaultBaseUrl:config.defaultBaseUrl,apiKeyEnvironmentVariable:config.apiKeyEnvironmentVariable,structuredOutputMode:config.structuredOutputMode,maxTokensField:config.maxTokensField,fetchImplementation:fetchImplementationForProvider(config.provider,config.timeoutMs)});
let next=0;
await Promise.all(Array.from({length:Math.min(3,selected.length)},async()=>{while(next<selected.length){
  const fixture=selected[next++]!,directory=path.join(archive,variant,fixture.name),{request,decodeAliases}=await requestFor(fixture);
  await mkdir(directory,{recursive:true,mode:0o700});
  await writeFile(path.join(directory,'request.json'),JSON.stringify({fixture,revision:revision??'working-tree',decodeAliases,request,sha256:hash(JSON.stringify(request))},null,2),{flag:'wx',mode:0o600});
  const wire={model:request.model,messages:[{role:'system',content:config.structuredOutputMode==='json_schema'?request.systemPrompt:[request.systemPrompt,'','Return exactly one JSON object matching the following JSON Schema. Do not add prose or Markdown outside the object.',JSON.stringify(request.outputSchema)].join('\n')},{role:'user',content:request.userPrompt}],
    [config.maxTokensField]:request.maxOutputTokens,response_format:config.structuredOutputMode==='json_schema'?{type:'json_schema',json_schema:{name:request.outputSchemaName,strict:true,schema:request.outputSchema}}:{type:'json_object'},reasoning_effort:request.reasoningEffort};
  await writeFile(path.join(directory,'wire-request.json'),JSON.stringify(wire,null,2),{flag:'wx',mode:0o600});
  if(!values['allow-provider-calls']){console.log(JSON.stringify({case:fixture.name,prepared:true,providerCall:false}));continue;}
  console.log(JSON.stringify({case:fixture.name,event:'started'}));
  try{
    const response=await adapter.run(request,{apiKey:apiKey!,baseUrl});
    await writeFile(path.join(directory,'response.json'),JSON.stringify(response,null,2),{flag:'wx',mode:0o600});
    let structuralErrors:string[],contentErrors:string[]=[];
    try{const parsed:unknown=JSON.parse(response.rawText);structuralErrors=validateJsonSchema(parsed,request.outputSchema);if(!structuralErrors.length)contentErrors=applicationErrors(fixture,parsed,request.outputSchema);}catch{structuralErrors=['invalid_json'];}
    const validation={case:fixture.name,finishReason:response.finishReason,structuralErrors,contentErrors,
      contentValidation:fixture.kind==='general'?'rendered reference schema plus shared stimulus guards':fixture.kind==='single'?'partial standalone identity, prompt, and retirement checks':'schema only; mapping semantics require review',
      valid:response.finishReason==='stop'&&!structuralErrors.length&&!contentErrors.length};
    await writeFile(path.join(directory,'validation.json'),JSON.stringify(validation,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify(validation));
  }catch(error){const failure={case:fixture.name,name:error instanceof Error?error.name:'unknown',status:typeof error==='object'&&error!==null&&'status'in error?error.status:null};await writeFile(path.join(directory,'failure.json'),JSON.stringify(failure,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify(failure));}
}}));
