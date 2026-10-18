import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseVocabularyStudyCommand } from '../server/vocabulary/study-routes.ts';

test('response parser retains explicit contrast choice identity and recognition assessment',()=>{
  assert.deepEqual(parseVocabularyStudyCommand({type:'response',response:'a',selectedWordId:'word-a'}),
    {type:'response',response:'a',selectedWordId:'word-a'});
  assert.deepEqual(parseVocabularyStudyCommand({type:'response',response:null,selfAssessment:'accepted'}),
    {type:'response',response:null,selfAssessment:'accepted'});
  for(const selectedWordId of ['',null,12,'x'.repeat(501)])assert.throws(()=>parseVocabularyStudyCommand({type:'response',response:'a',selectedWordId}),/identifier/);
});
test('feedback withdrawal and resuming admission are accepted explicit commands',()=>{
  assert.deepEqual(parseVocabularyStudyCommand({type:'feedback',feedback:'withdrawn'}),{type:'feedback',feedback:'withdrawn'});
  assert.deepEqual(parseVocabularyStudyCommand({type:'resume'}),{type:'resume'});
  assert.throws(()=>parseVocabularyStudyCommand({type:'feedback',feedback:'unknown'}),/Invalid feedback/);
});
