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

const generatedAt = '2026-08-18T08:00:00.000Z';

let dataDir = '';
let sqlite: DatabaseSync;
let dbModule: DbModule;

describe('reflection help inbox', { concurrency: false }, () => {
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-help-inbox-'));
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
    sqlite.function('current_learner_id', () => 'test-learner');
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

  test('seeds only empty-proposal items at materialize', () => {
    const withProposals = materialize('inbox-not-for-proposals', suppressOperation('target')).artifact;
    const informational = materializeInformational('inbox-empty-proposals').artifact;

    assert.equal(withProposals.helpInbox.length, 0);
    assert.equal(withProposals.proposals[0]!.review.disposition.kind, 'pending');
    assert.equal(informational.helpInbox.length, 1);
    assert.equal(informational.helpInbox[0]!.itemId, 'item');
    assert.equal(informational.helpInbox[0]!.openedAt, generatedAt);
    assert.equal(informational.proposals.length, 0);

    const listed = dbModule.listReflectionHelpInbox();
    assert.equal(listed.length, 1);
    assert.equal(listed[0]!.artifactId, informational.artifactId);
  });

  test('does not rewrite proposal disposition or invent a synthetic operation', () => {
    const withProposals = materialize('inbox-not-disposition', suppressOperation('target')).artifact;
    const informational = materializeInformational('inbox-explanation-only').artifact;

    const proposalDetail = dbModule.getReflectionArtifactDetail(withProposals.artifactId);
    assert.equal(proposalDetail.proposals[0]!.review.disposition.kind, 'pending');
    assert.equal(proposalDetail.helpInbox.length, 0);
    assert.equal(proposalDetail.qualityItemTags.length, 0);

    const informationalDetail = dbModule.getReflectionArtifactDetail(informational.artifactId);
    assert.equal(informationalDetail.proposals.length, 0);
    assert.equal(informationalDetail.helpInbox[0]!.itemId, 'item');
    assert.equal(informationalDetail.result.itemResults[0]!.proposals.length, 0);
  });

  test('Done deletes the inbox row without changing proposal review or result_json', () => {
    const withProposals = materialize('inbox-done-proposals', suppressOperation('target')).artifact;
    const informational = materializeInformational('inbox-done-explanation').artifact;
    const proposalId = withProposals.proposals[0]!.review.proposalId;
    dbModule.dismissReflectionProposal(proposalId, null, generatedAt);

    const done = dbModule.markReflectionHelpInboxDone({
      artifactId: informational.artifactId,
      itemId: 'item',
    });
    assert.deepEqual(done, { done: true });

    const informationalDetail = dbModule.getReflectionArtifactDetail(informational.artifactId);
    assert.equal(informationalDetail.helpInbox.length, 0);
    assert.equal(
      informationalDetail.result.itemResults[0]!.learnerExplanation,
      'Ordinary retrieval noise; no durable change.',
    );

    const proposalDetail = dbModule.getReflectionArtifactDetail(withProposals.artifactId);
    assert.equal(proposalDetail.proposals[0]!.review.disposition.kind, 'dismissed');
    assert.deepEqual(
      dbModule.markReflectionHelpInboxDone({
        artifactId: informational.artifactId,
        itemId: 'item',
      }),
      { done: false },
    );
    assert.equal(dbModule.listReflectionHelpInbox().length, 0);
  });

  test('rejects missing artifact or item', () => {
    const artifact = materializeInformational('inbox-missing').artifact;
    assert.throws(
      () => dbModule.markReflectionHelpInboxDone({
        artifactId: 'missing-artifact',
        itemId: 'item',
      }),
      /Reflection artifact not found/,
    );
    assert.throws(
      () => dbModule.markReflectionHelpInboxDone({
        artifactId: artifact.artifactId,
        itemId: 'missing-item',
      }),
      /Reflection item not found/,
    );
  });
});

function materialize(
  sessionId: string,
  operation: ReflectionOperation,
): ReturnType<DbModule['materializeReflectionArtifact']> {
  sqlite.prepare(`
    INSERT INTO study_sessions (
      id, started_at, ended_at, processing_state, processed_at
    ) VALUES (?, '2026-08-18T07:30:00.000Z', ?, 'processed', ?)
  `).run(sessionId, generatedAt, generatedAt);
  return dbModule.materializeReflectionArtifact({
    sourceSessionId: sessionId,
    reflectionFlowVersion: 'initial_post_session_reflection.v2',
    generatedAt,
    provider: 'openai',
    model: 'gpt-5.6-luna-high',
    promptVersion: 'reflection-v7',
    evidenceBundle: bundle(sessionId),
    result: result(operation),
  });
}

function materializeInformational(
  sessionId: string,
): ReturnType<DbModule['materializeReflectionArtifact']> {
  sqlite.prepare(`
    INSERT INTO study_sessions (
      id, started_at, ended_at, processing_state, processed_at
    ) VALUES (?, '2026-08-18T07:30:00.000Z', ?, 'processed', ?)
  `).run(sessionId, generatedAt, generatedAt);
  return dbModule.materializeReflectionArtifact({
    sourceSessionId: sessionId,
    reflectionFlowVersion: 'initial_post_session_reflection.v2',
    generatedAt,
    provider: 'openai',
    model: 'gpt-5.6-luna-high',
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
      startedAt: '2026-08-18T07:30:00.000Z',
      endedAt: generatedAt,
      studyProfile: 'mandarin',
    },
    items: [{
      itemId: 'item',
      source: 'production_mistake',
      sourceActionKind: 'production',
      sessionActionId: 'action-1',
      sourceAttemptId: 'attempt-item',
      occurredAt: '2026-08-18T07:59:00.000Z',
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
