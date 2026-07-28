import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { SessionStudyItem, StudyAttemptEvent } from '../src/domain/study-actions.ts';
import {
  createBucketSessionState,
  markActiveSessionUnitStarted,
  rateActiveSessionUnit,
} from '../src/lib/session-state.ts';
import {
  appendAcceptedProductionAttemptIds,
  buildSessionReflectionEvidenceSupplement,
  createSessionReflectionEvidenceAccumulator,
  dropSessionReflectionEvidenceForAction,
  recordProductionMistakeEvidence,
  restoreSessionReflectionEvidence,
  snapshotSessionReflectionEvidence,
} from '../src/features/session/session-reflection-evidence.ts';
import type { Word } from '../src/types.ts';

describe('completed-session reflection evidence', () => {
  test('review production attempt batches retain the raw typed response without changing rating behavior', () => {
    const item = createStudyItem({ actionKind: 'production', status: 'review' });
    let state = markActiveSessionUnitStarted(createBucketSessionState({
      buckets: {
        review: [item],
        learning: [],
        unstudied: [],
      },
      sessionId: 'typed-response-session',
      schedulerPolicy: {
        bucketWeights: { review: 1, learning: 0, unstudied: 0 },
      },
      seed: 1,
    }));

    let result = rateActiveSessionUnit(state, 'forgot', { response: '  生字原样  ' });
    assert.equal(result.commit.type, 'none');
    assert.equal(
      result.state.reviewProgress[item.sessionActionId]?.attempts[0]?.response,
      '  生字原样  ',
    );

    state = result.state;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      state = markActiveSessionUnitStarted(state);
      result = rateActiveSessionUnit(state, 'good', { response: `correct-${attempt + 1}` });
      state = result.state;
    }

    assert.equal(result.commit.type, 'commit-review-action-session');
    if (result.commit.type !== 'commit-review-action-session') {
      throw new Error('Expected accepted review attempt batch');
    }
    assert.equal(result.commit.failureCount, 1);
    assert.equal(result.commit.terminalRating, null);
    assert.deepEqual(
      result.commit.events.map((event) => event.response),
      ['  生字原样  ', 'correct-1', 'correct-2', 'correct-3'],
    );
  });

  test('recognition attempts keep a null response even when a response option is supplied', () => {
    const item = createStudyItem({ actionKind: 'recognition', status: 'review' });
    const state = markActiveSessionUnitStarted(createBucketSessionState({
      buckets: {
        review: [item],
        learning: [],
        unstudied: [],
      },
      sessionId: 'recognition-response-session',
      schedulerPolicy: {
        bucketWeights: { review: 1, learning: 0, unstudied: 0 },
      },
      seed: 1,
    }));

    const result = rateActiveSessionUnit(state, 'good', { response: 'must not persist' });
    assert.equal(result.commit.type, 'commit-review-action-session');
    if (result.commit.type !== 'commit-review-action-session') {
      throw new Error('Expected accepted review attempt batch');
    }
    assert.equal(result.commit.events[0]?.response, null);
  });

  test('captures the first nonempty review production mistake with the full cue as shown', () => {
    const item = createStudyItem({ actionKind: 'production', status: 'review' });
    const initial = createSessionReflectionEvidenceAccumulator();
    const noClue = recordProductionMistakeEvidence(initial, {
      item,
      incorrectAttempt: createAttempt({
        item,
        id: 'no-clue',
        response: '   ',
      }),
      promptDisplayedMeanings: ['first', 'second'],
    });
    assert.equal(noClue, initial);

    const captured = recordProductionMistakeEvidence(noClue, {
      item,
      incorrectAttempt: createAttempt({
        item,
        id: 'mistake-1',
        response: '  raw response  ',
      }),
      promptDisplayedMeanings: ['first meaning', 'second meaning', 'third meaning'],
    });

    assert.deepEqual(captured, {
      schemaVersion: 'session_reflection_evidence_supplement.v1',
      items: [{
        itemId: `production-mistake:${item.sessionActionId}`,
        sessionActionId: item.sessionActionId,
        targetWordId: item.targetWordId,
        cuesAsShown: [{
          cueId: null,
          cueType: 'definition_gloss',
          displayOrder: 0,
          text: 'first meaning; second meaning; third meaning',
          displayedMeanings: ['first meaning', 'second meaning', 'third meaning'],
        }],
        rawResponse: '  raw response  ',
        attemptIds: [],
      }],
    });

    const afterAnotherMistake = recordProductionMistakeEvidence(captured, {
      item,
      incorrectAttempt: createAttempt({
        item,
        id: 'mistake-2',
        actionAttemptSequence: 2,
        response: 'later response',
      }),
      promptDisplayedMeanings: ['changed later'],
    });
    assert.equal(afterAnotherMistake, captured);
  });

  test('excludes learning production, recognition, contrast, correct, and no-clue attempts', () => {
    const cases: Array<{
      item: SessionStudyItem;
      attempt: StudyAttemptEvent;
    }> = [];
    const learningProduction = createStudyItem({ actionKind: 'production', status: 'learning' });
    cases.push({
      item: learningProduction,
      attempt: createAttempt({ item: learningProduction, id: 'learning-production', response: 'typed' }),
    });
    const recognition = createStudyItem({ actionKind: 'recognition', status: 'review' });
    cases.push({
      item: recognition,
      attempt: createAttempt({ item: recognition, id: 'recognition', response: 'typed' }),
    });
    const contrast = createStudyItem({ actionKind: 'contrast_selection', status: 'review' });
    cases.push({
      item: contrast,
      attempt: createAttempt({ item: contrast, id: 'contrast', response: 'word-id' }),
    });
    const correctProduction = createStudyItem({ actionKind: 'production', status: 'review' });
    cases.push({
      item: correctProduction,
      attempt: createAttempt({
        item: correctProduction,
        id: 'correct-production',
        outcome: 'correct',
        response: 'typed',
      }),
    });
    const noClue = createStudyItem({ actionKind: 'production', status: 'review' });
    cases.push({
      item: noClue,
      attempt: createAttempt({ item: noClue, id: 'no-clue', response: null }),
    });

    const accumulator = cases.reduce(
      (current, entry) => recordProductionMistakeEvidence(current, {
        item: entry.item,
        incorrectAttempt: entry.attempt,
        promptDisplayedMeanings: ['cue'],
      }),
      createSessionReflectionEvidenceAccumulator(),
    );

    assert.deepEqual(accumulator.items, []);
  });

  test('links one ordered accepted attempt batch, snapshots for Undo, restores, and drops canceled evidence', () => {
    const item = createStudyItem({ actionKind: 'production', status: 'review' });
    const captured = recordProductionMistakeEvidence(createSessionReflectionEvidenceAccumulator(), {
      item,
      incorrectAttempt: createAttempt({ item, id: 'attempt-1', response: 'wrong' }),
      promptDisplayedMeanings: ['cue'],
    });
    assert.throws(
      () => buildSessionReflectionEvidenceSupplement(captured),
      /has no accepted attempt ids/,
    );

    const snapshot = snapshotSessionReflectionEvidence(captured);
    assert.throws(
      () => appendAcceptedProductionAttemptIds(captured, {
        sessionActionId: item.sessionActionId,
        acceptedAttempts: [],
      }),
      /cannot link an empty accepted attempt batch/,
    );
    const linked = appendAcceptedProductionAttemptIds(captured, {
      sessionActionId: item.sessionActionId,
      acceptedAttempts: [
        createAttempt({
          item,
          id: 'attempt-3',
          actionAttemptSequence: 3,
          outcome: 'correct',
          response: 'target',
        }),
        createAttempt({ item, id: 'attempt-1', response: 'wrong' }),
        createAttempt({
          item,
          id: 'attempt-2',
          actionAttemptSequence: 2,
          outcome: 'correct',
          response: 'target',
        }),
      ],
    });
    assert.deepEqual(linked.items[0]?.attemptIds, ['attempt-1', 'attempt-2', 'attempt-3']);
    assert.deepEqual(
      buildSessionReflectionEvidenceSupplement(linked),
      linked,
    );
    assert.throws(
      () => appendAcceptedProductionAttemptIds(linked, {
        sessionActionId: item.sessionActionId,
        acceptedAttempts: [
          createAttempt({ item, id: 'attempt-1', response: 'wrong' }),
        ],
      }),
      /already linked to an accepted attempt batch/,
    );

    const restored = restoreSessionReflectionEvidence(snapshot);
    assert.deepEqual(restored.items[0]?.attemptIds, []);
    assert.notEqual(restored, snapshot);
    assert.notEqual(restored.items[0]?.cuesAsShown, snapshot.items[0]?.cuesAsShown);
    assert.deepEqual(
      dropSessionReflectionEvidenceForAction(linked, item.sessionActionId).items,
      [],
    );
  });
});

function createStudyItem({
  actionKind,
  status,
}: {
  actionKind: SessionStudyItem['actionKind'];
  status: Word['status'];
}): SessionStudyItem {
  const word = createWord(status);
  return {
    sessionActionId: `${status}/${word.id}/${actionKind}`,
    actionKind,
    targetWordId: word.id,
    sampledSkillIds:
      actionKind === 'contrast_selection'
        ? ['contextual_selection']
        : [actionKind],
    contentRef: null,
    intervalHours: 24,
    word,
    contrastSelection: null,
  };
}

function createWord(status: Word['status']): Word {
  return {
    id: `${status}-word`,
    hanzi: '目标',
    traditional: null,
    pinyin: 'mùbiāo',
    meaning: 'target',
    meanings: ['target'],
    personalNotes: '',
    examples: [],
    status,
    priority: 0,
    createdAt: '2026-07-29T00:00:00.000Z',
    learningStreak: 0,
    lastLearningSuccessOn: null,
    lastLearningCoveredOn: null,
  };
}

function createAttempt({
  item,
  id,
  actionAttemptSequence = 1,
  outcome = 'incorrect',
  response,
}: {
  item: SessionStudyItem;
  id: string;
  actionAttemptSequence?: number;
  outcome?: StudyAttemptEvent['outcome'];
  response: string | null;
}): StudyAttemptEvent {
  return {
    id,
    occurredAt: '2026-07-29T00:01:00.000Z',
    sessionId: 'reflection-session',
    sessionActionId: item.sessionActionId,
    sessionEventSequence: actionAttemptSequence,
    actionAttemptSequence,
    actionKind: item.actionKind,
    targetWordId: item.targetWordId,
    sampledSkillIds: [...item.sampledSkillIds],
    response,
    outcome,
    rating: outcome === 'incorrect' ? 'forgot' : 'good',
    contentRef: item.contentRef,
    metadata: {},
  };
}
