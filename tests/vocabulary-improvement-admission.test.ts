import { VocabularySenseReadinessPending } from '../server/vocabulary/sense-readiness.ts';
import type { ensureVocabularyDefaultUsefulSelection } from '../server/vocabulary/default-useful-selection.ts';
import { writeVocabularyDefaultUsefulSenses } from '../server/db/vocabulary-sense-coverage.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach,afterEach,test } from 'node:test';
import { runWithLearnerId } from '../server/db/learner-context.ts';
import { setDb } from '../server/db/connection.ts';
import { createVocabularyContent,createVocabularySense,establishVocabularySenseCatalog,getVocabularyContentForMaintenance,getVocabularySenseCatalog,getVocabularySenses,mapVocabularyContentSense,updateVocabularyContent,updateVocabularySense } from '../server/db/vocabulary-content.ts';
import { createVocabularyPracticeProvider } from '../server/vocabulary/preparation.ts';
import type { WordContentDocument } from '../src/domain/word-content/types.ts';
import { createVocabularyReflectionProvider } from '../server/vocabulary/reflection-provider.ts';
import type { VocabularySenseEnsurer } from '../server/vocabulary/improvement-admission.ts';
import type { VocabularyContent } from '../src/domain/vocabulary-content.ts';
import type { VocabularyReflectionJob } from '../src/domain/vocabulary-reflection.ts';
import type { ProviderAdapter,ProviderRunRequest } from '../server/llm/types.ts';
import { effectiveVocabularyReactions, type VocabularyReactionAction } from '../src/domain/vocabulary-session.ts';

let db:DatabaseSync;
let original:VocabularyContent;
const actor={kind:'service' as const,id:'fixture'};
const at='2026-10-19T12:00:00.000Z';
beforeEach(()=>{
  db=new DatabaseSync(':memory:');setDb(db);
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE learners(learner_id TEXT PRIMARY KEY); INSERT INTO learners VALUES ('learner');
    CREATE TABLE lexical_word_meanings(id TEXT PRIMARY KEY,word_id TEXT,text TEXT,position INTEGER);
    CREATE TABLE lexical_words(id TEXT PRIMARY KEY,hanzi TEXT,traditional TEXT,pinyin TEXT,meaning TEXT);
    INSERT INTO lexical_words VALUES ('word','放大',NULL,'fang4 da4','enlarge; amplify');
    CREATE TABLE model_invocations(id TEXT PRIMARY KEY,actor_kind TEXT,actor_id TEXT,learner_id TEXT,status TEXT,spend_usd REAL,requesting_learner_id TEXT,timestamp TEXT,invocation_type TEXT);
    CREATE TABLE vocabulary_reflection_jobs(job_id TEXT PRIMARY KEY,model_choice TEXT); INSERT INTO vocabulary_reflection_jobs VALUES ('job',NULL);`);
  for(const name of ['0062_vocabulary_sense_coverage','0064_vocabulary_default_useful_senses','0039_vocabulary_content','0045_vocabulary_provenance_links','0050_vocabulary_improvement_admission','0051_vocabulary_pure_cue_promotion'])
    db.exec(readFileSync(new URL(`../server/db/migrations/${name}.sql`,import.meta.url),'utf8'));
  db.exec(readFileSync(new URL('../server/db/migrations/0061_vocabulary_sense_mapping_retries.sql',import.meta.url),'utf8'));
  original=createVocabularyContent({contentId:'original',kind:'exercise',payloadVersion:1,body:{prompt:'请把这张照片____后再打印。',instruction:'Old instruction',reveal:{teachingNote:'Old unrelated teaching'},source:{kind:'old_source'}},accessScope:'shared',availability:'active',originKind:'human',
    exerciseType:'word',skill:'production',exerciseRole:'general',assessment:{match:'exact'},words:[{wordId:'word',relation:'target'}],answers:[{wordId:'word',acceptedForms:['放大']}]},actor);
  createVocabularySense({senseId:'size',wordId:'word',description:{label:'make an image or object larger'}},actor);
  createVocabularySense({senseId:'effect',wordId:'word',description:{label:'amplify an effect or significance'}},actor);
  establishVocabularySenseCatalog('word',getVocabularySenseCatalog('word').version,actor);
  writeVocabularyDefaultUsefulSenses('word',0,['size','effect'],actor);
});
afterEach(()=>db.close());
function job(kind:VocabularyReflectionJob['kind']='exercise_improvement'):VocabularyReflectionJob {
  return {jobId:'job',caseId:'case',learnerId:'learner',kind,attemptNumber:1,leaseToken:'lease',leaseExpiresAt:'2026-10-20T00:00:00.000Z',evidence:{caseId:'case',completionId:'completion',learnerId:'learner',kind,wordId:'word',contentId:'original',status:'open',createdAt:at,
    evidence:[{encounterId:'encounter',wordId:'word',workNumber:1,presentedActionId:'presented',presentedAt:at,mode:'practice',snapshot:{contentId:'original',contentVersion:1,kind:'production',role:'general',body:{prompt:'请把这张照片____后再打印。'},assessment:{acceptedAnswers:['放大']}},responses:[],effectiveResponses:[],feedback:[],effectiveFeedback:[],skipped:false,presentationUndone:false}]}};
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
const repair={pureCueReferral:null,diagnosis:'Make the intended direction explicit.',operations:[{sourceContentId:'original',strategy:'replace',rationale:'Clarifies larger.',prompt:'Make this image larger before printing it.',acceptedAnswers:['放大']}]};
const laundry={outcome:'laundry_list',rationale:'Two distinct uses are bundled.',senseIds:[]};
const repertoire={exercises:[
  {id:'anchor',sourceUseId:'size',stimulus:{kind:'direct_text',text:'Make the image larger.'},teachingNote:'Image size.'},
  {id:'effect',sourceUseId:'effect',stimulus:{kind:'direct_text',text:'Make a small problem seem much more significant.'},teachingNote:null},
  {id:'cloze',sourceUseId:'size',stimulus:{kind:'phrase_cloze',frame:'Enlarge the image.',text:'这张图太小了，请把它____一点。'},teachingNote:'Natural size request.'},
]};

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
  const projected=JSON.parse(trial.requests[1]!.userPrompt).evidence.encounters[0];
  assert.deepEqual(projected.reactions,[{encounterId:'encounter',reaction:'comment',comment:reactions[1]!.payload.comment}]);
  assert.equal(projected.feedback,undefined);
  assert.equal(encounter.feedback.length,3); // Historical wire evidence is unchanged.
  assert.equal(trial.requests[1]!.provenance!.inputProjectionVersion,'vocabulary-admission.v3');
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
  const input=JSON.parse(trial.requests[1]!.userPrompt);assert.equal(input.intendedSense.senseId,input.senses.find((sense:{description:{label:string}})=>sense.description.label==='make an image or object larger').senseId);
  assert.match(trial.requests[1]!.systemPrompt,/Practice a useful collocation/);
  assert.deepEqual(trial.requests.map(request=>request.provenance?.stepName),['sense_mapping','single_improvement']);
  assert.ok(trial.requests.every(request=>request.reasoningEffort==='high'));
  assert.equal(getVocabularyContentForMaintenance('original')!.words[0]!.senseId,'size');
  assert.equal(getVocabularyContentForMaintenance('original')!.version,1);
  assert.equal(result.result.proposal!.operations[0]!.content.words[0]!.senseId,'size');
  assert.equal(db.prepare('SELECT count(*) n FROM content_items').get()!.n,1);
  const replay=await trial.provider.run({...job(),attemptNumber:2});assert.deepEqual(replay,result);assert.equal(trial.requests.length,2);
  assert.equal(db.prepare('SELECT count(*) n FROM vocabulary_improvement_stages').get()!.n,2);
  assert.equal(db.prepare('SELECT count(*) n FROM invocation_content_links').get()!.n,2);
  assert.equal(db.prepare('SELECT count(*) n FROM invocation_sense_links').get()!.n,4);
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

test('laundry list automatically proposes one source replacement plus additions, preserving unrelated cues',async()=>{
  createVocabularyContent({...original,contentId:'other'},actor);
  const trial=provider((_request,index)=>index===1?laundry:repertoire);
  const result=await trial.provider.run(job());if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.deepEqual(result.result.proposal!.operations.map(op=>op.strategy),['replace','create','create']);
  assert.deepEqual(result.result.proposal!.operations.map(op=>op.content.words[0]!.senseId),['size','effect','size']);
  assert.equal(getVocabularyContentForMaintenance('other')!.availability,'active');
  assert.equal(getVocabularyContentForMaintenance('original')!.availability,'active');
  assert.equal(getVocabularyContentForMaintenance('original')!.words[0]!.senseId,null);
  assert.equal(db.prepare('SELECT count(*) n FROM content_items').get()!.n,2);
  assert.equal(trial.requests[1]!.provenance!.stepName,'repertoire');
  assert.deepEqual(result.result.admission!.senseIds,[]);
  assert.deepEqual(trial.requests.map(request=>request.provenance!.promptVersion),['3','v5']);
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
  mapVocabularyContentSense({contentId:'original',wordId:'word',expectedContentVersion:1,expectedMapping:{senseId:mapping.senseId!,establishedAt:mapping.senseMappingEstablishedAt!},senseId:'effect'},actor);
  await assert.rejects(()=>trial.provider.run({...job(),attemptNumber:3}),/changed since the retained/);assert.equal(trial.requests.length,3);
});

test('repertoire cannot leak accepted answers',async()=>{
  const trial=provider((_request,index)=>index===1?laundry:{...repertoire,exercises:repertoire.exercises.map(exercise=>({...exercise,stimulus:{kind:'direct_text',text:'Use 放大 here.'}}))});
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
  assert.equal((await feedback.provider.run(job('learner_feedback'))).kind,'learner_feedback');
  assert.equal(feedback.requests.length,1);
  assert.equal(db.prepare('SELECT count(*) n FROM vocabulary_improvement_stages').get()!.n,0);
});

for(const wordAssociated of [false,true])test(`pure-cue dedicated review supplies all lexical members without individual repertoire (word-associated=${wordAssociated})`,async()=>{
  const input=pureCueJob(wordAssociated);
  const ensureSenses:VocabularySenseEnsurer=async()=>{throw new Error('Unexpected sense dependency');};
  const trial=provider(()=>pureExplanation,{ensureSenses});
  const result=await trial.provider.run(input);if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.equal(result.result.proposal,null);
  assert.equal(result.result.admission,undefined);
  assert.equal(trial.requests.length,1);
  assert.equal(trial.requests[0]!.provenance!.stepName,'pure_cue_improvement');
  const projected=JSON.parse(trial.requests[0]!.userPrompt);
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

for(const invalid of ['foreign-sense'] as const)test(`repertoire rejects ${invalid}`,async()=>{
  const exercises=repertoire.exercises.map(exercise=>({...exercise,sourceUseId:'unknown'}));
  const trial=provider((_request,index)=>index===1?laundry:{...repertoire,exercises});
  await assert.rejects(()=>trial.provider.run(job()),/output schema/);
  assert.equal(db.prepare('SELECT count(*) n FROM vocabulary_improvement_stages').get()!.n,2);
});

test('laundry-list replacement uses the inventory without mapping or preserving every old gloss',async()=>{
  createVocabularyContent({...original,contentId:'list',body:{prompt:'enlarge an image; amplify significance; a specialist gloss absent from the inventory'}},actor);
  const input=job();input.evidence.contentId='list';input.evidence.evidence[0]!.snapshot.contentId='list';
  const exercises=repertoire.exercises.filter(exercise=>exercise.sourceUseId==='size');
  const trial=provider((_request,index)=>index===1?laundry:{...repertoire,exercises});
  const result=await trial.provider.run(input);
  if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.equal(result.result.admission!.outcome,'laundry_list');
  assert.deepEqual(result.result.admission!.senseIds,[]);
  assert.deepEqual(result.result.proposal!.operations.map(op=>op.strategy),['replace','create']);
  assert.ok(result.result.proposal!.operations.every(op=>op.content.words[0]!.senseId==='size'));
  assert.equal(getVocabularyContentForMaintenance('list')!.words[0]!.senseId,null);
  const generatedInput=JSON.parse(trial.requests[1]!.userPrompt);
  assert.equal(generatedInput.role,'general_exercises');
  assert.equal(generatedInput.admission,undefined);
  assert.equal(generatedInput.content.uses.length,2);
  assert.equal(trial.requests.length,2);
});

for(const outcome of ['laundry_list','inventory_gap','unmappable'] as const)test(`${outcome} rejects unnecessary sense associations`,async()=>{
  const trial=provider(()=>({outcome,rationale:'Inspect the cue.',senseIds:['size','effect']}));
  await assert.rejects(()=>trial.provider.run(job()),/Invalid mapping outcome/);
  assert.equal(trial.requests.length,1);
  assert.equal(getVocabularyContentForMaintenance('original')!.words[0]!.senseId,null);
});

const referral={candidateWords:['放大','扩大'],sharedPurpose:'Make the visible size larger.',rationale:'Both may fulfill this shared task.'};
function secondWord(){db.exec("INSERT INTO lexical_words VALUES ('other-word','扩大',NULL,'kuo4 da4','expand')");}
const createPromotion={decision:'create',rationale:'A shared enlargement task.',existingContentId:null,prompt:'Make the displayed area larger.',semanticAxis:'Increase visible size.',teachingNote:'放大 and 扩大 can express enlargement when the object permits it.',memberWordIds:['word','other-word']};

for(const localRepair of [false,true])test(`referral composes with local repair=${localRepair}; promotion caches and never publishes`,async()=>{
  secondWord();
  const input=job();input.evidence.evidence[0]!.responses=[{protocolVersion:1,actionId:'answer',clientActionId:'answer',sequence:2,occurredAt:at,kind:'response',payload:{encounterId:'encounter',outcome:'rejected',response:'扩大'}}];
  const trial=provider(request=>request.provenance!.stepName==='sense_mapping'?single:request.provenance!.stepName==='single_improvement'
    ?{...repair,operations:localRepair?repair.operations:[],pureCueReferral:referral}:createPromotion,{ledger:true});
  const result=await trial.provider.run(input);if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.deepEqual(trial.requests.map(request=>request.provenance!.stepName),['sense_mapping','single_improvement','pure_cue_promotion']);
  assert.deepEqual(result.result.pureCueReferral,referral);assert.equal(result.result.pureCuePromotion!.outcome,'create');
  assert.equal(result.result.proposal!.operations.length,localRepair?2:1);
  assert.equal(result.result.proposal!.operations.at(-1)!.content.kind,'exercise');
  assert.equal(db.prepare('SELECT count(*) n FROM content_items').get()!.n,1);
  const promotionInput=JSON.parse(trial.requests[2]!.userPrompt);
  assert.equal(promotionInput.evidence.encounters[0].responses[0].response,'扩大');
  assert.match(promotionInput.intendedSense.senseId,/^s[12]$/);assert.equal(promotionInput.sourceContent.contentId,'original');
  assert.deepEqual(promotionInput.candidates.map((word:{wordId:string})=>word.wordId),['word','other-word']);
  assert.equal(trial.requests[1]!.provenance!.promptVersion,'4');assert.equal(trial.requests[1]!.provenance!.schemaVersion,'3');
  assert.match(trial.requests[1]!.systemPrompt,/Practice a useful collocation/);
  assert.doesNotMatch(trial.requests[1]!.systemPrompt,/## Learner feedback and proposal rationales/);
  assert.equal(trial.requests[2]!.provenance!.promptVersion,'3');assert.equal(trial.requests[2]!.provenance!.schemaVersion,'2');
  const replay=await trial.provider.run({...input,attemptNumber:2});assert.deepEqual(replay,result);assert.equal(trial.requests.length,3);
  assert.equal(db.prepare("SELECT count(*) n FROM vocabulary_improvement_stages WHERE stage='pure_cue_promotion'").get()!.n,1);
});

test('rejected referral retains local repair and no-op assessment, while missing lexical candidates need operator review without a promotion call',async()=>{
  const trial=provider(request=>request.provenance!.stepName==='sense_mapping'?single:{...repair,pureCueReferral:referral});
  const result=await trial.provider.run(job());if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.equal(result.result.pureCuePromotion!.outcome,'needs_operator');assert.equal(result.result.proposal!.operations.length,1);assert.equal(trial.requests.length,2);
  secondWord();
  const rejected=provider(()=>({decision:'reject',rationale:'These words do not share this construction.',existingContentId:null,prompt:null,semanticAxis:null,teachingNote:null,memberWordIds:[]}));
  const reassessed=await rejected.provider.run({...job(),attemptNumber:2});if(reassessed.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.equal(rejected.requests.length,1);assert.equal(reassessed.result.pureCuePromotion!.outcome,'reject');assert.equal(reassessed.result.proposal!.operations.length,1);
});

test('promotion failure retries only promotion and fences loss of publication authority',async()=>{
  secondWord();let allowed=true;
  const trial=provider(request=>{
    if(request.provenance!.stepName==='sense_mapping')return single;
    if(request.provenance!.stepName==='single_improvement')return {...repair,pureCueReferral:referral};
    allowed=false;return createPromotion;
  });
  await assert.rejects(()=>trial.provider.run(job(),{canPublish:()=>allowed}),/publication authority/);
  assert.equal(db.prepare('SELECT count(*) n FROM vocabulary_improvement_stages').get()!.n,2);
  const retry=provider(()=>createPromotion);const result=await retry.provider.run({...job(),attemptNumber:2});
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

test('reflection repertoire reaches the same general invocation as preparation while retaining its selected model',async()=>{
  db.prepare("UPDATE vocabulary_reflection_jobs SET model_choice='openai:gpt-6-sol-high'").run();
  for(const senseId of ['size','effect'])updateVocabularySense(senseId,1,{status:'active',description:{label:senseId,notes:[],examples:[{text:'把图片放大。',translation:'Enlarge the image.',pronunciation:null}]}},actor);
  const trial=provider((_request,index)=>index===1?laundry:repertoire);
  await trial.provider.run(job());
  const reflected=trial.requests[1]!;
  let sent:{messages:Array<{content:string}>;response_format:{json_schema:{name:string;schema:unknown}}}|undefined;
  const preparation=createVocabularyPracticeProvider({environment:{OPENAI_API_KEY:'fake'},fetchImplementation:(async(_url,init)=>{
    sent=JSON.parse(String(init?.body));
    const uses=JSON.parse(sent!.messages[1]!.content).content.uses as Array<{id:string;label:string}>;
    const output={exercises:repertoire.exercises.map(exercise=>({...exercise,sourceUseId:uses.find(use=>use.label===exercise.sourceUseId)!.id}))};
    return new Response(JSON.stringify({id:'response',choices:[{message:{content:JSON.stringify(output)},finish_reason:'stop'}]}),{status:200,headers:{'content-type':'application/json'}});
  })as typeof fetch});
  const source=JSON.parse(reflected.userPrompt).content as Pick<WordContentDocument,'word'|'uses'|'examples'>;
  await preparation.generate({schemaVersion:1,id:'ordinary-bootstrap',...source},{workflowId:'parity',onInvocation:()=>{}});
  assert.ok(sent);
  assert.equal(sent.messages[0]!.content,reflected.systemPrompt);
  const ordinary=JSON.parse(sent.messages[1]!.content),reflection=JSON.parse(reflected.userPrompt);
  assert.equal(ordinary.role,reflection.role);
  assert.deepEqual({word:ordinary.content.word,uses:ordinary.content.uses,examples:ordinary.content.examples},reflection.content);
  assert.equal(sent.response_format.json_schema.name,reflected.outputSchemaName);
  assert.deepEqual(sent.response_format.json_schema.schema,reflected.outputSchema);
  assert.equal(reflected.model,'gpt-6-sol');assert.equal(reflected.reasoningEffort,'high');
  assert.equal(reflected.provenance!.promptName,'vocabulary-general-exercises');
  assert.equal(reflected.provenance!.promptVersion,'v5');
});

test('a single mapped repertoire exercise preserves private publication scope and answers',async()=>{
  createVocabularyContent({...original,contentId:'private-source',accessScope:'private',ownerLearnerId:'learner'},actor);
  const input=job();input.evidence.contentId='private-source';input.evidence.evidence[0]!.snapshot.contentId='private-source';
  const trial=provider((_request,index)=>index===1?laundry:{exercises:[{...repertoire.exercises[0],sourceUseId:'size'}]});
  const result=await trial.provider.run(input);if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  const operations=result.result.proposal!.operations;assert.equal(operations.length,1);
  assert.deepEqual(operations[0]!.scope,{kind:'learner',learnerId:'learner'});
  assert.equal(operations[0]!.content.accessScope,'private');assert.equal(operations[0]!.content.ownerLearnerId,'learner');
  assert.equal(operations[0]!.content.words[0]!.senseId,'size');
  assert.equal(typeof operations[0]!.content.words[0]!.senseMappingEstablishedAt,'string');
  assert.deepEqual(operations[0]!.content.answers,original.answers);
  assert.equal(db.prepare('SELECT count(*) n FROM content_items').get()!.n,2);
});

for(const malformed of ['missing-blank','answer-in-frame','duplicate-id'] as const)test(`repertoire shared validation rejects ${malformed}`,async()=>{
  const exercises=structuredClone(repertoire.exercises);
  if(malformed==='duplicate-id')exercises[1]!.id=exercises[0]!.id;
  else exercises[2]!.stimulus={kind:'phrase_cloze',frame:malformed==='answer-in-frame'?'Use 放大.':'Enlarge the image.',text:malformed==='missing-blank'?'这张图太小了。':'把图片____。'};
  const trial=provider((_request,index)=>index===1?laundry:{exercises});
  await assert.rejects(()=>trial.provider.run(job()),/blank|exposes an accepted answer|duplicate/i);
  assert.equal(db.prepare("SELECT count(*) n FROM vocabulary_improvement_stages WHERE stage='repertoire'").get()!.n,0);
});

for(const change of ['source','catalog','authority'] as const)test(`repertoire publication fences ${change} changes during generation`,async()=>{
  let allowed=true;
  const trial=provider((_request,index)=>{
    if(index===1)return laundry;
    if(change==='source')updateVocabularyContent('original',1,{...original,body:{prompt:'Edited by operator'}},actor);
    if(change==='catalog')updateVocabularySense('size',1,{description:{label:'Changed meaning',notes:[]},status:'active'},actor);
    if(change==='authority')allowed=false;
    return repertoire;
  });
  await assert.rejects(()=>trial.provider.run(job(),{canPublish:()=>allowed}),/changed|publication authority/);
  assert.equal(db.prepare("SELECT count(*) n FROM vocabulary_improvement_stages WHERE stage='repertoire'").get()!.n,0);
});

test('repertoire retries reuse exact new-contract output and retain old-contract evidence without consuming it',async()=>{
  db.prepare('INSERT INTO vocabulary_improvement_stages VALUES (?,?,?,?,?,?,?)').run('job','repertoire','old-contract',JSON.stringify({contract:{promptName:'vocabulary-reflection-repertoire',promptVersion:'2'}}),JSON.stringify({obsolete:true}),null,at);
  const trial=provider((_request,index)=>index===1?laundry:repertoire,{ledger:true});
  const result=await trial.provider.run(job());
  const replay=await trial.provider.run({...job(),attemptNumber:2});
  assert.deepEqual(replay,result);assert.equal(trial.requests.length,2);
  assert.equal(db.prepare("SELECT count(*) n FROM vocabulary_improvement_stages WHERE stage='repertoire'").get()!.n,2);
  const retained=JSON.parse(String(db.prepare("SELECT input_json FROM vocabulary_improvement_stages WHERE stage='repertoire' AND input_hash!='old-contract'").get()!.input_json));
  assert.equal(retained.contract.systemPrompt,trial.requests[1]!.systemPrompt);
  assert.deepEqual(retained.contract.schema,trial.requests[1]!.outputSchema);
  assert.equal(db.prepare("SELECT count(*) n FROM invocation_content_links WHERE invocation_id='invocation-2'").get()!.n,1);
  assert.equal(db.prepare("SELECT count(*) n FROM invocation_sense_links WHERE invocation_id='invocation-2'").get()!.n,2);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('reassessment freshly maps current content and excludes historical encounters',async()=>{
  const first=provider((_request,index)=>index===1?single:repair);
  await first.provider.run(job());
  const current=getVocabularyContentForMaintenance('original')!;
  const {version,createdAt,updatedAt,...draft}=current;
  const revised=updateVocabularyContent('original',version,{...draft,body:{prompt:'An updated source.'}},actor);
  db.prepare('INSERT INTO vocabulary_reflection_jobs(job_id,model_choice) VALUES (?,?)').run('reassessment','openai:gpt-6-sol-high');
  const again=provider((_request,index)=>index===1?single:repair);
  const result=await again.provider.run({...job(),jobId:'reassessment',caseId:'new-case',reassessmentSourceJobId:'job',reassessmentSource:revised});
  assert.equal(result.kind,'exercise_improvement');
  assert.deepEqual(again.requests.map(request=>request.provenance!.stepName),['sense_mapping','single_improvement']);
  const input=JSON.parse(again.requests[1]!.userPrompt);
  assert.deepEqual(input.evidence.encounters,[]);
  assert.equal(input.sourceContent.version,2);
  if(result.kind==='exercise_improvement')assert.deepEqual(result.result.proposal!.bases,[{contentId:'original',expectedVersion:2}]);
});

test('reassessment runs fresh mapping even when source version is unchanged and catalog changed',async()=>{
  await provider((_request,index)=>index===1?single:repair).provider.run(job());
  db.prepare('INSERT INTO vocabulary_reflection_jobs(job_id,model_choice) VALUES (?,?)').run('reassessment','openai:gpt-6-sol-high');
  createVocabularySense({senseId:'new-sense',wordId:'word',description:{label:'a new meaning'}},actor);
  const again=provider((_request,index)=>index===1?single:repair);
  await again.provider.run({...job(),jobId:'reassessment',reassessmentSourceJobId:'job',reassessmentSource:getVocabularyContentForMaintenance('original')!});
  assert.equal(again.requests.length,2);
});

test('reassessment rejects a version race before any provider call',async()=>{
  const {version,createdAt,updatedAt,...draft}=original;
  updateVocabularyContent('original',version,{...draft,body:{prompt:'New version.'}},actor);
  const again=provider(()=>single);
  await assert.rejects(()=>again.provider.run({...job(),reassessmentSourceJobId:'old',reassessmentSource:original}),/Reassessment source version changed/);
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

for(const failFirst of [false,true])test(`repertoire scope survives policy changes and retry (first call fails=${failFirst})`,async()=>{
  const {writeVocabularyWordSenseCoverage}=await import('../server/db/vocabulary-sense-coverage.ts');
  const trial=provider((_request,index)=>{
    if(index===1)return laundry;
    if(index===2){writeVocabularyWordSenseCoverage('word',1,['effect'],actor);if(failFirst)throw new Error('Provider failed');}
    return repertoire;
  });
  if(failFirst)await assert.rejects(()=>trial.provider.run(job()),/Provider failed/);
  else await trial.provider.run(job());
  const result=await trial.provider.run({...job(),attemptNumber:2});if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.deepEqual(result.result.admission?.generationScope,{selectionEstablished:true,senseIds:['effect','size'],source:{kind:'word_defaults',wordId:'word',capturedVersion:1}});
  assert.equal(trial.requests.length,failFirst?3:2);
  for(const request of trial.requests.slice(1))assert.deepEqual(JSON.parse(request.userPrompt).content.uses.map((use:{id:string})=>use.id).sort(),['s1','s2']);
  assert.equal(getVocabularyContentForMaintenance('original')!.availability,'active');
});

test('explicit empty repertoire invocation is no-action and never retires source',async()=>{
  const {writeVocabularyWordSenseCoverage}=await import('../server/db/vocabulary-sense-coverage.ts');
  writeVocabularyWordSenseCoverage('word',1,['size','effect'],actor);
  const trial=provider(()=>laundry),result=await trial.provider.run(job());if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.equal(result.result.admission?.outcome,'no_senses_requested');assert.equal(result.result.proposal,null);
  assert.deepEqual(result.result.admission?.generationScope?.senseIds,[]);assert.equal(trial.requests.length,1);
  assert.equal(getVocabularyContentForMaintenance('original')!.availability,'active');
});

test('explicit review override supplies repertoire invocation independently of shared serving selection',async()=>{
  const {writeVocabularyCaseSenseCoverage,writeVocabularyWordSenseCoverage}=await import('../server/db/vocabulary-sense-coverage.ts');
  db.exec("CREATE TABLE reflection_cases(case_id TEXT PRIMARY KEY,word_id TEXT); INSERT INTO reflection_cases VALUES ('case','word');");
  writeVocabularyWordSenseCoverage('word',1,['effect'],actor);writeVocabularyCaseSenseCoverage('case',0,['effect'],actor);
  const trial=provider((_request,index)=>index===1?laundry:{exercises:repertoire.exercises.filter(exercise=>exercise.sourceUseId==='effect')});
  const result=await trial.provider.run(job());if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.deepEqual(result.result.admission?.generationScope,{selectionEstablished:true,senseIds:['effect'],source:{kind:'review_override',caseId:'case',capturedVersion:1}});
  assert.deepEqual(JSON.parse(trial.requests[1]!.userPrompt).content.uses.map((use:{id:string})=>use.id),['s1']);
});


test('unknown default usefulness does not block explicitly mapped single-sense improvement',async()=>{
  db.exec('UPDATE vocabulary_word_sense_coverage SET default_useful_sense_ids_json=NULL');
  const trial=provider((_request,index)=>index===1?single:repair),result=await trial.provider.run(job());
  if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.equal(result.result.admission?.outcome,'single_sense');assert.ok(result.result.proposal);assert.equal(trial.requests.length,2);
});
test('explicit review selection admits a use even when shared usefulness is unknown',async()=>{
  const {writeVocabularyCaseSenseCoverage}=await import('../server/db/vocabulary-sense-coverage.ts');
  db.exec("UPDATE vocabulary_word_sense_coverage SET default_useful_sense_ids_json=NULL; CREATE TABLE reflection_cases(case_id TEXT PRIMARY KEY,word_id TEXT); INSERT INTO reflection_cases VALUES ('case','word');");
  writeVocabularyCaseSenseCoverage('case',0,['effect'],actor);
  const trial=provider((_request,index)=>index===1?{...single,senseIds:['effect']}:repair),result=await trial.provider.run(job());
  if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.equal(trial.requests.length,2);assert.equal(result.result.admission?.outcome,'single_sense');assert.ok(result.result.proposal);
  assert.match(JSON.parse(trial.requests[1]!.userPrompt).intendedSense.senseId,/^s[12]$/);
});

test('unknown default usefulness makes laundry-list generation an explicit attention finding',async()=>{
  db.exec('UPDATE vocabulary_word_sense_coverage SET default_useful_sense_ids_json=NULL');
  const trial=provider(()=>laundry),result=await trial.provider.run(job());
  if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.equal(result.result.admission?.outcome,'needs_coverage');assert.equal(result.result.proposal,null);assert.equal(trial.requests.length,1);
  assert.equal(result.result.admission?.generationScope?.selectionEstablished,false);
});


test('repertoire waits for useful initialization without repeating or invalidating its completed mapping',async()=>{
  db.exec('UPDATE vocabulary_word_sense_coverage SET default_useful_sense_ids_json=NULL');
  let initializations=0;
  const trial=provider((_request,index)=>index===1?laundry:repertoire,{ledger:true,ensureDefaults:async()=>{
    initializations++;if(initializations===1)throw new VocabularySenseReadinessPending('2026-10-29T01:00:00.000Z');
    writeVocabularyDefaultUsefulSenses('word',1,['size','effect'],actor);
    const {getVocabularyWordSenseCoverage}=await import('../server/db/vocabulary-sense-coverage.ts');return getVocabularyWordSenseCoverage('word');
  }});
  await assert.rejects(trial.provider.run(job()),VocabularySenseReadinessPending);assert.equal(trial.requests.length,1);
  assert.equal(db.prepare("SELECT status FROM model_invocations WHERE id='invocation-1'").get()!.status,'completed');
  const result=await trial.provider.run({...job(),attemptNumber:2});if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.ok(result.result.proposal);assert.equal(trial.requests.length,2);assert.equal(initializations,2);
  assert.deepEqual(result.result.admission?.generationScope?.senseIds,['effect','size']);
});

const retirement={sourceContentId:'original',strategy:'retire',rationale:'This exercise cannot faithfully retrieve the exact target; no convincing repair is apparent.',prompt:'',acceptedAnswers:['放大']};
test('single assessment proposes exercise retirement without changing selected senses or live content',async()=>{
  const {resolveVocabularySenseCoverage}=await import('../server/db/vocabulary-sense-coverage.ts');
  const before=resolveVocabularySenseCoverage('word','case');
  const trial=provider((_request,index)=>index===1?single:{diagnosis:'Exercise-level mismatch, not a coverage decision.',operations:[retirement],pureCueReferral:null});
  const result=await trial.provider.run(job());if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  const operation=result.result.proposal!.operations[0]!;
  assert.equal(operation.strategy,'retire');assert.equal(operation.content.contentId,'original');
  assert.deepEqual(operation.content.body,original.body);assert.equal(operation.content.words[0]!.senseId,'size');
  assert.equal(getVocabularyContentForMaintenance('original')!.availability,'active');
  assert.deepEqual(resolveVocabularySenseCoverage('word','case'),before);
  assert.deepEqual(await trial.provider.run({...job(),attemptNumber:2}),result);assert.equal(trial.requests.length,2);
});

for(const invalid of ['replacement-prompt','changed-source','changed-answers','local-create','sense-exclusion'] as const)test(`single retirement rejects ${invalid}`,async()=>{
  const modified={...retirement,...(invalid==='replacement-prompt'?{prompt:'A replacement draft.'}:invalid==='changed-source'?{sourceContentId:'foreign'}:invalid==='changed-answers'?{acceptedAnswers:['扩大']}:invalid==='sense-exclusion'?{strategy:'exclude_sense'}:{})};
  const trial=provider((_request,index)=>index===1?single:{diagnosis:'Retire',operations:[modified,...(invalid==='local-create'?[{...repair.operations[0]!,strategy:'create'}]:[])],pureCueReferral:null});
  await assert.rejects(()=>trial.provider.run(job()),invalid==='sense-exclusion'?/strict output schema/:invalid==='replacement-prompt'?/replacement prompt/:invalid==='local-create'?/also author/:/source identities|answer criteria/);
});

test('retirement can retain an independent shared-practice referral',async()=>{
  secondWord();
  const trial=provider(request=>request.provenance!.stepName==='sense_mapping'?single:request.provenance!.stepName==='single_improvement'
    ?{diagnosis:'Poor source; a distinct shared task merits assessment.',operations:[retirement],pureCueReferral:referral}
    :{decision:'reject',rationale:'No suitable shared task was established.',existingContentId:null,prompt:null,semanticAxis:null,teachingNote:null,memberWordIds:[]});
  const result=await trial.provider.run(job());if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.deepEqual(result.result.proposal!.operations.map(operation=>operation.strategy),['retire']);
  assert.equal(result.result.pureCuePromotion!.outcome,'reject');
});

test('empty faithful repertoire proposes only source retirement and preserves selected coverage',async()=>{
  const {resolveVocabularySenseCoverage}=await import('../server/db/vocabulary-sense-coverage.ts');
  const before=resolveVocabularySenseCoverage('word','case');
  const trial=provider((_request,index)=>index===1?laundry:{exercises:[]});
  const result=await trial.provider.run(job());if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.deepEqual(result.result.proposal!.operations.map(operation=>operation.strategy),['retire']);
  assert.deepEqual(result.result.proposal!.operations[0]!.content.body,original.body);
  assert.match(String(result.result.diagnosis),/without changing the selected sense coverage/);
  assert.match(String(result.result.diagnosis),/0 other active general production exercises existed.*Retiring this source would leave none/);
  assert.deepEqual(resolveVocabularySenseCoverage('word','case'),before);
  assert.equal(getVocabularyContentForMaintenance('original')!.availability,'active');
});

test('selected specialized use reaches faithful authoring without model coverage authority',async()=>{
  updateVocabularySense('effect',1,{description:{label:'specialized technical amplification',notes:['Intentionally selected for a professional interest.']},status:'active'},actor);
  writeVocabularyDefaultUsefulSenses('word',1,['size'],actor);
  const trial=provider((_request,index)=>index===1?{...single,senseIds:['effect']}:repair);
  const result=await trial.provider.run(job());if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.equal(JSON.parse(trial.requests[1]!.userPrompt).intendedSense.description.label,'specialized technical amplification');
  assert.deepEqual(result.result.proposal!.operations.map(operation=>operation.strategy),['replace']);
  assert.deepEqual((await import('../server/db/vocabulary-sense-coverage.ts')).resolveVocabularySenseCoverage('word').includedSenseIds,['size']);
  assert.deepEqual(result.result.admission?.generationScope,{selectionEstablished:true,senseIds:['effect'],source:{kind:'mapped_source'}});
});

for(const reassessment of [false,true])test(`valid retirement output stays completed when ${reassessment?'reassessment':'encounter'} source changes during the call`,async()=>{
  const input={...job(),...(reassessment?{reassessmentSource:original,reassessmentSourceJobId:'prior'}:{})};
  const trial=provider((_request,index)=>{
    if(index===1)return single;
    updateVocabularyContent('original',1,{...getVocabularyContentForMaintenance('original')!,body:{prompt:'A concurrent editorial change.'}},actor);
    return {diagnosis:'No faithful useful repair is apparent.',operations:[retirement],pureCueReferral:null};
  },{ledger:true});
  await assert.rejects(()=>trial.provider.run(input),/source, mapping, or sense catalog changed/);
  assert.equal(db.prepare("SELECT status FROM model_invocations WHERE id='invocation-2'").get()!.status,'completed');
  assert.equal(db.prepare("SELECT count(*) n FROM vocabulary_improvement_stages WHERE stage='single_improvement'").get()!.n,0);
  assert.equal(getVocabularyContentForMaintenance('original')!.version,2);
  assert.equal(getVocabularyContentForMaintenance('original')!.availability,'active');
});

test('empty repertoire reports other active production content in the same publication scope',async()=>{
  if(original.kind!=='exercise')assert.fail('Expected exercise fixture');
  createVocabularyContent({...original,contentId:'other'},actor);
  createVocabularyContent({...original,contentId:'private',accessScope:'private',ownerLearnerId:'learner'},actor);
  createVocabularyContent({...original,contentId:'recognition',skill:'recognition'},actor);
  const trial=provider((_request,index)=>index===1?laundry:{exercises:[]});
  const result=await trial.provider.run(job());if(result.kind!=='exercise_improvement')assert.fail('Expected improvement');
  assert.match(String(result.result.diagnosis),/1 other active general production exercise existed.*same publication scope/);
  assert.doesNotMatch(String(result.result.diagnosis),/would leave none/);
  assert.match(String(result.result.diagnosis),/contract provides no explanatory rationale/);
});

for(const outcome of ['single_sense','laundry_list'])test(`actual UUIDs stay canonical behind ${outcome} call-local references`,async()=>{
  const size='fb57f552-2ef8-4df3-b2a9-701e0cb0e732',effect='9fef2d9f-eb72-4137-9219-c7fbf70b6dca';
  for(const id of ['size','effect'])updateVocabularySense(id,1,{description:id,status:'retired'},actor);
  createVocabularySense({senseId:size,wordId:'word',description:{label:'image enlargement',notes:[],examples:[{text:'把图片放大。',translation:'Enlarge the image.',pronunciation:null}]}},actor);
  createVocabularySense({senseId:effect,wordId:'word',description:{label:'amplify an effect'}},actor);
  writeVocabularyDefaultUsefulSenses('word',1,[size,effect],actor);
  const trial=provider((_request,index)=>index===1?{...single,outcome,senseIds:outcome==='single_sense'?[size]:[]}:
    outcome==='single_sense'?repair:{exercises:[{...repertoire.exercises[0],sourceUseId:size}]});
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


test('new repertoire items reject missing sense binding instead of inventing one',async()=>{
  const trial=provider((_request,index)=>index===1?laundry:{exercises:[{...repertoire.exercises[0],sourceUseId:null}]});
  await assert.rejects(()=>trial.provider.run(job()),/strict output schema/);
  assert.equal(getVocabularyContentForMaintenance('original')!.availability,'active');
  assert.equal(db.prepare("SELECT count(*) n FROM vocabulary_improvement_stages WHERE stage='repertoire'").get()!.n,0);
});
