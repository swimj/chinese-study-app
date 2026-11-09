import test from 'node:test';
import assert from 'node:assert/strict';
import {validateJsonSchema} from '../server/llm/json-schema-validator.ts';
import {pureCueFlowCases,pureCueFlowSchemas,singleTrialInput,fixedSingleOutput,integrationTrialInput,singleOutputErrors,integrationOutputErrors,decodeIntegrationReplay} from '../scripts/lib/pure-cue-flow-cases.ts';

test('representative flow cases contain four chains and four isolated integration tasks',()=>{
  const cases=pureCueFlowCases();assert.equal(cases.length,8);assert.equal(new Set(cases.map(c=>c.id)).size,8);
  assert.equal(cases.filter(c=>c.kind==='chain').length,4);assert.equal(cases.filter(c=>c.kind==='integration').length,4);
  for(const fixture of cases){assert.equal(fixture.words.length,2);assert(fixture.reviewFocus.length);assert(!JSON.stringify(singleTrialInput(fixture)).includes('reviewFocus'));}
});
test('fixed candidate input mapping retains the decision but moves teaching authoring to integration',()=>{
  for(const fixture of pureCueFlowCases().filter(c=>c.kind==='integration')){
    const baseline=fixedSingleOutput(fixture,'baseline'),candidate=fixedSingleOutput(fixture,'candidate');
    assert.deepEqual(validateJsonSchema(baseline,pureCueFlowSchemas('baseline').single),[]);
    assert.deepEqual(validateJsonSchema(candidate,pureCueFlowSchemas('candidate').single),[]);
    assert(!('teachingNote'in candidate.sharedExercise!));assert(baseline.sharedExercise!.teachingNote);
    assert.deepEqual(singleOutputErrors(fixture,candidate),[]);
    const input=integrationTrialInput(fixture,candidate,'candidate');assert.equal(input.candidates.length,2);
    assert.equal(input.localAssessment,candidate.summary);assert(input.localPlan?.operations.length);
    assert(!('teachingNote'in input.referral.draft));assert(!JSON.stringify(input).includes('reviewFocus'));
  }
});
test('frozen schemas distinguish baseline creation from integration-owned final content',()=>{
  const fixture=pureCueFlowCases().find(c=>c.id==='same-members-different-sense')!;
  const input=integrationTrialInput(fixture,fixedSingleOutput(fixture,'candidate'),'candidate');
  const create={decision:'create' as const,existingContentId:null,prompt:'Having no connection to a matter.',semanticAxis:'Lack of connection.',teachingNote:'Both express unrelatedness.',rationale:'The reassurance cue has a different meaning.'};
  assert.deepEqual(validateJsonSchema(create,pureCueFlowSchemas('candidate').integration),[]);
  assert.deepEqual(integrationOutputErrors(input,create,'candidate'),[]);
  assert(validateJsonSchema(create,pureCueFlowSchemas('baseline').integration).length);
  assert(integrationOutputErrors(input,{...create,prompt:null},'candidate').length);
  assert(integrationOutputErrors(input,{...create,prompt:'无关'},'candidate').some(e=>e.includes('exposes')));
});
test('integration guards enforce deterministic destinations while leaving linguistic review to humans',()=>{
  const fixture=pureCueFlowCases().find(c=>c.id==='extend-retained-member')!,input=integrationTrialInput(fixture,fixedSingleOutput(fixture,'candidate'),'candidate');
  const existingContentId=input.existingCues[0]!.contentId;
  const extend={decision:'extend' as const,existingContentId,prompt:null,semanticAxis:null,teachingNote:'Integrated full note.',rationale:'The same modifier use fits.'};
  assert.deepEqual(integrationOutputErrors(input,extend,'candidate'),[]);
  assert(integrationOutputErrors(input,{...extend,semanticAxis:'New axis'},'candidate').length);
  assert(integrationOutputErrors(input,{...extend,decision:'reuse',teachingNote:null},'candidate').some(e=>e.includes('lacks incoming')));
});

test('integration replay keeps exact archived user text and refuses schema/model drift',()=>{
  const fixture=pureCueFlowCases().find(c=>c.id==='reuse-other-scene')!,input=integrationTrialInput(fixture,fixedSingleOutput(fixture,'candidate'),'candidate');
  const schema=pureCueFlowSchemas('candidate').integration,userPrompt=JSON.stringify(input,null,2)+'\n';
  const archive={request:{model:'test-model',outputSchema:schema,userPrompt}};
  const replay=decodeIntegrationReplay(archive,schema,'test-model');assert.equal(replay.userPrompt,userPrompt);assert.deepEqual(replay.input,input);
  assert.throws(()=>decodeIntegrationReplay(archive,schema,'other-model'),/differs/);
  assert.throws(()=>decodeIntegrationReplay(archive,pureCueFlowSchemas('baseline').integration,'test-model'),/differs/);
});

test('frozen candidate trial schemas match the active production contracts',async()=>{
  const {vocabularySingleImprovementSchema}=await import('../server/vocabulary/exercise-improvement-authoring.ts');
  const {vocabularyPureCueIntegrationSchema}=await import('../server/vocabulary/pure-cue-promotion.ts');
  assert.deepEqual(pureCueFlowSchemas('candidate').single,vocabularySingleImprovementSchema);
  assert.deepEqual(pureCueFlowSchemas('candidate').integration,vocabularyPureCueIntegrationSchema);
});

test('trial answer references match exact production call-local identities',()=>{
  const fixture=pureCueFlowCases().find(c=>c.id==='reuse-other-scene')!;
  for(const ref of ['response_0','response_01','1','response_']){
    const output=fixedSingleOutput(fixture,'candidate');
    output.sharedExercise!.answers=['target',ref];
    assert(singleOutputErrors(fixture,output).includes('Unknown supplied answer reference'));
    assert.throws(()=>integrationTrialInput(fixture,output,'candidate'),/Unknown supplied/);
  }
});
