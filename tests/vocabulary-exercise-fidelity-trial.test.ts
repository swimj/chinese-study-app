import {fidelityGeneralContentErrors} from '../scripts/lib/exercise-fidelity-validation.ts';
import {generalExerciseSchema,generalExerciseInvocation,type GeneralExerciseSource} from '../server/vocabulary/general-exercise-authoring.ts';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';

function trial(options:string[],check:(archive:string)=>void){
  const archive=mkdtempSync(path.join(os.tmpdir(),'fidelity-trial-'));
  try{
    const run=spawnSync(process.execPath,['--import','tsx','scripts/review-exercise-fidelity-trial.ts','--archive',archive,'--variant','check',...options],{encoding:'utf8'});
    assert.equal(run.status,0,run.stderr);check(archive);
  }finally{rmSync(archive,{recursive:true,force:true});}
}
test('offline fidelity default stays bounded and captures production strict-schema wire references',()=>trial([],archive=>{
  const index=JSON.parse(readFileSync(path.join(archive,'check-index.json'),'utf8'));
  assert.equal(index.live,false);assert.equal(index.cases.length,6);assert.equal(index.modelChoice,'openai:gpt-5.6-luna-high');
  for(const name of index.cases){
    const request=JSON.parse(readFileSync(path.join(archive,'check',name,'request.json'),'utf8'));
    const wire=JSON.parse(readFileSync(path.join(archive,'check',name,'wire-request.json'),'utf8'));
    assert.equal(request.request.model,'gpt-5.6-luna');assert.equal(request.decodeAliases,true);
    assert.equal(wire.response_format.type,'json_schema');assert.equal(wire.response_format.json_schema.strict,true);
    assert.equal(wire.max_completion_tokens,name.startsWith('general-')?24000:50000);
    assert.ok(!request.request.userPrompt.includes(`sense-${name.split('-')[1]}-1`));
  }
}));
test('offline fidelity can select a registered non-strict arm and reflection settings',()=>trial(['--model-choice','zai:glm-5.3-flash-high','--profile','reflection','--cases','general-簋'],archive=>{
  const wire=JSON.parse(readFileSync(path.join(archive,'check','general-簋','wire-request.json'),'utf8'));
  assert.equal(wire.model,'glm-5.3-flash');assert.deepEqual(wire.response_format,{type:'json_object'});
  assert.match(wire.messages[0].content,/JSON Schema/);assert.ok(wire.max_tokens>0);
}));


// Historical reference policy must not be replaced by current publication policy.
test('fidelity trials preserve nullable historical bindings while current wire rejects them',()=>{
  const source:GeneralExerciseSource={word:{wordId:'word',hanzi:'得以',traditional:'得以',pinyin:'déyǐ'},
    uses:[{id:'canonical-use',label:'become able because conditions permit',notes:[],exampleIds:[]}],examples:[]};
  const historical=generalExerciseSchema(source);
  historical.properties!.exercises.minItems=1;
  historical.properties!.exercises.items!.properties!.sourceUseId={type:['string','null'],enum:[null,'canonical-use']};
  const current=generalExerciseInvocation(source).outputSchema;
  const item={id:'one',sourceUseId:null,stimulus:{kind:'direct_text',text:'Be able to do something because conditions permit it.'},teachingNote:null};
  assert.deepEqual(fidelityGeneralContentErrors(source,{exercises:[item]},historical),[]);
  assert.ok(fidelityGeneralContentErrors(source,{exercises:[item]},current).length);
  assert.deepEqual(fidelityGeneralContentErrors(source,{exercises:[{...item,sourceUseId:'s1'}]},current),[]);
  for(const schema of [historical,current]){
    const sourceUseId=schema===historical?null:'s1';
    assert.ok(fidelityGeneralContentErrors(source,{exercises:[{...item,sourceUseId:'unknown'}]},schema).length);
    assert.match(fidelityGeneralContentErrors(source,{exercises:[{...item,sourceUseId,stimulus:{kind:'direct_text',text:'The answer is 得以.'}}]},schema).join(' '),/exposes.*answer/);
    assert.match(fidelityGeneralContentErrors(source,{exercises:[{...item,sourceUseId,stimulus:{kind:'phrase_cloze',frame:'Become able.',text:'没有空格。'}}]},schema).join(' '),/blank|cloze/i);
  }
  assert.ok(fidelityGeneralContentErrors(source,{exercises:[]},historical).length);
  assert.deepEqual(fidelityGeneralContentErrors(source,{exercises:[]},current),[]);
});
