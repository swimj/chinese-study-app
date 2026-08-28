import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  SESSION_REFLECTION_RESULT_V7_WIRE_SCHEMA_NAME,
  sessionReflectionResultV7WireSchema,
} from '../src/domain/reflection-result-schema.ts';
import {
  SYNTHETIC_REFLECTION_ATTEMPT_ID_PREFIX,
  normalizeSessionReflectionResultV7,
  validateSessionReflectionResultV7,
  type SessionReflectionBundleV4,
  type SessionReflectionResultV7Wire,
} from '../src/domain/reflection.ts';
import { validateJsonSchema } from '../server/llm/json-schema-validator.ts';

const bundle: SessionReflectionBundleV4 = {
  schemaVersion: 'session_reflection_bundle.v4',
  generatedAt: '2026-08-20T01:00:00.000Z',
  session: {
    sessionId: 'session-1',
    startedAt: '2026-08-20T00:30:00.000Z',
    endedAt: '2026-08-20T00:55:00.000Z',
    studyProfile: 'mandarin',
  },
  items: [{
    itemId: 'item-1',
    source: 'production_mistake',
    sourceActionKind: 'production',
    sessionActionId: 'action-1',
    occurredAt: '2026-08-20T00:45:00.000Z',
    targetWord: {
      wordId: 'baobi',
      hanzi: '包庇',
      pinyin: 'bāobì',
      meanings: ['to shield', 'to harbor'],
    },
    sessionNote: null,
    existingContent: { contrastClusters: [], knownAcceptedAlternates: [] },
    sourceAttemptId: 'attempt-1',
    servedCue: {
      cueId: null,
      cueType: 'definition_gloss',
      text: 'to shield; to harbor; to cover up',
      acceptedWordIds: ['baobi'],
      supplement: null,
    },
    rawResponse: '保护',
    submittedWord: null,
    responseKind: 'unmatched_text',
  }],
};

function result(): SessionReflectionResultV7Wire {
  return {
    schemaVersion: 'session_reflection_result.v7',
    itemResults: [{
      itemId: 'item-1',
      diagnosisTags: ['ordinary_retrieval_noise'],
      learnerExplanation: 'The definition cue is fair; a legal-context example can reinforce its register.',
      proposals: [{
        proposalGroupKey: null,
        rationale: 'Keep the cue and add one post-reveal natural context.',
        operation: {
          kind: 'add_production_cue_supplement',
          wordId: 'baobi',
          englishFrame: 'Knowingly shielding a wrongdoer from responsibility.',
          exampleSentence: '他明知儿子犯了罪，却包庇了他。',
          exampleTranslation: 'He knew his son had committed a crime but shielded him.',
        },
      }],
      questions: [],
    }],
  };
}

describe('session reflection V7 result schema', () => {
  test('normalizes a strict supplement wire operation onto the exact served fallback', () => {
    const wire = result();
    assert.equal(SESSION_REFLECTION_RESULT_V7_WIRE_SCHEMA_NAME, 'session_reflection_result_v7');
    assert.deepEqual(validateJsonSchema(wire, sessionReflectionResultV7WireSchema), []);

    const normalized = normalizeSessionReflectionResultV7(wire, bundle);
    assert.deepEqual(validateSessionReflectionResultV7(normalized, bundle), []);
    assert.deepEqual(normalized.itemResults[0]?.proposals[0]?.operation, {
      ...wire.itemResults[0]!.proposals[0]!.operation,
      version: 1,
      taskId: 'production-task:baobi:default_production',
      cueId: null,
    });
  });

  test('keeps synthetic remediation cue changes without inventing attempt judgments', () => {
    const syntheticBundle = structuredClone(bundle);
    syntheticBundle.items[0]!.sourceAttemptId =
      `${SYNTHETIC_REFLECTION_ATTEMPT_ID_PREFIX}legacy-remediation:baobi`;
    const wire: SessionReflectionResultV7Wire = {
      schemaVersion: 'session_reflection_result.v7',
      itemResults: [{
        itemId: 'item-1',
        diagnosisTags: ['production_cue_overloaded'],
        learnerExplanation: 'The fallback cue is too broad.',
        proposals: [{
          proposalGroupKey: null,
          rationale: 'Use a narrower durable cue.',
          operation: {
            kind: 'repair_production_cue',
            wordId: 'baobi',
            changes: [{
              kind: 'create',
              cue: {
                cueType: 'minimal_context',
                text: 'Knowingly shielding a wrongdoer',
                acceptedWordIds: ['baobi'],
              },
            }],
            sourceAttemptJudgments: [{ kind: 'misleading_or_overloaded_cue' }],
          },
        }],
        questions: [],
      }],
    };

    const normalized = normalizeSessionReflectionResultV7(wire, syntheticBundle);
    const operation = normalized.itemResults[0]?.proposals[0]?.operation;
    assert.equal(operation?.kind, 'repair_production_cue');
    assert(operation?.kind === 'repair_production_cue' && operation.version === 2);
    assert.equal(operation.changes[0]?.kind, 'create');
    assert.deepEqual(operation.sourceAttemptJudgments, []);
  });

  test('rejects hidden attachment ids, non-definition evidence, existing supplements, and targetless examples', () => {
    const withHiddenId = structuredClone(result()) as unknown as Record<string, unknown>;
    const hiddenOperation = (((withHiddenId.itemResults as unknown[])[0] as Record<string, unknown>)
      .proposals as Array<Record<string, unknown>>)[0]!.operation as Record<string, unknown>;
    hiddenOperation.cueId = 'model-chosen';
    assert.match(
      validateJsonSchema(withHiddenId, sessionReflectionResultV7WireSchema).join('\n'),
      /cueId: unknown property/,
    );

    const normalized = normalizeSessionReflectionResultV7(result(), bundle);
    const nonDefinition = structuredClone(bundle);
    nonDefinition.items[0]!.servedCue.cueType = 'minimal_context';
    assert.match(validateSessionReflectionResultV7(normalized, nonDefinition).join('\n'), /definition-gloss/);

    const existing = structuredClone(bundle);
    existing.items[0]!.servedCue.supplement = {
      supplementId: 'supplement-1',
      englishFrame: 'Existing frame',
      exampleSentence: '这里已经有包庇的例子。',
      exampleTranslation: 'There is already an example here.',
    };
    assert.match(validateSessionReflectionResultV7(normalized, existing).join('\n'), /already has a supplement/);

    const targetless = structuredClone(normalized);
    const operation = targetless.itemResults[0]!.proposals[0]!.operation;
    assert.equal(operation.kind, 'add_production_cue_supplement');
    if (operation.kind === 'add_production_cue_supplement') {
      operation.exampleSentence = '这是一个没有目标词的例子。';
    }
    assert.match(validateSessionReflectionResultV7(targetless, bundle).join('\n'), /must contain the target expression/);
  });
});
