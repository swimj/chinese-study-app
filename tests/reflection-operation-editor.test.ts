import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, test } from 'node:test';
import type {
  ProductionMistakeReflectionItemV2,
  RepairProductionCueOperationV2,
} from '../src/domain/reflection.ts';
import { ReflectionOperationEditor } from '../src/features/reflection/ReflectionOperationEditor.tsx';

describe('reflection operation editor', () => {
  test('lists V2 cue changes compactly and does not restate Hanzi', () => {
    const markup = renderToStaticMarkup(createElement(ReflectionOperationEditor, {
      operation: cueRepairV2(),
      evidence: v2Evidence(),
      onChange: () => {},
    }));

    assert.match(markup, /reflection-cue-change-list/);
    assert.match(markup, /3 changes/);
    assert.match(markup, /kind-create/);
    assert.match(markup, /kind-replace/);
    assert.match(markup, /kind-deactivate/);
    assert.match(markup, /A bounded context/);
    assert.match(markup, /brand-new cue/);
    assert.match(markup, />target</);
    assert.doesNotMatch(markup, /Cue lifecycle changes/);
    assert.doesNotMatch(markup, /Change 1 kind/);
    assert.doesNotMatch(markup, /aria-label="Hanzi"/);
    assert.doesNotMatch(markup, /Cue to replace/);
  });
});

function cueRepairV2(): RepairProductionCueOperationV2 {
  return {
    kind: 'repair_production_cue',
    version: 2,
    wordId: 'target',
    taskId: 'production-task:target:default_production',
    changes: [
      {
        kind: 'create',
        cue: {
          cueType: 'definition_gloss',
          text: 'brand-new cue',
          acceptedWordIds: ['target'],
        },
      },
      {
        kind: 'replace',
        cueId: 'cue-1',
        replacements: [{
          cueType: 'minimal_context',
          text: 'A bounded context',
          acceptedWordIds: ['target', 'alternate'],
        }],
      },
      {
        kind: 'deactivate',
        cueId: 'cue-1',
      },
    ],
    sourceAttemptJudgments: [],
  };
}

function v2Evidence(): ProductionMistakeReflectionItemV2 {
  return {
    itemId: 'item',
    source: 'production_mistake',
    sourceActionKind: 'production',
    sourceAttemptId: 'attempt-1',
    sessionActionId: 'action-1',
    occurredAt: '2026-07-29T11:59:00.000Z',
    targetWord: {
      wordId: 'target',
      hanzi: '目标',
      pinyin: 'mùbiāo',
      meanings: ['target'],
    },
    sessionNote: null,
    existingContent: { contrastClusters: [], knownAcceptedAlternates: [] },
    servedCue: {
      cueId: 'cue-1',
      cueType: 'definition_gloss',
      text: 'target',
      acceptedWordIds: ['target'],
    },
    rawResponse: '替代',
    submittedWord: {
      wordId: 'alternate',
      hanzi: '替代',
      pinyin: 'tìdài',
      meanings: ['alternate'],
    },
    responseKind: 'matched_known_word',
  };
}
