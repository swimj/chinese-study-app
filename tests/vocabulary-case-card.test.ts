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
  assert.ok(html.indexOf('Source changed')<html.indexOf('Assessment provenance'));
  item.reassessment.eligible=false;assert.doesNotMatch(render(item),/Reassessment uses/);
});

test('known assessment finding and retired-source blocker are visible without requiring operator prose',()=>{
  const item=caseReviewFixture();item.proposal=null;item.needsDecision=true;
  item.finding={kind:'unmappable',message:'The cue does not identify one sense.'};
  item.reassessment={eligible:false,reason:'The source exercise is retired.',source:null};
  const html=render(item);assert.match(html,/Intended sense unresolved/);assert.match(html,/The cue does not identify one sense/);assert.match(html,/Reassessment unavailable: The source exercise is retired/);
});
