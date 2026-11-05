import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { VocabularyProposalOperation, VocabularyContentProposal } from '../src/domain/vocabulary-reflection.ts';
import { restrictRepertoireOperations, retainedRepertoireOperations } from '../server/db/vocabulary-repertoire-revision.ts';

function operation(key:string,senseId:string,replace=false):VocabularyProposalOperation {
  const common={operationKey:key,scope:{kind:'shared' as const},rationale:'reviewed repertoire',content:{kind:'exercise' as const,
    contentId:key,payloadVersion:1,body:{prompt:key},accessScope:'shared' as const,availability:'active' as const,originKind:'human' as const,
    exerciseType:'word',skill:'production' as const,exerciseRole:'general' as const,assessment:{match:'exact'},
    words:[{wordId:'word',relation:'target' as const,senseId}],answers:[{wordId:'word',acceptedForms:['字']}]}};
  return replace?{...common,strategy:'replace',sourceContentId:'source',expectedVersion:3}:{...common,strategy:'create'};
}
test('narrowing a repertoire preserves replacement when its first item is removed',()=>{
  const original=[operation('first','a',true),operation('second','b'),operation('third','b')];
  const before=structuredClone(original);
  const result=restrictRepertoireOperations(original,'word',['b']);
  assert.deepEqual(result.map(item=>[item.operationKey,item.strategy]),[['second','replace'],['third','create']]);
  assert.equal(result[0]!.strategy!=='create'&&result[0]!.sourceContentId,'source');
  assert.equal(result[0]!.strategy!=='create'&&result[0]!.expectedVersion,3);
  assert.deepEqual(original,before);
});
test('narrowing preserves an included replacement and authored text',()=>{
  const original=[operation('first','a',true),operation('second','b')];
  assert.deepEqual(restrictRepertoireOperations(original,'word',['a']),[original[0]]);
});
test('removing all items never manufactures a retirement',()=>{
  assert.throws(()=>restrictRepertoireOperations([operation('first','a',true)],'word',[]),/Dismiss/);
});
test('unmapped repertoire items require explicit editorial review',()=>{
  const item=operation('first','a',true);delete item.content.words[0]!.senseId;
  assert.throws(()=>restrictRepertoireOperations([item],'word',['a']),/explicit target senses/);
});

test('retained selection pool preserves manual deletions and edited hidden content across repeated toggles',()=>{
  const original=[operation('first','a',true),operation('second','b'),operation('third','b')];
  const snapshot=(version:number,operations:VocabularyProposalOperation[])=>({version,operations} as VocabularyContentProposal);
  const narrowed=restrictRepertoireOperations(original,'word',['b']);
  const edited=[{...narrowed[0]!,content:{...narrowed[0]!.content,body:{prompt:'edited second'}}}];
  const revisions=[{proposal:snapshot(1,original),selectionOnly:false},{proposal:snapshot(2,narrowed),selectionOnly:true},{proposal:snapshot(3,edited),selectionOnly:false}];
  const pool=retainedRepertoireOperations(revisions);
  assert.deepEqual(pool.map(item=>[item.operationKey,item.strategy]),[['first','replace'],['second','create']]);
  const restored=restrictRepertoireOperations(pool,'word',['a','b']);
  const hiddenAgain=restrictRepertoireOperations(pool,'word',['a']);
  const next=retainedRepertoireOperations([...revisions,{proposal:snapshot(4,restored),selectionOnly:true},{proposal:snapshot(5,hiddenAgain),selectionOnly:true}]);
  assert.deepEqual(restrictRepertoireOperations(next,'word',['a','b']),restored);
  assert.deepEqual(restored[1]!.content.body,{prompt:'edited second'});
});
