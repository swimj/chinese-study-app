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
    const originalCueId = created.application.state.kind === 'applied'
      ? created.application.state.effectRefs.find((ref) => ref.type === 'production_cue')!.id
      : '';

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
    const replacementCueId = replaced.application.state.kind === 'applied'
      ? replaced.application.state.effectRefs.find((ref) => ref.type === 'production_cue')!.id
      : '';
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

    rawLearnerId = 'learner-b';
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
