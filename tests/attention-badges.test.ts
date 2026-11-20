import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, beforeEach, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';

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
    const withProposals = seedProposalArtifact('attention-pending');
    const informational = seedExplanationArtifact('attention-explanation');
    assert.equal(dbModule.countUnseenReflectionHelpItems(), 2);

    dbModule.markReflectionInboxSeen({
      kind: 'proposal',
      proposalId: withProposals.proposalId,
    }, seenAt);
    assert.equal(dbModule.countUnseenReflectionHelpItems(), 1);

    dbModule.markReflectionInboxSeen({
      kind: 'explanation',
      artifactId: informational.artifactId,
      itemId: 'item',
    }, seenAt);
    assert.equal(dbModule.countUnseenReflectionHelpItems(), 0);
  });

  test('obsolete unread proposals do not leave an unresolvable Help badge', () => {
    seedProposalArtifact('obsolete-attention', 'initial_post_session_reflection.v3');
    assert.equal(dbModule.countUnseenReflectionHelpItems(), 0);
    seedProposalArtifact('current-attention');
    assert.equal(dbModule.countUnseenReflectionHelpItems(), 1);
  });

  test('keeps seen-but-pending out of the badge without changing disposition', () => {
    const { proposalId } = seedProposalArtifact('attention-seen-pending');
    dbModule.markReflectionInboxSeen({ kind: 'proposal', proposalId }, seenAt);

    assert.equal(
      sqlite.prepare('SELECT disposition FROM reflection_proposal_reviews WHERE proposal_id = ?')
        .get(proposalId)?.disposition,
      'pending',
    );
    assert.equal(dbModule.countUnseenReflectionHelpItems(), 0);
    const second = dbModule.markReflectionInboxSeen({ kind: 'proposal', proposalId }, '2026-08-18T09:00:00.000Z');
    assert.equal(second.marked, false);
    assert.equal(
      sqlite.prepare('SELECT inbox_seen_at FROM reflection_proposal_reviews WHERE proposal_id = ?')
        .get(proposalId)?.inbox_seen_at,
      seenAt,
    );
  });

  test('a proposal that left pending no longer counts toward the badge', () => {
    const { proposalId } = seedProposalArtifact('attention-dismiss');
    assert.equal(dbModule.countUnseenReflectionHelpItems(), 1);

    sqlite.prepare(`
      UPDATE reflection_proposal_reviews SET disposition = 'dismissed', updated_at = ?
      WHERE proposal_id = ?
    `).run(seenAt, proposalId);
    assert.equal(dbModule.countUnseenReflectionHelpItems(), 0);
  });

  test('an unseen explanation row that is no longer open drops the count', () => {
    const informational = seedExplanationArtifact('attention-deferred');
    assert.equal(dbModule.countUnseenReflectionHelpItems(), 1);
    sqlite.prepare(`
      UPDATE reflection_help_inbox SET disposition = 'deferred', disposition_at = ?
      WHERE artifact_id = ? AND item_id = 'item'
    `).run(seenAt, informational.artifactId);
    assert.equal(dbModule.countUnseenReflectionHelpItems(), 0);
  });

  test('rejects rewriting help inbox membership fields while allowing inbox_seen_at', () => {
    const informational = seedExplanationArtifact('attention-immutable');
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
      reflectionGenerating: false,
      failedReflectionRunIds: ['failed-run'],
      failedReflectionRunsSeenThroughAt: null,
      whatsNewSeenThroughDate: null,
      whatsNewSeenThroughSequence: null,
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

function insertArtifact(
  sessionId: string,
  resultValue: unknown,
  reflectionFlowVersion = 'initial_post_session_reflection.v6',
): string {
  insertSession(sessionId);
  const artifactId = `artifact:${sessionId}`;
  sqlite.prepare(`
    INSERT INTO reflection_artifacts (
      artifact_id, source_session_id, source_run_id, reflection_flow_version, generated_at,
      provider, model, prompt_version, bundle_schema_version, result_schema_version,
      evidence_bundle_json, result_json
    ) VALUES (?, ?, NULL, ?, ?, 'openai', 'gpt-5.6-luna-high', 'reflection-staged-v4',
      'session_reflection_bundle.v6', 'session_reflection_result.v10', ?, ?)
  `).run(
    artifactId,
    sessionId,
    reflectionFlowVersion,
    generatedAt,
    JSON.stringify(bundle(sessionId)),
    JSON.stringify(resultValue),
  );
  return artifactId;
}

/** Seeds the rows a materialized artifact with one pending proposal leaves. */
function seedProposalArtifact(
  sessionId: string,
  reflectionFlowVersion?: string,
): { artifactId: string; proposalId: string } {
  const artifactId = insertArtifact(sessionId, {
    schemaVersion: 'session_reflection_result.v10',
    itemResults: [{
      itemId: 'item',
      diagnosisTags: ['persistent_confusion'],
      learnerExplanation: 'The learner supplied a visible alternate.',
      proposals: [{
        proposalGroupKey: null,
        rationale: 'This operation may make the study state more faithful.',
        operation: { kind: 'suppress_definition_production', version: 1, wordId: 'target' },
      }],
      questions: [],
    }],
  }, reflectionFlowVersion);
  const proposalId = `proposal:${sessionId}`;
  sqlite.prepare(`
    INSERT INTO reflection_proposal_reviews (
      proposal_id, artifact_id, item_id, proposal_index, disposition, updated_at
    ) VALUES (?, ?, 'item', 0, 'pending', ?)
  `).run(proposalId, artifactId, generatedAt);
  return { artifactId, proposalId };
}

/** Seeds the rows a materialized explanation-only artifact leaves. */
function seedExplanationArtifact(sessionId: string): { artifactId: string } {
  const artifactId = insertArtifact(sessionId, {
    schemaVersion: 'session_reflection_result.v10',
    itemResults: [{
      itemId: 'item',
      diagnosisTags: ['ordinary_retrieval_noise'],
      learnerExplanation: 'Ordinary retrieval noise; no durable change.',
      proposals: [],
      questions: [],
    }],
  });
  sqlite.prepare(`
    INSERT INTO reflection_help_inbox (inbox_id, artifact_id, item_id, opened_at)
    VALUES (?, ?, 'item', ?)
  `).run(`inbox:${sessionId}`, artifactId, generatedAt);
  return { artifactId };
}

function insertSession(sessionId: string): void {
  sqlite.prepare(`
    INSERT INTO study_sessions (
      id, started_at, ended_at, processing_state, processed_at
    ) VALUES (?, '2026-08-18T07:30:00.000Z', ?, 'processed', ?)
  `).run(sessionId, generatedAt, generatedAt);
}

function recordFailedRun(sessionId: string, runId: string, completedAt: string): void {
  insertRun(sessionId, runId, completedAt, 'failed');
}

function recordSucceededRun(sessionId: string, runId: string, completedAt: string): void {
  insertRun(sessionId, runId, completedAt, 'succeeded');
}

function insertRun(
  sessionId: string,
  runId: string,
  completedAt: string,
  state: 'failed' | 'succeeded',
): void {
  const failed = state === 'failed';
  sqlite.prepare(`
    INSERT INTO reflection_generation_runs (
      run_id, source_session_id, reflection_flow_version, started_at, completed_at,
      provider, model, provider_model, prompt_version, response_id, finish_reason,
      bundle_schema_version, result_schema_version, state, failure_code,
      eligible_item_count, included_item_count, input_tokens, output_tokens, total_tokens,
      evidence_bundle_json
    ) VALUES (?, ?, 'initial_post_session_reflection.v6', ?, ?, 'openai', 'gpt-5.6-luna-high',
      'gpt-5.6-luna', 'reflection-staged-v4', ?, ?, 'session_reflection_bundle.v6',
      'session_reflection_result.v4', ?, ?, 1, 1, ?, ?, ?, ?)
  `).run(
    runId,
    sessionId,
    generatedAt,
    completedAt,
    failed ? null : 'response-1',
    failed ? null : 'stop',
    state,
    failed ? 'upstream_failure' : null,
    failed ? null : 10,
    failed ? null : 4,
    failed ? null : 14,
    JSON.stringify(bundle(sessionId)),
  );
}

function bundle(sessionId: string) {
  return {
    schemaVersion: 'session_reflection_bundle.v6',
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
      promotionEvidence: null,
      servedCue: {
        supplement: null,
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
