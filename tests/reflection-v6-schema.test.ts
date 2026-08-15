import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  SESSION_REFLECTION_RESULT_V6_WIRE_SCHEMA_NAME,
  sessionReflectionResultV6WireSchema,
} from '../src/domain/reflection-result-schema.ts';
import {
  normalizeSessionReflectionResultV6,
  validateSessionReflectionResultV6,
  type SessionReflectionBundleV2,
  type SessionReflectionResultV6Wire,
} from '../src/domain/reflection.ts';
import { validateJsonSchema } from '../server/llm/json-schema-validator.ts';

const bundle: SessionReflectionBundleV2 = {
  schemaVersion: 'session_reflection_bundle.v2',
  generatedAt: '2026-08-14T08:00:00.000Z',
  session: {
    sessionId: 'session-1',
    startedAt: '2026-08-14T07:50:00.000Z',
    endedAt: '2026-08-14T08:00:00.000Z',
    studyProfile: 'mandarin',
  },
  items: [{
    itemId: 'item-1',
    source: 'production_mistake',
    sourceActionKind: 'production',
    sessionActionId: 'action-1',
    occurredAt: '2026-08-14T07:58:00.000Z',
    targetWord: {
      wordId: 'word-1',
      hanzi: '预期',
      pinyin: 'yùqī',
      meanings: ['to expect; expectation'],
    },
    sessionNote: null,
    existingContent: { contrastClusters: [], knownAcceptedAlternates: [] },
    sourceAttemptId: 'attempt-1',
    servedCue: {
      cueId: null,
      cueType: 'definition_gloss',
      text: 'to expect; expectation',
      acceptedWordIds: ['word-1'],
    },
    rawResponse: '预计',
    submittedWord: {
      wordId: 'word-2',
      hanzi: '预计',
      pinyin: 'yùjì',
      meanings: ['to estimate; to forecast'],
    },
    responseKind: 'matched_known_word',
  }],
};

function result(): SessionReflectionResultV6Wire {
  return {
    schemaVersion: 'session_reflection_result.v6',
    itemResults: [{
      itemId: 'item-1',
      diagnosisTags: ['production_cue_overloaded'],
      learnerExplanation: '预期 and 预计 overlap in forecasting, while 预期 also commonly names an expected outcome.',
      proposals: [{
        proposalGroupKey: null,
        rationale: 'Add a natural expected-outcome use without discarding the broader verbal sense.',
        operation: {
          kind: 'repair_production_cue',
          wordId: 'word-1',
          changes: [{
            kind: 'create',
            cue: {
              cueType: 'minimal_context',
              text: '这项改革的实际效果没有达到我们的____。',
              acceptedWordIds: ['word-1'],
            },
          }],
          sourceAttemptJudgments: [{ kind: 'misleading_or_overloaded_cue' }],
        },
      }],
      questions: [],
    }],
  };
}

describe('reflection V6 provider result schema', () => {
  test('uses one required item-level teaching surface and canonicalizes provenance', () => {
    assert.equal(SESSION_REFLECTION_RESULT_V6_WIRE_SCHEMA_NAME, 'session_reflection_result_v6');
    const wire = result();
    assert.deepEqual(validateJsonSchema(wire, sessionReflectionResultV6WireSchema), []);

    const normalized = normalizeSessionReflectionResultV6(wire, bundle);
    assert.deepEqual(validateSessionReflectionResultV6(normalized, bundle), []);
    const operation = normalized.itemResults[0]!.proposals[0]!.operation;
    assert.equal(operation.kind, 'repair_production_cue');
    if (operation.kind === 'repair_production_cue') {
      assert.equal(operation.taskId, 'production-task:word-1:default_production');
      assert.equal(operation.sourceAttemptJudgments[0]?.sourceAttemptId, 'attempt-1');
    }
  });

  test('rejects retired observation and unhandled-need fields', () => {
    const withObservation = structuredClone(result()) as unknown as {
      itemResults: Array<Record<string, unknown>>;
    };
    withObservation.itemResults[0]!.observation = 'Redundant diagnostic prose.';
    assert.match(
      validateJsonSchema(withObservation, sessionReflectionResultV6WireSchema).join('\n'),
      /observation: unknown property/,
    );

    const withUnhandledNeeds = structuredClone(result()) as unknown as {
      itemResults: Array<Record<string, unknown>>;
    };
    withUnhandledNeeds.itemResults[0]!.unhandledNeeds = [];
    assert.match(
      validateJsonSchema(withUnhandledNeeds, sessionReflectionResultV6WireSchema).join('\n'),
      /unhandledNeeds: unknown property/,
    );
  });

  test('requires non-empty learner feedback at the domain boundary', () => {
    const empty = result();
    empty.itemResults[0]!.learnerExplanation = ' ';
    assert.deepEqual(validateJsonSchema(empty, sessionReflectionResultV6WireSchema), []);
    assert.match(
      validateSessionReflectionResultV6(
        normalizeSessionReflectionResultV6(empty, bundle),
        bundle,
      ).join('\n'),
      /learnerExplanation: must not be empty/,
    );
  });
});
