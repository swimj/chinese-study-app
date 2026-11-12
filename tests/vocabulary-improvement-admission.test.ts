import { captureVocabularyRepertoireSelection } from '../server/db/vocabulary-repertoire-selection.ts';
import { createHash } from 'node:crypto';
import { VocabularySenseReadinessPending } from '../server/vocabulary/sense-readiness.ts';
import type { ensureVocabularyDefaultUsefulSelection } from '../server/vocabulary/default-useful-selection.ts';
import { writeVocabularyDefaultUsefulSenses } from '../server/db/vocabulary-sense-coverage.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach,afterEach,test,type TestFn } from 'node:test';
import { runWithLearnerId } from '../server/db/learner-context.ts';
import { setDb } from '../server/db/connection.ts';
import { createVocabularyContent,createVocabularySense,establishVocabularySenseCatalog,getVocabularyContentForMaintenance,getVocabularySenseCatalog,getVocabularySenses,mapVocabularyContentSense,updateVocabularyContent,updateVocabularySense } from '../server/db/vocabulary-content.ts';
import { createVocabularyPracticeProvider } from '../server/vocabulary/preparation.ts';
import type { WordContentDocument } from '../src/domain/word-content/types.ts';
import { createVocabularyReflectionProvider } from '../server/vocabulary/reflection-provider.ts';
import { VocabularyReflectionSourceConflict } from '../server/db/vocabulary-case-reviews.ts';
import type { VocabularySenseEnsurer } from '../server/vocabulary/improvement-admission.ts';
import type { VocabularyContent } from '../src/domain/vocabulary-content.ts';
import type { VocabularyReflectionJob } from '../src/domain/vocabulary-reflection.ts';
import type { ProviderAdapter,ProviderRunRequest } from '../server/llm/types.ts';
import { effectiveVocabularyReactions, type VocabularyReactionAction } from '../src/domain/vocabulary-session.ts';

let db:DatabaseSync;
let original:Extract<VocabularyContent,{kind:'exercise'}>;
const actor={kind:'service' as const,id:'fixture'};
const at='2026-10-19T12:00:00.000Z';
beforeEach(context=>{
  db=new DatabaseSync(':memory:');setDb(db);
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE learners(learner_id TEXT PRIMARY KEY); INSERT INTO learners VALUES ('learner');
    CREATE TABLE lexical_word_meanings(id TEXT PRIMARY KEY,word_id TEXT,text TEXT,position INTEGER);
    CREATE TABLE lexical_words(id TEXT PRIMARY KEY,hanzi TEXT,traditional TEXT,pinyin TEXT,meaning TEXT);
    INSERT INTO lexical_words VALUES ('word','放大',NULL,'fang4 da4','enlarge; amplify');
    CREATE TABLE model_invocations(id TEXT PRIMARY KEY,actor_kind TEXT,actor_id TEXT,learner_id TEXT,status TEXT,spend_usd REAL,requesting_learner_id TEXT,timestamp TEXT,invocation_type TEXT);
    CREATE TABLE reflection_cases(case_id TEXT PRIMARY KEY,kind TEXT,word_id TEXT,evidence_snapshot_json TEXT);
    CREATE TABLE vocabulary_case_lineage(member_case_id TEXT PRIMARY KEY REFERENCES reflection_cases(case_id),case_id TEXT NOT NULL REFERENCES reflection_cases(case_id));
    CREATE TABLE vocabulary_reflection_jobs(job_id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('learner_feedback','exercise_improvement')),model_choice TEXT,
      review_case_id TEXT REFERENCES reflection_cases(case_id),case_sequence INTEGER NOT NULL DEFAULT 1,reassessment_source_json TEXT);
    INSERT INTO vocabulary_reflection_jobs(job_id,kind,model_choice) VALUES ('job','exercise_improvement',NULL);`);
  for(const name of ['0062_vocabulary_sense_coverage','0064_vocabulary_default_useful_senses','0039_vocabulary_content','0045_vocabulary_provenance_links','0050_vocabulary_improvement_admission','0051_vocabulary_pure_cue_promotion'])
    db.exec(readFileSync(new URL(`../server/db/migrations/${name}.sql`,import.meta.url),'utf8'));
  db.exec(readFileSync(new URL('../server/db/migrations/0061_vocabulary_sense_mapping_retries.sql',import.meta.url),'utf8'));
  const created=createVocabularyContent({contentId:'original',kind:'exercise',payloadVersion:1,body:{prompt:'请把这张照片____后再打印。',instruction:'Old instruction',reveal:{teachingNote:'Old unrelated teaching'},source:{kind:context.name.startsWith('[bootstrap]')?'dictionary_baseline':'old_source'}},accessScope:'shared',availability:'active',originKind:'human',
    exerciseType:'word',skill:'production',exerciseRole:'general',assessment:{match:'exact'},words:[{wordId:'word',relation:'target'}],answers:[{wordId:'word',acceptedForms:['放大']}]},actor);
  if(created.kind!=='exercise')throw new Error('Expected an exercise fixture');
  original=created;
  if(!context.name.startsWith('[bootstrap] fresh inventory')) {
    seedInventory();
    writeVocabularyDefaultUsefulSenses('word',0,['size','effect'],actor);
  }
});
afterEach(()=>db.close());
function seedInventory(): void {
  createVocabularySense({senseId:'size',wordId:'word',description:{label:'make an image or object larger'}},actor);
  createVocabularySense({senseId:'effect',wordId:'word',description:{label:'amplify an effect or significance'}},actor);
  establishVocabularySenseCatalog('word',getVocabularySenseCatalog('word').version,actor);
}
function job(kind:VocabularyReflectionJob['kind']='exercise_improvement'):VocabularyReflectionJob {
  db.prepare('UPDATE vocabulary_reflection_jobs SET kind=? WHERE job_id=?').run(kind,'job');
  return {jobId:'job',caseId:'case',learnerId:'learner',kind,attemptNumber:1,leaseToken:'lease',leaseExpiresAt:'2026-10-20T00:00:00.000Z',evidence:{caseId:'case',completionId:'completion',learnerId:'learner',kind,wordId:'word',contentId:'original',status:'open',createdAt:at,
    evidence:[{encounterId:'encounter',wordId:'word',workNumber:1,presentedActionId:'presented',presentedAt:at,mode:'practice',snapshot:{contentId:'original',contentVersion:1,kind:'production',role:'general',body:{prompt:'请把这张照片____后再打印。'},assessment:{acceptedAnswers:['放大']}},responses:[],effectiveResponses:[],feedback:[],effectiveFeedback:[],skipped:false,presentationUndone:false}]}};
}
function addPronunciationEncounter(input:VocabularyReflectionJob):void {
  const encounter=structuredClone(input.evidence.evidence[0]!);
  encounter.encounterId='pronunciation-private-marker';
  encounter.snapshot.body={prompt:'pronunciation-private-marker'};
  encounter.responses=[{protocolVersion:1,actionId:'pronunciation-private-marker',clientActionId:'pronunciation-private-marker',sequence:3,occurredAt:at,kind:'response',payload:{encounterId:encounter.encounterId,response:'放大',outcome:'rejected',selfAssessment:'rejected'}}];
  encounter.effectiveResponses=[...encounter.responses];
  encounter.feedback=[{protocolVersion:1,actionId:'private-comment',clientActionId:'private-comment',sequence:4,occurredAt:at,kind:'feedback',payload:{encounterId:encounter.encounterId,feedback:'comment',comment:'pronunciation-private-marker'}}];
  encounter.effectiveFeedback=[...encounter.feedback];
  input.evidence.evidence.unshift(encounter);
}
const readiness:VocabularySenseEnsurer=async()=>({catalog:getVocabularySenseCatalog('word'),senses:getVocabularySenses('word'),source:'existing'});
function provider(reply:(request:ProviderRunRequest,index:number)=>unknown|Promise<unknown>,options:{ensureDefaults?:typeof ensureVocabularyDefaultUsefulSelection;ensureSenses?:VocabularySenseEnsurer;ledger?:boolean;adapterId?:string}={}) {
  const requests:ProviderRunRequest[]=[];
  const adapter:ProviderAdapter={id:options.adapterId??'fake',defaultBaseUrl:'https://unused.invalid',apiKeyEnvironmentVariable:'KEY',structuredOutputMode:'json_schema',async run(request){
    requests.push(request);const canonical=getVocabularySenses('word').filter(sense=>sense.status==='active');
    let value=await reply(request,requests.length);
    // Test scenarios describe canonical domain outcomes; the fake model emits
    // only the call-local references actually present on its wire input.
    const wire=JSON.parse(request.userPrompt),stage=request.provenance?.stepName;
    if(stage==='sense_mapping'){
      const mapping=value as {senseIds:string[]};
      const aliases=new Map(canonical.map((sense,index)=>[sense.senseId,wire.senses[index]?.senseId]));
      value={...mapping,senseIds:mapping.senseIds.map(id=>aliases.get(id)??id)};
    } else if(stage==='repertoire'){
      const output=value as {exercises:Array<{sourceUseId:string|null}>};
      const aliases=new Map(wire.content.uses.map((use:{id:string;label:string})=>{
        const sense=canonical.find(sense=>typeof sense.description==='string'?sense.description===use.label:
          sense.description&&typeof sense.description==='object'&&!Array.isArray(sense.description)&&sense.description.label===use.label);
        return [sense?.senseId,use.id];
      }));
      value={...output,exercises:output.exercises.map(exercise=>({...exercise,sourceUseId:exercise.sourceUseId===null?null:aliases.get(exercise.sourceUseId)??exercise.sourceUseId}))};
    }
    const invocationId=options.ledger?`invocation-${requests.length}`:null;
    if(invocationId)db.prepare("INSERT INTO model_invocations(id,actor_kind,actor_id,learner_id,status) VALUES (?,'service','vocabulary-reflection',NULL,'completed')").run(invocationId);
    return {provider:'fake',model:'fake',responseId:null,structuredOutputMode:'json_schema',rawText:JSON.stringify(value),finishReason:'stop',rawResponse:null,usage:{inputTokens:null,cachedInputTokens:null,cacheWriteInputTokens:null,outputTokens:null,reasoningTokens:null,totalTokens:null},invocationId};
  }};
  return {requests,provider:createVocabularyReflectionProvider({random:()=>0,environment:{OPENAI_API_KEY:'fake'},adapter,ensureSenses:options.ensureSenses??readiness,ensureDefaults:options.ensureDefaults})};
}
const single={outcome:'single_sense',rationale:'Photo enlargement is the intended use, though direction is missing.',senseIds:['size']};
const repair={summary:'Make the intended direction explicit.',source:{decision:'revise',prompt:'Make this image larger before printing it.'},sharedExercise:null,additionalExercises:[]};
// Select fixture provenance before creating content; model stubs never mutate
// a source or its retained revision to force a routing comparison.
const bootstrapTest=(name:string,fn:TestFn):Promise<void>=>test(`[bootstrap] ${name}`,fn);
// Jobs admitted before defaults were established can finish their retained route.
function retainBootstrapRoute(source:VocabularyContent=original): void {
  const catalog=getVocabularySenseCatalog('word');
  const senses=getVocabularySenses('word').filter(sense=>sense.status==='active');
  const input=JSON.stringify({contract:'deterministic-repertoire-bootstrap-v1',sourceContent:source,catalog,senses});
  const hash=createHash('sha256').update(input).digest('hex');
  const mapping={outcome:'repertoire_bootstrap',rationale:'Continue the retained fallback bootstrap.',senseIds:[],
    generationScope:null,observedMapping:{senseId:null,establishedAt:null},mappingTimestamp:at};
  db.prepare('INSERT INTO vocabulary_improvement_stages VALUES (?,?,?,?,?,NULL,?)').run('job','sense_mapping',hash,input,JSON.stringify(mapping),at);
}
const repertoire={exercises:[
  {id:'anchor',sourceUseId:'size',stimulus:{kind:'direct_text',text:'Make the image larger.'},teachingNote:'Image size.'},
  {id:'effect',sourceUseId:'effect',stimulus:{kind:'direct_text',text:'Make a small problem seem much more significant.'},teachingNote:null},
  {id:'cloze',sourceUseId:'size',stimulus:{kind:'phrase_cloze',frame:'Enlarge the image.',text:'这张图太小了，请把它____一点。'},teachingNote:'Natural size request.'},
]};

bootstrapTest('existing practice outside useful defaults leaves fallback for operator review',async()=>{
  writeVocabularyDefaultUsefulSenses('word',1,['size'],actor);
  createVocabularyContent({...original,contentId:'outside-defaults',body:{prompt:'Exaggerate the problem.'},
    words:[{wordId:'word',relation:'target',senseId:'effect',senseMappingEstablishedAt:at}]},actor);
  const trial=provider(()=>assert.fail('Fallback review should make no provider calls'));
  const result=await trial.provider.run(job());
  if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.equal(result.result.admission?.outcome,'needs_repertoire');
  assert.deepEqual(result.result.admission?.generationScope?.senseIds,['size']);
  assert.equal(result.result.proposal,null);
  assert.equal(trial.requests.length,0);
});

bootstrapTest('fresh inventory carries newly saved defaults straight into first repertoire generation',async()=>{
  const trial=provider(()=>({exercises:[repertoire.exercises[0]]}),{ensureSenses:async()=>{
    assert.deepEqual(getVocabularySenses('word'),[]);
    seedInventory();
    writeVocabularyDefaultUsefulSenses('word',0,['size'],actor);
    return {...await readiness('word',{workflowId:'job'}),source:'generated'};
  }});
  const result=await trial.provider.run(job());
  if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.deepEqual(trial.requests.map(request=>request.provenance!.stepName),['repertoire']);
  assert.equal(JSON.parse(trial.requests[0]!.userPrompt).content.uses.length,1);
  assert.equal(result.result.admission?.outcome,'repertoire_bootstrap');
  assert.deepEqual(result.result.admission?.generationScope?.senseIds,['size']);
  assert.deepEqual(result.result.proposal?.operations.map(op=>[op.strategy,op.content.words[0]!.senseId]),[['replace','size']]);
});

for (const empty of [false,true]) bootstrapTest(`operator generation adds selected practice without retiring fallback (empty=${empty})`,async()=>{
  writeVocabularyDefaultUsefulSenses('word',1,['size'],actor);
  createVocabularyContent({...original,contentId:'outside-defaults',body:{prompt:'Exaggerate the problem.'},
    words:[{wordId:'word',relation:'target',senseId:'effect',senseMappingEstablishedAt:at}]},actor);
  const scope={selectionEstablished:true,senseIds:['size'],source:{kind:'review_override' as const,caseId:'case',capturedVersion:1}};
  captureVocabularyRepertoireSelection('job',{wordId:'word',catalogVersion:getVocabularySenseCatalog('word').version,generationScope:scope});
  db.prepare("UPDATE vocabulary_reflection_jobs SET model_choice='openai:gpt-6-sol-high' WHERE job_id='job'").run();
  const trial=provider(()=>({exercises:empty?[]:[repertoire.exercises[0]]}));
  const result=await trial.provider.run(job());
  if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.equal(trial.requests.length,1);
  assert.equal(trial.requests[0]!.model,'gpt-6-sol');
  assert.deepEqual(JSON.parse(trial.requests[0].userPrompt).content.uses.map((use:{label:string})=>use.label),['make an image or object larger']);
  assert.equal(result.result.admission?.outcome,'selected_repertoire');
  assert.deepEqual(result.result.admission?.generationScope,scope);
  if(empty)assert.equal(result.result.proposal,null);
  else assert.deepEqual(result.result.proposal?.operations.map(op=>[op.strategy,op.content.words[0].senseId]),[['create','size']]);
  assert.equal(getVocabularyContentForMaintenance('original')?.availability,'active');
  assert.equal(getVocabularyContentForMaintenance('outside-defaults')?.availability,'active');
});

// Most provider scenarios supply evidence directly on the job. Persist it here
// to exercise the admission guard's canonical-case and historical-source lookup.
for(const sourceState of ['current','revised','retired'] as const)test(`persisted case lineage ${sourceState==='current'?'admits current':'rejects '+sourceState} source before provider work`,async()=>{
  const input=job();
  for(const caseId of ['case','canonical-case'])db.prepare('INSERT INTO reflection_cases VALUES (?,?,?,?)')
    .run(caseId,'exercise_improvement','word',JSON.stringify(caseId==='canonical-case'?input.evidence.evidence:[]));
  db.prepare('INSERT INTO vocabulary_case_lineage VALUES (?,?)').run('case','canonical-case');
  db.prepare('UPDATE vocabulary_reflection_jobs SET review_case_id=? WHERE job_id=?').run('canonical-case','job');
  if(sourceState!=='current')updateVocabularyContent('original',original.version,{
    ...original,...(sourceState==='retired'?{availability:'retired' as const}:{body:{prompt:'A revised source.'}}),
  },actor);
  const trial=provider((_request,index)=>index===1?single:repair);
  if(sourceState==='current'){
    assert.equal((await trial.provider.run(input)).kind,'exercise_improvement');
    assert.equal(trial.requests.length,2);
  }else{
    await assert.rejects(()=>trial.provider.run(input),VocabularyReflectionSourceConflict);
    assert.equal(trial.requests.length,0);
    assert.equal(db.prepare('SELECT count(*) n FROM vocabulary_improvement_stages').get()!.n,0);
  }
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('improvement receives effective learner reactions and comments while mapping remains authored-content only',async()=>{
  const input=job(),encounter=input.evidence.evidence[0]!;
  const reactions:VocabularyReactionAction[]=[
    {protocolVersion:1,actionId:'negative',clientActionId:'negative',sequence:1,occurredAt:at,kind:'feedback',payload:{encounterId:'encounter',feedback:'negative'}},
    {protocolVersion:1,actionId:'comment',clientActionId:'comment',sequence:2,occurredAt:at,kind:'feedback',payload:{encounterId:'encounter',feedback:'comment',comment:'This assumes printing experience I do not have.'}},
    {protocolVersion:1,actionId:'withdrawn',clientActionId:'withdrawn',sequence:3,occurredAt:at,kind:'feedback',payload:{encounterId:'encounter',feedback:'withdrawn'}},
  ];
  encounter.feedback=reactions;encounter.effectiveFeedback=effectiveVocabularyReactions(reactions);
  const trial=provider((_request,index)=>index===1?single:repair);
  await trial.provider.run(input);
  const mapping=JSON.parse(trial.requests[0]!.userPrompt);
  assert.equal(mapping.encounters,undefined);assert.equal(mapping.evidence,undefined);
  const projected=JSON.parse(trial.requests[1]!.userPrompt).encounters[0];
  assert.deepEqual(projected.reactions,[{reaction:'comment',comment:reactions[1]!.payload.comment}]);
  assert.equal(projected.feedback,undefined);
  assert.equal(encounter.feedback.length,3); // Historical wire evidence is unchanged.
  assert.equal(trial.requests[1]!.provenance!.inputProjectionVersion,'vocabulary-exercise-authoring.v3');
});

test('single sense admission preserves target, supplies sense context, and reuses both completed stages on retry',async()=>{
  const trial=provider((request,index)=>index===1?single:repair,{ledger:true});
  const result=await trial.provider.run(job());assert.equal(result.kind,'exercise_improvement');if(result.kind!=='exercise_improvement')return;
  assert.equal(result.result.admission?.outcome,'single_sense');assert.equal(trial.requests.length,2);
  const mappingInput=JSON.parse(trial.requests[0]!.userPrompt);
  assert.deepEqual(mappingInput.word,{wordId:'word',hanzi:'放大',traditional:null,pinyin:'fang4 da4',meaning:'enlarge; amplify'});
  assert.deepEqual(mappingInput.senses.map((sense:{senseId:string})=>sense.senseId).sort(),['s1','s2']);
  assert.equal(mappingInput.encounters,undefined);
  assert.equal(trial.requests[0]!.model,'gpt-6-luna');
  const input=JSON.parse(trial.requests[1]!.userPrompt);assert.deepEqual(input.intendedSense,{description:{label:'make an image or object larger'}});assert.equal(input.senses,undefined);
  assert.match(trial.requests[1]!.systemPrompt,/# Review a Mandarin production exercise/);
  assert.deepEqual(trial.requests.map(request=>request.provenance?.stepName),['sense_mapping','single_improvement']);
  assert.ok(trial.requests.every(request=>request.reasoningEffort==='high'));
  assert.deepEqual(getVocabularyContentForMaintenance('original'),original);
  assert.equal(getVocabularyContentForMaintenance('original')!.version,1);
  assert.equal(result.result.proposal!.operations[0]!.content.words[0]!.senseId,'size');
  assert.equal(db.prepare('SELECT count(*) n FROM content_items').get()!.n,1);
  const replay=await trial.provider.run({...job(),attemptNumber:2});assert.deepEqual(replay,result);assert.equal(trial.requests.length,2);
  assert.equal(db.prepare('SELECT count(*) n FROM vocabulary_improvement_stages').get()!.n,2);
  assert.equal(db.prepare('SELECT count(*) n FROM invocation_content_links').get()!.n,2);
  assert.equal(db.prepare('SELECT count(*) n FROM invocation_sense_links').get()!.n,3);
  assert.deepEqual(db.prepare("SELECT sense_id FROM invocation_sense_links WHERE invocation_id='invocation-1' ORDER BY sense_id").all().map(row=>row.sense_id),['effect','size']);
  assert.deepEqual(db.prepare("SELECT sense_id FROM invocation_sense_links WHERE invocation_id='invocation-2' ORDER BY sense_id").all().map(row=>row.sense_id),['size']);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('sense mapping stays on GPT-6 Luna across invalid-output retry while repair keeps the job model',async()=>{
  db.prepare("UPDATE vocabulary_reflection_jobs SET model_choice='openai:gpt-6-sol-high' WHERE job_id='job'").run();
  const trial=provider((_request,index)=>index===1?{...single,senseIds:['foreign']}:index===2?single:repair);
  await assert.rejects(()=>trial.provider.run(job()),/Improvement stage failed strict output schema/);
  assert.equal(getVocabularyContentForMaintenance('original')!.words[0]!.senseId,null);
  await trial.provider.run({...job(),attemptNumber:2});
  assert.deepEqual(trial.requests.map(request=>[request.provenance!.stepName,request.model]),[
    ['sense_mapping','gpt-6-luna'],['sense_mapping','gpt-6-luna'],['single_improvement','gpt-6-sol'],
  ]);
  const stored=JSON.parse(String(db.prepare("SELECT input_json FROM vocabulary_improvement_stages WHERE stage='sense_mapping'").get()!.input_json));
  assert.equal(stored.contract.model,'gpt-6-luna');
  assert.equal(stored.contract.reasoningEffort,'high');
});

test('mapping provider failures propagate without fallback or retained mapping evidence',async()=>{
  db.prepare("UPDATE vocabulary_reflection_jobs SET model_choice='openai:gpt-6-sol-high' WHERE job_id='job'").run();
  const trial=provider(()=>{throw new Error('Provider rejected model');});
  for(const attemptNumber of [1,2])await assert.rejects(()=>trial.provider.run({...job(),attemptNumber}),/Provider rejected model/);
  assert.deepEqual(trial.requests.map(request=>request.model),['gpt-6-luna','gpt-6-luna']);
  assert.equal(db.prepare('SELECT count(*) n FROM vocabulary_improvement_stages').get()!.n,0);
});

bootstrapTest('retained fallback bootstrap proposes one source replacement plus additions, preserving unrelated cues',async()=>{
  retainBootstrapRoute();
  createVocabularyContent({...original,contentId:'other'},actor);
  const trial=provider((_request,index)=>repertoire);
  const result=await trial.provider.run(job());if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.deepEqual(result.result.proposal!.operations.map(op=>op.strategy),['replace','create','create']);
  assert.deepEqual(result.result.proposal!.operations.map(op=>op.content.words[0]!.senseId),['size','effect','size']);
  assert.equal(getVocabularyContentForMaintenance('other')!.availability,'active');
  assert.equal(getVocabularyContentForMaintenance('original')!.availability,'active');
  assert.equal(getVocabularyContentForMaintenance('original')!.words[0]!.senseId,null);
  assert.equal(db.prepare('SELECT count(*) n FROM content_items').get()!.n,2);
  assert.equal(trial.requests[0]!.provenance!.stepName,'repertoire');
  assert.deepEqual(result.result.admission!.senseIds,[]);
  assert.deepEqual(trial.requests.map(request=>request.provenance!.promptVersion),['v5.1']);
  for(const [index,op] of result.result.proposal!.operations.entries()){
    const authored=repertoire.exercises[index]!;
    const body=op.content.body as {prompt:string;instruction:string;stimulus:unknown;reveal?:unknown;source:{kind:string;assessedContentId:string}};
    assert.deepEqual(body.reveal,{teachingNote:authored.teachingNote});
    assert.deepEqual(body.stimulus,authored.stimulus);
    assert.equal(body.prompt,authored.stimulus.kind==='phrase_cloze'?`${authored.stimulus.frame}\n${authored.stimulus.text}`:authored.stimulus.text);
    assert.equal(body.instruction,'');assert.equal(body.source.kind,'vocabulary_repertoire');assert.equal(body.source.assessedContentId,'original');
    assert.deepEqual(op.content.answers,original.answers);assert.equal(op.content.accessScope,'shared');
  }
});
for(const outcome of ['inventory_gap','unmappable'] as const)test(`${outcome} records an attention outcome without repair, repertoire, or sense mutation`,async()=>{
  const trial=provider(()=>({outcome,rationale:'No defensible mapping in this inventory.',senseIds:[]}));
  const before=getVocabularySenses('word');const result=await trial.provider.run(job());
  if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.equal(result.result.admission!.outcome,outcome);assert.equal(result.result.proposal,null);assert.equal(trial.requests.length,1);
  assert.deepEqual(getVocabularySenses('word'),before);assert.equal(getVocabularyContentForMaintenance('original')!.words[0]!.senseId,null);
});

test('invented sense references are rejected before mapping or downstream calls',async()=>{
  const trial=provider(()=>({...single,senseIds:['invented']}));await assert.rejects(()=>trial.provider.run(job()),/strict output schema/);
  assert.equal(trial.requests.length,1);assert.equal(db.prepare('SELECT count(*) n FROM vocabulary_improvement_stages').get()!.n,0);
});

test('source edits during mapping fence stage publication and all later work',async()=>{
  const trial=provider(()=>{updateVocabularyContent('original',1,{...original,body:{prompt:'A newly edited cue'}},actor);return single;});
  await assert.rejects(()=>trial.provider.run(job()),/source, mapping, or sense catalog changed/);
  assert.equal(trial.requests.length,1);assert.equal(db.prepare('SELECT count(*) n FROM vocabulary_improvement_stages').get()!.n,0);
});

test('sense catalog edits during mapping cannot publish stale admission',async()=>{
  const trial=provider(()=>{updateVocabularySense('size',1,{description:'new description',status:'active'},actor);return single;});
  await assert.rejects(()=>trial.provider.run(job()),/sense catalog changed/);assert.equal(trial.requests.length,1);
});

test('maintenance loss during a model call prevents stage and mapping writes',async()=>{
  let allowed=true;const trial=provider(()=>{allowed=false;return single;});
  await assert.rejects(()=>trial.provider.run(job(),{canPublish:()=>allowed}),/publication authority/);
  assert.equal(db.prepare('SELECT count(*) n FROM vocabulary_improvement_stages').get()!.n,0);
  assert.equal(getVocabularyContentForMaintenance('original')!.words[0]!.senseId,null);
});

test('successful mapping survives a later provider failure, while operator remapping blocks reuse',async()=>{
  const trial=provider((_request,index)=>{if(index===1)return single;if(index===2)throw new Error('provider failed');return repair;});
  await assert.rejects(()=>trial.provider.run(job()),/provider failed/);
  assert.equal(db.prepare('SELECT count(*) n FROM vocabulary_improvement_stages').get()!.n,1);
  await trial.provider.run({...job(),attemptNumber:2});assert.equal(trial.requests.length,3);
  const mapping=getVocabularyContentForMaintenance('original')!.words[0]!;
  mapVocabularyContentSense({contentId:'original',wordId:'word',expectedContentVersion:1,expectedMapping:{senseId:mapping.senseId??null,establishedAt:mapping.senseMappingEstablishedAt??null},senseId:'effect'},actor);
  await assert.rejects(()=>trial.provider.run({...job(),attemptNumber:3}),/changed since the retained/);assert.equal(trial.requests.length,3);
});

bootstrapTest('repertoire cannot leak accepted answers',async()=>{
  retainBootstrapRoute();
  const trial=provider((_request,index)=>({...repertoire,exercises:repertoire.exercises.map(exercise=>({...exercise,stimulus:{kind:'direct_text',text:'Use 放大 here.'}}))}));
  await assert.rejects(()=>trial.provider.run(job()),/exposes.*answer/);
  assert.equal(db.prepare('SELECT count(*) n FROM vocabulary_improvement_stages').get()!.n,2);
});

const pureExplanation={diagnosis:'The submitted expression does not fit this shared task.',decision:'explanation_only',reason:'does_not_fit',addedWordIds:[],prompt:null,teachingNote:null};
function pureCueJob(wordAssociated=false):VocabularyReflectionJob {
  secondWord();
  createVocabularyContent({...original,contentId:'pure-cue',exerciseType:'pure_cue',
    body:{prompt:'Increase the visible size.',reveal:{axisNote:'Visible enlargement',teachingNote:'Use a suitable enlargement expression.'}},
    words:[{wordId:'word',relation:'target'},{wordId:'other-word',relation:'target'}],
    answers:[{wordId:'word',acceptedForms:['放大']},{wordId:'other-word',acceptedForms:['扩大']}]},actor);
  const input=job();input.evidence.contentId='pure-cue';input.evidence.wordId=wordAssociated?'word':null;
  const encounter=input.evidence.evidence[0]!;encounter.wordId=wordAssociated?'word':null;
  encounter.snapshot={...encounter.snapshot,contentId:'pure-cue',schedulingScope:'pure_cue',body:{prompt:'Increase the visible size.'},assessment:{acceptedAnswers:['放大','扩大']}};
  return input;
}

test('learner feedback bypasses sense readiness and admission',async()=>{
  const ensureSenses:VocabularySenseEnsurer=async()=>{throw new Error('Unexpected sense dependency');};
  const feedback=provider(()=>({diagnosis:'No answer submitted.',lesson:'A useful explanation.',unfairEncounterIds:[]}),{ensureSenses});
  const input=job('learner_feedback');addPronunciationEncounter(input);
  assert.equal((await feedback.provider.run(input)).kind,'learner_feedback');
  assert.equal(feedback.requests[0]!.userPrompt.includes('pronunciation-private-marker'),false);
  assert.equal(feedback.requests.length,1);
  assert.equal(db.prepare('SELECT count(*) n FROM vocabulary_improvement_stages').get()!.n,0);
});

for(const wordAssociated of [false,true])test(`pure-cue dedicated review supplies all lexical members without individual repertoire (word-associated=${wordAssociated})`,async()=>{
  const input=pureCueJob(wordAssociated);addPronunciationEncounter(input);
  const ensureSenses:VocabularySenseEnsurer=async()=>{throw new Error('Unexpected sense dependency');};
  const trial=provider(()=>pureExplanation,{ensureSenses});
  const result=await trial.provider.run(input);if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.equal(result.result.proposal,null);
  assert.equal(result.result.admission,undefined);
  assert.equal(trial.requests.length,1);
  assert.equal(trial.requests[0]!.provenance!.stepName,'pure_cue_improvement');
  const projected=JSON.parse(trial.requests[0]!.userPrompt);
  assert.equal(trial.requests[0]!.userPrompt.includes('pronunciation-private-marker'),false);
  assert.equal(projected.evidence.encounters.length,1);
  assert.deepEqual(projected.currentMembers.map((word:{wordId:string})=>word.wordId).sort(),['other-word','word']);
  assert.deepEqual(projected.evidence.words.map((word:{wordId:string})=>word.wordId).sort(),['other-word','word']);
  assert.deepEqual(projected.evidence.subject,{kind:'pureCue',contentId:'pure-cue'});
  assert.deepEqual(Object.keys(projected).sort(),['currentMembers','evidence','responseCandidates','sourceContent']);
  assert.equal(projected.sourceContent.exerciseType,'pure_cue');
  assert.equal(db.prepare('SELECT count(*) n FROM vocabulary_improvement_stages').get()!.n,0);
  assert.equal(getVocabularyContentForMaintenance('original')!.words[0]!.senseId,null);
});

test('recognition and contrast return without any provider or sense calls',async()=>{
  const ensureSenses:VocabularySenseEnsurer=async()=>{throw new Error('Unexpected sense dependency');};
  for(const variant of ['recognition','contrast'] as const) {
    const contentId=`source-${variant}`;
    const candidate=createVocabularyContent({...original,contentId,skill:variant==='contrast'?'contextual_selection':'recognition',exerciseType:'word'},actor);
    const input=job();input.evidence.contentId=contentId;
    input.evidence.evidence[0]!.snapshot={...input.evidence.evidence[0]!.snapshot,contentId,kind:variant};
    const trial=provider(()=>{throw new Error('Unexpected provider call');},{ensureSenses});
    const result=await trial.provider.run(input);if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
    assert.equal(result.result.proposal,null);assert.equal(trial.requests.length,0);
    assert.equal(candidate.words[0]!.senseId,null);
  }
});

test('unknown production improvement contracts reject before provider and sense calls',async()=>{
  const ensureSenses:VocabularySenseEnsurer=async()=>{throw new Error('Unexpected sense dependency');};
  secondWord();
  createVocabularyContent({...original,contentId:'multi-word',words:[{wordId:'word',relation:'target'},{wordId:'other-word',relation:'target'}],answers:[{wordId:'word',acceptedForms:['放大']},{wordId:'other-word',acceptedForms:['扩大']}]},actor);
  const withoutTarget=job();withoutTarget.evidence.wordId=null;withoutTarget.evidence.evidence[0]!.wordId=null;
  const multiWord=job();multiWord.evidence.contentId='multi-word';multiWord.evidence.evidence[0]!.snapshot.contentId='multi-word';
  for(const input of [withoutTarget,multiWord]){
    const trial=provider(()=>{throw new Error('Unexpected provider call');},{ensureSenses});
    await assert.rejects(()=>trial.provider.run(input),/no supported improvement contract/);
    assert.equal(trial.requests.length,0);
  }
});

test('cache identity retains actual prompts and schema and separates provider configurations',async()=>{
  const first=provider((_request,index)=>index===1?single:repair);
  await first.provider.run(job());
  const stored=JSON.parse(String(db.prepare("SELECT input_json FROM vocabulary_improvement_stages WHERE stage='sense_mapping'").get()!.input_json));
  assert.equal(stored.contract.systemPrompt,first.requests[0]!.systemPrompt);
  assert.deepEqual(stored.contract.schema,first.requests[0]!.outputSchema);
  assert.equal(stored.contract.model,first.requests[0]!.model);
  const changed=provider((_request,index)=>index===1?single:repair,{adapterId:'changed-provider'});
  await changed.provider.run({...job(),attemptNumber:2});assert.equal(changed.requests.length,2);
  assert.equal(db.prepare('SELECT count(*) n FROM vocabulary_improvement_stages').get()!.n,4);
});

for(const invalid of ['foreign-sense'] as const)bootstrapTest(`repertoire rejects ${invalid}`,async()=>{
  retainBootstrapRoute();
  const exercises=repertoire.exercises.map(exercise=>({...exercise,sourceUseId:'unknown'}));
  const trial=provider((_request,index)=>({...repertoire,exercises}));
  await assert.rejects(()=>trial.provider.run(job()),/output schema/);
  assert.equal(db.prepare('SELECT count(*) n FROM vocabulary_improvement_stages').get()!.n,2);
});

bootstrapTest('fallback replacement uses the inventory without mapping or preserving every old gloss',async()=>{
  createVocabularyContent({...original,contentId:'list',body:{prompt:'enlarge an image; amplify significance; a specialist gloss absent from the inventory',source:{kind:'dictionary_baseline'}}},actor);
  const input=job();input.evidence.contentId='list';input.evidence.evidence[0]!.snapshot.contentId='list';
  retainBootstrapRoute(getVocabularyContentForMaintenance('list')!);
  const exercises=repertoire.exercises.filter(exercise=>exercise.sourceUseId==='size');
  const trial=provider((_request,index)=>({...repertoire,exercises}));
  const result=await trial.provider.run(input);
  if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.equal(result.result.admission!.outcome,'repertoire_bootstrap');
  assert.deepEqual(result.result.admission!.senseIds,[]);
  assert.deepEqual(result.result.proposal!.operations.map(op=>op.strategy),['replace','create']);
  assert.ok(result.result.proposal!.operations.every(op=>op.content.words[0]!.senseId==='size'));
  assert.equal(getVocabularyContentForMaintenance('list')!.words[0]!.senseId,null);
  const generatedInput=JSON.parse(trial.requests[0]!.userPrompt);
  assert.equal(generatedInput.role,'general_exercises');
  assert.equal(generatedInput.admission,undefined);
  assert.equal(generatedInput.content.uses.length,2);
  assert.equal(trial.requests.length,1);
});

for(const outcome of ['laundry_list','inventory_gap','unmappable'] as const)test(`${outcome} rejects unnecessary sense associations`,async()=>{
  const trial=provider(()=>({outcome,rationale:'Inspect the cue.',senseIds:['size','effect']}));
  await assert.rejects(()=>trial.provider.run(job()),/Invalid mapping outcome|strict output schema/);
  assert.equal(trial.requests.length,1);
  assert.equal(getVocabularyContentForMaintenance('original')!.words[0]!.senseId,null);
});

const sharedExercise={answers:['target','response_1'],prompt:'Make the displayed area larger.',rationale:'Both may fulfill this shared task.'};
const referral={candidateWords:['放大','扩大'],sharedPurpose:sharedExercise.rationale,rationale:sharedExercise.rationale,draft:{prompt:sharedExercise.prompt}};
function secondWord(){db.exec("INSERT INTO lexical_words VALUES ('other-word','扩大',NULL,'kuo4 da4','expand')");}
const createPromotion={decision:'create',rationale:'A shared enlargement task.',existingContentId:null,prompt:'Make the visible size larger.',teachingNote:'Both expressions can describe enlarging a visible area.',semanticAxis:'Increase visible size.'};

for(const localRepair of [false,true])test(`referral composes with local repair=${localRepair}; promotion caches and never publishes`,async()=>{
  secondWord();
  const input=job();input.evidence.evidence[0]!.responses=[{protocolVersion:1,actionId:'answer',clientActionId:'answer',sequence:2,occurredAt:at,kind:'response',payload:{encounterId:'encounter',outcome:'rejected',response:'扩大'}}];
  addPronunciationEncounter(input);
  const source = localRepair
    ? { decision: 'revise', prompt: '先____这张图，再检查放大后的效果。' }
    : { decision: 'keep', prompt: null };
  const candidate = localRepair ? { ...sharedExercise, prompt: '把图上的区域____一点，再比较放大前后的效果。' } : sharedExercise;
  const final = localRepair ? { ...createPromotion, prompt: '____图上的区域，再检查放大后的效果。' } : createPromotion;
  const trial=provider(request=>request.provenance!.stepName==='sense_mapping'?single:request.provenance!.stepName==='single_improvement'
    ?{...repair,source,sharedExercise:candidate}:final,{ledger:true});
  const result=await trial.provider.run(input);if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.deepEqual(trial.requests.map(request=>request.provenance!.stepName),['sense_mapping','single_improvement','pure_cue_promotion']);
  assert.ok(trial.requests.every(request=>!request.userPrompt.includes('pronunciation-private-marker')));
  assert.deepEqual(result.result.pureCueReferral,{...referral,draft:{prompt:candidate.prompt}});
  assert.equal(result.result.pureCuePromotion!.outcome,'create');
  const operations = result.result.proposal!.operations;
  assert.equal(operations.length,localRepair?2:1);
  if (localRepair) assert.equal((operations[0]!.content.body as {prompt:string}).prompt,source.prompt);
  assert.equal((operations.at(-1)!.content.body as {prompt:string}).prompt,final.prompt);
  assert.equal(db.prepare('SELECT count(*) n FROM content_items').get()!.n,1);
  const promotionInput=JSON.parse(trial.requests[2]!.userPrompt);
  assert.equal(promotionInput.evidence.encounters[0].responses[0].response,'扩大');
  assert.match(promotionInput.intendedSense.senseId,/^s[12]$/);assert.equal(promotionInput.sourceContent.contentId,'original');
  assert.deepEqual(promotionInput.candidates.map((word:{wordId:string})=>word.wordId),['word','other-word']);
  assert.equal(trial.requests[1]!.provenance!.promptVersion,'7');assert.equal(trial.requests[1]!.provenance!.schemaVersion,'5');
  assert.match(trial.requests[1]!.systemPrompt,/# Review a Mandarin production exercise/);
  assert.doesNotMatch(trial.requests[1]!.systemPrompt,/## Learner feedback and proposal rationales/);
  assert.equal(trial.requests[2]!.provenance!.promptVersion,'3');assert.equal(trial.requests[2]!.provenance!.schemaVersion,'4');
  const replay=await trial.provider.run({...input,attemptNumber:2});assert.deepEqual(replay,result);assert.equal(trial.requests.length,3);
  assert.equal(db.prepare("SELECT count(*) n FROM vocabulary_improvement_stages WHERE stage='pure_cue_promotion'").get()!.n,1);
});

test('missing response remains evidence while source repair is actionable',async()=>{
  const trial=provider(request=>{
    if(request.provenance!.stepName==='sense_mapping')return single;
    const wire=JSON.parse(request.userPrompt);
    assert.equal(wire.words[1].lexical,null);
    assert.equal(wire.encounters[0].responses[0].response,'扩大');
    return repair;
  });
  const result=await trial.provider.run(submittedJob());if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.equal(result.result.proposal!.operations[0]!.strategy,'update_existing');
  assert.equal(result.result.pendingPlan,undefined);assert.equal(result.result.pureCuePromotion,undefined);
  assert.equal(trial.requests.length,2);
});

test('shared authoring rejects a missing response identity before caching',async()=>{
  const trial=provider(request=>request.provenance!.stepName==='sense_mapping'?single:{...repair,sharedExercise});
  await assert.rejects(()=>trial.provider.run(submittedJob()),/Shared exercise requires supplied unambiguous words/);
  assert.equal(db.prepare("SELECT count(*) n FROM vocabulary_improvement_stages WHERE stage='single_improvement'").get()!.n,0);
});

test('ambiguous response pauses before authoring and the selected identity reaches shared integration',async()=>{
  db.exec("INSERT INTO lexical_words VALUES ('a','扩大',NULL,'a','expand'),('b','扩大',NULL,'b','broaden')");
  const input=submittedJob();
  const trial=provider(request=>request.provenance!.stepName==='sense_mapping'?single:request.provenance!.stepName==='single_improvement'?{...repair,sharedExercise}:createPromotion);
  const pending=await trial.provider.run(input);if(pending.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.equal(pending.result.proposal,null);assert.equal(trial.requests.length,1);
  const options=pending.result.responseIdentityOptions!;
  assert.deepEqual(options.map(option=>[option.form,option.choices.map(word=>word.wordId)]),[['扩大',['a','b']]]);
  input.responseIdentitySelection={options,selections:{'扩大':'b'}};
  const result=await trial.provider.run({...input,attemptNumber:2});if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.equal(JSON.parse(trial.requests[1]!.userPrompt).words[1].lexical.pinyin,'b');
  assert.deepEqual(JSON.parse(trial.requests[2]!.userPrompt).candidates.map((word:{wordId:string})=>word.wordId),['word','b']);
  assert.equal(result.result.pureCuePromotion!.outcome,'create');
});
test('a newly ambiguous second response re-presents all ambiguous identities',async()=>{
  db.exec("INSERT INTO lexical_words VALUES ('a','扩大',NULL,'a','expand'),('b','扩大',NULL,'b','broaden'),('c','增加',NULL,'c','increase')");
  const input=submittedJob();
  input.evidence.evidence[0]!.responses.push({protocolVersion:1,actionId:'answer-two',clientActionId:'answer-two',sequence:3,occurredAt:at,kind:'response',payload:{encounterId:'encounter',outcome:'rejected',response:'增加'}});
  const trial=provider(()=>single);
  const first=await trial.provider.run(input);if(first.kind!=='exercise_improvement')assert.fail('Expected improvement');
  input.responseIdentitySelection={options:first.result.responseIdentityOptions!,selections:{'扩大':'a'}};
  db.exec("INSERT INTO lexical_words VALUES ('d','增加',NULL,'d','additional')");
  const next=await trial.provider.run({...input,attemptNumber:2});if(next.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.deepEqual(next.result.responseIdentityOptions!.map(option=>option.form),['扩大','增加']);
  assert.equal(trial.requests.length,1);
});

test('candidate and integration stages retain prior-contract evidence without consuming it on retry',async()=>{
  secondWord();
  for(const stage of ['single_improvement','pure_cue_promotion'])db.prepare('INSERT INTO vocabulary_improvement_stages VALUES (?,?,?,?,?,?,?)')
    .run('job',stage,'old-contract',JSON.stringify({contract:{promptVersion:stage==='single_improvement'?'5':'1'}}),JSON.stringify({obsolete:true}),null,at);
  const trial=provider(request=>request.provenance!.stepName==='sense_mapping'?single:request.provenance!.stepName==='single_improvement'?{...repair,sharedExercise}:createPromotion);
  const input=submittedJob(),result=await trial.provider.run(input);
  assert.deepEqual(await trial.provider.run({...input,attemptNumber:2}),result);assert.equal(trial.requests.length,3);
  for(const stage of ['single_improvement','pure_cue_promotion']){
    assert.equal(db.prepare('SELECT count(*) n FROM vocabulary_improvement_stages WHERE stage=?').get(stage)!.n,2);
    assert.equal(db.prepare("SELECT result_json FROM vocabulary_improvement_stages WHERE stage=? AND input_hash='old-contract'").get(stage)!.result_json,'{"obsolete":true}');
  }
});

test('promotion failure retries only promotion and fences loss of publication authority',async()=>{
  secondWord();let allowed=true;
  const trial=provider(request=>{
    if(request.provenance!.stepName==='sense_mapping')return single;
    if(request.provenance!.stepName==='single_improvement')return {...repair,sharedExercise};
    allowed=false;return createPromotion;
  });
  await assert.rejects(()=>trial.provider.run(submittedJob(),{canPublish:()=>allowed}),/publication authority/);
  assert.equal(db.prepare('SELECT count(*) n FROM vocabulary_improvement_stages').get()!.n,2);
  const retry=provider(()=>createPromotion);const result=await retry.provider.run({...submittedJob(),attemptNumber:2});
  assert.equal(retry.requests.length,1);assert.equal(retry.requests[0]!.provenance!.stepName,'pure_cue_promotion');assert.equal(result.kind,'exercise_improvement');
});

test('promotion migration retains stage evidence and immutability while admitting the new stage',()=>{
  const migrationDb=new DatabaseSync(':memory:');
  try{
    migrationDb.exec(`PRAGMA foreign_keys=ON;CREATE TABLE vocabulary_reflection_jobs(job_id TEXT PRIMARY KEY);INSERT INTO vocabulary_reflection_jobs VALUES ('job');CREATE TABLE model_invocations(id TEXT PRIMARY KEY);`);
    migrationDb.exec(readFileSync(new URL('../server/db/migrations/0050_vocabulary_improvement_admission.sql',import.meta.url),'utf8'));
    migrationDb.prepare('INSERT INTO vocabulary_improvement_stages VALUES (?,?,?,?,?,?,?)').run('job','single_improvement','old','{}','{"diagnosis":"retained"}',null,at);
    migrationDb.exec(readFileSync(new URL('../server/db/migrations/0051_vocabulary_pure_cue_promotion.sql',import.meta.url),'utf8'));
    assert.equal(migrationDb.prepare('SELECT result_json FROM vocabulary_improvement_stages').get()!.result_json,'{"diagnosis":"retained"}');
    migrationDb.prepare('INSERT INTO vocabulary_improvement_stages VALUES (?,?,?,?,?,?,?)').run('job','pure_cue_promotion','new','{}','{}',null,at);
    assert.throws(()=>migrationDb.exec("UPDATE vocabulary_improvement_stages SET result_json='{}'"),/immutable/);
    assert.throws(()=>migrationDb.exec('DELETE FROM vocabulary_improvement_stages'),/retained/);
    assert.deepEqual(migrationDb.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{migrationDb.close();}
});

for (const spend of [0.1, 100]) {
  test(`internal content improvement runs all stages with inherited learner context and $${spend} recorded spend`,async()=>{
    db.prepare(`INSERT INTO model_invocations(id,actor_kind,actor_id,status,spend_usd,requesting_learner_id,timestamp,invocation_type)
      VALUES ('historical','service','vocabulary-reflection','completed',?,'learner',?,'vocabulary_reflection_improvement')`)
      .run(spend,new Date().toISOString());
    const trial=provider((_request,index)=>index===1?single:repair);
    const result=await runWithLearnerId('learner',()=>trial.provider.run(job()));
    assert.equal(result.kind,'exercise_improvement');
    if(result.kind!=='exercise_improvement')return;
    assert.equal(result.result.admission?.outcome,'single_sense');
    assert.equal(result.result.proposal?.operations.length,1);
    assert.equal(trial.requests.length,2);
    assert.deepEqual(trial.requests.map(request=>request.provenance?.stepName),['sense_mapping','single_improvement']);
    assert.ok(trial.requests.every(request=>request.invocationActor?.kind==='service'));
    assert.equal(db.prepare("SELECT spend_usd FROM model_invocations WHERE id='historical'").get()!.spend_usd,spend);
  });
}

bootstrapTest('automatic Luna reflection uses the same general authoring brief as preparation',async()=>{
  for(const senseId of ['size','effect'])updateVocabularySense(senseId,1,{status:'active',description:{label:senseId,notes:[],examples:[{text:'把图片放大。',translation:'Enlarge the image.',pronunciation:null}]}},actor);
  retainBootstrapRoute();
  const trial=provider((_request,index)=>repertoire);
  await trial.provider.run(job());
  const reflected=trial.requests[0]!;
  let sent:{messages:Array<{content:string}>;response_format:{json_schema:{name:string;schema:unknown}}}|undefined;
  const preparation=createVocabularyPracticeProvider({environment:{OPENAI_API_KEY:'fake'},fetchImplementation:(async(_url,init)=>{
    sent=JSON.parse(String(init?.body));
    const uses=JSON.parse(sent!.messages[1]!.content).content.uses as Array<{id:string;label:string}>;
    const output={exercises:repertoire.exercises.map(exercise=>({...exercise,sourceUseId:uses.find(use=>use.label===exercise.sourceUseId)!.id}))};
    return new Response(JSON.stringify({id:'response',choices:[{message:{content:JSON.stringify(output)},finish_reason:'stop'}]}),{status:200,headers:{'content-type':'application/json'}});
  })as typeof fetch});
  const source=JSON.parse(reflected.userPrompt).content as Pick<WordContentDocument,'word'|'uses'|'examples'>;
  const document:WordContentDocument={schemaVersion:1,id:'ordinary-bootstrap',...source};
  await preparation.generate(document,{workflowId:'parity',onInvocation:()=>{}});
  assert.ok(sent);
  assert.equal(sent.messages[0]!.content,reflected.systemPrompt);
  const ordinary=JSON.parse(sent.messages[1]!.content),reflection=JSON.parse(reflected.userPrompt);
  assert.equal(ordinary.role,reflection.role);
  assert.deepEqual({word:ordinary.content.word,uses:ordinary.content.uses,examples:ordinary.content.examples},reflection.content);
  assert.equal(sent.response_format.json_schema.name,reflected.outputSchemaName);
  assert.deepEqual(sent.response_format.json_schema.schema,reflected.outputSchema);
  assert.equal(reflected.model,'gpt-6-luna');assert.equal(reflected.reasoningEffort,'high');
  assert.equal(db.prepare('SELECT model_choice FROM vocabulary_reflection_jobs WHERE job_id=?').get('job')!.model_choice,'openai:gpt-6-luna-high');
  assert.equal(reflected.provenance!.promptName,'vocabulary-general-exercises');
  assert.equal(reflected.provenance!.promptVersion,'v5.1');
});

bootstrapTest('a single mapped repertoire exercise preserves private publication scope and answers',async()=>{
  createVocabularyContent({...original,contentId:'private-source',accessScope:'private',ownerLearnerId:'learner'},actor);
  const input=job();input.evidence.contentId='private-source';input.evidence.evidence[0]!.snapshot.contentId='private-source';
  retainBootstrapRoute(getVocabularyContentForMaintenance('private-source')!);
  const trial=provider((_request,index)=>({exercises:[{...repertoire.exercises[0],sourceUseId:'size'}]}));
  const result=await trial.provider.run(input);if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  const operations=result.result.proposal!.operations;assert.equal(operations.length,1);
  assert.deepEqual(operations[0]!.scope,{kind:'learner',learnerId:'learner'});
  assert.equal(operations[0]!.content.accessScope,'private');assert.equal(operations[0]!.content.ownerLearnerId,'learner');
  assert.equal(operations[0]!.content.words[0]!.senseId,'size');
  assert.equal(typeof operations[0]!.content.words[0]!.senseMappingEstablishedAt,'string');
  assert.deepEqual(operations[0]!.content.answers,original.answers);
  assert.equal(db.prepare('SELECT count(*) n FROM content_items').get()!.n,2);
});

for(const malformed of ['missing-blank','duplicate-id'] as const)bootstrapTest(`repertoire shared validation rejects ${malformed}`,async()=>{
  retainBootstrapRoute();
  const exercises=structuredClone(repertoire.exercises);
  if(malformed==='duplicate-id')exercises[1]!.id=exercises[0]!.id;
  else exercises[2]!.stimulus={kind:'phrase_cloze',frame:'Enlarge the image.',text:'这张图太小了。'};
  const trial=provider(()=>({exercises}));
  await assert.rejects(()=>trial.provider.run(job()),/blank|duplicate/i);
  assert.equal(db.prepare("SELECT count(*) n FROM vocabulary_improvement_stages WHERE stage='repertoire'").get()!.n,0);
});

for(const change of ['source','catalog','authority'] as const)bootstrapTest(`repertoire publication fences ${change} changes during generation`,async()=>{
  retainBootstrapRoute();
  let allowed=true;
  const trial=provider((_request,index)=>{
    if(change==='source')updateVocabularyContent('original',1,{...original,body:{prompt:'Edited by operator'}},actor);
    if(change==='catalog')updateVocabularySense('size',1,{description:{label:'Changed meaning',notes:[]},status:'active'},actor);
    if(change==='authority')allowed=false;
    return repertoire;
  });
  await assert.rejects(()=>trial.provider.run(job(),{canPublish:()=>allowed}),/changed|publication authority/);
  assert.equal(db.prepare("SELECT count(*) n FROM vocabulary_improvement_stages WHERE stage='repertoire'").get()!.n,0);
});

bootstrapTest('repertoire retries reuse exact new-contract output and retain old-contract evidence without consuming it',async()=>{
  retainBootstrapRoute();
  db.prepare('INSERT INTO vocabulary_improvement_stages VALUES (?,?,?,?,?,?,?)').run('job','repertoire','old-contract',JSON.stringify({contract:{promptName:'vocabulary-reflection-repertoire',promptVersion:'2'}}),JSON.stringify({obsolete:true}),null,at);
  const trial=provider((_request,index)=>repertoire,{ledger:true});
  const result=await trial.provider.run(job());
  const replay=await trial.provider.run({...job(),attemptNumber:2});
  assert.deepEqual(replay,result);assert.equal(trial.requests.length,1);
  assert.equal(db.prepare("SELECT count(*) n FROM vocabulary_improvement_stages WHERE stage='repertoire'").get()!.n,2);
  const retained=JSON.parse(String(db.prepare("SELECT input_json FROM vocabulary_improvement_stages WHERE stage='repertoire' AND input_hash!='old-contract'").get()!.input_json));
  assert.equal(retained.contract.systemPrompt,trial.requests[0]!.systemPrompt);
  assert.deepEqual(retained.contract.schema,trial.requests[0]!.outputSchema);
  assert.equal(db.prepare("SELECT count(*) n FROM invocation_content_links WHERE invocation_id='invocation-1'").get()!.n,1);
  assert.equal(db.prepare("SELECT count(*) n FROM invocation_sense_links WHERE invocation_id='invocation-1'").get()!.n,2);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('reassessment freshly maps current content and retains historical encounters',async()=>{
  const first=provider((_request,index)=>index===1?single:repair);
  await first.provider.run(job());
  const current=getVocabularyContentForMaintenance('original')!;
  const {version,createdAt,updatedAt,...draft}=current;
  const revised=updateVocabularyContent('original',version,{...draft,body:{prompt:'An updated source.'}},actor);
  db.prepare('INSERT INTO vocabulary_reflection_jobs(job_id,kind,model_choice) VALUES (?,?,?)').run('reassessment','exercise_improvement','openai:gpt-6-sol-high');
  const again=provider((_request,index)=>index===1?single:repair);
  const result=await again.provider.run({...job(),jobId:'reassessment',caseId:'new-case',reassessmentSourceJobId:'job',reassessmentSource:revised});
  assert.equal(result.kind,'exercise_improvement');
  assert.deepEqual(again.requests.map(request=>request.provenance!.stepName),['sense_mapping','single_improvement']);
  const input=JSON.parse(again.requests[1]!.userPrompt);
  assert.equal(input.encounters.length,job().evidence.evidence.length);
  assert.equal(input.assessmentOrigin,'operator_reassessment; encounters retain their historical served cues');
  assert.equal(input.source.prompt,'An updated source.');assert.equal(input.encounters[0].prompt,'请把这张照片____后再打印。');
  if(result.kind==='exercise_improvement')assert.deepEqual(result.result.proposal!.bases,[{contentId:'original',expectedVersion:2}]);
});

test('reassessment runs fresh mapping even when source version is unchanged and catalog changed',async()=>{
  await provider((_request,index)=>index===1?single:repair).provider.run(job());
  db.prepare('INSERT INTO vocabulary_reflection_jobs(job_id,kind,model_choice) VALUES (?,?,?)').run('reassessment','exercise_improvement','openai:gpt-6-sol-high');
  createVocabularySense({senseId:'new-sense',wordId:'word',description:{label:'a new meaning'}},actor);
  const again=provider((_request,index)=>index===1?single:repair);
  await again.provider.run({...job(),jobId:'reassessment',reassessmentSourceJobId:'job',reassessmentSource:getVocabularyContentForMaintenance('original')!});
  assert.equal(again.requests.length,2);
});

test('reassessment rejects a version race before any provider call',async()=>{
  const {version,createdAt,updatedAt,...draft}=original;
  updateVocabularyContent('original',version,{...draft,body:{prompt:'New version.'}},actor);
  const again=provider(()=>single);
  await assert.rejects(()=>again.provider.run({...job(),reassessmentSourceJobId:'old',reassessmentSource:original}),VocabularyReflectionSourceConflict);
  assert.equal(again.requests.length,0);
});

test('mapped canonical sense improves independently of serving exclusions',async()=>{
  const {writeVocabularyWordSenseCoverage}=await import('../server/db/vocabulary-sense-coverage.ts');
  writeVocabularyWordSenseCoverage('word',1,['size'],actor);
  const trial=provider((_request,index)=>index===1?single:repair),result=await trial.provider.run(job());
  if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.equal(result.result.admission?.outcome,'single_sense');assert.ok(result.result.proposal);
  assert.deepEqual(result.result.admission?.generationScope,{selectionEstablished:true,senseIds:['size'],source:{kind:'mapped_source'}});
  assert.equal(trial.requests.length,2);
  assert.equal(JSON.parse(trial.requests[0]!.userPrompt).senses.length,2);
  for(const request of trial.requests)assert.equal(Object.hasOwn(JSON.parse(request.userPrompt),'coverage'),false);
  const retained=JSON.parse(String(db.prepare("SELECT input_json FROM vocabulary_improvement_stages WHERE stage='sense_mapping'").get()!.input_json));
  assert.equal(Object.hasOwn(retained.input,'coverage'),false);
  assert.equal(retained.normalizationVersion,'canonical-generation-scope-v1');
});
for(const during of ['mapping','improvement'] as const)test(`serving-policy change during ${during} does not invalidate mapped-sense work`,async()=>{
  const {writeVocabularyWordSenseCoverage}=await import('../server/db/vocabulary-sense-coverage.ts');
  const trial=provider((_request,index)=>{
    if(index===(during==='mapping'?1:2))writeVocabularyWordSenseCoverage('word',1,['size'],actor);
    return index===1?single:repair;
  });
  const result=await trial.provider.run(job());if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.ok(result.result.proposal);assert.equal(trial.requests.length,2);
  assert.equal(db.prepare('SELECT count(*) n FROM vocabulary_improvement_stages').get()!.n,2);
  assert.deepEqual(result.result.admission?.generationScope?.senseIds,['size']);
});

for(const failFirst of [false,true])bootstrapTest(`repertoire scope survives policy changes and retry (first call fails=${failFirst})`,async()=>{
  retainBootstrapRoute();
  const {writeVocabularyWordSenseCoverage}=await import('../server/db/vocabulary-sense-coverage.ts');
  const trial=provider((_request,index)=>{
    if(index===1){writeVocabularyWordSenseCoverage('word',1,['effect'],actor);if(failFirst)throw new Error('Provider failed');}
    return repertoire;
  });
  if(failFirst)await assert.rejects(()=>trial.provider.run(job()),/Provider failed/);
  else await trial.provider.run(job());
  const result=await trial.provider.run({...job(),attemptNumber:2});if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.deepEqual(result.result.admission?.generationScope,{selectionEstablished:true,senseIds:['effect','size'],source:{kind:'word_defaults',wordId:'word',capturedVersion:1}});
  assert.equal(trial.requests.length,failFirst?2:1);
  for(const request of trial.requests)assert.deepEqual(JSON.parse(request.userPrompt).content.uses.map((use:{id:string})=>use.id).sort(),['s1','s2']);
  assert.equal(getVocabularyContentForMaintenance('original')!.availability,'active');
});

bootstrapTest('explicit empty repertoire invocation is no-action and never retires source',async()=>{
  const {writeVocabularyWordSenseCoverage}=await import('../server/db/vocabulary-sense-coverage.ts');
  writeVocabularyWordSenseCoverage('word',1,['size','effect'],actor);
  const trial=provider(()=>{throw new Error('No model call expected');}),result=await trial.provider.run(job());if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.equal(result.result.admission?.outcome,'no_senses_requested');assert.equal(result.result.proposal,null);
  assert.deepEqual(result.result.admission?.generationScope?.senseIds,[]);assert.equal(trial.requests.length,0);
  assert.equal(getVocabularyContentForMaintenance('original')!.availability,'active');
});

bootstrapTest('historical review coverage cannot override word defaults for repertoire generation',async()=>{
  retainBootstrapRoute();
  const {writeVocabularyWordSenseCoverage}=await import('../server/db/vocabulary-sense-coverage.ts');
  db.prepare('INSERT INTO reflection_cases(case_id,kind,word_id,evidence_snapshot_json) VALUES (?,?,?,?)')
    .run('case','exercise_improvement','word',JSON.stringify(job().evidence.evidence));
  db.prepare('INSERT INTO vocabulary_case_sense_coverage VALUES (?,?,?,?)').run('case',1,JSON.stringify(['effect']),at);
  writeVocabularyWordSenseCoverage('word',1,['effect'],actor);
  const trial=provider(()=>({exercises:repertoire.exercises.filter(exercise=>exercise.sourceUseId==='size')}));
  const result=await trial.provider.run(job());if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.deepEqual(result.result.admission?.generationScope,{selectionEstablished:true,senseIds:['size'],source:{kind:'word_defaults',wordId:'word',capturedVersion:2}});
});


test('unknown default usefulness does not block explicitly mapped single-sense improvement',async()=>{
  db.exec('UPDATE vocabulary_word_sense_coverage SET default_useful_sense_ids_json=NULL');
  const trial=provider((_request,index)=>index===1?single:repair),result=await trial.provider.run(job());
  if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.equal(result.result.admission?.outcome,'single_sense');assert.ok(result.result.proposal);assert.equal(trial.requests.length,2);
});

bootstrapTest('unknown default usefulness makes fallback generation an explicit attention finding',async()=>{
  db.exec('UPDATE vocabulary_word_sense_coverage SET default_useful_sense_ids_json=NULL');
  const trial=provider(()=>{throw new Error('No model call expected');}),result=await trial.provider.run(job());
  if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.equal(result.result.admission?.outcome,'needs_coverage');assert.equal(result.result.proposal,null);assert.equal(trial.requests.length,0);
  assert.equal(result.result.admission?.generationScope?.selectionEstablished,false);
});


bootstrapTest('repertoire waits for useful initialization without a mapping call or losing its retained route',async()=>{
  db.exec('UPDATE vocabulary_word_sense_coverage SET default_useful_sense_ids_json=NULL');
  let initializations=0;
  const trial=provider((_request,index)=>repertoire,{ledger:true,ensureDefaults:async()=>{
    initializations++;if(initializations===1)throw new VocabularySenseReadinessPending('2026-10-29T01:00:00.000Z');
    writeVocabularyDefaultUsefulSenses('word',1,['size','effect'],actor);
    const {getVocabularyWordSenseCoverage}=await import('../server/db/vocabulary-sense-coverage.ts');return getVocabularyWordSenseCoverage('word');
  }});
  await assert.rejects(trial.provider.run(job()),VocabularySenseReadinessPending);assert.equal(trial.requests.length,0);
  assert.equal(db.prepare("SELECT count(*) n FROM model_invocations").get()!.n,0);
  const result=await trial.provider.run({...job(),attemptNumber:2});if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.ok(result.result.proposal);assert.equal(trial.requests.length,1);assert.equal(initializations,2);
  assert.deepEqual(result.result.admission?.generationScope?.senseIds,['effect','size']);
});

const retirement={decision:'retire',prompt:null};
test('single assessment proposes exercise retirement without changing selected senses or live content',async()=>{
  const {resolveVocabularySenseCoverage}=await import('../server/db/vocabulary-sense-coverage.ts');
  const before=resolveVocabularySenseCoverage('word');
  const trial=provider((_request,index)=>index===1?single:{...repair,summary:'Exercise-level mismatch, not a coverage decision.',source:retirement});
  const result=await trial.provider.run(job());if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  const operation=result.result.proposal!.operations[0]!;
  assert.equal(operation.strategy,'retire');assert.equal(operation.content.contentId,'original');
  assert.deepEqual(operation.content.body,original.body);assert.deepEqual(operation.content.words,original.words);
  assert.equal(getVocabularyContentForMaintenance('original')!.availability,'active');
  assert.deepEqual(resolveVocabularySenseCoverage('word'),before);
  assert.deepEqual(await trial.provider.run({...job(),attemptNumber:2}),result);assert.equal(trial.requests.length,2);
});

for(const invalid of ['replacement-prompt','changed-source','changed-answers','sense-exclusion'] as const)test(`single retirement rejects ${invalid}`,async()=>{
  const modified={...retirement,...(invalid==='replacement-prompt'?{prompt:'A replacement draft.'}:invalid==='changed-source'?{sourceContentId:'foreign'}:invalid==='changed-answers'?{acceptedAnswers:['扩大']}:{decision:'exclude_sense'})};
  const trial=provider((_request,index)=>index===1?single:{...repair,summary:'Retire',source:modified});
  await assert.rejects(()=>trial.provider.run(job()),invalid==='replacement-prompt'?/cannot carry a revised prompt/:/strict output schema/);
});

test('source retirement may coexist with optional target enrichment mapped to the source sense',async()=>{
  const trial=provider((_request,index)=>index===1?single:{...repair,summary:'Retire the source and offer another useful example.',source:retirement,
    additionalExercises:[{answer:'target',role:'enrichment',prompt:'Make the map larger so the street names are readable.',rationale:'Practise enlargement in another setting.'}]});
  const result=await trial.provider.run(job());if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.deepEqual(result.result.proposal!.operations.map(operation=>operation.strategy),['retire','create']);
  assert.equal(result.result.proposal!.operations[1]!.learningRole,'enrichment');
  const mapping=result.result.admission!.sourceMapping!;
  assert.deepEqual(mapping,{senseId:null,establishedAt:null});
  const addedWord=result.result.proposal!.operations[1]!.content.words[0]!;assert.equal(addedWord.senseId,'size');assert.ok(addedWord.senseMappingEstablishedAt);
  const addedBody=result.result.proposal!.operations[1]!.content.body as {prompt:string;instruction:string;reveal?:unknown;stimulus:unknown};
  assert.equal(addedBody.prompt,'Make the map larger so the street names are readable.');
  assert.equal(addedBody.instruction,'');assert.equal(addedBody.reveal,undefined);
  assert.deepEqual(addedBody.stimulus,{kind:'direct_text',text:addedBody.prompt});
  assert.equal(getVocabularyContentForMaintenance('original')!.availability,'active');
});

test('retirement can retain an independent shared-practice referral',async()=>{
  secondWord();
  const trial=provider(request=>request.provenance!.stepName==='sense_mapping'?single:request.provenance!.stepName==='single_improvement'
    ?{...repair,summary:'Poor source; a distinct shared task merits assessment.',source:retirement,sharedExercise}
    :createPromotion);
  const result=await trial.provider.run(submittedJob());if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.deepEqual(result.result.proposal!.operations.map(operation=>operation.strategy),['retire','create']);
  assert.equal(result.result.pureCuePromotion!.outcome,'create');
});

bootstrapTest('empty faithful repertoire proposes only source retirement and preserves selected coverage',async()=>{
  retainBootstrapRoute();
  const {resolveVocabularySenseCoverage}=await import('../server/db/vocabulary-sense-coverage.ts');
  const before=resolveVocabularySenseCoverage('word');
  const trial=provider((_request,index)=>({exercises:[]}));
  const result=await trial.provider.run(job());if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.deepEqual(result.result.proposal!.operations.map(operation=>operation.strategy),['retire']);
  assert.deepEqual(result.result.proposal!.operations[0]!.content.body,original.body);
  assert.match(String(result.result.diagnosis),/without changing the selected sense coverage/);
  assert.match(String(result.result.diagnosis),/0 other active general production exercises existed.*Retiring this source would leave none/);
  assert.deepEqual(resolveVocabularySenseCoverage('word'),before);
  assert.equal(getVocabularyContentForMaintenance('original')!.availability,'active');
});

test('selected specialized use reaches faithful authoring without model coverage authority',async()=>{
  updateVocabularySense('effect',1,{description:{label:'specialized technical amplification',notes:['Intentionally selected for a professional interest.']},status:'active'},actor);
  writeVocabularyDefaultUsefulSenses('word',1,['size'],actor);
  const trial=provider((_request,index)=>index===1?{...single,senseIds:['effect']}:repair);
  const result=await trial.provider.run(job());if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.equal(JSON.parse(trial.requests[1]!.userPrompt).intendedSense.description.label,'specialized technical amplification');
  assert.deepEqual(result.result.proposal!.operations.map(operation=>operation.strategy),['update_existing']);
  assert.deepEqual((await import('../server/db/vocabulary-sense-coverage.ts')).resolveVocabularySenseCoverage('word').includedSenseIds,['size']);
  assert.deepEqual(result.result.admission?.generationScope,{selectionEstablished:true,senseIds:['effect'],source:{kind:'mapped_source'}});
});

for(const reassessment of [false,true])test(`valid retirement output stays completed when ${reassessment?'reassessment':'encounter'} source changes during the call`,async()=>{
  const input={...job(),...(reassessment?{reassessmentSource:original,reassessmentSourceJobId:'prior'}:{})};
  const trial=provider((_request,index)=>{
    if(index===1)return single;
    updateVocabularyContent('original',1,{...getVocabularyContentForMaintenance('original')!,body:{prompt:'A concurrent editorial change.'}},actor);
    return {...repair,summary:'No faithful useful repair is apparent.',source:retirement};
  },{ledger:true});
  await assert.rejects(()=>trial.provider.run(input),/source, mapping, or sense catalog changed/);
  assert.equal(db.prepare("SELECT status FROM model_invocations WHERE id='invocation-2'").get()!.status,'completed');
  assert.equal(db.prepare("SELECT count(*) n FROM vocabulary_improvement_stages WHERE stage='single_improvement'").get()!.n,0);
  assert.equal(getVocabularyContentForMaintenance('original')!.version,2);
  assert.equal(getVocabularyContentForMaintenance('original')!.availability,'active');
});

bootstrapTest('empty repertoire reports other active production content in the same publication scope',async()=>{
  retainBootstrapRoute();
  if(original.kind!=='exercise')assert.fail('Expected exercise fixture');
  createVocabularyContent({...original,contentId:'other'},actor);
  createVocabularyContent({...original,contentId:'private',accessScope:'private',ownerLearnerId:'learner'},actor);
  createVocabularyContent({...original,contentId:'recognition',skill:'recognition'},actor);
  const trial=provider((_request,index)=>({exercises:[]}));
  const result=await trial.provider.run(job());if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.match(String(result.result.diagnosis),/1 other active general production exercise existed.*same publication scope/);
  assert.doesNotMatch(String(result.result.diagnosis),/would leave none/);
  assert.match(String(result.result.diagnosis),/contract provides no explanatory rationale/);
});

for(const outcome of ['single_sense','repertoire_bootstrap'])(outcome==='single_sense'?test:bootstrapTest)(`actual UUIDs stay canonical behind ${outcome} call-local references`,async()=>{
  const size='fb57f552-2ef8-4df3-b2a9-701e0cb0e732',effect='9fef2d9f-eb72-4137-9219-c7fbf70b6dca';
  for(const id of ['size','effect'])updateVocabularySense(id,1,{description:id,status:'retired'},actor);
  createVocabularySense({senseId:size,wordId:'word',description:{label:'image enlargement',notes:[],examples:[{text:'把图片放大。',translation:'Enlarge the image.',pronunciation:null}]}},actor);
  createVocabularySense({senseId:effect,wordId:'word',description:{label:'amplify an effect'}},actor);
  writeVocabularyDefaultUsefulSenses('word',1,[size,effect],actor);
  if(outcome==='repertoire_bootstrap')retainBootstrapRoute();
  const trial=provider((_request,index)=>outcome==='single_sense'?(index===1?{...single,senseIds:[size]}:repair):{exercises:[{...repertoire.exercises[0],sourceUseId:size}]});
  const result=await trial.provider.run(job());if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  for(const request of trial.requests){
    assert.ok(!request.userPrompt.includes(size));assert.ok(!request.userPrompt.includes(effect));
    assert.ok(!JSON.stringify(request.outputSchema).includes(size));assert.ok(!JSON.stringify(request.outputSchema).includes(effect));
  }
  assert.equal(result.result.proposal!.operations[0]!.content.words[0]!.senseId,size);
  assert.ok(result.result.admission!.generationScope!.senseIds.includes(size));
  const retained=db.prepare("SELECT input_json,result_json FROM vocabulary_improvement_stages WHERE stage='sense_mapping' ORDER BY recorded_at LIMIT 1").get()!;
  assert.match(String(retained.input_json),new RegExp(size));
  if(outcome==='single_sense')assert.match(String(retained.result_json),new RegExp(size));
});

test('mapper rejects unlisted call-local IDs and records invalid output without inventing canonical identities',async()=>{
  const trial=provider(()=>({...single,senseIds:['s99']}),{ledger:true});
  await assert.rejects(()=>trial.provider.run(job()),/strict output schema/);
  assert.equal(db.prepare("SELECT status FROM model_invocations WHERE id='invocation-1'").get()!.status,'invalid_response');
  assert.equal(getVocabularyContentForMaintenance('original')!.words[0]!.senseId,null);
});


bootstrapTest('new repertoire items reject missing sense binding instead of inventing one',async()=>{
  retainBootstrapRoute();
  const trial=provider((_request,index)=>({exercises:[{...repertoire.exercises[0],sourceUseId:null}]}));
  await assert.rejects(()=>trial.provider.run(job()),/strict output schema/);
  assert.equal(getVocabularyContentForMaintenance('original')!.availability,'active');
  assert.equal(db.prepare("SELECT count(*) n FROM vocabulary_improvement_stages WHERE stage='repertoire'").get()!.n,0);
});

function resolvedPromotionJob(authored=false):VocabularyReflectionJob {
  db.prepare('INSERT INTO lexical_words VALUES (?,?,?,?,?)').run('other','扩大',null,'kuo4 da4','expand');
  const referral={candidateWords:['放大','扩大'],sharedPurpose:'Increase size',rationale:'Shared expressive task',
    ...(authored?{draft:{prompt:'A historical shared enlargement cue.',teachingNote:'Retained historical teaching.',semanticAxis:'Enlargement'}}:{})};
  const resolution={actorId:'editor',recordedAt:at,sourceJobId:'parent',original,
    admission:{outcome:'single_sense',rationale:'Size',wordId:'word',sourceContentId:'original',sourceContentVersion:original.version,catalogVersion:getVocabularySenseCatalog('word').version,senseIds:['size'],sourceMapping:{senseId:null,establishedAt:null}},
    diagnosis:'Retained local diagnosis',referral,...(authored?{responseCandidateSnapshots:[],localPlan:{rationale:'Retained local source plan',bases:[{contentId:'original',expectedVersion:1}],operations:[{operationKey:'local-retirement',strategy:'retire',sourceContentId:'original',expectedVersion:1,scope:{kind:'shared'},rationale:'Shared practice replaces the source.',content:original}]}}:{}),selections:{'放大':'word','扩大':'other'},candidates:db.prepare("SELECT id AS wordId,hanzi,traditional,pinyin,meaning FROM lexical_words WHERE id IN ('word','other') ORDER BY CASE id WHEN 'word' THEN 0 ELSE 1 END").all()};
  db.prepare("INSERT INTO vocabulary_improvement_stages VALUES (?,'pure_cue_promotion',?,?,?,NULL,?)").run('job','operator-pure-cue-resolution-v1','{}',JSON.stringify(resolution),at);
  return {...job(),reassessmentSourceJobId:'parent',reassessmentSource:original};
}
const promotionReply={decision:'create',rationale:'Shared task fits',existingContentId:null,prompt:'Increase the size or extent.',semanticAxis:'Size increase',teachingNote:'Both express making something larger.',memberWordIds:['word','other']};
test('resolved identity continuation calls only promotion, preserves evidence and records input provenance',async()=>{
  const input=resolvedPromotionJob();
  const trial=provider(request=>{
    assert.equal(request.provenance?.stepName,'pure_cue_promotion');
    const wire=JSON.parse(request.userPrompt);
    assert.equal(wire.localAssessment,'Retained local diagnosis');assert.equal(wire.evidence.encounters.length,1);
    assert.deepEqual(wire.candidates.map((word:{wordId:string})=>word.wordId),['word','other']);
    return promotionReply;
  },{ledger:true,ensureSenses:async()=>{throw new Error('Continuation must not rerun sense admission');}});
  const result=await trial.provider.run(input);
  assert.equal(trial.requests.length,1);assert.equal(result.kind,'exercise_improvement');
  if(result.kind!=='exercise_improvement')assert.fail();
  assert.equal(result.result.proposal?.operations.length,1);assert.equal(result.result.proposal.operations[0]!.operationKey,'pure-cue-promotion');
  assert.equal(result.result.pureCuePromotion?.invocationId,'invocation-1');
  assert.equal(db.prepare("SELECT count(*) n FROM invocation_content_links WHERE invocation_id='invocation-1' AND content_id='original' AND role='input'").get()!.n,1);
  assert.equal(getVocabularyContentForMaintenance('original')!.version,1);
  // The durable decision remains reusable after a worker retry; neither local stage runs.
  await trial.provider.run({...input,attemptNumber:2});assert.equal(trial.requests.length,2);
});
test('historical authored identity continuation retains its local plan and uses current integration output',async()=>{
  const input=resolvedPromotionJob(true);
  const trial=provider(request=>{
    assert.equal(request.provenance!.promptName,'vocabulary-reflection-pure-cue-integration');
    assert.equal(request.provenance!.promptVersion,'3');assert.equal(request.provenance!.schemaVersion,'4');
    const wire=JSON.parse(request.userPrompt);
    assert.equal(wire.referral.draft.teachingNote,'Retained historical teaching.');
    assert.equal(wire.localPlan.operations[0].operationKey,'local-retirement');
    return createPromotion;
  },{ensureSenses:async()=>{throw new Error('Saved plan must not rerun admission');}});
  const result=await trial.provider.run(input);if(result.kind!=='exercise_improvement')assert.fail();
  assert.equal(trial.requests.length,1);
  assert.deepEqual(result.result.proposal!.operations.map(operation=>operation.operationKey),['local-retirement','pure-cue-promotion']);
  assert.equal((result.result.proposal!.operations[1]!.content.body as {prompt:string}).prompt,createPromotion.prompt);
  assert.equal(result.result.diagnosis,'Retained local diagnosis');
  assert.equal(getVocabularyContentForMaintenance('original')!.availability,'active');
});
test('current integration refuses a historical wire reply on an authored continuation',async()=>{
  const input=resolvedPromotionJob(true);
  const trial=provider(()=>({decision:'create',rationale:'Old wire result',existingContentId:null,semanticAxis:'Size',teachingNote:null}));
  await assert.rejects(()=>trial.provider.run(input),/strict output schema/);
  assert.equal(getVocabularyContentForMaintenance('original')!.availability,'active');
});

test('resolved identity continuation fences source and dictionary changes before and during its model call',async()=>{
  const input=resolvedPromotionJob();
  const trial=provider(()=>{db.prepare("UPDATE lexical_words SET meaning='new meaning' WHERE id='other'").run();return promotionReply;});
  await assert.rejects(()=>trial.provider.run(input),/identities changed/);
  await assert.rejects(()=>trial.provider.run(input),/Selected lexical identities changed/);
  assert.equal(trial.requests.length,1);
  updateVocabularyContent('original',1,{...original,body:{prompt:'Changed source'}},actor);
  await assert.rejects(()=>trial.provider.run(input),VocabularyReflectionSourceConflict);
  assert.equal(trial.requests.length,1);
});

for(const shape of ['compact_definition','synonymous_glosses'] as const)test(`authored ${shape} stays on local mapping and cannot request repertoire`,async()=>{
  const {version,createdAt,updatedAt,...draft}=original;
  const current=updateVocabularyContent('original',version,{...draft,body:{prompt:shape==='compact_definition'?'enlarge; magnify':'make larger; increase visible size',source:{kind:'authored_prompt'}}},actor);
  const trial=provider((_request,index)=>index===1?single:repair);
  const result=await trial.provider.run({...job(),reassessmentSourceJobId:'prior',reassessmentSource:current});
  assert.equal(result.kind,'exercise_improvement');
  assert.deepEqual(trial.requests.map(request=>request.provenance!.stepName),['sense_mapping','single_improvement']);
  assert.deepEqual(trial.requests[0]!.outputSchema.properties!.outcome.enum,['single_sense','unmappable','inventory_gap']);
});
for(const kind of ['targeted','pure_cue'] as const)bootstrapTest(`current ${kind} practice prevents repeat bootstrap`,async()=>{
  retainBootstrapRoute();
  if(original.kind!=='exercise')assert.fail('Expected exercise');
  createVocabularyContent({...original,contentId:'authored',exerciseType:kind,body:{prompt:'An authored retrieval task.',source:{kind:'authored_prompt'}}},actor);
  const trial=provider(()=>{throw new Error('No provider call expected');});
  const result=await trial.provider.run(job());if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.equal(result.result.admission!.outcome,'already_covered');assert.equal(result.result.proposal,null);assert.equal(trial.requests.length,0);
  assert.equal(getVocabularyContentForMaintenance('original')!.availability,'active');
});
for(const scope of ['other_owner','shared','recognition','retired','teaching','fallback'] as const)bootstrapTest(`${scope} content does not cover a private fallback`,async()=>{
  if(original.kind!=='exercise')assert.fail('Expected exercise');
  db.exec("INSERT INTO learners VALUES ('another')");
  createVocabularyContent({...original,contentId:'private-source',accessScope:'private',ownerLearnerId:'learner'},actor);
  const input=job();input.evidence.contentId='private-source';input.evidence.evidence[0]!.snapshot.contentId='private-source';
  createVocabularyContent({...original,contentId:'other',accessScope:scope==='shared'?'shared':'private',ownerLearnerId:scope==='shared'?null:scope==='other_owner'?'another':'learner',
    availability:scope==='retired'?'retired':'active',exerciseRole:scope==='teaching'?'teaching' as const:'general' as const,skill:scope==='recognition'?'recognition':'production',
    body:{prompt:'Current other content.',source:{kind:scope==='fallback'?'dictionary_baseline':'authored_prompt'}}},actor);
  retainBootstrapRoute(getVocabularyContentForMaintenance('private-source')!);
  const trial=provider(()=>repertoire);const result=await trial.provider.run(input);if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.equal(result.result.admission!.outcome,'repertoire_bootstrap');assert.ok(result.result.proposal);assert.equal(trial.requests.length,1);
});
bootstrapTest('new authored practice during bootstrap fences publication',async()=>{
  retainBootstrapRoute();
  const trial=provider(()=>{createVocabularyContent({...original,contentId:'new-authored',body:{prompt:'New authored retrieval.'}},actor);return repertoire;});
  await assert.rejects(()=>trial.provider.run(job()),/Authored production practice changed/);
  assert.equal(db.prepare("SELECT count(*) n FROM vocabulary_improvement_stages WHERE stage='repertoire'").get()!.n,0);
});
bootstrapTest('retry checks current authored coverage before consuming a retained repertoire',async()=>{
  retainBootstrapRoute();
  const trial=provider(()=>repertoire);await trial.provider.run(job());
  createVocabularyContent({...original,contentId:'new-authored',body:{prompt:'New authored retrieval.'}},actor);
  const result=await trial.provider.run({...job(),attemptNumber:2});if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.equal(result.result.admission!.outcome,'already_covered');assert.equal(result.result.proposal,null);assert.equal(trial.requests.length,1);
});

test('legacy dictionary supplement uses deterministic bootstrap without mapping',async()=>{
  const {version,createdAt,updatedAt,...draft}=original;
  const current=updateVocabularyContent('original',version,{...draft,body:{prompt:'enlarge; amplify',source:{kind:'production_cue_supplement',cueId:null}}},actor);
  retainBootstrapRoute(current);
  const trial=provider(()=>repertoire);
  const result=await trial.provider.run({...job(),reassessmentSourceJobId:'prior',reassessmentSource:current});
  if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.equal(result.result.admission!.outcome,'repertoire_bootstrap');assert.equal(trial.requests.length,1);
  assert.equal(trial.requests[0]!.provenance!.stepName,'repertoire');
});

function submittedJob():VocabularyReflectionJob {
  const input=job();
  const answer={protocolVersion:1 as const,actionId:'answer',clientActionId:'answer',sequence:2,occurredAt:at,kind:'response' as const,
    payload:{encounterId:'encounter',outcome:'rejected' as const,response:'扩大'}};
  input.evidence.evidence[0]!.responses=[answer];input.evidence.evidence[0]!.effectiveResponses=[answer];
  return input;
}
function responseJob():VocabularyReflectionJob {secondWord();return submittedJob();}
const responseExercise={answer:'response_1',role:'enrichment',prompt:'Increase the scope of this project.',rationale:'Practise the response word in its own useful setting.'};
test('single improvement receives exact response identities and can add only response practice',async()=>{
  const input=responseJob(),sourceBefore=getVocabularyContentForMaintenance('original');
  const trial=provider(request=>request.provenance!.stepName==='sense_mapping'?single:{...repair,source:{decision:'keep',prompt:null},additionalExercises:[responseExercise]});
  const result=await trial.provider.run(input);if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.deepEqual(JSON.parse(trial.requests[1]!.userPrompt).words[1],{ref:'response_1',form:'扩大',lexical:{hanzi:'扩大',traditional:null,pinyin:'kuo4 da4',meaning:'expand'},canAuthorIndividual:true});
  assert.equal(result.result.proposal!.operations.length,1);
  const operation=result.result.proposal!.operations[0]!;
  assert.equal(operation.strategy,'create');assert.equal(operation.content.kind,'exercise');
  assert.deepEqual(operation.content.words,[{wordId:'other-word',relation:'target'}]);
  if(operation.content.kind!=='exercise')assert.fail('Expected exercise');
  assert.deepEqual(operation.content.answers,[{wordId:'other-word',acceptedForms:['扩大']}]);
  assert.deepEqual(result.result.proposal!.bases,[{contentId:'original',expectedVersion:1}]);
  assert.equal(getVocabularyContentForMaintenance('original')!.version,sourceBefore!.version);
  assert.deepEqual(getVocabularyContentForMaintenance('original')!.body,sourceBefore!.body);
});
test('alias resolution during authoring cannot silently renumber supplied word references',async()=>{
  const {VocabularyReflectionConflict}=await import('../server/db/vocabulary-reflection.ts');
  db.exec("INSERT INTO lexical_words VALUES ('expanded','扩大','擴大','kuo4 da4','expand'),('homograph','扩大',NULL,'another reading','another sense'),('increased','增加',NULL,'zeng1 jia1','increase')");
  const input=job();
  input.evidence.evidence[0]!.responses=['扩大','擴大','增加'].map((response,index)=>({protocolVersion:1,actionId:`answer-${index}`,clientActionId:`answer-${index}`,sequence:index+1,occurredAt:at,kind:'response',payload:{encounterId:'encounter',outcome:'rejected',response}}));
  const matches=(await import('../server/vocabulary/response-word-matching.ts')).vocabularyResponseWordMatches(input);
  input.responseIdentitySelection={options:[{form:'扩大',choices:matches[0]!.matches}],selections:{'扩大':'expanded'}};
  const trial=provider(request=>{
    if(request.provenance!.stepName==='sense_mapping')return single;
    const wire=JSON.parse(request.userPrompt);
    assert.deepEqual(wire.words.map((word:{ref:string;form:string})=>[word.ref,word.form]),[['target','放大'],['response_1','扩大'],['response_2','增加']]);
    assert.equal(wire.words[1].canAuthorIndividual,true);
    db.exec("DELETE FROM lexical_words WHERE id='homograph'");
    return {...repair,source:{decision:'keep',prompt:null},additionalExercises:[{answer:'response_2',role:'enrichment',prompt:'Broaden the scope of an investigation.',rationale:'Practice the expansion use.'}]};
  },{ledger:true});
  await assert.rejects(()=>trial.provider.run(input),error=>error instanceof VocabularyReflectionConflict&&/dictionary identities changed/.test(error.message));
  assert.equal(db.prepare("SELECT count(*) n FROM vocabulary_improvement_stages WHERE stage='single_improvement'").get()!.n,0);
  assert.equal(db.prepare("SELECT status FROM model_invocations WHERE id='invocation-2'").get()!.status,'completed');
  assert.equal(db.prepare('SELECT count(*) n FROM content_items').get()!.n,1);
});
test('source retirement and response addition remain unchanged when integration authors final shared content',async()=>{
  const input=responseJob();
  const trial=provider(request=>request.provenance!.stepName==='sense_mapping'?single:request.provenance!.stepName==='single_improvement'
    ?{...repair,source:retirement,additionalExercises:[responseExercise],sharedExercise}:createPromotion);
  const result=await trial.provider.run(input);if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.deepEqual(result.result.proposal!.operations.map(operation=>operation.strategy),['retire','create','create']);
  const wire=JSON.parse(trial.requests[2]!.userPrompt);
  assert.deepEqual(wire.localPlan.operations.map((operation:{strategy:string})=>operation.strategy),['retire','create']);
  assert.deepEqual(wire.referral.draft,referral.draft);
  const body=result.result.proposal!.operations[2]!.content.body as {prompt:string;reveal:{axisNote:string;teachingNote:string}};
  assert.equal(body.prompt,createPromotion.prompt);assert.notEqual(body.prompt,referral.draft.prompt);assert.equal(body.reveal.axisNote,createPromotion.semanticAxis);assert.equal(body.reveal.teachingNote,createPromotion.teachingNote);
  assert.deepEqual(result.result.proposal!.operations[1]!.content.words,[{wordId:'other-word',relation:'target'}]);
  assert.equal(getVocabularyContentForMaintenance('original')!.availability,'active');assert.equal(db.prepare('SELECT count(*) n FROM content_items').get()!.n,1);
});
test('existing shared cue reuse still keeps source retirement and both evidence bases',async()=>{
  const input=responseJob();
  createVocabularyContent({...original,contentId:'shared-cue',exerciseType:'pure_cue',body:{prompt:referral.draft.prompt},words:[{wordId:'word',relation:'target'},{wordId:'other-word',relation:'target'}],
    answers:[{wordId:'word',acceptedForms:['放大']},{wordId:'other-word',acceptedForms:['扩大']}]},actor);
  const trial=provider(request=>request.provenance!.stepName==='sense_mapping'?single:request.provenance!.stepName==='single_improvement'
    ?{...repair,source:retirement,sharedExercise}:{decision:'reuse',rationale:'Existing task fits the authored plan.',existingContentId:'shared-cue',prompt:null,teachingNote:null,semanticAxis:null});
  const result=await trial.provider.run(input);if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.equal(result.result.pureCuePromotion!.outcome,'reuse');assert.deepEqual(result.result.proposal!.operations.map(operation=>operation.strategy),['retire']);
  assert.deepEqual(result.result.proposal!.bases,[{contentId:'original',expectedVersion:1},{contentId:'shared-cue',expectedVersion:1}]);
  assert.equal(getVocabularyContentForMaintenance('original')!.availability,'active');
});
for(const invalid of ['unknown-identity','answer-leak','private-comment'] as const)test(`response exercise rejects ${invalid}`,async()=>{
  const input=responseJob();
  if(invalid==='private-comment')input.evidence.evidence[0]!.feedback=[{protocolVersion:1,actionId:'comment',clientActionId:'comment',sequence:3,occurredAt:at,kind:'feedback',payload:{encounterId:'encounter',feedback:'comment',comment:'private family detail'}}];
  const trial=provider(request=>request.provenance!.stepName==='sense_mapping'?single:{...repair,additionalExercises:[{...responseExercise,
    ...(invalid==='unknown-identity'?{answer:'unknown'}:{prompt:invalid==='answer-leak'?'Use 扩大 here.':'Use private family detail.'})}]});
  await assert.rejects(()=>trial.provider.run(input),/Unknown supplied word reference|exposes an accepted answer|copy private learner evidence/);
  assert.equal(db.prepare("SELECT count(*) n FROM vocabulary_improvement_stages WHERE stage='single_improvement'").get()!.n,0);
});

for(const invalid of ['resolved-answer-leak','resolved-private-prompt'] as const)test(`invalid shared draft ${invalid} is rejected before caching and retry authors a fresh plan`,async()=>{
  secondWord();
  const input=submittedJob();
  if(invalid==='resolved-private-prompt')input.evidence.evidence[0]!.feedback=[{protocolVersion:1,actionId:'private-comment',clientActionId:'private-comment',sequence:2,occurredAt:at,kind:'feedback',
    payload:{encounterId:'encounter',feedback:'comment',comment:'A private family detail.'}}];
  const bad={...sharedExercise,...(invalid==='resolved-private-prompt'?{prompt:'A private family detail.'}:{prompt:'Use 放大 here.'})};
  let localCalls=0;
  const trial=provider(request=>{
    if(request.provenance!.stepName==='sense_mapping')return single;
    if(request.provenance!.stepName==='single_improvement')return {...repair,sharedExercise:++localCalls===1?bad:sharedExercise};
    return createPromotion;
  },{ledger:true});
  await assert.rejects(()=>trial.provider.run(input),/exposes an accepted answer|copies private learner evidence/);
  assert.equal(db.prepare("SELECT count(*) n FROM vocabulary_improvement_stages WHERE stage='single_improvement'").get()!.n,0);
  assert.equal(db.prepare("SELECT status FROM model_invocations WHERE id='invocation-2'").get()!.status,'invalid_response');
  assert.equal(db.prepare("SELECT status FROM model_invocations WHERE id='invocation-1'").get()!.status,'completed');
  assert.equal(getVocabularyContentForMaintenance('original')!.availability,'active');
  const result=await trial.provider.run({...input,attemptNumber:2});if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.equal(localCalls,2);assert.equal(db.prepare("SELECT count(*) n FROM vocabulary_improvement_stages WHERE stage='single_improvement'").get()!.n,1);
  assert.equal(db.prepare("SELECT status FROM model_invocations WHERE id='invocation-3'").get()!.status,'completed');
  assert.deepEqual(trial.requests.map(request=>request.provenance!.stepName),['sense_mapping','single_improvement','single_improvement','pure_cue_promotion']);
  assert.equal(result.result.pureCuePromotion!.outcome,'create');
});

for(const prefix of ['', '[bootstrap] '])test(`${prefix}established empty inventory stops mapping and authoring while preserving source`,async()=>{
  for(const sense of getVocabularySenses('word'))updateVocabularySense(sense.senseId,sense.version,{description:sense.description,status:'retired'},actor);
  const trial=provider(()=>assert.fail('No mapping or authoring call for empty inventory'));
  const before=getVocabularyContentForMaintenance(original.contentId);
  const result=await trial.provider.run(job());
  assert.equal(result.kind,'exercise_improvement');
  if(result.kind!=='exercise_improvement')throw new Error('Unexpected result');
  assert.equal(result.result.admission?.outcome,'no_senses_requested');
  assert.equal(result.result.proposal,null);assert.equal(trial.requests.length,0);
  assert.deepEqual(getVocabularyContentForMaintenance(original.contentId),before);
});

for(const senseId of ['size','effect'])test(`operator target ${senseId} skips mapping and binds only proposed content`,async()=>{
  const trial=provider(()=>repair);
  const result=await trial.provider.run({...job(),repairTarget:{senseId,version:4},reassessmentSourceJobId:'prior',reassessmentSource:original});
  if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.deepEqual(trial.requests.map(request=>request.provenance?.stepName),['single_improvement']);
  assert.equal(result.result.admission?.repairTargetVersion,4);
  assert.deepEqual(result.result.admission?.sourceMapping,{senseId:null,establishedAt:null});
  assert.equal(result.result.proposal!.operations[0]!.content.words[0]!.senseId,senseId);
  assert.deepEqual(getVocabularyContentForMaintenance('original'),original);
});
test('operator target can produce no repair without mutating its source',async()=>{
  const trial=provider(()=>({...repair,source:{decision:'keep',prompt:null},additionalExercises:[]}));
  const result=await trial.provider.run({...job(),repairTarget:{senseId:'size',version:2},reassessmentSourceJobId:'prior',reassessmentSource:original});
  if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.equal(result.result.proposal,null);assert.equal(result.result.admission?.repairTargetVersion,2);
  assert.deepEqual(getVocabularyContentForMaintenance('original'),original);
});

bootstrapTest('explicit repair intent takes precedence over fallback repertoire routing',async()=>{
  const trial=provider(()=>repair);
  const result=await trial.provider.run({...job(),repairTarget:{senseId:'size',version:1},reassessmentSourceJobId:'prior',reassessmentSource:original});
  if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.equal(result.result.admission?.outcome,'single_sense');
  assert.deepEqual(trial.requests.map(request=>request.provenance?.stepName),['single_improvement']);
  assert.deepEqual(getVocabularyContentForMaintenance('original'),original);
});

for(const failFirst of [false,true])bootstrapTest(`queue-captured repertoire selection survives edits before worker and retry (failure=${failFirst})`,async()=>{
  const scope={selectionEstablished:true,senseIds:['size'],source:{kind:'word_defaults' as const,wordId:'word',capturedVersion:1}};
  captureVocabularyRepertoireSelection('job',{wordId:'word',catalogVersion:getVocabularySenseCatalog('word').version,generationScope:scope});
  writeVocabularyDefaultUsefulSenses('word',1,['effect'],actor);
  const trial=provider((_request,index)=>{if(failFirst&&index===1)throw new Error('Provider failed');return {exercises:repertoire.exercises.filter(exercise=>exercise.sourceUseId==='size')};});
  if(failFirst)await assert.rejects(()=>trial.provider.run(job()),/Provider failed/);
  const result=await trial.provider.run({...job(),attemptNumber:failFirst?2:1});
  if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.deepEqual(result.result.admission?.generationScope,scope);
  for(const request of trial.requests)assert.equal(JSON.parse(request.userPrompt).content.uses.length,1);
  assert.equal(trial.requests.length,failFirst?2:1);
});
for(const invalid of ['catalog','sense','word'] as const)bootstrapTest(`queue-captured repertoire rejects stale ${invalid} before provider`,async()=>{
  captureVocabularyRepertoireSelection('job',{wordId:invalid==='word'?'other':'word',catalogVersion:getVocabularySenseCatalog('word').version+(invalid==='catalog'?1:0),generationScope:{selectionEstablished:true,senseIds:[invalid==='sense'?'missing':'size'],source:{kind:'word_defaults',wordId:'word',capturedVersion:1}}});
  const trial=provider(()=>repertoire);
  await assert.rejects(()=>trial.provider.run(job()),/captured repertoire selection/);assert.equal(trial.requests.length,0);
});
test('queue-captured repertoire cannot force authored content into the bootstrap route',async()=>{
  captureVocabularyRepertoireSelection('job',{wordId:'word',catalogVersion:getVocabularySenseCatalog('word').version,generationScope:{selectionEstablished:true,senseIds:['size'],source:{kind:'word_defaults',wordId:'word',capturedVersion:1}}});
  const trial=provider(()=>repertoire);
  await assert.rejects(()=>trial.provider.run(job()),/no longer bootstrap/);assert.equal(trial.requests.length,0);
});

bootstrapTest('queue-captured repertoire rejects newly authored coverage before provider',async()=>{
  captureVocabularyRepertoireSelection('job',{wordId:'word',catalogVersion:getVocabularySenseCatalog('word').version,generationScope:{selectionEstablished:true,senseIds:['size'],source:{kind:'word_defaults',wordId:'word',capturedVersion:1}}});
  createVocabularyContent({...original,contentId:'new-authored',body:{prompt:'An authored retrieval cue'}},actor);
  const trial=provider(()=>repertoire);
  await assert.rejects(()=>trial.provider.run(job()),/no longer bootstrap/);assert.equal(trial.requests.length,0);
});

for (const kind of ['learner_feedback','exercise_improvement'] as const) test(`retained pronunciation-only ${kind} job makes no provider calls`,async()=>{
  const input=job(kind);addPronunciationEncounter(input);input.evidence.evidence.pop();
  const trial=provider(()=>{throw new Error('No model should run');});
  const result=await trial.provider.run(input);
  assert.equal(trial.requests.length,0);
  if(result.kind==='learner_feedback')assert.equal(result.judgment.message,null);
  else assert.equal(result.result.proposal,null);
  assert.equal(input.evidence.evidence[0]!.responses.length,1);
});

test('second opinions exclude pronunciation encounter text and reactions',async()=>{
  const input=job();addPronunciationEncounter(input);
  input.secondOpinion={requestId:'opinion',proposal:null,notes:'Review the cue',diagnosis:'No repair'};
  const trial=provider(()=>({verdict:'support',rationale:'The cue works.'}));
  await trial.provider.run(input);
  assert.equal(trial.requests.length,1);
  assert.equal(trial.requests[0]!.provenance!.stepName,'second_opinion');
  assert.equal(trial.requests[0]!.userPrompt.includes('pronunciation-private-marker'),false);
  assert.equal(JSON.parse(trial.requests[0]!.userPrompt).evidence.encounters.length,1);
});

bootstrapTest('repertoire proposal saves an embedded cloze sentence once',async()=>{
  retainBootstrapRoute();
 const wire=structuredClone(repertoire);
 const cloze=wire.exercises[2]!.stimulus;
 cloze.frame=`Enlarge the image: ${cloze.text}`;
 const trial=provider(()=>wire);
 const result=await trial.provider.run(job());if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
 const body=result.result.proposal!.operations[2]!.content.body as {prompt:string};
 assert.equal(body.prompt,cloze.frame);
});


test('editorial direction reaches authoring separately from mapping and ordinary encounter evidence',async()=>{
  const input=job();input.editorial={instructions:'Use a shorter cue.',secondOpinion:{requestId:'opinion',jobId:'advisory',verdict:'revise',rationale:'The direction is not explicit.'}};
  const p=provider((_request,index)=>index===1?single:repair);
  await p.provider.run(input);
  const mapping=JSON.parse(p.requests[0].userPrompt),authoring=JSON.parse(p.requests[1].userPrompt);
  assert.equal(mapping.operatorEditorial,undefined);
  assert.deepEqual(authoring.operatorEditorial,input.editorial);
  assert.match(p.requests[1].systemPrompt,/Operator editorial context/);
  assert.match(p.requests[1].provenance!.inputProjectionVersion!,/editorial.v1/);
  assert.equal(authoring.encounters[0].reactions.length,0);
});

bootstrapTest('editorial context composes with the shared repertoire call without changing its output contract',async()=>{
  retainBootstrapRoute();
  const input=job();input.editorial={instructions:'Prefer concise English frames.'};
  const p=provider(()=>repertoire);
  const result=await p.provider.run(input);
  assert.equal(result.kind,'exercise_improvement');assert.equal(p.requests.length,1);
  const request=p.requests[0],wire=JSON.parse(request.userPrompt);
  assert.equal(request.provenance!.stepName,'repertoire');assert.deepEqual(wire.operatorEditorial,input.editorial);
  assert.equal(wire.role,'general_exercises');assert.ok(wire.content.uses.length);
  assert.match(request.systemPrompt,/Operator editorial context/);
  assert.match(request.provenance!.inputProjectionVersion!,/editorial.v1/);
  assert.deepEqual(Object.keys(request.outputSchema.properties!),['exercises']);
});
