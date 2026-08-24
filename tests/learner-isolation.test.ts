import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { ReflectionOperation } from '../src/domain/reflection.js';

type DbModule = typeof import('../server/db.ts');

let dataDir = '';
let sqlite: DatabaseSync;
let dbModule: DbModule;
let rawLearnerId = 'learner-a';
let reinstallLearnerScopedCompatibilityViews: () => void;

describe('learner isolation', { concurrency: false }, () => {
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-learner-isolation-'));
    const previousMode = process.env.APP_MODE;
    const previousDataDir = process.env.APP_DATA_DIR;
    process.env.APP_MODE = 'study';
    process.env.APP_DATA_DIR = dataDir;
    try {
      dbModule = await import(
        `${pathToFileURL(path.resolve('server/db.ts')).href}?learner-isolation=${Date.now()}`
      );
    } finally {
      restoreEnv('APP_MODE', previousMode);
      restoreEnv('APP_DATA_DIR', previousDataDir);
    }

    dbModule.bootstrapLearner({ learnerId: 'learner-a', displayName: 'Learner A' });
    dbModule.bootstrapLearner({ learnerId: 'learner-b', displayName: 'Learner B' });
    reinstallLearnerScopedCompatibilityViews = (
      await import('../server/db/learner-scoped-tables.ts')
    ).installLearnerScopedCompatibilityViews;

    sqlite = new DatabaseSync(path.join(dataDir, 'app.db'));
    sqlite.function('current_learner_id', () => rawLearnerId);
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.prepare(`
      INSERT INTO words (
        id, hanzi, traditional, pinyin, meaning, meanings_json, personal_notes,
        examples_json, status, priority, created_at, learning_streak,
        last_learning_success_on, last_learning_covered_on
      ) VALUES (?, ?, NULL, ?, ?, ?, '', '[]', 'unstudied', 10, ?, 0, NULL, NULL)
    `).run('shared-word', '共享', 'gòngxiǎng', 'shared', '["shared"]', '2026-08-21T00:00:00.000Z');
  });

  after(() => {
    sqlite.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('shares lexical content while isolating learner overlays', () => {
    dbModule.runWithLearnerId('learner-a', () => {
      dbModule.updateWordPersonalNotes('shared-word', 'A private note');
    });

    const aWord = dbModule.runWithLearnerId(
      'learner-a',
      () => dbModule.getWords().find((word) => word.id === 'shared-word'),
    );
    const bWord = dbModule.runWithLearnerId(
      'learner-b',
      () => dbModule.getWords().find((word) => word.id === 'shared-word'),
    );
    assert.equal(aWord?.personalNotes, 'A private note');
    assert.equal(bWord?.personalNotes, '');
    assert.equal(bWord?.hanzi, '共享');
  });

  test('permits the same private logical id for two learners without overwriting', () => {
    dbModule.runWithLearnerId('learner-a', () => dbModule.upsertStudySessionRecord({
      id: 'same-session-id',
      startedAt: '2026-08-21T01:00:00.000Z',
      endedAt: null,
      processingState: 'open',
      processedAt: null,
    }));
    dbModule.runWithLearnerId('learner-b', () => dbModule.upsertStudySessionRecord({
      id: 'same-session-id',
      startedAt: '2026-08-21T02:00:00.000Z',
      endedAt: null,
      processingState: 'open',
      processedAt: null,
    }));

    assert.equal(
      dbModule.runWithLearnerId('learner-a', () => dbModule.getStudySessionRecord('same-session-id'))?.startedAt,
      '2026-08-21T01:00:00.000Z',
    );
    assert.equal(
      dbModule.runWithLearnerId('learner-b', () => dbModule.getStudySessionRecord('same-session-id'))?.startedAt,
      '2026-08-21T02:00:00.000Z',
    );
  });

  test('hides private contrast content and rejects cross-learner session references', () => {
    dbModule.runWithLearnerId('learner-a', () => {
      dbModule.createContrastCluster({ id: 'a-cluster', title: 'A private cluster' });
      dbModule.upsertStudySessionRecord({
        id: 'a-only-session',
        startedAt: '2026-08-21T03:00:00.000Z',
        endedAt: null,
        processingState: 'open',
        processedAt: null,
      });
    });
    assert.deepEqual(
      dbModule.runWithLearnerId('learner-b', () => dbModule.getContrastClusters()),
      [],
    );

    rawLearnerId = 'learner-b';
    assert.throws(
      () => sqlite.prepare(`
        INSERT INTO study_events (
          id, occurred_at, session_id, session_action_id, session_event_sequence,
          event_type, target_word_id, action_kind, sampled_skill_ids_json,
          content_ref_json, payload_json, projected_at
        ) VALUES (?, ?, ?, NULL, NULL, 'study_management', ?, NULL, '[]', NULL, '{}', NULL)
      `).run(
        'cross-owner-event',
        '2026-08-21T03:01:00.000Z',
        'a-only-session',
        'shared-word',
      ),
      /FOREIGN KEY constraint failed/,
    );
  });

  test('shares authorized cue publications without exposing source provenance or reports', () => {
    rawLearnerId = 'learner-a';
    insertInvocation('learner-a-cue-create', cueRepairOperation({
      changes: [{
        kind: 'create',
        cue: {
          cueType: 'definition_gloss',
          text: 'something held in common',
          acceptedWordIds: ['shared-word'],
        },
      }, {
        kind: 'create',
        cue: {
          cueType: 'circumstance',
          text: 'when describing something jointly held',
          acceptedWordIds: ['shared-word'],
        },
      }],
    }));
    const created = dbModule.runWithLearnerId(
      'learner-a',
      () => dbModule.applyReflectionInvocation(
        'learner-a-cue-create',
        '2026-08-21T04:01:00.000Z',
      ),
    );
    assert.equal(created.application.state.kind, 'applied');
    const originalCueIds = created.application.state.kind === 'applied'
      ? created.application.state.effectRefs
        .filter((ref) => ref.type === 'production_cue')
        .map((ref) => ref.id)
      : [];
    assert.equal(originalCueIds.length, 2);
    const originalCueId = originalCueIds[0]!;
    const otherOriginalCueId = originalCueIds[1]!;

    const sourceCue = dbModule.runWithLearnerId(
      'learner-a',
      () => dbModule.getProductionCue(originalCueId),
    );
    const originalPublication = dbModule.getSharedContentPublicationForContent(
      'production_cue',
      originalCueId,
    );
    assert.ok(originalPublication);
    assert.deepEqual(sourceCue?.attribution, {
      origin: 'reflection',
      invocationId: 'learner-a-cue-create',
    });
    assert.equal(
      dbModule.runWithLearnerId(
        'learner-a',
        () => dbModule.getSharedContentPublication(originalPublication.publicationId)?.publicationStatus,
      ),
      'shared_trial',
    );

    const otherLearnerCue = dbModule.runWithLearnerId(
      'learner-b',
      () => dbModule.getProductionCue(originalCueId),
    );
    assert.deepEqual(otherLearnerCue, {
      cueId: originalCueId,
      taskId: 'production-task:shared-word:default_production',
      cueType: 'definition_gloss',
      text: 'something held in common',
      acceptedWordIds: ['shared-word'],
      createdAt: '2026-08-21T04:01:00.000Z',
      attribution: { origin: 'manual', invocationId: null },
      active: true,
    });
    assert.equal(
      dbModule.runWithLearnerId(
        'learner-b',
        () => dbModule.getSharedContentPublicationProvenance(originalPublication.publicationId),
      ),
      null,
    );

    rawLearnerId = 'learner-a';
    insertInvocation('learner-a-cue-replace', cueRepairOperation({
      changes: [{
        kind: 'replace',
        cueId: originalCueId,
        replacements: [{
          cueType: 'definition_gloss',
          text: 'something owned or used by more than one person',
          acceptedWordIds: ['shared-word'],
        }],
      }, {
        kind: 'replace',
        cueId: otherOriginalCueId,
        replacements: [{
          cueType: 'circumstance',
          text: 'when two people hold something together',
          acceptedWordIds: ['shared-word'],
        }],
      }, {
        kind: 'create',
        cue: {
          cueType: 'minimal_context',
          text: 'a standalone shared-context cue',
          acceptedWordIds: ['shared-word'],
        },
      }],
    }));
    const replaced = dbModule.runWithLearnerId(
      'learner-a',
      () => dbModule.applyReflectionInvocation(
        'learner-a-cue-replace',
        '2026-08-21T04:02:00.000Z',
      ),
    );
    assert.equal(replaced.application.state.kind, 'applied');
    const replacementCueIds = replaced.application.state.kind === 'applied'
      ? replaced.application.state.effectRefs
        .filter((ref) => ref.type === 'production_cue')
        .map((ref) => ref.id)
      : [];
    assert.equal(replacementCueIds.length, 3);
    const replacementCueId = replacementCueIds[0]!;
    const otherReplacementCueId = replacementCueIds[1]!;
    const standaloneCueId = replacementCueIds[2]!;
    const replacementPublication = dbModule.getSharedContentPublicationForContent(
      'production_cue',
      replacementCueId,
    );
    assert.ok(replacementPublication);
    assert.equal(
      dbModule.getSharedContentPublication(originalPublication.publicationId)?.publicationStatus,
      'shared_trial',
    );
    assert.equal(
      dbModule.getSharedContentPublication(replacementPublication.publicationId)?.publicationStatus,
      'shared_trial',
    );
    assert.ok(dbModule.getSharedContentPublicationForContent('production_cue', otherReplacementCueId));
    assert.ok(dbModule.getSharedContentPublicationForContent('production_cue', standaloneCueId));
    assert.equal(
      dbModule.runWithLearnerId(
        'learner-b',
        () => dbModule.getProductionCue(originalCueId)?.active,
      ),
      true,
    );
    assert.equal(
      dbModule.runWithLearnerId(
        'learner-a',
        () => dbModule.getProductionCue(originalCueId)?.active,
      ),
      false,
    );
    dbModule.runWithLearnerId('learner-b', () => dbModule.upsertStudySessionRecord({
      id: 'shared-version-session',
      startedAt: '2026-08-21T04:02:30.000Z',
      endedAt: null,
      processingState: 'open',
      processedAt: null,
    }));
    rawLearnerId = 'learner-b';
    const historicalMetadata = JSON.stringify({
      production: {
        taskId: 'production-task:shared-word:default_production',
        cueId: replacementCueId,
        cueType: 'definition_gloss',
        text: 'something owned or used by more than one person',
        acceptedWordIds: ['shared-word'],
        anchorWordId: 'shared-word',
        submittedText: '共享',
        submittedWordId: 'shared-word',
        result: 'accepted_anchor',
        recheckDemandId: null,
      },
    });
    sqlite.prepare(`
      INSERT INTO study_attempt_events (
        id, occurred_at, session_id, session_action_id, session_event_sequence,
        action_attempt_sequence, action_kind, target_word_id, sampled_skill_ids_json,
        response, outcome, rating, content_ref_json, metadata_json, projected_at
      ) VALUES (
        'shared-version-attempt', '2026-08-21T04:02:45.000Z',
        'shared-version-session', 'shared-version-action', 1, 1, 'production',
        'shared-word', '["production"]', '共享', 'correct', 'good', ?, ?,
        '2026-08-21T04:02:45.000Z'
      )
    `).run(
      JSON.stringify({
        type: 'production_cue',
        taskId: 'production-task:shared-word:default_production',
        cueId: replacementCueId,
      }),
      historicalMetadata,
    );
    const report = dbModule.runWithLearnerId('learner-b', () => (
      dbModule.reportSharedContentPublication({
        publicationId: replacementPublication.publicationId,
        category: 'misleading',
        note: 'This cue needs operator review.',
        createdAt: '2026-08-21T04:03:00.000Z',
      })
    ));
    assert.equal(
      dbModule.runWithLearnerId(
        'learner-a',
        () => dbModule.getSharedContentReport(report.reportId),
      ),
      null,
    );
    assert.equal(
      dbModule.getSharedContentPublication(replacementPublication.publicationId)?.publicationStatus,
      'shared_trial',
    );
    assert.deepEqual(dbModule.listOpenSharedContentReportsForOperator(), [{
      reportId: report.reportId,
      reportingLearnerId: 'learner-b',
      publicationId: replacementPublication.publicationId,
      category: 'misleading',
      note: 'This cue needs operator review.',
      createdAt: '2026-08-21T04:03:00.000Z',
      resolution: 'open',
      resolvedAt: null,
      contentKind: 'production_cue',
      contentId: replacementCueId,
    }]);
    sqlite.exec(`
      DROP TRIGGER shared_content_reports_scoped_update;
      CREATE TRIGGER shared_content_reports_scoped_update
      INSTEAD OF UPDATE ON shared_content_reports
      BEGIN
        UPDATE learner_owned_shared_content_reports
        SET resolution = NEW.resolution,
            resolved_at = NEW.resolved_at,
            resolved_by_operator_id = NEW.resolved_by_operator_id
        WHERE learner_id = current_learner_id() AND report_id = OLD.report_id;
      END;
    `);
    reinstallLearnerScopedCompatibilityViews();
    assert.throws(
      () => sqlite.prepare(`
        UPDATE shared_content_reports
        SET resolution = 'dismissed',
            resolved_at = '2026-08-21T04:03:20.000Z',
            resolved_by_operator_id = 'forged-operator'
        WHERE report_id = ?
      `).run(report.reportId),
      /reports are immutable through learner paths/,
    );
    assert.throws(
      () => sqlite.prepare(`DELETE FROM shared_content_reports WHERE report_id = ?`)
        .run(report.reportId),
      /shared content reports cannot be deleted/,
    );
    assert.throws(
      () => sqlite.prepare(`
        DELETE FROM learner_owned_shared_content_publication_provenance
        WHERE publication_id = ?
      `).run(replacementPublication.publicationId),
      /publication provenance cannot be deleted/,
    );
    assert.throws(
      () => sqlite.prepare(`
        DELETE FROM learner_owned_reflection_operation_invocations
        WHERE learner_id = 'learner-a' AND invocation_id = 'learner-a-cue-replace'
      `).run(),
      /invocation with shared publication provenance cannot be deleted/,
    );
    assert.throws(
      () => sqlite.prepare(`
        UPDATE shared_content_publications
        SET publication_status = 'available', status_updated_at = '2026-08-21T04:03:30.000Z'
        WHERE publication_id = ?
      `).run(replacementPublication.publicationId),
      /status changes require an attributable publication event/,
    );

    const quarantined = dbModule.runWithLearnerId('learner-b', () => (
      dbModule.quarantineSharedContentPublicationFromReport({
        reportId: report.reportId,
        operatorId: 'operator-1',
        occurredAt: '2026-08-21T04:04:00.000Z',
      })
    ));
    assert.equal(quarantined.publicationStatus, 'quarantined');
    assert.equal(
      dbModule.runWithLearnerId(
        'learner-b',
        () => dbModule.getProductionCue(replacementCueId)?.active,
      ),
      false,
    );
    assert.equal(
      (sqlite.prepare(`
        SELECT metadata_json
        FROM learner_owned_study_attempt_events
        WHERE learner_id = 'learner-b' AND id = 'shared-version-attempt'
      `).get() as { metadata_json: string }).metadata_json,
      historicalMetadata,
    );
    assert.deepEqual(dbModule.listOpenSharedContentReportsForOperator(), []);
    assert.throws(
      () => sqlite.prepare(`DELETE FROM shared_content_publications WHERE publication_id = ?`)
        .run(replacementPublication.publicationId),
      /shared content publications cannot be deleted/,
    );
  });
});

function cueRepairOperation(input: {
  changes: Extract<ReflectionOperation, {
    kind: 'repair_production_cue';
    version: 2;
  }>['changes'];
}): Extract<ReflectionOperation, { kind: 'repair_production_cue'; version: 2 }> {
  return {
    kind: 'repair_production_cue',
    version: 2,
    wordId: 'shared-word',
    taskId: 'production-task:shared-word:default_production',
    changes: input.changes,
    sourceAttemptJudgments: [],
  };
}

function insertInvocation(invocationId: string, operation: ReflectionOperation): void {
  sqlite.prepare(`
    INSERT INTO reflection_operation_invocations (
      invocation_id, created_at, origin_kind, origin_proposal_id,
      origin_superseded_proposal_id, operation_kind, operation_version,
      operation_json, application_state, application_updated_at,
      unsupported_reason, applied_at, application_error, stale_reason,
      effect_refs_json, satisfying_effect_refs_json
    ) VALUES (?, '2026-08-21T04:00:00.000Z', 'manual', NULL, NULL, ?, ?, ?,
      'pending', '2026-08-21T04:00:00.000Z', NULL, NULL, NULL, NULL, '[]', '[]')
  `).run(invocationId, operation.kind, operation.version, JSON.stringify(operation));
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
