import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeSenseLabels,scopeBlocksNavigation,coverageImpact,scopeAffectsProposal } from '../src/features/vocabulary-operator/sense-coverage.ts';
import type { VocabularySenseCoverageWorkspace } from '../src/domain/vocabulary-sense-coverage.ts';
import type { VocabularyContentProposal } from '../src/domain/vocabulary-reflection.ts';
function workspace(known=true):VocabularySenseCoverageWorkspace{return {word:{wordId:'word',version:known?1:0,defaultUsefulSenseIds:known?['first','second']:null,excludedSenseIds:[]},review:null,includedSenseIds:known?['first','second']:[],selectionEstablished:known,fingerprint:'fixture',senses:['first','second'].map(senseId=>({senseId,wordId:'word',description:{label:senseId},status:'active',version:1,createdAt:'2026-10-29',updatedAt:'2026-10-29'})),productionExerciseCounts:{first:6,second:2}};}
test('shared impact counts existing mapped exercises, including preserved serving under unknown defaults',()=>{
  assert.equal(coverageImpact(workspace(),['first']),2);assert.equal(coverageImpact(workspace(),[]),8);
  assert.equal(coverageImpact(workspace(false),['first']),2);
  const current=workspace();current.word.excludedSenseIds=['second'];current.word.defaultUsefulSenseIds=['first'];
  assert.equal(coverageImpact(current,['first']),0);
});
test('review invalidation is case-specific while shared invalidation follows word identity',()=>{
  const proposal={caseId:'case',operations:[{strategy:'create',content:{words:[{wordId:'word',relation:'target'}]}}]} as VocabularyContentProposal;
  assert.equal(scopeAffectsProposal(proposal,'case','case','word'),true);assert.equal(scopeAffectsProposal(proposal,'case','child','word'),false);
  assert.equal(scopeAffectsProposal(proposal,'word','other-case','word'),true);assert.equal(scopeAffectsProposal(proposal,'word','case','other-word'),false);
});

test('a scope refresh preserves sense labels for other words',()=>{
 const old=[{wordId:'one',senseId:'old',label:'Old label'},{wordId:'two',senseId:'other',label:'Other word'}];
 assert.deepEqual(mergeSenseLabels(old,'one',[{wordId:'one',senseId:'new',label:'New label'}]),[old[1],{wordId:'one',senseId:'new',label:'New label'}]);
});
test('plain scope reads do not lock navigation; unsaved edits and writes do',()=>{
 assert.equal(scopeBlocksNavigation(false,false),false);assert.equal(scopeBlocksNavigation(false,true),true);assert.equal(scopeBlocksNavigation(true,false),true);
});
