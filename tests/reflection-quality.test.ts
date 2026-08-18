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

describe('reflection quality item tags', { concurrency: false }, () => {
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
      DELETE FROM reflection_help_inbox;
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

  test('upserts one tag set per item and last write wins', () => {
    const artifact = materialize('quality-upsert', suppressOperation('target'), 'gpt-5.6-luna-high').artifact;

    const first = dbModule.upsertReflectionQualityAnnotation({
      artifactId: artifact.artifactId,
      itemId: 'item',
      tags: ['praise'],
    }, updatedAt);
    assert.deepEqual(first.tags, ['praise']);
    assert.equal(first.note, null);

    const second = dbModule.upsertReflectionQualityAnnotation({
      artifactId: artifact.artifactId,
      itemId: 'item',
      tags: ['praise', 'low_quality_content', 'wrong_diagnosis'],
      note: 'Prompt text was awkward but diagnosis was useful.',
    }, '2026-08-16T08:02:00.000Z');
    assert.equal(second.annotationId, first.annotationId);
    assert.deepEqual(second.tags, ['praise', 'wrong_diagnosis', 'low_quality_content']);
    assert.equal(second.note, 'Prompt text was awkward but diagnosis was useful.');

    const listed = dbModule.listReflectionQualityAnnotationsForArtifact(artifact.artifactId);
    assert.equal(listed.length, 1);
    assert.deepEqual(listed[0]!.tags, ['praise', 'wrong_diagnosis', 'low_quality_content']);
  });

  test('other requires a note; missed_intervention allowed with proposals', () => {
    const withProposals = materialize(
      'quality-item-has-proposals',
      suppressOperation('target'),
      'qwen3.8-max',
    ).artifact;

    assert.throws(
      () => dbModule.upsertReflectionQualityAnnotation({
        artifactId: withProposals.artifactId,
        itemId: 'item',
        tags: ['other'],
      }, updatedAt),
      /other tag requires a non-empty note/,
    );

    const tagged = dbModule.upsertReflectionQualityAnnotation({
      artifactId: withProposals.artifactId,
      itemId: 'item',
      tags: ['missed_intervention', 'other'],
      note: 'Should have repaired the cue too.',
    }, updatedAt);
    assert.deepEqual(tagged.tags, ['missed_intervention', 'other']);
  });

  test('dismiss does not write quality tags', () => {
    const artifact = materialize('quality-dismiss', suppressOperation('target'), 'glm-5.2-high').artifact;
    const proposalId = artifact.proposals[0]!.review.proposalId;

    const review = dbModule.dismissReflectionProposal(
      proposalId,
      'Cue accepts too much.',
      updatedAt,
    );
    assert.deepEqual(review.disposition, {
      kind: 'dismissed',
      reason: 'Cue accepts too much.',
    });

    const detail = dbModule.getReflectionArtifactDetail(artifact.artifactId);
    assert.equal(detail.qualityItemTags.length, 0);
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
  });

  test('stats aggregate multiple terminal reviews and tags within one model arm including pending tags', () => {
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
    const stillPending = materialize(
      'agg-pending-tagged',
      suppressOperation('target'),
      'gpt-5.6-luna-high',
    ).artifact;

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
      artifactId: exactA.artifactId,
      itemId: 'item',
      tags: ['praise'],
    }, updatedAt);
    dbModule.upsertReflectionQualityAnnotation({
      artifactId: exactB.artifactId,
      itemId: 'item',
      tags: ['praise', 'low_quality_content'],
    }, updatedAt);
    dbModule.upsertReflectionQualityAnnotation({
      artifactId: emptyItem.artifactId,
      itemId: 'item',
      tags: ['missed_intervention'],
    }, updatedAt);
    dbModule.upsertReflectionQualityAnnotation({
      artifactId: stillPending.artifactId,
      itemId: 'item',
      tags: ['inconsistent'],
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
    assert.equal(lunaV7.taggedItemCount, 4);
    assert.equal(lunaV7.tagCounts.praise, 2);
    assert.equal(lunaV7.tagCounts.low_quality_content, 1);
    assert.equal(lunaV7.tagCounts.missed_intervention, 1);
    assert.equal(lunaV7.tagCounts.inconsistent, 1);

    assert.equal(lunaV6.terminalReviewCount, 1);
    assert.equal(lunaV6.exactAcceptCount, 1);
    assert.equal(lunaV6.dismissCount, 0);
  });

  test('clear removes tags without changing disposition', () => {
    const artifact = materialize('quality-clear', suppressOperation('target'), 'glm-5.2-high').artifact;
    const proposalId = artifact.proposals[0]!.review.proposalId;
    dbModule.dismissReflectionProposal(proposalId, null, updatedAt);
    dbModule.upsertReflectionQualityAnnotation({
      artifactId: artifact.artifactId,
      itemId: 'item',
      tags: ['low_quality_content'],
    }, updatedAt);
    const cleared = dbModule.clearReflectionQualityAnnotation({
      artifactId: artifact.artifactId,
      itemId: 'item',
    });
    assert.deepEqual(cleared, { cleared: true });
    assert.equal(
      dbModule.getReflectionArtifactDetail(artifact.artifactId).qualityItemTags.length,
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
