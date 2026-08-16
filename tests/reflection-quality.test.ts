import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, beforeEach, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import type {
  ReflectionOperation,
  SessionReflectionBundleV2,
  SessionReflectionResultV6,
} from '../src/domain/reflection.js';

type DbModule = typeof import('../server/db.ts');

const generatedAt = '2026-08-16T08:00:00.000Z';
const updatedAt = '2026-08-16T08:01:00.000Z';

let dataDir = '';
let sqlite: DatabaseSync;
let dbModule: DbModule;

describe('reflection quality annotations', { concurrency: false }, () => {
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-reflection-quality-'));
    const previousMode = process.env.APP_MODE;
    const previousDataDir = process.env.APP_DATA_DIR;
    try {
      process.env.APP_MODE = 'study';
      process.env.APP_DATA_DIR = dataDir;
      const moduleUrl = `${pathToFileURL(path.resolve('server/db.ts')).href}?test=${Date.now()}`;
      dbModule = await import(moduleUrl);
    } finally {
      if (previousMode === undefined) delete process.env.APP_MODE;
      else process.env.APP_MODE = previousMode;
      if (previousDataDir === undefined) delete process.env.APP_DATA_DIR;
      else process.env.APP_DATA_DIR = previousDataDir;
    }

    sqlite = new DatabaseSync(path.join(dataDir, 'app.db'));
    sqlite.exec('PRAGMA foreign_keys = ON;');
  });

  beforeEach(() => {
    sqlite.exec(`
      PRAGMA defer_foreign_keys = ON;
      BEGIN;
      DELETE FROM reflection_quality_annotations;
      DELETE FROM reflection_proposal_reviews;
      DELETE FROM reflection_operation_invocations;
      DELETE FROM reflection_generation_runs;
      DELETE FROM reflection_artifacts;
      DELETE FROM study_sessions;
      DELETE FROM words;
      COMMIT;
    `);
    insertWord('target', '目标');
  });

  after(() => {
    sqlite.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('upserts one annotation per subject and last write wins', () => {
    const artifact = materialize('quality-upsert', suppressOperation('target'), 'gpt-5.6-luna-high').artifact;
    const proposalId = artifact.proposals[0]!.review.proposalId;

    const praise = dbModule.upsertReflectionQualityAnnotation({
      subject: { kind: 'proposal', proposalId },
      polarity: 'praise',
    }, updatedAt);
    assert.equal(praise.polarity, 'praise');
    assert.equal(praise.reasonCode, null);

    const critique = dbModule.upsertReflectionQualityAnnotation({
      subject: { kind: 'proposal', proposalId },
      polarity: 'critique',
      reasonCode: 'wrong_diagnosis',
      note: 'Missed the cue overload.',
    }, '2026-08-16T08:02:00.000Z');
    assert.equal(critique.annotationId, praise.annotationId);
    assert.equal(critique.polarity, 'critique');
    assert.equal(critique.reasonCode, 'wrong_diagnosis');
    assert.equal(critique.note, 'Missed the cue overload.');

    const listed = dbModule.listReflectionQualityAnnotationsForArtifact(artifact.artifactId);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]!.polarity, 'critique');
  });

  test('dismiss with reasonCode writes critique in the same transaction', () => {
    const artifact = materialize('quality-dismiss', suppressOperation('target'), 'glm-5.2-high').artifact;
    const proposalId = artifact.proposals[0]!.review.proposalId;

    const review = dbModule.dismissReflectionProposal(
      proposalId,
      'Cue accepts too much.',
      updatedAt,
      'inconsistent',
    );
    assert.deepEqual(review.disposition, {
      kind: 'dismissed',
      reason: 'Cue accepts too much.',
    });

    const detail = dbModule.getReflectionArtifactDetail(artifact.artifactId);
    assert.equal(detail.qualityAnnotations.length, 1);
    assert.deepEqual(detail.qualityAnnotations[0]!.subject, {
      kind: 'proposal',
      proposalId,
    });
    assert.equal(detail.qualityAnnotations[0]!.polarity, 'critique');
    assert.equal(detail.qualityAnnotations[0]!.reasonCode, 'inconsistent');
    assert.equal(detail.qualityAnnotations[0]!.note, 'Cue accepts too much.');
  });

  test('item critique can mark missed_intervention only when there are no proposals', () => {
    const withProposals = materialize(
      'quality-item-has-proposals',
      suppressOperation('target'),
      'qwen3.8-max',
    ).artifact;
    assert.throws(
      () => dbModule.upsertReflectionQualityAnnotation({
        subject: {
          kind: 'item',
          artifactId: withProposals.artifactId,
          itemId: 'item',
        },
        polarity: 'critique',
        reasonCode: 'missed_intervention',
      }, updatedAt),
      /missed_intervention is valid only for items with no durable proposals/,
    );

    const empty = materializeInformational('quality-item-empty', 'qwen3.7-plus').artifact;
    const annotation = dbModule.upsertReflectionQualityAnnotation({
      subject: {
        kind: 'item',
        artifactId: empty.artifactId,
        itemId: 'item',
      },
      polarity: 'critique',
      reasonCode: 'missed_intervention',
    }, updatedAt);
    assert.equal(annotation.reasonCode, 'missed_intervention');

    assert.throws(
      () => dbModule.upsertReflectionQualityAnnotation({
        subject: {
          kind: 'proposal',
          proposalId: withProposals.proposals[0]!.review.proposalId,
        },
        polarity: 'critique',
        reasonCode: 'missed_intervention',
      }, updatedAt),
      /missed_intervention is valid only for item quality subjects/,
    );
  });

  test('stats group terminal user reviews by model arm and exclude pending/system supersession', () => {
    const luna = materialize('stats-luna', suppressOperation('target'), 'gpt-5.6-luna-high').artifact;
    const glm = materialize('stats-glm', suppressOperation('target'), 'glm-5.2-high').artifact;
    const pending = materialize('stats-pending', suppressOperation('target'), 'gpt-5.6-luna-high').artifact;
    const system = materialize('stats-system', suppressOperation('target'), 'gpt-5.6-luna-high').artifact;

    dbModule.acceptReflectionProposal({
      proposalId: luna.proposals[0]!.review.proposalId,
      operation: suppressOperation('target'),
      createdAt: updatedAt,
    });
    dbModule.dismissReflectionProposal(
      glm.proposals[0]!.review.proposalId,
      null,
      updatedAt,
      'wrong_intervention',
    );
    dbModule.supersedeReflectionProposal({
      proposalId: system.proposals[0]!.review.proposalId,
      updatedAt,
      supersession: {
        source: 'external_state',
        actor: 'system',
        reason: 'Already handled outside reflection.',
        replacementProposalId: null,
        replacementInvocationId: null,
        satisfyingEffectRefs: [{ type: 'word_skill_relevance', id: 'target/production' }],
      },
    });

    void pending;

    const stats = dbModule.getReflectionQualityStats();
    const lunaArm = stats.arms.find((arm) => arm.modelArm === 'gpt-5.6-luna-high');
    const glmArm = stats.arms.find((arm) => arm.modelArm === 'glm-5.2-high');
    assert(lunaArm);
    assert(glmArm);
    assert.equal(lunaArm.terminalReviewCount, 1);
    assert.equal(lunaArm.exactAcceptCount, 1);
    assert.equal(lunaArm.dismissCount, 0);
    assert.equal(glmArm.terminalReviewCount, 1);
    assert.equal(glmArm.dismissCount, 1);
    assert.equal(glmArm.dismissalReasons.wrong_intervention, 1);
    assert.equal(glmArm.dismissalReasons.unspecified, 0);
  });

  test('stats aggregate multiple terminal reviews and annotations within one model arm', () => {
    const exactA = materialize('agg-exact-a', suppressOperation('target'), 'gpt-5.6-luna-high').artifact;
    const exactB = materialize('agg-exact-b', suppressOperation('target'), 'gpt-5.6-luna-high').artifact;
    const exactC = materialize('agg-exact-c', suppressOperation('target'), 'gpt-5.6-luna-high').artifact;
    const dismissCoded = materialize(
      'agg-dismiss-coded',
      suppressOperation('target'),
      'gpt-5.6-luna-high',
    ).artifact;
    const dismissLegacy = materialize(
      'agg-dismiss-legacy',
      suppressOperation('target'),
      'gpt-5.6-luna-high',
    ).artifact;
    const otherPrompt = materialize(
      'agg-other-prompt',
      suppressOperation('target'),
      'gpt-5.6-luna-high',
      'reflection-v6',
    ).artifact;
    const emptyItem = materializeInformational('agg-item-miss', 'gpt-5.6-luna-high').artifact;

    for (const artifact of [exactA, exactB, exactC]) {
      dbModule.acceptReflectionProposal({
        proposalId: artifact.proposals[0]!.review.proposalId,
        operation: suppressOperation('target'),
        createdAt: updatedAt,
      });
    }
    dbModule.dismissReflectionProposal(
      dismissCoded.proposals[0]!.review.proposalId,
      'bad cue',
      updatedAt,
      'inconsistent',
    );
    dbModule.dismissReflectionProposal(
      dismissLegacy.proposals[0]!.review.proposalId,
      'legacy note',
      updatedAt,
    );
    dbModule.acceptReflectionProposal({
      proposalId: otherPrompt.proposals[0]!.review.proposalId,
      operation: suppressOperation('target'),
      createdAt: updatedAt,
    });

    dbModule.upsertReflectionQualityAnnotation({
      subject: { kind: 'proposal', proposalId: exactA.proposals[0]!.review.proposalId },
      polarity: 'praise',
    }, updatedAt);
    dbModule.upsertReflectionQualityAnnotation({
      subject: { kind: 'proposal', proposalId: exactB.proposals[0]!.review.proposalId },
      polarity: 'praise',
    }, updatedAt);
    dbModule.upsertReflectionQualityAnnotation({
      subject: {
        kind: 'item',
        artifactId: emptyItem.artifactId,
        itemId: 'item',
      },
      polarity: 'critique',
      reasonCode: 'missed_intervention',
    }, updatedAt);

    const stats = dbModule.getReflectionQualityStats();
    const lunaV7 = stats.arms.find((arm) => (
      arm.modelArm === 'gpt-5.6-luna-high' && arm.promptVersion === 'reflection-v7'
    ));
    const lunaV6 = stats.arms.find((arm) => (
      arm.modelArm === 'gpt-5.6-luna-high' && arm.promptVersion === 'reflection-v6'
    ));
    assert(lunaV7);
    assert(lunaV6);

    assert.equal(lunaV7.terminalReviewCount, 5);
    assert.equal(lunaV7.exactAcceptCount, 3);
    assert.equal(lunaV7.revisedAcceptCount, 0);
    assert.equal(lunaV7.dismissCount, 2);
    assert.equal(lunaV7.dismissalReasons.inconsistent, 1);
    assert.equal(lunaV7.dismissalReasons.unspecified, 1);
    assert.equal(lunaV7.praiseCount, 2);
    assert.equal(lunaV7.critiqueCount, 2);
    assert.equal(lunaV7.missedInterventionCount, 1);
    assert.equal(lunaV7.annotatedSubjectCount, 4);
    assert.equal(lunaV7.itemCritiqueCount, 1);
    assert.equal(lunaV7.proposalCritiqueCount, 1);

    assert.equal(lunaV6.terminalReviewCount, 1);
    assert.equal(lunaV6.exactAcceptCount, 1);
    assert.equal(lunaV6.dismissCount, 0);
  });

  test('dismiss without reasonCode aggregates as unspecified', () => {
    const artifact = materialize(
      'stats-unspecified',
      suppressOperation('target'),
      'gpt-5.6-luna-high',
    ).artifact;
    dbModule.dismissReflectionProposal(
      artifact.proposals[0]!.review.proposalId,
      'legacy freeform',
      updatedAt,
    );
    const stats = dbModule.getReflectionQualityStats();
    const arm = stats.arms.find((entry) => entry.modelArm === 'gpt-5.6-luna-high');
    assert(arm);
    assert.equal(arm.dismissCount, 1);
    assert.equal(arm.dismissalReasons.unspecified, 1);
  });

  test('clear removes an annotation without changing disposition', () => {
    const artifact = materialize('quality-clear', suppressOperation('target'), 'glm-5.2-high').artifact;
    const proposalId = artifact.proposals[0]!.review.proposalId;
    dbModule.dismissReflectionProposal(proposalId, null, updatedAt, 'low_quality_content');
    const cleared = dbModule.clearReflectionQualityAnnotation({
      subject: { kind: 'proposal', proposalId },
    });
    assert.deepEqual(cleared, { cleared: true });
    assert.equal(
      dbModule.getReflectionArtifactDetail(artifact.artifactId).qualityAnnotations.length,
      0,
    );
    assert.equal(
      dbModule.getReflectionArtifactDetail(artifact.artifactId).proposals[0]!.review.disposition.kind,
      'dismissed',
    );
  });
});

function materialize(
  sessionId: string,
  operation: ReflectionOperation,
  model: string,
  promptVersion = 'reflection-v7',
): ReturnType<DbModule['materializeReflectionArtifact']> {
  sqlite.prepare(`
    INSERT INTO study_sessions (
      id, started_at, ended_at, processing_state, processed_at
    ) VALUES (?, '2026-08-16T07:30:00.000Z', ?, 'processed', ?)
  `).run(sessionId, generatedAt, generatedAt);
  return dbModule.materializeReflectionArtifact({
    sourceSessionId: sessionId,
    reflectionFlowVersion: 'initial_post_session_reflection.v2',
    generatedAt,
    provider: 'openai',
    model,
    promptVersion,
    evidenceBundle: bundle(sessionId),
    result: result(operation),
  });
}

function materializeInformational(
  sessionId: string,
  model: string,
): ReturnType<DbModule['materializeReflectionArtifact']> {
  sqlite.prepare(`
    INSERT INTO study_sessions (
      id, started_at, ended_at, processing_state, processed_at
    ) VALUES (?, '2026-08-16T07:30:00.000Z', ?, 'processed', ?)
  `).run(sessionId, generatedAt, generatedAt);
  return dbModule.materializeReflectionArtifact({
    sourceSessionId: sessionId,
    reflectionFlowVersion: 'initial_post_session_reflection.v2',
    generatedAt,
    provider: 'openai',
    model,
    promptVersion: 'reflection-v7',
    evidenceBundle: bundle(sessionId),
    result: {
      schemaVersion: 'session_reflection_result.v6',
      itemResults: [{
        itemId: 'item',
        diagnosisTags: ['ordinary_retrieval_noise'],
        learnerExplanation: 'Ordinary retrieval noise; no durable change.',
        proposals: [],
        questions: [],
      }],
    },
  });
}

function bundle(sessionId: string): SessionReflectionBundleV2 {
  return {
    schemaVersion: 'session_reflection_bundle.v2',
    generatedAt,
    session: {
      sessionId,
      startedAt: '2026-08-16T07:30:00.000Z',
      endedAt: generatedAt,
      studyProfile: 'mandarin',
    },
    items: [{
      itemId: 'item',
      source: 'production_mistake',
      sourceActionKind: 'production',
      sessionActionId: 'action-1',
      sourceAttemptId: 'attempt-item',
      occurredAt: '2026-08-16T07:59:00.000Z',
      targetWord: {
        wordId: 'target',
        hanzi: '目标',
        pinyin: 'mùbiāo',
        meanings: ['target'],
      },
      sessionNote: null,
      existingContent: { contrastClusters: [], knownAcceptedAlternates: [] },
      servedCue: {
        cueId: null,
        cueType: 'definition_gloss',
        text: 'target',
        acceptedWordIds: ['target'],
      },
      rawResponse: '替代',
      responseKind: 'unmatched_text',
      submittedWord: null,
    }],
  };
}

function result(operation: ReflectionOperation): SessionReflectionResultV6 {
  return {
    schemaVersion: 'session_reflection_result.v6',
    itemResults: [{
      itemId: 'item',
      diagnosisTags: ['persistent_confusion'],
      learnerExplanation: 'The learner supplied a visible alternate.',
      proposals: [{
        proposalGroupKey: null,
        rationale: 'This operation may make the study state more faithful.',
        operation,
      }],
      questions: [],
    }],
  };
}

function suppressOperation(wordId: string): ReflectionOperation {
  return {
    kind: 'suppress_definition_production',
    version: 1,
    wordId,
  };
}

function insertWord(wordId: string, hanzi: string): void {
  sqlite.prepare(`
    INSERT INTO words (
      id,
      hanzi,
      pinyin,
      meaning,
      meanings_json,
      personal_notes,
      examples_json,
      status,
      priority,
      created_at,
      learning_streak,
      last_learning_success_on,
      last_learning_covered_on
    ) VALUES (?, ?, 'pin1yin1', 'meaning', '["meaning"]', '', '[]', 'review', 1, ?, 0, NULL, NULL)
  `).run(wordId, hanzi, generatedAt);
}
