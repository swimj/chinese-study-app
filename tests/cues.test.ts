import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertTargetedCueAcceptsOnlyOwner,
  matchServedCueAnswer,
  type CueContent,
  type PureCueContent,
  type TargetedCueContent,
} from '../src/domain/cues.ts';
import { resolvePureCueResponse, type PureCue } from '../src/domain/pure-cues.ts';
import {
  resolveAcceptedProductionResponse,
  resolveSessionProductionResponse,
} from '../src/domain/production-response.ts';

const targetAnswer = { wordId: 'target', hanzi: '学习', traditional: '學習' };
const alternateAnswer = { wordId: 'alternate', hanzi: '研习', traditional: '研習' };

test('cue content distinguishes targeted ownership from a pure semantic axis', () => {
  const targeted: TargetedCueContent = {
    kind: 'targeted',
    id: 'cue-target',
    ownerWordId: 'target',
    format: 'definition_gloss',
    stimulus: 'to study',
    acceptedWordIds: ['target'],
    active: true,
  };
  const pure: PureCueContent = {
    kind: 'pure',
    id: 'cue-pure',
    stimulus: 'They ___ the subject in depth.',
    axisNote: 'Neutral or formal ways to study a subject.',
    acceptedWordIds: ['target', 'alternate'],
    active: true,
  };

  const contents: CueContent[] = [targeted, pure];
  assert.equal(contents[0]?.kind === 'targeted' ? contents[0].ownerWordId : null, 'target');
  assert.equal(contents[1]?.kind === 'pure' ? contents[1].axisNote : null, pure.axisNote);
});

test('a pure cue composes shared content with learner study state', () => {
  const cue: PureCue = {
    kind: 'pure',
    id: 'cue-pure',
    stimulus: 'They ___ the subject in depth.',
    axisNote: 'Neutral or formal ways to study a subject.',
    acceptedWordIds: ['target', 'alternate'],
    active: true,
    intervalHours: 24,
    easeFactor: 2.5,
    lastStudiedAt: null,
    nextDueAt: '2026-09-20T00:00:00.000Z',
    strongSince: null,
    strongSuccesses: 0,
  };

  assert.equal(cue.kind, 'pure');
  assert.equal(cue.intervalHours, 24);
});

test('shared frozen-answer matching is profile-aware and returns stable identity', () => {
  const snapshot = { acceptedAnswers: [targetAnswer, alternateAnswer] };

  assert.equal(matchServedCueAnswer(snapshot, ' 學 習 ')?.wordId, 'target');
  assert.equal(matchServedCueAnswer(snapshot, '研習')?.wordId, 'alternate');
  assert.equal(matchServedCueAnswer(snapshot, 'unknown'), null);
  assert.equal(matchServedCueAnswer(snapshot, null), null);
  assert.equal(matchServedCueAnswer({
    acceptedAnswers: [{ wordId: 'french-target', hanzi: 'étudier', traditional: null }],
  }, 'ETUDIER', 'french')?.wordId, 'french-target');
});

test('word-owned and pure response resolution share matching without sharing ownership policy', () => {
  assert.deepEqual(resolveSessionProductionResponse({
    submittedText: '學習',
    anchorWordId: 'target',
    production: {
      taskId: 'production-task:target:default_production',
      cueId: 'cue-target',
      cueType: 'definition_gloss',
      text: 'to study',
      acceptedAnswers: [targetAnswer],
      supplement: null,
    },
  }), {
    submittedText: '學習',
    result: 'accepted_anchor',
  });
  assert.deepEqual(resolveAcceptedProductionResponse({
    submittedText: '學習',
    anchorWordId: 'target',
    acceptedAnswers: [targetAnswer],
  }), {
    submittedText: '學習',
    result: 'accepted_anchor',
  });
  assert.deepEqual(resolvePureCueResponse({
    snapshotId: 'snapshot-pure',
    pureCueId: 'pure-cue',
    servedAt: '2026-09-20T00:00:00.000Z',
    stimulus: 'They ___ the subject in depth.',
    axisNote: 'Neutral or formal ways to study a subject.',
    acceptedAnswers: [targetAnswer, alternateAnswer],
  }, '研習'), {
    outcome: 'accepted',
    submittedWordId: 'alternate',
  });

  assert.throws(() => assertTargetedCueAcceptsOnlyOwner({
    acceptedAnswers: [targetAnswer, alternateAnswer],
  }, 'target'), /exactly one accepted answer/);
  assert.throws(() => resolveAcceptedProductionResponse({
    submittedText: '研習',
    anchorWordId: 'target',
    acceptedAnswers: [targetAnswer, alternateAnswer],
  }), /exactly one accepted answer/);
});
