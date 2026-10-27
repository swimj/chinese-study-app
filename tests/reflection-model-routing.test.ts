import assert from 'node:assert/strict';
import { test } from 'node:test';
import { routeBatchedReflectionModel, routeIndividualReflectionModel, reflectionConfigForChoice } from '../server/reflection/model-routing.ts';
import { buildReflectionSpendCap } from '../server/reflection/spend-cap.ts';
const cap=buildReflectionSpendCap(0,new Date('2026-10-26T00:00:00Z'));
test('shared routing preserves exact small and large registry proportions',()=>{
  const count=(size:number)=>{
    const result:Record<string,number>={};
    for(let n=0;n<100;n++){const choice=routeBatchedReflectionModel(size,cap,()=>n/100);result[choice]=(result[choice]??0)+1;}
    return result;
  };
  assert.deepEqual(count(10),{'openai:gpt-5.6-luna-high':30,'zai:glm-5.3-flash-high':70});
  assert.deepEqual(count(11),{'openai:gpt-5.6-luna-high':20,'zai:glm-5.3-flash-high':20,'openai:gpt-6-sol-high':60});
  assert.equal(routeBatchedReflectionModel(11,buildReflectionSpendCap(1,new Date()),()=>0.9),'openai:gpt-5.6-luna-high');
  assert.equal(reflectionConfigForChoice('zai:glm-5.3-flash-high').structuredOutputMode,'json_object');
  assert.throws(()=>routeBatchedReflectionModel(0,cap),/positive item count/);
});

test('individual routing splits evenly among the three offered arms and respects the spend guard',()=>{
  const counts:Record<string,number>={};
  for(let n=0;n<300;n++){
    const choice=routeIndividualReflectionModel(cap,()=>(n+0.5)/300);
    counts[choice]=(counts[choice]??0)+1;
  }
  assert.deepEqual(counts,{'openai:gpt-5.6-luna-high':100,'zai:glm-5.3-flash-high':100,'openai:gpt-6-sol-high':100});
  for(const ticket of [0,0.5,0.99]){
    assert.equal(routeIndividualReflectionModel(buildReflectionSpendCap(1,new Date()),()=>ticket),'openai:gpt-5.6-luna-high');
  }
});
