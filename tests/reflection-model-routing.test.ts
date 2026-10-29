import assert from 'node:assert/strict';
import { test } from 'node:test';
import { routeBatchedReflectionModel, routeIndividualReflectionModel, reflectionConfigForChoice } from '../server/reflection/model-routing.ts';
test('shared routing preserves exact small and large registry proportions',()=>{
  const count=(size:number)=>{
    const result:Record<string,number>={};
    for(let n=0;n<100;n++){const choice=routeBatchedReflectionModel(size,()=>n/100);result[choice]=(result[choice]??0)+1;}
    return result;
  };
  assert.deepEqual(count(10),{'openai:gpt-5.6-luna-high':30,'zai:glm-5.3-flash-high':70});
  assert.deepEqual(count(11),{'openai:gpt-5.6-luna-high':20,'zai:glm-5.3-flash-high':20,'openai:gpt-6-sol-high':60});
  assert.equal(reflectionConfigForChoice('zai:glm-5.3-flash-high').structuredOutputMode,'json_object');
  assert.throws(()=>routeBatchedReflectionModel(0),/positive item count/);
});

test('individual routing splits evenly among the three offered arms',()=>{
  const counts:Record<string,number>={};
  for(let n=0;n<300;n++){
    const choice=routeIndividualReflectionModel(()=>(n+0.5)/300);
    counts[choice]=(counts[choice]??0)+1;
  }
  assert.deepEqual(counts,{'openai:gpt-5.6-luna-high':100,'zai:glm-5.3-flash-high':100,'openai:gpt-6-sol-high':100});
});
