import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'node:test';
import type { ReflectionItemResult } from '../src/domain/reflection.ts';
import { ReflectionStageCompositionNotice } from '../src/features/reflection/ReflectionStageCompositionNotice.tsx';

const base: ReflectionItemResult = {
  itemId: 'item', diagnosisTags: [], learnerExplanation: 'The response fits.',
  proposals: [], questions: [],
};

test('withheld target content is inspectable without proposal controls', () => {
  const result: ReflectionItemResult = {
    ...base,
    targetSuppression: { reason: 'The target is a bound form.' },
    withheldTargetChanges: {
      wordPlan: { wordId: 'target', deactivateCueIds: ['old-cue'], distinctiveCueDrafts: [
        { cueType: 'minimal_context', text: 'Conflicting target draft' },
      ] },
      destination: { kind: 'create', stimulus: 'Conflicting shared cue', axisNote: 'Shared axis', teachingNote: 'Teaching note' },
      rationale: 'Original stage-two rationale', learnerExplanation: 'Original stage-two explanation',
    },
  };
  const markup = renderToStaticMarkup(createElement(ReflectionStageCompositionNotice, { result }));
  assert.match(markup, /The target is a bound form/);
  assert.match(markup, /Stage conflict/);
  assert.match(markup, /reflection-withheld-target-changes/);
  for (const text of ['Conflicting target draft', 'Conflicting shared cue', 'old-cue', 'Original stage-two rationale', 'Original stage-two explanation']) {
    assert.ok(markup.includes(text));
  }
  assert.doesNotMatch(markup, /<button|<input|<select|<textarea/);
});

test('suppression alone has no stage conflict indicator', () => {
  const result: ReflectionItemResult = { ...base, targetSuppression: { reason: 'Bound form.' } };
  const markup = renderToStaticMarkup(createElement(ReflectionStageCompositionNotice, { result }));
  assert.match(markup, /Bound form/);
  assert.doesNotMatch(markup, /Stage conflict|<details/);
  assert.equal(renderToStaticMarkup(createElement(ReflectionStageCompositionNotice, { result: base })), '');
});


test('dependent response plan is fully inspectable and cannot be applied', () => {
  const result: ReflectionItemResult = {
    ...base,
    targetSuppression: { reason: 'Bound form.' },
    withheldTargetChanges: {
      wordPlan: { wordId: 'target', deactivateCueIds: [], distinctiveCueDrafts: [] },
      destination: { kind: 'create', stimulus: 'Withheld shared replacement', axisNote: 'Shared axis', teachingNote: 'Teaching' },
      rationale: 'Replace the old repertoire.', learnerExplanation: 'Use shared practice.',
      dependentResponsePlan: {
        wordId: 'response', deactivateCueIds: ['old-response-cue'], distinctiveCueDrafts: [
          { cueType: 'minimal_context', text: 'Withheld response draft' },
        ],
      },
    },
  };
  const markup = renderToStaticMarkup(createElement(ReflectionStageCompositionNotice, { result }));
  assert.match(markup, /entire cue plan withheld/);
  assert.match(markup, /may rely on the withheld shared cue/);
  assert.match(markup, /Withheld response-word plan/);
  assert.match(markup, /old-response-cue/);
  assert.match(markup, /Withheld response draft/);
  assert.match(markup, /Withheld shared replacement/);
  assert.doesNotMatch(markup, /<button|<input|<select|<textarea/);
});
