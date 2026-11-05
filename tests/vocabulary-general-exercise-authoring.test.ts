import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generalExerciseInvocation,validateGeneralExerciseOutput,type GeneralExerciseSource } from '../server/vocabulary/general-exercise-authoring.ts';

const source:GeneralExerciseSource={word:{wordId:'hu',hanzi:'笏',traditional:'笏',pinyin:'hù'},
  uses:[{id:'ceremonial',label:'ceremonial court tablet',notes:['Deliberately selected historical vocabulary.'],exampleIds:[]}],examples:[]};
const exercise={id:'one',sourceUseId:'ceremonial',stimulus:{kind:'direct_text',text:'A ceremonial tablet held by officials at imperial court.'},teachingNote:null};
test('active shared authoring permits empty fidelity results without a sense-exclusion contract',()=>{
  assert.deepEqual(validateGeneralExerciseOutput(source,{exercises:[]}),{exercises:[]});
  assert.throws(()=>validateGeneralExerciseOutput(source,{exercises:[],excludedUses:[]}),/failed validation/);
  assert.equal(generalExerciseInvocation(source).outputSchemaName,'vocabulary_general_exercises_v2');
});
test('specialized selected uses retain exact-target guards on the shared current path',()=>{
  assert.equal(validateGeneralExerciseOutput(source,{exercises:[exercise]}).exercises.length,1);
  assert.throws(()=>validateGeneralExerciseOutput(source,{exercises:[{...exercise,sourceUseId:'unknown'}]}),/failed validation/);
  assert.throws(()=>validateGeneralExerciseOutput(source,{exercises:[{...exercise,sourceUseId:null}]}),/failed validation/);
  assert.throws(()=>validateGeneralExerciseOutput(source,{exercises:[{...exercise,stimulus:{kind:'direct_text',text:'The answer is 笏.'}}]}),/exposes.*answer/);
  assert.throws(()=>validateGeneralExerciseOutput(source,{exercises:[exercise,exercise]}),/unique|duplicate/i);
  assert.throws(()=>validateGeneralExerciseOutput(source,{exercises:[{...exercise,stimulus:{kind:'phrase_cloze',frame:'A ceremonial tablet.',text:'没有空格。'}}]}),/blank|cloze/i);
});
