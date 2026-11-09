/** Synthetic two-stage prompt trial. Never opens an application database or loads hosted evidence. */
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {parseArgs} from 'node:util';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createOpenAiCompatibleAdapter} from '../server/llm/openai-compatible.ts';
import {fetchImplementationForProvider} from '../server/llm/proxy-fetch.ts';
import {validateJsonSchema} from '../server/llm/json-schema-validator.ts';
import {reflectionConfigForChoice} from '../server/reflection/model-routing.ts';
import {isOfferedReflectionModelChoice,LUNA_REFLECTION_MODEL_CHOICE} from '../server/reflection/model-arms.ts';
import type {ProviderRunRequest,ProviderRawResult} from '../server/llm/types.ts';
import {pureCueFlowCases,pureCueFlowSchemas,singleTrialInput,integrationTrialInput,fixedSingleOutput,singleOutputErrors,integrationOutputErrors,decodeIntegrationReplay,
  type FlowContract,type PureCueFlowCase,type TrialSingleOutput,type TrialIntegrationOutput} from './lib/pure-cue-flow-cases.ts';

const BASELINE='8b3f0aa1e2adce8173cfc3767ceb6b717c8cece3';
const root=fileURLToPath(new URL('..',import.meta.url));
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const {values}=parseArgs({options:{archive:{type:'string'},variant:{type:'string'},contract:{type:'string',default:'candidate'},cases:{type:'string'},'model-choice':{type:'string',default:LUNA_REFLECTION_MODEL_CHOICE},'baseline-revision':{type:'string',default:BASELINE},'allow-provider-calls':{type:'boolean',default:false},'replay-integration-from':{type:'string'}}});
function required(value:string|undefined,name:string):string {if(!value?.trim())throw new Error(`Expected --${name}`);return value;}
const archive=path.resolve(required(values.archive,'archive')),variant=required(values.variant,'variant');
if(!/^[A-Za-z0-9_-]+$/.test(variant))throw new Error('Variant must be filesystem safe');
if(values.contract!=='candidate'&&values.contract!=='baseline')throw new Error('Expected --contract baseline or candidate');
const contract:FlowContract=values.contract;
const choice=values['model-choice'];if(!isOfferedReflectionModelChoice(choice))throw new Error('Select an offered production --model-choice');
const config=reflectionConfigForChoice(choice),modelSlug=choice.replaceAll(/[^A-Za-z0-9_-]/g,'-');
const baseline=execFileSync('git',['rev-parse','--verify',`${values['baseline-revision']}^{commit}`],{cwd:root,encoding:'utf8'}).trim();
if(baseline!==BASELINE)throw new Error('Frozen baseline schemas correspond only to 8b3f0aa1; use that baseline revision');
const sourceRevision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const promptFiles={single:'server/vocabulary/reflection-prompts/single-improvement.md',integration:'server/vocabulary/reflection-prompts/pure-cue-integration.md'};
const prompts=Object.fromEntries(await Promise.all(Object.entries(promptFiles).map(async([stage,file])=>[stage,`\n\n${contract==='baseline'?execFileSync('git',['show',`${baseline}:${file}`],{cwd:root,encoding:'utf8'}):await readFile(path.join(root,file),'utf8')}`]))) as Record<'single'|'integration',string>;
const schemas=pureCueFlowSchemas(contract),all=pureCueFlowCases();
const requested=values.cases?.split(',')??all.map(c=>c.id);
if(new Set(requested).size!==requested.length||requested.length<1||requested.length>8||requested.some(id=>!all.some(c=>c.id===id)))throw new Error('Select one to eight distinct known cases');
const selected=all.filter(c=>requested.includes(c.id));
const replayFrom=values['replay-integration-from'];
if(replayFrom&&(!path.isAbsolute(replayFrom)||contract!=='candidate'))throw new Error('Replay requires an absolute candidate archive path and candidate contract');
const replayInputs=new Map<string,ReturnType<typeof decodeIntegrationReplay>&{sourceFile:string;sourceSha256:string}>();
let replayManifest:unknown=null;
const replaySkipped:Record<string,string>={};
if(replayFrom){
  const modelDirectory=path.join(replayFrom,modelSlug);
  replayManifest=JSON.parse(await readFile(path.join(modelDirectory,'manifest.json'),'utf8')) as unknown;
  const sourceReview=JSON.parse(await readFile(path.join(modelDirectory,'review.json'),'utf8')) as {reviews:Array<{case:string;status:string}>};
  for(const fixture of selected){
    const sourceFile=path.join(modelDirectory,fixture.id,'integration','request.json');
    let raw:string;
    try{raw=await readFile(sourceFile,'utf8');}catch(error){
      if(typeof error==='object'&&error!==null&&'code'in error&&error.code==='ENOENT'){
        replaySkipped[fixture.id]=sourceReview.reviews.find(item=>item.case===fixture.id)?.status??'no_archived_integration_request';continue;
      }
      throw error;
    }
    const originalFixture=JSON.parse(await readFile(path.join(modelDirectory,fixture.id,'fixture.json'),'utf8')) as unknown;
    if(JSON.stringify(originalFixture)!==JSON.stringify(fixture))throw new Error('Replay fixture differs from frozen case');
    replayInputs.set(fixture.id,{...decodeIntegrationReplay(JSON.parse(raw) as unknown,schemas.integration,config.providerModel),sourceFile,sourceSha256:hash(raw)});
  }
}
const live=values['allow-provider-calls'];
const apiKey=process.env[config.apiKeyEnvironmentVariable]?.trim();
if(live&&!apiKey)throw new Error(`${config.apiKeyEnvironmentVariable} is not configured`);
const baseUrl=config.baseUrlEnvironmentVariable?process.env[config.baseUrlEnvironmentVariable]?.trim()||null:null;
const directory=path.join(archive,variant,modelSlug);
await mkdir(directory,{recursive:true,mode:0o700});
const manifest={format:'pure-cue-flow-trial.v1',variant,contract,baselineRevision:baseline,sourceRevision,live,modelChoice:choice,
  settings:{provider:config.provider,model:config.providerModel,reasoningEffort:config.reasoningEffort,maxOutputTokens:config.maxOutputTokens,timeoutMs:config.timeoutMs,temperature:null,cachePrompt:true,structuredOutputMode:config.structuredOutputMode,additionalRequestBody:config.additionalRequestBody??null},
  promptHashes:Object.fromEntries(Object.entries(prompts).map(([key,text])=>[key,hash(text)])),schemaHashes:Object.fromEntries(Object.entries(schemas).map(([key,schema])=>[key,hash(JSON.stringify(schema))])),
  replay:replayFrom?{sourceDirectory:replayFrom,sourceManifest:replayManifest,inputs:Object.fromEntries([...replayInputs].map(([id,input])=>[id,{sourceFile:input.sourceFile,sourceSha256:input.sourceSha256,userPromptSha256:hash(input.userPrompt)}])),skipped:replaySkipped}:null,
  cases:selected.map(c=>c.id),fixtureSha256:hash(JSON.stringify(selected)),startedAt:new Date().toISOString(),
  limitations:'Synthetic prompt behavior and partial contract guards only. No admission mapping, dictionary identity resolution, database normalization/application, historical snapshots, live learner data, or learner outcomes. Local-plan content is a simplified semantic projection, not a persistence-ready proposal; the synthetic retained member 另外的 does not establish a production lexical identity. Human reviewFocus is withheld from provider messages. One sample per case/model/variant is not a reliability estimate.',
  inputMapping:{single:'Same cue/word/encounter projection for both variants; candidate omits shared teachingNote output.',integration:'Resolved members and local-plan decisions carry from the actual single result. Baseline keeps upstream prompt/note on create; candidate authors final prompt/axis/note. Fixed integration-only candidates use the same visible candidate and intended overlap; only baseline supplies an upstream note.'}};
// An existing manifest refuses every repeated invocation before any provider call.
await writeFile(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx',mode:0o600});
const reviews:Array<Record<string,unknown>>=[];
async function save(file:string,value:unknown):Promise<void> {await writeFile(file,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});}
type StageResult={parsed:unknown;valid:boolean;structuralErrors:string[];contentErrors:string[];response:ProviderRawResult|null};
async function runStage(fixture:PureCueFlowCase,stage:'single'|'integration',input:unknown,contentErrors:(value:unknown)=>string[],exactUserPrompt?:string):Promise<StageResult> {
  const stageDir=path.join(directory,fixture.id,stage);await mkdir(stageDir,{recursive:true,mode:0o700});
  const request:ProviderRunRequest={model:config.providerModel,reasoningEffort:config.reasoningEffort,systemPrompt:prompts[stage],userPrompt:exactUserPrompt??JSON.stringify(input),
    outputSchemaName:`vocabulary_reflection_${stage==='single'?'single_improvement':'pure_cue_promotion'}_v${stage==='single'?(contract==='baseline'?'4':'5'):(contract==='baseline'?'3':'4')}`,
    outputSchema:schemas[stage],maxOutputTokens:config.maxOutputTokens,temperature:null,timeoutMs:config.timeoutMs,cachePrompt:true,clientRequestId:randomUUID()};
  await save(path.join(stageDir,'request.json'),{request,hashes:{systemPrompt:hash(request.systemPrompt),userPrompt:hash(request.userPrompt),outputSchema:hash(JSON.stringify(request.outputSchema))}});
  if(!live)return {parsed:null,valid:false,structuralErrors:[],contentErrors:[],response:null};
  const direct=fetchImplementationForProvider(config.provider,config.timeoutMs);
  const adapter=createOpenAiCompatibleAdapter({id:config.provider,defaultBaseUrl:config.defaultBaseUrl,apiKeyEnvironmentVariable:config.apiKeyEnvironmentVariable,
    structuredOutputMode:config.structuredOutputMode,maxTokensField:config.maxTokensField,additionalRequestBody:config.additionalRequestBody,
    fetchImplementation:async(input,init)=>{
      // The body is the exact adapter-rendered transport payload. Never retain headers or credentials.
      if(typeof init?.body!=='string')throw new Error('Expected serialized provider body');
      await save(path.join(stageDir,'wire-request.json'),JSON.parse(init.body));return direct(input,init);
    }});
  console.log(JSON.stringify({case:fixture.id,stage,event:'started',modelChoice:choice}));
  const started=Date.now();
  try {
    const response=await adapter.run(request,{apiKey:apiKey!,baseUrl});
    await save(path.join(stageDir,'response.json'),response);
    let parsed:unknown=null,structuralErrors:string[],guardErrors:string[]=[];
    try{parsed=JSON.parse(response.rawText);structuralErrors=validateJsonSchema(parsed,request.outputSchema);if(!structuralErrors.length)guardErrors=contentErrors(parsed);}catch{structuralErrors=['invalid_json'];}
    const validation={valid:response.finishReason==='stop'&&!structuralErrors.length&&!guardErrors.length,structuralErrors,contentErrors:guardErrors,finishReason:response.finishReason,latencyMs:Date.now()-started};
    await save(path.join(stageDir,'validation.json'),validation);console.log(JSON.stringify({case:fixture.id,stage,...validation}));
    return {parsed,...validation,response};
  }catch(error){
    // Provider exception messages/bodies can contain transport or credential details. Keep only safe metadata.
    const failure={case:fixture.id,stage,event:'provider_failed',name:error instanceof Error?error.name:'unknown',status:typeof error==='object'&&error!==null&&'status'in error?error.status:null,latencyMs:Date.now()-started};
    await save(path.join(stageDir,'failure.json'),failure);console.log(JSON.stringify(failure));
    return {parsed:null,valid:false,structuralErrors:['provider_failed'],contentErrors:[],response:null};
  }
}
let next=0;
await Promise.all(Array.from({length:Math.min(3,selected.length)},async()=>{while(next<selected.length){
  const fixture=selected[next++]!;await mkdir(path.join(directory,fixture.id),{recursive:true,mode:0o700});
  await save(path.join(directory,fixture.id,'fixture.json'),fixture);
  if(replayFrom){
    const replay=replayInputs.get(fixture.id);
    if(!replay){reviews.push({case:fixture.id,reviewFocus:fixture.reviewFocus,status:'no_archived_integration_request',sourceStatus:replaySkipped[fixture.id],single:null});continue;}
    const integration=await runStage(fixture,'integration',replay.input,value=>integrationOutputErrors(replay.input,value as TrialIntegrationOutput,contract),replay.userPrompt);
    reviews.push({case:fixture.id,reviewFocus:fixture.reviewFocus,status:live?(integration.valid?'completed':'integration_failed'):'integration_prepared',single:null,integration,replaySource:replay.sourceFile});continue;
  }
  let single:TrialSingleOutput;let singleResult:StageResult|null=null;
  if(fixture.kind==='chain'){
    singleResult=await runStage(fixture,'single',singleTrialInput(fixture),value=>singleOutputErrors(fixture,value as TrialSingleOutput));
    if(!singleResult.valid){reviews.push({case:fixture.id,reviewFocus:fixture.reviewFocus,status:live?'single_failed':'single_prepared_integration_awaits_output',single:singleResult});continue;}
    single=singleResult.parsed as TrialSingleOutput;
  }else single=fixedSingleOutput(fixture,contract);
  if(!single.sharedExercise){reviews.push({case:fixture.id,reviewFocus:fixture.reviewFocus,status:'no_shared_candidate',single:singleResult});continue;}
  const input=integrationTrialInput(fixture,single,contract);
  const integration=await runStage(fixture,'integration',input,value=>integrationOutputErrors(input,value as TrialIntegrationOutput,contract));
  reviews.push({case:fixture.id,reviewFocus:fixture.reviewFocus,status:live?(integration.valid?'completed':'integration_failed'):'integration_prepared',single:singleResult,integration});
}}));
reviews.sort((a,b)=>String(a.case).localeCompare(String(b.case)));
await save(path.join(directory,'review.json'),{manifest,finishedAt:new Date().toISOString(),reviews});
console.log(JSON.stringify({event:'finished',modelChoice:choice,review:path.join(directory,'review.json'),cases:reviews.length,live}));
