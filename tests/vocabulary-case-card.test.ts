import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CaseReviewCard } from '../src/features/vocabulary-operator/CaseReviewCard.tsx';
import { caseReviewFixture } from './fixtures/case-review-data.ts';
const render=(item=caseReviewFixture())=>renderToStaticMarkup(React.createElement(CaseReviewCard,{item,onDetails:()=>{}}));
test('compact case uses encounter time and explicitly labels missing evidence fallback',()=>{
  const item=caseReviewFixture();assert.match(render(item),/Encounter ·/);assert.doesNotMatch(render(item),/Case opened/);
  item.served[0].presentedAt=null;assert.match(render(item),/Case opened ·/);assert.doesNotMatch(render(item),/Encounter ·/);
});
test('sense groups collapse with counts and repetitive repertoire explanations appear only once',()=>{
  const item=caseReviewFixture();item.assessment!.outcome='repertoire_bootstrap';
  item.assessment!.diagnosis=item.proposal!.rationale=item.proposal!.operations[0].rationale='Repeated bootstrap reason';
  const html=render(item);assert.match(html,/Default selected senses/);assert.doesNotMatch(html,/Repertoire assessment/);
  assert.match(html,/<details class="vocabulary-sense-group"><summary>/);assert.match(html,/1 exercise/);
  assert.equal(html.split('Repeated bootstrap reason').length-1,1);
});
test('unchanged source is omitted, changed source is inside original evidence with accurate unavailable actions',()=>{
  const item=caseReviewFixture();assert.doesNotMatch(render(item),/Source changed|Current source/);
  item.sources[0].version=2;item.stale=true;
  const html=render(item);assert.match(html,/Source changed/);assert.match(html,/Approval and second opinion are unavailable/);
  assert.ok(html.indexOf('Source changed')<html.indexOf('Proposed improvement'));
  item.reassessment.eligible=false;assert.doesNotMatch(render(item),/Reassessment uses/);
});

test('known assessment finding and retired-source blocker are visible without requiring operator prose',()=>{
  const item=caseReviewFixture();item.proposal=null;item.needsDecision=true;
  item.finding={kind:'unmappable',message:'The cue does not identify one sense.'};
  item.reassessment={eligible:false,reason:'The source exercise is retired.',source:null};
  const html=render(item);assert.match(html,/Intended sense unresolved/);assert.match(html,/The cue does not identify one sense/);assert.match(html,/Reassessment unavailable: The source exercise is retired/);
});

test('pure cue uses the stored axis, direct accepted delta, and teaching note without an artificial sense',()=>{
  const item=caseReviewFixture();item.wordLabel=null;item.wordId=null;
  item.served[0].pureCue={axisNote:'Stored semantic purpose',teachingNote:'Original explanation'};
  const operation=item.proposal!.operations[0];operation.pureCue={axisNote:'Stored semantic purpose',teachingNote:'Revised explanation'};operation.acceptedAnswers=['报备','报告'];
  const html=render(item);assert.match(html,/<h2>Stored semantic purpose<\/h2>/);assert.match(html,/Revised teaching note/);assert.match(html,/Revised explanation/);assert.match(html,/changes to/);assert.doesNotMatch(html,/vocabulary-sense-group/);assert.match(html,/Accepted answers/);
  item.served[0].pureCue.axisNote=null;assert.match(render(item),/<h2>Content review<\/h2>/);
});
test('chronological first encounter leads; collapsed history retains distinct snapshots and undone evidence',()=>{
  const item=caseReviewFixture(); const earlier=structuredClone(item.served[0]);earlier.encounterId='earlier';earlier.presentedAt='2020-01-01T00:00:00Z';earlier.prompt='Earlier distinct cue';earlier.responses=[{actionId:'older-response',text:'first accepted response',outcome:'accepted',undone:true}];earlier.skipped=true;earlier.presentationUndone=true;
  item.served.push(earlier);const html=render(item);
  assert.ok(html.indexOf('Earlier distinct cue')<html.indexOf('Before taking leave'));assert.match(html,/aria-expanded="false"/);assert.match(html,/1 more encounters/);assert.match(html,/vocabulary-encounter-history" hidden/);assert.match(html,/first accepted response/);assert.match(html,/Presentation undone/);assert.match(html,/Skipped/);assert.match(html,/unfair/);
});
test('routine provenance is disclosed separately; alternatives and full workspace stay accessible',()=>{
 const item=caseReviewFixture();assert.doesNotMatch(render(item),/Assessment provenance|Proposal revision/);
 const html=renderToStaticMarkup(React.createElement(CaseReviewCard,{item,showDetails:true,onDetails:()=>{}},'Retained alternatives'));
 assert.match(html,/Assessment provenance/);assert.match(html,/Proposal revision/);assert.match(html,/Retained alternatives/);assert.match(html,/Full review workspace/);
 item.served[0].acceptedAnswers=['报备','報備'];assert.match(render(item),/Also accepted/);assert.match(render(item),/報備/);
});

test('an unresolved finding does not repeat identical diagnosis prose',()=>{
 const item=caseReviewFixture();item.finding={kind:'unmappable',message:'No single intended sense.'};item.assessment!.diagnosis=' No single intended sense. ';
 assert.equal(render(item).split('No single intended sense.').length-1,1);
 item.assessment!.diagnosis='A distinct observation.';assert.match(render(item),/A distinct observation/);
});

test('reused shared cue is visible before edits, inspectable, and never a selectable operation',()=>{
 const item=caseReviewFixture();item.reusedSharedCue={contentId:'shared-existing',prompt:'四周显得格外____。',acceptedAnswers:['静','宁静'],teachingNote:'Quiet versus tranquil.',rationale:'Both answers already accepted.',version:1,expectedVersion:1,availability:'active'};
 const html=render(item);assert.match(html,/Reuse existing/);assert.match(html,/Shared practice/);assert.match(html,/静 · 宁静/);assert.match(html,/<details><summary>Inspect shared cue/);assert.match(html,/Quiet versus tranquil/);
 assert.ok(html.indexOf('Reuse existing')<html.indexOf('vocabulary-sense-group'));
 const card=html.slice(html.indexOf('aria-label="Reused shared practice"'),html.indexOf('</article>',html.indexOf('aria-label="Reused shared practice"')));
 assert.doesNotMatch(card,/checkbox|<button/);
 item.proposal=null;assert.match(render(item),/Reuse existing/);
 delete item.reusedSharedCue;assert.doesNotMatch(render(item),/Reuse existing/);
});
test('reused cue discloses missing, retired, and changed content without claiming availability',()=>{
 const item=caseReviewFixture();item.reusedSharedCue={contentId:'missing',prompt:null,acceptedAnswers:[],teachingNote:null,rationale:'Reuse decision',version:null,expectedVersion:1,availability:null};
 assert.match(render(item),/referenced shared cue is unavailable/);assert.doesNotMatch(render(item),/Current version/);
 item.reusedSharedCue.availability='retired';item.reusedSharedCue.version=2;
 assert.match(render(item),/referenced shared cue is retired/);assert.match(render(item),/Assessed version 1/);assert.match(render(item),/Current version 2/);
});

test('teaching encounters identify their source without an exercise reassessment prerequisite',()=>{
 const item=caseReviewFixture();item.kind='teaching_review';item.proposal=null;
 item.reassessment={eligible:false,reason:'A completed assessment is required.',source:null};
 assert.match(render(item),/Teaching encounter/);assert.doesNotMatch(render(item),/A completed assessment is required/);
});
