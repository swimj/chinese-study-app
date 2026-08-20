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
  appendAcceptedLearnerRequestedAttemptIds,
  buildLearnerRequestedReflectionSupplement,
  buildSessionReflectionEvidenceSupplement,
  createLearnerRequestedReflectionAccumulator,
  createSessionReflectionEvidenceAccumulator,
  dropSessionReflectionEvidenceForAction,
  dropLearnerRequestedReflectionForAction,
  recordProductionMistakeEvidence,
  restoreSessionReflectionEvidence,
  snapshotSessionReflectionEvidence,
  toggleLearnerRequestedReview,
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

    let result = rateActiveSessionUnit(state, 'forgot', {
      response: '  生字原样  ',
      productionResponse: {
        submittedText: '  生字原样  ',
        submittedWordId: null,
        result: 'rejected',
      },
    });
    assert.equal(result.commit.type, 'none');
    assert.equal(
      result.state.reviewProgress[item.sessionActionId]?.attempts[0]?.response,
      '  生字原样  ',
    );
    assert.deepEqual(
      result.state.reviewProgress[item.sessionActionId]?.attempts[0]?.metadata.production,
      {
        taskId: 'production-task:review-word:default_production',
        cueId: null,
        cueType: 'definition_gloss',
        text: 'target',
        acceptedWordIds: ['review-word'],
        supplement: null,
        anchorWordId: 'review-word',
        submittedText: '  生字原样  ',
        submittedWordId: null,
        result: 'rejected',
        recheckDemandId: null,
      },
    );

    state = result.state;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      state = markActiveSessionUnitStarted(state);
      const response = `correct-${attempt + 1}`;
      result = rateActiveSessionUnit(state, 'good', {
        response,
        productionResponse: {
          submittedText: response,
          submittedWordId: item.targetWordId,
          result: 'accepted_anchor',
        },
      });
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

  test('no clue uses ordinary Forgot reinforcement with null response provenance', () => {
    const item = createStudyItem({ actionKind: 'production', status: 'review' });
    let state = markActiveSessionUnitStarted(createBucketSessionState({
      buckets: { review: [item], learning: [], unstudied: [] },
      sessionId: 'no-clue-session',
      schedulerPolicy: { bucketWeights: { review: 1, learning: 0, unstudied: 0 } },
      seed: 1,
    }));

    let result = rateActiveSessionUnit(state, 'forgot', {
      response: null,
      productionResponse: {
        responseKind: 'no_clue',
        submittedText: null,
        submittedWordId: null,
        result: 'rejected',
      },
    });
    const noClueAttempt = result.state.reviewProgress[item.sessionActionId]?.attempts[0];
    assert.equal(result.commit.type, 'none');
    assert.equal(noClueAttempt?.response, null);
    assert.equal(noClueAttempt?.outcome, 'incorrect');
    assert.equal(noClueAttempt?.rating, 'forgot');
    assert.deepEqual(noClueAttempt?.metadata.production, {
      taskId: 'production-task:review-word:default_production',
      cueId: null,
      cueType: 'definition_gloss',
      text: 'target',
      acceptedWordIds: ['review-word'],
      supplement: null,
      anchorWordId: 'review-word',
      responseKind: 'no_clue',
      submittedText: null,
      submittedWordId: null,
      result: 'rejected',
      recheckDemandId: null,
    });
    assert.equal(result.state.reviewProgress[item.sessionActionId]?.failureCount, 1);
    assert.equal(result.state.reviewProgress[item.sessionActionId]?.reinforcementStreak, 0);

    state = result.state;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      state = markActiveSessionUnitStarted(state);
      result = rateActiveSessionUnit(state, 'good', {
        response: '目标',
        productionResponse: {
          submittedText: '目标',
          submittedWordId: item.targetWordId,
          result: 'accepted_anchor',
        },
      });
      state = result.state;
    }
    assert.equal(result.commit.type, 'commit-review-action-session');
    if (result.commit.type !== 'commit-review-action-session') throw new Error('Expected covered review batch');
    assert.equal(result.commit.failureCount, 1);
    assert.equal(result.commit.terminalRating, null);
    assert.deepEqual(result.commit.events.map((event) => event.response), [null, '目标', '目标', '目标']);
  });

  test('an accepted typed response can still be learner-rated forgot', () => {
    const item = createStudyItem({ actionKind: 'production', status: 'review' });
    const state = markActiveSessionUnitStarted(createBucketSessionState({
      buckets: {
        review: [item],
        learning: [],
        unstudied: [],
      },
      sessionId: 'accepted-forgot-session',
      schedulerPolicy: {
        bucketWeights: { review: 1, learning: 0, unstudied: 0 },
      },
      seed: 1,
    }));

    const result = rateActiveSessionUnit(state, 'forgot', {
      response: '目标',
      productionResponse: {
        submittedText: '目标',
        submittedWordId: item.targetWordId,
        result: 'accepted_anchor',
      },
    });

    assert.equal(result.commit.type, 'none');
    const attempt = result.state.reviewProgress[item.sessionActionId]?.attempts[0];
    assert.equal(attempt?.outcome, 'incorrect');
    assert.equal(attempt?.rating, 'forgot');
    assert.equal(attempt?.metadata.production && (
      attempt.metadata.production as { result?: unknown }
    ).result, 'accepted_anchor');
    assert.equal(result.state.reviewProgress[item.sessionActionId]?.failureCount, 1);
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
          text: 'target',
          displayedMeanings: [],
        }],
        rawResponse: '  raw response  ',
        responseKind: 'typed',
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

    const durableItem: SessionStudyItem = {
      ...item,
      contentRef: {
        type: 'production_cue',
        taskId: 'production-task:review-word:default_production',
        cueId: 'circumstance-cue',
      },
      production: {
        taskId: 'production-task:review-word:default_production',
        cueId: 'circumstance-cue',
        cueType: 'circumstance',
        text: 'When choosing a target under uncertain conditions',
        acceptedWordIds: ['review-word'],
        recheckDemandId: null,
      },
    };
    const durableCaptured = recordProductionMistakeEvidence(initial, {
      item: durableItem,
      incorrectAttempt: createAttempt({
        item: durableItem,
        id: 'durable-mistake',
        response: 'wrong',
      }),
      promptDisplayedMeanings: ['must not replace the durable cue'],
    });
    assert.deepEqual(durableCaptured.items[0]?.cuesAsShown, [{
      cueId: 'circumstance-cue',
      cueType: 'circumstance',
      displayOrder: 0,
      text: 'When choosing a target under uncertain conditions',
      displayedMeanings: [],
    }]);
  });

  test('excludes learning production, recognition, contrast, and correct attempts', () => {
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

  test('captures no clue without fabricating a response', () => {
    const item = createStudyItem({ actionKind: 'production', status: 'review' });
    const state = markActiveSessionUnitStarted(createBucketSessionState({
      buckets: { review: [item], learning: [], unstudied: [] },
      sessionId: 'no-clue-evidence-session',
      schedulerPolicy: { bucketWeights: { review: 1, learning: 0, unstudied: 0 } },
      seed: 1,
    }));
    const transition = rateActiveSessionUnit(state, 'forgot', {
      response: null,
      productionResponse: {
        responseKind: 'no_clue',
        submittedText: null,
        submittedWordId: null,
        result: 'rejected',
      },
    });
    const attempt = transition.state.reviewProgress[item.sessionActionId]?.attempts[0];
    if (!attempt) throw new Error('Expected no-clue attempt');

    const captured = recordProductionMistakeEvidence(
      createSessionReflectionEvidenceAccumulator(),
      { item, incorrectAttempt: attempt, promptDisplayedMeanings: ['target'] },
    );
    assert.equal(captured.items[0]?.rawResponse, null);
    assert.equal(captured.items[0]?.responseKind, 'no_clue');
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

  test('keeps an explicit review request outside Undo while joining it to the accepted action batch', () => {
    const item = createStudyItem({ actionKind: 'production', status: 'review' });
    let requests = toggleLearnerRequestedReview(
      createLearnerRequestedReflectionAccumulator(), item, ['target'],
    );
    const undoSnapshot = snapshotSessionReflectionEvidence(createSessionReflectionEvidenceAccumulator());
    assert.equal(requests.items.length, 1);
    assert.deepEqual(restoreSessionReflectionEvidence(undoSnapshot).items, []);

    requests = appendAcceptedLearnerRequestedAttemptIds(requests, {
      sessionActionId: item.sessionActionId,
      acceptedAttempts: [createAttempt({ item, id: 'accepted', outcome: 'correct', response: '目标' })],
    });
    const supplement = buildLearnerRequestedReflectionSupplement(
      createSessionReflectionEvidenceAccumulator(), requests,
    );
    assert.equal(supplement.schemaVersion, 'session_reflection_evidence_supplement.v2');
    assert.equal(supplement.items[0]?.learnerRequestedReview, true);
    assert.deepEqual(supplement.items[0]?.attemptIds, ['accepted']);
    assert.deepEqual(dropLearnerRequestedReflectionForAction(requests, item.sessionActionId).items, []);
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
    production: actionKind === 'production' && status === 'review'
      ? {
          taskId: `production-task:${word.id}:default_production`,
          cueId: null,
          cueType: 'definition_gloss',
          text: word.meaning,
          acceptedWordIds: [word.id],
          recheckDemandId: null,
        }
      : null,
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
