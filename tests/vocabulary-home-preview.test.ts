import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createVocabularyHomePreviewLoader, type VocabularyHomePreviewState } from '../src/features/vocabulary-study/home-preview.ts';
import type { VocabularySessionPreview } from '../src/domain/vocabulary-study-api.ts';
function deferred<T>() { let resolve!:(value:T)=>void;let reject!:(reason:unknown)=>void;
  const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject}; }
const preview=(itemCount:number):VocabularySessionPreview=>({itemCount,previewSeed:`seed-${itemCount}`,preparationPending:false});
test('settings refresh ignores a late previous count and carries only the current sampling seed',async()=>{
  const old=deferred<VocabularySessionPreview>(),fresh=deferred<VocabularySessionPreview>();
  const states:VocabularyHomePreviewState[]=[];let calls=0;
  const loader=createVocabularyHomePreviewLoader(()=>++calls===1?old.promise:fresh.promise,(state)=>states.push(state));
  const first=loader.reload(),second=loader.reload();
  fresh.resolve(preview(2));await second;old.resolve(preview(25));await first;
  assert.equal(states.at(-1)?.preview?.itemCount,2);
  assert.equal(states.at(-1)?.preview?.previewSeed,'seed-2');
  assert.equal(states.filter((state)=>state.status==='ready').length,1);
});
test('disposed Home previews cannot overwrite a subsequent visit and failed counts remain unavailable',async()=>{
  const pending=deferred<VocabularySessionPreview>(),states:VocabularyHomePreviewState[]=[];
  const loader=createVocabularyHomePreviewLoader(()=>pending.promise,(state)=>states.push(state));
  const work=loader.reload();loader.dispose();pending.resolve(preview(25));await work;
  assert.equal(states.length,1);assert.equal(states[0]?.status,'loading');
  const failed=createVocabularyHomePreviewLoader(async()=>{throw new Error('Offline');},(state)=>states.push(state));
  await failed.reload();assert.deepEqual(states.at(-1),{status:'error',preview:null,error:'Offline'});
});

test('background refresh retains a usable count and seed through loading and a transient failure',async()=>{
  const pending=deferred<VocabularySessionPreview>(),states:VocabularyHomePreviewState[]=[];let calls=0;
  const loader=createVocabularyHomePreviewLoader(()=>++calls===1?Promise.resolve(preview(12)):pending.promise,(state)=>states.push(state));
  await loader.reload();const before=states.length;
  const refresh=loader.reload({background:true});assert.equal(states.length,before);
  pending.reject(new Error('Offline'));await refresh;
  assert.equal(states.at(-1)?.status,'ready');assert.equal(states.at(-1)?.preview?.itemCount,12);
  assert.equal(states.at(-1)?.preview?.previewSeed,'seed-12');
});
