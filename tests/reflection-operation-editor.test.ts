import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, test } from 'node:test';
import type {
  ProductionMistakeReflectionItemV2,
  ReflectionItemV5,
  PromotePureElicitationOperationV1,
  RepairProductionCueOperationV2,
} from '../src/domain/reflection.ts';
import { AcceptedWordChips, ReflectionOperationEditor } from '../src/features/reflection/ReflectionOperationEditor.tsx';

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
    assert.doesNotMatch(markup, /Add word/);
    assert.doesNotMatch(markup, /Remove word/);
  });

  test('accepted-word labels show only the fixed proposal set without editing controls', () => {
    const markup = renderToStaticMarkup(createElement(AcceptedWordChips, {
      wordOptions: [
        { wordId: 'target', hanzi: '目标', pinyin: 'mùbiāo' },
        { wordId: 'alternate', hanzi: '替代', pinyin: 'tìdài' },
      ],
      acceptedWordIds: ['target'],
    }));

    assert.match(markup, /目标 · mùbiāo/);
    assert.doesNotMatch(markup, /替代 · tìdài/);
    assert.doesNotMatch(markup, /<button|aria-pressed/);
    assert.match(markup, /read-only/);
    assert.match(markup, /is-accepted/);
  });

  test('legacy multi-answer sets remain visible and unchanged as read-only labels', () => {
    const acceptedWordIds = ['target', 'alternate'];
    const markup = renderToStaticMarkup(createElement(AcceptedWordChips, {
      wordOptions: [{ wordId: 'target', hanzi: '目标', pinyin: 'mùbiāo' }],
      acceptedWordIds,
    }));
    assert.match(markup, /目标 · mùbiāo/);
    assert.match(markup, />alternate</);
    assert.doesNotMatch(markup, /<button|aria-pressed/);
    assert.deepEqual(acceptedWordIds, ['target', 'alternate']);
  });

  test('presents promotion as a grouped future cue set without repeated word metadata', () => {
    const evidence = promotionEvidence();
    const operation: PromotePureElicitationOperationV1 = {
      kind: 'promote_pure_elicitation',
      version: 1,
      sourceAttemptId: evidence.sourceAttemptId,
      targetWordId: 'target',
      responseWordId: 'alternate',
      destination: { kind: 'existing', pureCueId: 'pure-1' },
      wordPlans: [{
        wordId: 'target',
        deactivateCueIds: ['cue-1'],
        distinctiveCueDrafts: [],
      }, {
        wordId: 'alternate',
        deactivateCueIds: [],
        distinctiveCueDrafts: [{ cueType: 'minimal_context', text: 'alternate-only context' }],
      }],
    };
    const markup = renderToStaticMarkup(createElement(ReflectionOperationEditor, {
      operation,
      evidence,
      onChange: () => {},
    }));
    assert.match(markup, /reflection-promotion-preview/);
    assert.match(markup, /目标 \/ 替代/);
    assert.match(markup, /目标 · mùbiāo/);
    assert.match(markup, /替代 · tìdài/);
    assert.equal(markup.match(/mùbiāo/g)?.length, 1);
    assert.equal(markup.match(/tìdài/g)?.length, 1);
    assert.match(markup, /reflection-promotion-cue-copy">shared axis</);
    assert.doesNotMatch(markup, /reflection-promotion-cue-copy">shared axis — explicit axis</);
    assert.match(markup, /kind-deactivate is-excluded/);
    assert.match(markup, /aria-pressed="false" aria-label="Deactivate cue: broad target"/);
    assert.match(markup, /kind-keep is-included/);
    assert.match(markup, /aria-pressed="true" aria-label="Keep cue: broad alternate"/);
    assert.match(markup, /kind-create is-included/);
    assert.match(markup, /alternate-only context/);
    assert.doesNotMatch(markup, /\(2 accepted\)/);
    assert.doesNotMatch(markup, /type="checkbox"/);
    assert.doesNotMatch(markup, /3 changes/);
    assert.doesNotMatch(markup, /Source attempt/);
    assert.doesNotMatch(markup, /Promotion scope/);
    assert.doesNotMatch(markup, /Pure elicitation destination/);
    assert.doesNotMatch(markup, /Deactivate broad word-owned cues/);
    assert.doesNotMatch(markup, /not-in-evidence/);
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

function promotionEvidence(): ReflectionItemV5 {
  const evidence = v2Evidence();
  return {
    ...evidence,
    servedCue: { ...evidence.servedCue, acceptedWordIds: ['target', 'alternate'], supplement: null },
    promotionEvidence: {
      diagnosisTags: ['production_cue_overloaded'],
      words: ['target', 'alternate'].map((wordId) => ({
        wordId,
        activeProductionCues: [{
          cueId: wordId === 'target' ? 'cue-1' : 'cue-2',
          taskId: `production-task:${wordId}:default_production`,
          cueType: 'definition_gloss',
          text: `broad ${wordId}`,
          acceptedWordIds: ['target', 'alternate'],
        }],
      })),
      intersectingPureCues: [{
        id: 'pure-1',
        stimulus: 'shared axis',
        axisNote: 'explicit axis',
        acceptedWordIds: ['target'],
      }],
    },
  };
}
