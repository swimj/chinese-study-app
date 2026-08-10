import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  SESSION_REFLECTION_RESULT_V5_WIRE_SCHEMA_NAME,
  sessionReflectionResultV5WireSchema,
} from '../src/domain/reflection-result-schema.js';
import type { SessionReflectionResultV5Wire } from '../src/domain/reflection.js';
import { validateJsonSchema } from '../server/llm/json-schema-validator.js';

function result(): SessionReflectionResultV5Wire {
  return {
    schemaVersion: 'session_reflection_result.v5',
    itemResults: [{
      itemId: 'item-1',
      diagnosisTags: ['production_cue_overloaded'],
      observation: 'The served cue admitted another visible word.',
      learnerExplanation: null,
      proposals: [{
        proposalGroupKey: null,
        rationale: 'Preserve the prompt and expand its answer space.',
        operation: {
          kind: 'repair_production_cue',
          wordId: 'word-1',
          changes: [{
            kind: 'replace',
            cueId: 'cue-1',
            replacements: [{
              cueType: 'definition_gloss',
              text: 'to know (a fact)',
              acceptedWordIds: ['word-1', 'word-2'],
            }],
          }],
          sourceAttemptJudgments: [{
            kind: 'accepted_answer_space_omission',
            sourceAttemptId: 'attempt-1',
            submittedWordId: 'word-2',
          }],
        },
      }],
      questions: [],
      unhandledNeeds: [],
    }],
  };
}

describe('reflection V5 provider wire schema', () => {
  test('accepts a V2 repair without asking the model for deterministic metadata', () => {
    assert.equal(SESSION_REFLECTION_RESULT_V5_WIRE_SCHEMA_NAME, 'session_reflection_result_v5');
    assert.deepEqual(validateJsonSchema(result(), sessionReflectionResultV5WireSchema), []);
  });

  test('requires V2 contrast clusters with at least four prompts', () => {
    const contrastResult = structuredClone(result()) as unknown as {
      itemResults: Array<{ proposals: Array<{ operation: Record<string, unknown> }> }>;
    };
    contrastResult.itemResults[0]!.proposals[0]!.operation = {
      kind: 'create_contrast_cluster',
      version: 2,
      title: '目标 / 替代',
      clusterNote: null,
      members: [
        { wordId: 'word-1', nuanceNote: null },
        { wordId: 'word-2', nuanceNote: null },
      ],
      prompts: [],
    };

    assert.match(
      validateJsonSchema(contrastResult, sessionReflectionResultV5WireSchema).join('\n'),
      /prompts: expected at least 4 item/,
    );
  });

  test('rejects model-authored deterministic fields and malformed nested variants', () => {
    const versioned = structuredClone(result()) as unknown as {
      itemResults: Array<{ proposals: Array<{ operation: Record<string, unknown> }> }>;
    };
    versioned.itemResults[0]!.proposals[0]!.operation.version = 2;
    assert.match(
      validateJsonSchema(versioned, sessionReflectionResultV5WireSchema).join('\n'),
      /version: unknown property/,
    );

    const taskIdentified = structuredClone(result()) as unknown as {
      itemResults: Array<{ proposals: Array<{ operation: Record<string, unknown> }> }>;
    };
    taskIdentified.itemResults[0]!.proposals[0]!.operation.taskId =
      'production-task:word-1:default_production';
    assert.match(
      validateJsonSchema(taskIdentified, sessionReflectionResultV5WireSchema).join('\n'),
      /taskId: unknown property/,
    );

    const emptyReplacement = structuredClone(result());
    const operation = emptyReplacement.itemResults[0]!.proposals[0]!.operation;
    assert.equal(operation.kind, 'repair_production_cue');
    if (operation.kind === 'repair_production_cue') {
      const change = operation.changes[0];
      assert.equal(change?.kind, 'replace');
      if (change?.kind === 'replace') change.replacements = [];
    }
    assert.match(
      validateJsonSchema(emptyReplacement, sessionReflectionResultV5WireSchema).join('\n'),
      /replacements: expected at least 1 item/,
    );

    const reactivation = structuredClone(result()) as unknown as {
      itemResults: Array<{ proposals: Array<{ operation: Record<string, unknown> }> }>;
    };
    reactivation.itemResults[0]!.proposals[0]!.operation.changes = [{
      kind: 'activate',
      cueId: 'cue-1',
    }];
    assert.match(
      validateJsonSchema(reactivation, sessionReflectionResultV5WireSchema).join('\n'),
      /does not match any allowed schema/,
    );
  });
});
