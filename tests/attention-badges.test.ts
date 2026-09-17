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
const seenAt = '2026-08-18T08:05:00.000Z';

let dataDir = '';
let sqlite: DatabaseSync;
let dbModule: DbModule;

describe('attention badges', { concurrency: false }, () => {
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-attention-'));
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
      DELETE FROM word_meanings;
      DELETE FROM words;
      DELETE FROM learner_params;
      COMMIT;
    `);
    insertWord('target', '目标');
  });

  after(() => {
    sqlite.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('counts unseen pending proposals and explanation inbox rows separately', () => {
    const withProposals = materialize('attention-pending', suppressOperation('target')).artifact;
    const informational = materializeInformational('attention-explanation').artifact;
    assert.equal(dbModule.countUnseenReflectionHelpItems(), 2);

    dbModule.markReflectionInboxSeen({
      kind: 'proposal',
      proposalId: withProposals.proposals[0]!.review.proposalId,
    }, seenAt);
    assert.equal(dbModule.countUnseenReflectionHelpItems(), 1);

    dbModule.markReflectionInboxSeen({
      kind: 'explanation',
      artifactId: informational.artifactId,
      itemId: 'item',
    }, seenAt);
    assert.equal(dbModule.countUnseenReflectionHelpItems(), 0);
  });

  test('keeps seen-but-pending out of the badge without changing disposition', () => {
    const artifact = materialize('attention-seen-pending', suppressOperation('target')).artifact;
    const proposalId = artifact.proposals[0]!.review.proposalId;
    dbModule.markReflectionInboxSeen({ kind: 'proposal', proposalId }, seenAt);

    const detail = dbModule.getReflectionArtifactDetail(artifact.artifactId);
    assert.equal(detail.proposals[0]!.review.disposition.kind, 'pending');
    assert.equal(dbModule.countUnseenReflectionHelpItems(), 0);
    const second = dbModule.markReflectionInboxSeen({ kind: 'proposal', proposalId }, '2026-08-18T09:00:00.000Z');
    assert.equal(second.marked, false);
    assert.equal(
      sqlite.prepare('SELECT inbox_seen_at FROM reflection_proposal_reviews WHERE proposal_id = ?')
        .get(proposalId)?.inbox_seen_at,
      seenAt,
    );
  });

  test('leaving pending from By session clears the badge and undo does not restore it', () => {
    const artifact = materialize('attention-dismiss', suppressOperation('target')).artifact;
    const proposalId = artifact.proposals[0]!.review.proposalId;
    assert.equal(dbModule.countUnseenReflectionHelpItems(), 1);

    dbModule.dismissReflectionProposal(proposalId, null, seenAt);
    assert.equal(dbModule.countUnseenReflectionHelpItems(), 0);

    dbModule.reopenReflectionProposal(proposalId, '2026-08-18T09:00:00.000Z');
    assert.equal(dbModule.getReflectionArtifactDetail(artifact.artifactId).proposals[0]!.review.disposition.kind, 'pending');
    assert.equal(dbModule.countUnseenReflectionHelpItems(), 0);
  });

  test('Done on an unseen explanation row drops the count', () => {
    const informational = materializeInformational('attention-done').artifact;
    assert.equal(dbModule.countUnseenReflectionHelpItems(), 1);
    dbModule.markReflectionHelpInboxDone({
      artifactId: informational.artifactId,
      itemId: 'item',
    });
    assert.equal(dbModule.countUnseenReflectionHelpItems(), 0);
  });

  test('rejects rewriting help inbox membership fields while allowing inbox_seen_at', () => {
    const informational = materializeInformational('attention-immutable').artifact;
    assert.throws(
      () => sqlite.exec(`
        UPDATE reflection_help_inbox
        SET opened_at = '2026-08-18T09:00:00.000Z'
        WHERE artifact_id = '${informational.artifactId}'
      `),
      /reflection help inbox entries are immutable/,
    );
    sqlite.prepare(`
      UPDATE reflection_help_inbox
      SET inbox_seen_at = ?
      WHERE artifact_id = ?
    `).run(seenAt, informational.artifactId);
    assert.equal(dbModule.countUnseenReflectionHelpItems(), 0);
  });

  test('whats-new ensure grandfathers the current catalog and seen advances monotonically', () => {
    assert.equal(dbModule.getWhatsNewSeenThroughDate(), null);
    assert.equal(dbModule.ensureWhatsNewSeenThroughDate('2026-09-16'), '2026-09-16');
    assert.equal(dbModule.ensureWhatsNewSeenThroughDate('2026-09-20'), '2026-09-16');
    assert.equal(dbModule.markWhatsNewSeenThroughDate('2026-09-14'), '2026-09-16');
    assert.equal(dbModule.markWhatsNewSeenThroughDate('2026-09-20'), '2026-09-20');
    assert.equal(dbModule.getAttentionBadges().whatsNewSeenThroughDate, '2026-09-20');
    assert.equal(
      sqlite.prepare(`
        SELECT value_json FROM learner_params
        WHERE learner_id = 'test-learner' AND param_key = 'whats_new_seen_through_date'
      `).get()?.value_json,
      JSON.stringify('2026-09-20'),
    );
    assert.equal(
      sqlite.prepare(`
        SELECT 1 FROM learner_settings
        WHERE learner_id = 'test-learner' AND setting_key = 'whats_new_seen_through_date'
      `).get(),
      undefined,
    );
    assert.throws(
      () => dbModule.markWhatsNewSeenThroughDate('09-20-2026'),
      /YYYY-MM-DD/,
    );
  });

  test('lists failed generation run ids without counting succeeded runs', () => {
    insertSession('attention-failed-run');
    recordFailedRun('attention-failed-run', 'failed-run', seenAt);
    recordSucceededRun('attention-failed-run', 'succeeded-run', '2026-08-18T08:06:00.000Z');

    assert.deepEqual(dbModule.listFailedReflectionRunIds(), ['failed-run']);
    assert.deepEqual(dbModule.getAttentionBadges(), {
      reflectionUnseenCount: 0,
      failedReflectionRunIds: ['failed-run'],
      failedReflectionRunsSeenThroughAt: null,
      whatsNewSeenThroughDate: null,
    });
  });

  test('durably acknowledges failed runs so reload does not re-badge until a newer failure', () => {
    insertSession('attention-failed-durable');
    recordFailedRun('attention-failed-durable', 'failed-old', '2026-08-18T08:05:00.000Z');

    const acknowledged = dbModule.markFailedReflectionRunsSeen('2026-08-18T08:05:00.000Z');
    assert.deepEqual(acknowledged, {
      failedReflectionRunIds: [],
      failedReflectionRunsSeenThroughAt: '2026-08-18T08:05:00.000Z',
    });
    assert.deepEqual(dbModule.getAttentionBadges().failedReflectionRunIds, []);
    assert.equal(
      dbModule.getFailedReflectionRunsSeenThroughAt(),
      '2026-08-18T08:05:00.000Z',
    );
    assert.equal(
      sqlite.prepare(`
        SELECT value_json FROM learner_params
        WHERE learner_id = 'test-learner' AND param_key = 'failed_reflection_runs_seen_through_at'
      `).get()?.value_json,
      JSON.stringify('2026-08-18T08:05:00.000Z'),
    );

    const earlier = dbModule.markFailedReflectionRunsSeen('2026-08-18T08:00:00.000Z');
    assert.equal(earlier.failedReflectionRunsSeenThroughAt, '2026-08-18T08:05:00.000Z');

    recordFailedRun('attention-failed-durable', 'failed-new', '2026-08-18T09:00:00.000Z');
    assert.deepEqual(dbModule.getAttentionBadges().failedReflectionRunIds, ['failed-new']);

    const reack = dbModule.markFailedReflectionRunsSeen('2026-08-18T09:00:00.000Z');
    assert.deepEqual(reack.failedReflectionRunIds, []);
    assert.deepEqual(dbModule.getAttentionBadges().failedReflectionRunIds, []);
  });
});

function materialize(
  sessionId: string,
  operation: ReflectionOperation,
): ReturnType<DbModule['materializeReflectionArtifact']> {
  insertSession(sessionId);
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
  insertSession(sessionId);
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

function insertSession(sessionId: string): void {
  sqlite.prepare(`
    INSERT INTO study_sessions (
      id, started_at, ended_at, processing_state, processed_at
    ) VALUES (?, '2026-08-18T07:30:00.000Z', ?, 'processed', ?)
  `).run(sessionId, generatedAt, generatedAt);
}

function recordFailedRun(sessionId: string, runId: string, completedAt: string): void {
  dbModule.recordReflectionGenerationRun({
    runId,
    sourceSessionId: sessionId,
    reflectionFlowVersion: 'initial_post_session_reflection.v2',
    startedAt: generatedAt,
    completedAt,
    provider: 'openai',
    model: 'gpt-5.6-luna-high',
    providerModel: 'gpt-5.6-luna',
    promptVersion: 'reflection-v7',
    responseId: null,
    finishReason: null,
    state: 'failed',
    failureCode: 'upstream_failure',
    eligibleItemCount: 1,
    includedItemCount: 1,
    usage: {
      inputTokens: null,
      cachedInputTokens: null,
      cacheWriteInputTokens: null,
      outputTokens: null,
      reasoningTokens: null,
      totalTokens: null,
    },
    pricingSnapshotId: null,
    pricingAsOf: null,
    pricingBasis: null,
    estimatedCostUsd: null,
    evidenceBundle: bundle(sessionId),
  });
}

function recordSucceededRun(sessionId: string, runId: string, completedAt: string): void {
  dbModule.recordReflectionGenerationRun({
    runId,
    sourceSessionId: sessionId,
    reflectionFlowVersion: 'initial_post_session_reflection.v2',
    startedAt: generatedAt,
    completedAt,
    provider: 'openai',
    model: 'gpt-5.6-luna-high',
    providerModel: 'gpt-5.6-luna',
    promptVersion: 'reflection-v7',
    responseId: 'response-1',
    finishReason: 'stop',
    state: 'succeeded',
    failureCode: null,
    eligibleItemCount: 1,
    includedItemCount: 1,
    usage: {
      inputTokens: 10,
      cachedInputTokens: null,
      cacheWriteInputTokens: null,
      outputTokens: 4,
      reasoningTokens: null,
      totalTokens: 14,
    },
    pricingSnapshotId: null,
    pricingAsOf: null,
    pricingBasis: null,
    estimatedCostUsd: null,
    evidenceBundle: bundle(sessionId),
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
