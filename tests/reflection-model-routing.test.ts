import assert from 'node:assert/strict';
import { test } from 'node:test';
import { routeIndividualReflectionModel, reflectionConfigForChoice } from '../server/reflection/model-routing.ts';
test('GLM Flash high uses JSON-object structured output',()=>{
  assert.equal(reflectionConfigForChoice('zai:glm-5.3-flash-high').structuredOutputMode,'json_object');
});

test('individual routing splits evenly among the three offered arms',()=>{
  const counts:Record<string,number>={};
  for(let n=0;n<300;n++){
    const choice=routeIndividualReflectionModel(()=>(n+0.5)/300);
    counts[choice]=(counts[choice]??0)+1;
  }
  assert.deepEqual(counts,{'openai:gpt-6-luna-high':100,'zai:glm-5.3-flash-high':100,'openai:gpt-6-sol-high':100});
});

test('learner feedback splits evenly between Luna and Sol while improvement retains GLM',()=>{
  const counts:Record<string,number>={};
  for(let n=0;n<300;n++){
    const choice=routeIndividualReflectionModel(()=>(n+0.5)/300,'learner_feedback');
    counts[choice]=(counts[choice]??0)+1;
  }
  assert.deepEqual(counts,{'openai:gpt-6-luna-high':150,'openai:gpt-6-sol-high':150});
  assert.equal(routeIndividualReflectionModel(()=>0.5,'exercise_improvement'),'zai:glm-5.3-flash-high');
});
