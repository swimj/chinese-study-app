import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertStrictTargetOnlyProductionSnapshot,
  type ProductionExerciseSnapshot,
} from '../src/domain/study-actions.ts';

const targetAnswer = { wordId: 'target', hanzi: '学习', traditional: '學習' };

test('word-owned production rejects a non-target served snapshot', () => {
  assert.throws(() => assertStrictTargetOnlyProductionSnapshot({
    ...createProductionSnapshot(),
    acceptedAnswers: [{ wordId: 'other', hanzi: '研习', traditional: '研習' }],
  }, 'target'), /only target word/);
});

function createProductionSnapshot(): ProductionExerciseSnapshot {
  return {
    taskId: 'task',
    cueId: 'cue',
    cueType: 'definition_gloss',
    text: 'to study',
    acceptedAnswers: [targetAnswer],
    supplement: null,
  };
}
