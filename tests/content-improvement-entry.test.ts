import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { VocabularyContent } from '../src/domain/vocabulary-content.ts';
import type { VocabularyEncounterEvidence } from '../src/domain/vocabulary-session.ts';
import { ContentImprovementEntry, proposalServedEvidence, servedContentLead } from '../src/features/vocabulary-operator/content-improvement-entry.tsx';

const at = '2026-10-17T12:00:00.000Z';
const servedPrompt = 'Give the office advance notice of a planned absence.';
const currentPrompt = 'Notify the relevant people in advance so your planned absence is on record.';
const proposedPrompt = 'Let your supervisor know about planned time off beforehand, so they have it on record.';

function encounter(id: string, prompt: string, answers: string[]): VocabularyEncounterEvidence {
  return {
    encounterId: id, wordId: 'word-baobei', workNumber: 1, presentedActionId: `present-${id}`, presentedAt: at, mode: 'practice',
    snapshot: { contentId: 'exercise-general', contentVersion: 1, kind: 'production', role: 'general', body: { prompt }, assessment: { acceptedAnswers: answers } },
    responses: [], effectiveResponses: [], feedback: [], effectiveFeedback: [], skipped: false, presentationUndone: false,
  };
}

test('a proposal entry uses its own served snapshot when current and proposed content differ', () => {
  const current: Pick<VocabularyContent, 'body' | 'answers'> = {
    body: { prompt: currentPrompt }, answers: [{ wordId: 'word-baobei', acceptedForms: ['报备', '報備'] }],
  };
  const proposed = { body: { prompt: proposedPrompt }, answers: ['报备', '報備', '备案'] };
  const evidence = [encounter('served', servedPrompt, ['报备'])];
  const otherCase = [encounter('other', 'A different case was served later.', ['后来'])];
  assert.equal(proposalServedEvidence('general-case', { caseId: 'other-case', evidence: otherCase }), null);
  assert.equal(proposalServedEvidence(null, { caseId: 'general-case', evidence }), null);
  const selected = proposalServedEvidence('general-case', { caseId: 'general-case', evidence });
  const lead = servedContentLead(selected);
  assert.equal(lead.status, 'served');
  if (lead.status !== 'served') return;
  const snapshot = lead.items[0];
  assert.ok(snapshot && 'snapshot' in snapshot);
  if (!snapshot || !('snapshot' in snapshot)) return;
  assert.equal(snapshot.snapshot.body.prompt, servedPrompt);
  assert.deepEqual(snapshot.snapshot.assessment?.acceptedAnswers, ['报备']);
  assert.notEqual(snapshot.snapshot.body.prompt, current.body && typeof current.body === 'object' && !Array.isArray(current.body) ? current.body.prompt : '');
  assert.notEqual(snapshot.snapshot.body.prompt, proposed.body.prompt);
  assert.ok(!snapshot.snapshot.assessment?.acceptedAnswers.includes('報備'));
  assert.ok(!snapshot.snapshot.assessment?.acceptedAnswers.includes('备案'));

  const diagnosis = 'Clarify the practical intention without making the exercise a bureaucratic definition puzzle.';
  const html = renderToStaticMarkup(createElement(ContentImprovementEntry, {
    evidence: selected, label: 'Proposal review',
  }, createElement('h2', null, '报备 · 報備'), createElement('p', null, diagnosis),
    createElement('h5', null, 'Current item'), createElement('p', null, currentPrompt),
    createElement('p', null, '報備'),
    createElement('h5', null, 'Proposed result'), createElement('p', null, proposedPrompt),
    createElement('button', null, 'Approve and apply'), createElement('button', null, 'Edit proposal'), createElement('button', null, 'Dismiss')));
  const servedAt = html.indexOf(servedPrompt);
  const diagnosisAt = html.indexOf(diagnosis);
  const currentAt = html.indexOf(currentPrompt);
  const proposedAt = html.indexOf(proposedPrompt);
  assert.ok(servedAt >= 0 && diagnosisAt > servedAt && currentAt > diagnosisAt && proposedAt > currentAt);
  const leadRegion = html.slice(html.indexOf('vocabulary-served-lead'), html.indexOf('vocabulary-improvement-entry-body'));
  assert.match(leadRegion, /Original served content/);
  assert.match(leadRegion, /Expected answers/);
  assert.match(leadRegion, /报备/);
  assert.doesNotMatch(leadRegion, /報備|备案/);
  assert.doesNotMatch(leadRegion, /Notify the relevant people/);
  assert.doesNotMatch(leadRegion, /Let your supervisor know/);
  assert.match(html, /Approve and apply/);
  assert.match(html, /Edit proposal/);
  assert.match(html, /Dismiss/);
});

test('every served encounter leads, including one whose snapshot is missing', () => {
  const first = encounter('intro', 'Introduction shown to the learner.', []);
  const second = encounter('practice', 'Served practice cue.', ['报备']);
  const missing = { ...encounter('gap', 'This prompt must not be invented.', ['替身']), snapshot: undefined } as unknown as VocabularyEncounterEvidence;
  const diagnosis = 'No change proposed';
  const html = renderToStaticMarkup(createElement(ContentImprovementEntry, {
    evidence: [first, missing, second], label: 'No change judgment',
  }, createElement('p', null, diagnosis), createElement('p', null, currentPrompt), createElement('button', null, 'Done'), createElement('button', null, 'Second opinion')));
  const leadRegion = html.slice(html.indexOf('vocabulary-served-lead'), html.indexOf('vocabulary-improvement-entry-body'));
  assert.ok(leadRegion.indexOf('Introduction shown to the learner.') >= 0);
  assert.ok(leadRegion.indexOf('Introduction shown to the learner.') < leadRegion.indexOf('Served practice cue.'));
  assert.match(leadRegion, /not available for this encounter/);
  assert.doesNotMatch(leadRegion, /This prompt must not be invented|替身|Notify the relevant people/);
  assert.ok(html.indexOf(diagnosis) > html.indexOf('Served practice cue.'));
  assert.match(html, /Done/);
  assert.match(html, /Second opinion/);
});

test('an entry without a served snapshot says so and does not present another version as the original', () => {
  const html = renderToStaticMarkup(createElement(ContentImprovementEntry, {
    evidence: null, label: 'Proposal review',
  }, createElement('h5', null, 'Current item'), createElement('p', null, currentPrompt),
    createElement('h5', null, 'Proposed result'), createElement('p', null, proposedPrompt)));
  const noteAt = html.indexOf('The original served content is not available for this entry.');
  const currentAt = html.indexOf('Current item');
  assert.ok(noteAt >= 0 && currentAt > noteAt);
  const leadRegion = html.slice(html.indexOf('vocabulary-served-lead'), html.indexOf('vocabulary-improvement-entry-body'));
  assert.match(leadRegion, /Original served content/);
  assert.doesNotMatch(leadRegion, /Notify the relevant people|Let your supervisor know|Original cue/);
  assert.equal(servedContentLead([]).status, 'unavailable');
  assert.equal(servedContentLead(null).status, 'unavailable');
});

test('identical served snapshots render once while retaining every response and comment',()=>{
  const first=encounter('first',servedPrompt,['报备']),second=encounter('second',servedPrompt,['报备']);
  for(const [index,item] of [first,second].entries()){
    const response={protocolVersion:1 as const,actionId:`response-${index}`,clientActionId:`response-${index}`,sequence:1,occurredAt:at,kind:'response' as const,payload:{encounterId:item.encounterId,response:index?'报告':'备案',outcome:'rejected' as const}};
    item.responses=[response];item.effectiveResponses=[response];
  }
  const html=renderToStaticMarkup(createElement(ContentImprovementEntry,{evidence:[first,second],label:'Review'}));
  assert.equal(html.split(servedPrompt).length-1,1);assert.match(html,/备案/);assert.match(html,/报告/);
  second.snapshot={...second.snapshot,body:{prompt:'Different rendered wording'}};
  const mixed=renderToStaticMarkup(createElement(ContentImprovementEntry,{evidence:[first,second],label:'Review'}));
  assert.match(mixed,/Different rendered wording/);assert.match(mixed,/Give the office/);
});
