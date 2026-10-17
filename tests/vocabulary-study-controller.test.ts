import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createVocabularyCommandQueue, assessVocabularyResponse, vocabularyCompletionDeadline } from '../src/features/vocabulary-study/useVocabularyStudy.ts';
import { renderVocabularyTeaching, renderVocabularyReveal, vocabularyTeachingBeats } from '../src/features/vocabulary-study/render-material.tsx';
import type { VocabularySessionCompletion } from '../src/domain/vocabulary-session-api.ts';

function deferred<T>() { let resolve!: (value:T)=>void;let reject!:(reason:unknown)=>void;
  const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject}; }

test('incremental command queue orders acknowledgments and final flush waits for every command',async()=>{
  const queue=createVocabularyCommandQueue();const first=deferred<string>();const seen:string[]=[];
  const a=queue.enqueue('answer-id',async(id)=>{seen.push(id);return first.promise;});
  const b=queue.enqueue('feedback-id',async(id)=>{seen.push(id);return 'feedback saved';});
  let finalized=false;const final=queue.flush().then(()=>{finalized=true;});
  await Promise.resolve();assert.deepEqual(seen,['answer-id']);assert.equal(finalized,false);
  first.resolve('answer saved');assert.equal(await a,'answer saved');assert.equal(await b,'feedback saved');await final;
  assert.deepEqual(seen,['answer-id','feedback-id']);assert.equal(queue.pending,false);assert.equal(finalized,true);
});

test('failed saves block the boundary and Retry reuses the original command identity and payload',async()=>{
  const queue=createVocabularyCommandQueue();const seen:string[]=[];let fail=true;
  const a=queue.enqueue('same-id',async(id)=>{seen.push(`${id}:原文`);if(fail)throw new Error('offline');return 'saved';});
  const b=queue.enqueue('next-id',async(id)=>{seen.push(id);return 'next';});
  await assert.rejects(a,/offline/);await assert.rejects(queue.flush(),/offline/);
  assert.equal(queue.pending,true);assert.deepEqual(seen,['same-id:原文']);
  fail=false;await queue.retry();assert.equal(await b,'next');await queue.flush();
  assert.deepEqual(seen,['same-id:原文','same-id:原文','next-id']);assert.equal(queue.error,null);assert.equal(queue.pending,false);
});

test('queue failure after earlier acceptance never resends the acknowledged command',async()=>{
  const queue=createVocabularyCommandQueue();const seen:string[]=[];let fail=true;
  await queue.enqueue('accepted',async(id)=>{seen.push(id);return true;});
  const rejected=queue.enqueue('retry',async(id)=>{seen.push(id);if(fail)throw new Error('lost response');return true;});
  await assert.rejects(rejected,/lost response/);fail=false;await queue.retry();
  assert.deepEqual(seen,['accepted','retry','retry']);
});

test('immediate local assessment uses the prepared forms and existing Mandarin punctuation normalization',()=>{
  assert.equal(assessVocabularyResponse(['甲','甲字'],' 甲！ '),'accepted');
  assert.equal(assessVocabularyResponse(['字'],' 字， '),'accepted');
  assert.equal(assessVocabularyResponse(['甲'],'乙'),'rejected');
  assert.equal(assessVocabularyResponse(['甲'],null),'rejected');
  assert.equal(assessVocabularyResponse(['甲'],' ！ '),'rejected');
});

test('completion countdown uses the server interval rather than the browser wall-clock offset',()=>{
  const completion={closeAt:'2026-10-17T10:00:15.000Z',serverNow:'2026-10-17T10:00:03.000Z'} as VocabularySessionCompletion;
  assert.equal(vocabularyCompletionDeadline(completion,1000),13000);
  assert.equal(vocabularyCompletionDeadline({...completion,serverNow:'2026-10-17T10:00:20.000Z'},1000),1000);
});

test('introduction rendering preserves ordered materialized authored text without serializing source JSON',()=>{
  const material={beats:[{id:'first',parts:[{text:'An introduction',source:{kind:'text'}},{text:'我亲眼看见了。',source:{kind:'example',field:'sentence'}}]},
    {id:'second',parts:[{text:'Use this when you saw it yourself.',source:{kind:'use_note',useId:'private-id'}}]}],sourcePackageId:'hidden-provenance'};
  assert.equal(vocabularyTeachingBeats(material).length,2);
  const first=renderToStaticMarkup(createElement('div',{},renderVocabularyTeaching(material,0)));
  assert.match(first,/An introduction/);assert.match(first,/我亲眼看见了/);assert.doesNotMatch(first,/saw it yourself|hidden-provenance|private-id/);
  const second=renderToStaticMarkup(createElement('div',{},renderVocabularyTeaching(material,1)));
  assert.match(second,/saw it yourself/);assert.doesNotMatch(second,/sourcePackageId|private-id/);
});

test('reveal renderer includes authored explanations but excludes hidden metadata and answer contracts',()=>{
  const html=renderToStaticMarkup(createElement('div',{},renderVocabularyReveal({reveal:{englishFrame:'Seen firsthand',exampleSentence:'我亲眼看见了。',axisNote:'Direct evidence'},
    source:{promptTemplate:'private prompt'},assessment:{acceptedAnswers:['hidden']}})));
  assert.match(html,/Seen firsthand/);assert.match(html,/Direct evidence/);assert.doesNotMatch(html,/private prompt|hidden|acceptedAnswers/);
});

test('recognition presentation conceals pinyin until reveal, then renders pinyin and meaning',async()=>{
  const {vocabularyPresentationWord,renderVocabularyRecognitionAnswer}=await import('../src/features/vocabulary-study/render-material.tsx');
  const word={id:'a',hanzi:'甲',pinyin:'jiǎ',meaning:'first heavenly stem'};
  assert.equal(vocabularyPresentationWord(word,'recognition',false),null);
  assert.equal(vocabularyPresentationWord(word,'recognition',true),null);
  assert.equal(vocabularyPresentationWord(word,'production',false),null);
  assert.deepEqual(vocabularyPresentationWord(word,'production',true),word);
  const revealed=renderToStaticMarkup(createElement('div',{},renderVocabularyRecognitionAnswer(word.pinyin,word.meaning)));
  assert.match(revealed,/jiǎ/);assert.match(revealed,/first heavenly stem/);
});

test('full history retains more than 24 words, refreshes revisit recency, and conceals the current production target',async()=>{
  const {vocabularySessionHistory}=await import('../src/features/vocabulary-study/history.ts');
  const {projectVocabularySession}=await import('../src/domain/vocabulary-session.ts');
  type Action=import('../src/domain/vocabulary-session.ts').VocabularySessionAction;
  type Study=import('../src/domain/vocabulary-study-api.ts').VocabularyStudy;
  type Input=Action extends infer A?A extends Action?Pick<A,'kind'|'payload'>:never:never;
  const words=Array.from({length:28},(_,index)=>({wordId:`word-${index}`,mode:'practice' as const}));
  const context={sessionId:'long-history',words};const actions:Action[]=[];
  const append=(input:Input)=>actions.push({...input,protocolVersion:1,sequence:actions.length+1,actionId:`action-${actions.length+1}`,clientActionId:`client-${actions.length+1}`,occurredAt:'2026-10-17T00:00:00.000Z'});
  const present=(wordId:string,encounterId:string)=>append({kind:'presentation',payload:{wordId,encounterId,snapshot:{contentId:encounterId,contentVersion:1,kind:'production',role:'general',body:{prompt:'A fair cue'},assessment:{acceptedAnswers:[wordId]}}}});
  for(const word of words){present(word.wordId,word.wordId);append({kind:'response',payload:{encounterId:word.wordId,response:word.wordId,outcome:'accepted'}});append({kind:'word_wrap',payload:{wordId:word.wordId,reason:'policy'}});}
  const view=():Study=>{const projection=projectVocabularySession(context,actions);return {session:{sessionId:context.sessionId,status:'active',context,actions,projection,completion:null},
    words:words.map((word)=>({...word,hanzi:word.wordId,traditional:null,pinyin:'pinyin',meaning:'meaning'})),currentWordId:projection.encounters.at(-1)!.wordId,currentEncounter:projection.encounters.at(-1)!,notice:null,
    controls:{canNext:true,canSkip:true,canEnough:true,canMore:true,canUndo:true,canFinishForNow:true,canFinishImmediately:false,canChangeMode:true}};};
  let history=vocabularySessionHistory(view(),true);
  assert.equal(history.length,28);assert.equal(history[0].wordId,'word-27');assert.equal(history.at(-1)?.wordId,'word-0');
  append({kind:'word_more',payload:{wordId:'word-0'}});present('word-0','revisit');
  history=vocabularySessionHistory(view(),false);
  assert.equal(history.length,27);assert.equal(history.some((word)=>word.wordId==='word-0'),false);
  append({kind:'response',payload:{encounterId:'revisit',response:'word-0',outcome:'accepted'}});
  history=vocabularySessionHistory(view(),true);
  assert.equal(history.length,28);assert.equal(history[0].wordId,'word-0');assert.equal(history[1].wordId,'word-27');
});
