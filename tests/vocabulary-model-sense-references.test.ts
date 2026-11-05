import assert from 'node:assert/strict';
import {test} from 'node:test';
import {projectVocabularySenseReferences,vocabularySenseReferences} from '../server/vocabulary/model-sense-references.ts';
import {generalExerciseInvocation,normalizeGeneralExerciseReferences,validateGeneralExerciseOutput,type GeneralExerciseSource} from '../server/vocabulary/general-exercise-authoring.ts';

for(const id of ['technical-effect','fb57f552-2ef8-4df3-b2a9-701e0cb0e732'])test(`call-local projection preserves canonical ownership for ${id}`,()=>{
  const input={sourceContent:{contentId:'keep-content-id',words:[{wordId:'keep-word-id',senseId:id}],body:{sourceUseId:id}},
    senses:[{senseId:id,description:{label:'technical amplification'}}],intendedSense:{senseId:id},
    admission:{senseIds:[id],generationScope:{senseIds:[id],source:{kind:'mapped_source'}}}};
  const projected=projectVocabularySenseReferences(input);
  assert.doesNotMatch(JSON.stringify(projected.input),new RegExp(id));
  assert.deepEqual(projected.input,{sourceContent:{contentId:'keep-content-id',words:[{wordId:'keep-word-id',senseId:'s1'}],body:{sourceUseId:'s1'}},
    senses:[{senseId:'s1',description:{label:'technical amplification'}}],intendedSense:{senseId:'s1'},
    admission:{senseIds:['s1'],generationScope:{senseIds:['s1'],source:{kind:'mapped_source'}}}});
  assert.equal(projected.references.canonical('s1'),id);
  assert.equal(input.sourceContent.words[0]!.senseId,id);
  assert.throws(()=>projected.references.canonical(id),/Unknown call-local/);
  assert.throws(()=>projected.references.canonical('s99'),/Unknown call-local/);
});

test('shared general call aliases use and example references, then validates canonical output',()=>{
  const id='fb57f552-2ef8-4df3-b2a9-701e0cb0e732',exampleId=`${id}:example:1`;
  const source:GeneralExerciseSource={word:{wordId:'query',hanzi:'查询',traditional:'查詢',pinyin:'cháxún'},
    uses:[{id,label:'look up information',notes:[],exampleIds:[exampleId]}],
    examples:[{id:exampleId,text:'可以在网上查询订单。',translation:'You can look up the order online.',pronunciation:null}]};
  const invocation=generalExerciseInvocation(source),wire=JSON.parse(invocation.userPrompt);
  assert.ok(!invocation.userPrompt.includes(id));assert.ok(!JSON.stringify(invocation.outputSchema).includes(id));
  assert.equal(wire.content.uses[0].id,'s1');assert.deepEqual(wire.content.uses[0].exampleIds,['e1']);assert.equal(wire.content.examples[0].id,'e1');
  const result=normalizeGeneralExerciseReferences(source,{exercises:[{id:'one',sourceUseId:'s1',stimulus:{kind:'direct_text',text:'Look up specific information in a record or system.'},teachingNote:null}]});
  assert.equal(validateGeneralExerciseOutput(source,result).exercises[0]!.sourceUseId,id);
  assert.throws(()=>normalizeGeneralExerciseReferences(source,{exercises:[{id:'one',sourceUseId:id,stimulus:{kind:'direct_text',text:'Look up information.'},teachingNote:null}]}),/failed validation/);
  assert.throws(()=>vocabularySenseReferences([id]).alias('missing'),/Unregistered/);
});

test('historical sense references stay unlisted aliases rather than inventing active identities',()=>{
  const historical='0ecddfec-b78c-40bc-8c8a-f937baf3b1ab',active='9fef2d9f-eb72-4137-9219-c7fbf70b6dca';
  const projected=projectVocabularySenseReferences({sourceContent:{words:[{senseId:historical}]},senses:[{senseId:active,description:'current meaning'}]});
  const wire=projected.input as {sourceContent:{words:Array<{senseId:string}>};senses:Array<{senseId:string}>};
  assert.notEqual(wire.sourceContent.words[0]!.senseId,wire.senses[0]!.senseId);
  assert.equal(projected.references.canonical(wire.sourceContent.words[0]!.senseId),historical);
  assert.equal(projected.references.canonical(wire.senses[0]!.senseId),active);
  assert.ok(!JSON.stringify(wire).includes(historical));
});
