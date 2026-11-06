import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AssessmentReview} from '../src/features/vocabulary-operator/AssessmentReview.tsx';
import type {VocabularyAssessmentReview} from '../src/domain/vocabulary-reflection.ts';

test('main assessment metadata separates stage models, sense mapping and scope',()=>{
  const assessment:VocabularyAssessmentReview={origin:'reassessment',models:[{invocationId:'one',stage:'single_improvement',provider:'zai',model:'local-model',resolvedModel:null},{invocationId:'two',stage:'pure_cue_promotion',provider:'openai',model:'promotion-model',resolvedModel:'resolved-promotion-model'}],admission:{outcome:'single_sense',wordId:'word',sourceContentId:'source',sourceContentVersion:1,catalogVersion:1,senseIds:['sense'],sourceMapping:{senseId:null,establishedAt:null},rationale:'The cue asks for material assistance.',generationScope:{selectionEstablished:true,senseIds:['sense'],source:{kind:'mapped_source'}}}};
  const html=renderToStaticMarkup(createElement(AssessmentReview,{assessment,senses:[{senseId:'sense',wordId:'word',label:'Financial support'}]}));
  for(const expected of ['Operator reassessment','Exercise improvement','local-model','Pure cue promotion','resolved-promotion-model','Financial support','mapped source','Sense mapping rationale','material assistance'])assert.ok(html.includes(expected),expected);
  assert.ok(html.indexOf('<details>')<html.indexOf('material assistance'));
});
test('manual-only provenance does not claim an automatic model assessment',()=>{
  const html=renderToStaticMarkup(createElement(AssessmentReview,{assessment:{origin:'unavailable',models:[]},senses:[],operator:true}));
  assert.match(html,/Operator correction/);assert.doesNotMatch(html,/Automatic assessment/);
  const missing=renderToStaticMarkup(createElement(AssessmentReview,{assessment:{origin:'unavailable',models:[]},senses:[]}));
  assert.match(missing,/Assessment provenance unavailable/);
});


test('create-only stale proposal shows its current assessment source and correction action',async()=>{
  const {CompactProposalReview}=await import('../src/features/vocabulary-operator/CompactProposalReview.tsx');
  const source:import('../src/domain/vocabulary-content.ts').VocabularyContent={contentId:'source',kind:'exercise',payloadVersion:1,version:2,createdAt:'2026-10-30',updatedAt:'2026-10-30',body:{prompt:'Current source'},exerciseType:'word',skill:'production',exerciseRole:'general',assessment:{match:'exact'},accessScope:'shared',availability:'active',originKind:'human',words:[{wordId:'word',relation:'target'}],answers:[{wordId:'word',acceptedForms:['字']}]};
  const html=renderToStaticMarkup(createElement(CompactProposalReview,{operations:[{operationKey:'add',strategy:'create',scope:{kind:'shared'},rationale:'Shared practice',content:{...source,contentId:'new'}}],previews:[],currentSources:[source],bases:[{contentId:'source',expectedVersion:1}],senses:[],excluded:new Set<string>(),toggle:()=>{},disabled:false,editing:false,onChange:()=>{},onStrategy:()=>{},stale:true,onDraftCorrection:()=>{}}));
  assert.match(html,/Current source/);assert.match(html,/version 2/);assert.match(html,/Proposal based on v1/);assert.match(html,/Draft a correction from v2/);assert.match(html,/Expected answers/);
});
