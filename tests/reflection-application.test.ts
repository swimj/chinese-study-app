import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, beforeEach, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import type {
  ReflectionOperation,
  SessionReflectionBundleV1,
  SessionReflectionResultV4,
} from '../src/domain/reflection.js';

type DbModule = typeof import('../server/db.ts');

const createdAt = '2026-07-29T12:00:00.000Z';
const appliedAt = '2026-07-29T12:01:00.000Z';
let dataDir = '';
let sqlite: DatabaseSync;
let dbModule: DbModule;

describe('reflection application adapters', { concurrency: false }, () => {
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-reflection-application-'));
    const previousMode = process.env.APP_MODE;
    const previousDataDir = process.env.APP_DATA_DIR;
    try {
      process.env.APP_MODE = 'study';
      process.env.APP_DATA_DIR = dataDir;
      dbModule = await import(
        `${pathToFileURL(path.resolve('server/db.ts')).href}?test=${Date.now()}`
      );
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
      DROP TRIGGER IF EXISTS fail_reflection_prompt_insert;
      DROP TRIGGER IF EXISTS fail_production_cue_lifecycle_insert;
      DROP TRIGGER IF EXISTS production_cues_no_delete;
      DROP TRIGGER IF EXISTS production_cue_accepted_words_no_delete;
      DROP TRIGGER IF EXISTS production_cue_lifecycle_events_no_delete;
      DROP TRIGGER IF EXISTS production_cue_evidence_records_no_delete;
      PRAGMA defer_foreign_keys = ON;
      BEGIN;
      DELETE FROM production_cue_evidence_projection;
      DELETE FROM production_cue_evidence_records;
      DELETE FROM production_cue_activation_state;
      DELETE FROM production_cue_lifecycle_events;
      DELETE FROM production_cues;
      DELETE FROM production_tasks;
      DELETE FROM reflection_help_inbox;
      DELETE FROM reflection_quality_annotations;
      DELETE FROM reflection_proposal_reviews;
      DELETE FROM reflection_operation_invocations;
      DELETE FROM reflection_generation_runs;
      DELETE FROM reflection_artifacts;
      DELETE FROM contrast_candidate_intake;
      DELETE FROM contrast_prompts;
      DELETE FROM contrast_cluster_members;
      DELETE FROM contrast_clusters;
      DELETE FROM word_skill_relevance;
      DELETE FROM study_events;
      DELETE FROM study_sessions;
      DELETE FROM words;
      COMMIT;
    `);
    dbModule.ensureProductionCueSchema();
    insertWord('target', '目标');
    insertWord('alternate', '替代');
  });

  after(() => {
    sqlite.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('backfills default production tasks once and leaves future words to the insert trigger', () => {
    sqlite.exec(`
      DELETE FROM production_tasks;
      DELETE FROM app_metadata WHERE key = 'production_tasks_backfill_v0';
    `);

    dbModule.ensureProductionCueSchema();

    assert.deepEqual(
      sqlite.prepare(`
        SELECT task_id, word_id, task_kind, created_at
        FROM production_tasks
        ORDER BY word_id
      `).all().map((row) => ({ ...row })),
      [
        {
          task_id: 'production-task:alternate:default_production',
          word_id: 'alternate',
          task_kind: 'default_production',
          created_at: createdAt,
        },
        {
          task_id: 'production-task:target:default_production',
          word_id: 'target',
          task_kind: 'default_production',
          created_at: createdAt,
        },
      ],
    );
    const marker = sqlite.prepare(`
      SELECT value, updated_at
      FROM app_metadata
      WHERE key = 'production_tasks_backfill_v0'
    `).get() as { value: string; updated_at: string };
    assert.equal(marker.value, 'complete');
    assert.equal(new Date(marker.updated_at).toISOString(), marker.updated_at);

    sqlite.prepare(`
      DELETE FROM app_metadata
      WHERE key = 'production_tasks_backfill_v0'
    `).run();
    dbModule.ensureProductionCueSchema();
    assert.equal(countRows('production_tasks'), 2);

    sqlite.prepare(`
      UPDATE app_metadata
      SET updated_at = ?
      WHERE key = 'production_tasks_backfill_v0'
    `).run(appliedAt);
    dbModule.ensureProductionCueSchema();
    assert.equal(
      (sqlite.prepare(`
        SELECT updated_at
        FROM app_metadata
        WHERE key = 'production_tasks_backfill_v0'
      `).get() as { updated_at: string }).updated_at,
      appliedAt,
    );

    insertWord('future', '未来');
    assert.deepEqual(dbModule.getDefaultProductionTask('future'), {
      taskId: 'production-task:future:default_production',
      wordId: 'future',
      kind: 'default_production',
      createdAt,
    });
  });

  test('applies production suppression once and returns its recorded status on later calls', () => {
    insertInvocation('suppress-new', suppressOperation('target'));

    const first = dbModule.applyReflectionInvocation('suppress-new', appliedAt);
    assert.deepEqual(first.application.state, {
      kind: 'applied',
      appliedAt,
      effectRefs: [{ type: 'word_skill_relevance', id: 'target/production' }],
    });
    assert.deepEqual(dbModule.getWordSkillRelevance('target', 'production'), {
      wordId: 'target',
      skillId: 'production',
      relevanceState: 'suppressed',
      updatedAt: appliedAt,
      sourceEventId: null,
    });

    const repeatedCall = dbModule.applyReflectionInvocation(
      'suppress-new',
      '2026-07-29T12:30:00.000Z',
    );
    assert.deepEqual(repeatedCall, first);
  });

  test('preserves existing suppression provenance when recording already_satisfied', () => {
    sqlite.prepare(`
      INSERT INTO word_skill_relevance (
        word_id, skill_id, relevance_state, updated_at, source_event_id
      ) VALUES ('target', 'production', 'suppressed', ?, NULL)
    `).run(createdAt);
    insertInvocation('suppress-existing', suppressOperation('target'));

    const result = dbModule.applyReflectionInvocation('suppress-existing', appliedAt);
    assert.deepEqual(result.application.state, {
      kind: 'already_satisfied',
      satisfyingEffectRefs: [{ type: 'word_skill_relevance', id: 'target/production' }],
    });
    assert.equal(
      dbModule.getWordSkillRelevance('target', 'production')?.updatedAt,
      createdAt,
    );
  });

  test('records a missing suppression target as stale without writing effects', () => {
    insertInvocation('suppress-stale', suppressOperation('target'));
    sqlite.prepare(`DELETE FROM words WHERE id = 'target'`).run();

    const result = dbModule.applyReflectionInvocation('suppress-stale', appliedAt);
    assert.equal(result.application.state.kind, 'stale');
    assert.match(
      result.application.state.kind === 'stale' ? result.application.state.reason : '',
      /no longer exists/,
    );
    assert.equal(dbModule.getWordSkillRelevance('target', 'production'), null);
  });

  test('withdraws a safely cancellable pending invocation without applying it', () => {
    insertInvocation('suppress-withdrawn', suppressOperation('target'));

    const withdrawn = dbModule.withdrawReflectionInvocationAuthorization(
      'suppress-withdrawn',
      appliedAt,
    );
    assert.deepEqual(withdrawn.application.state, { kind: 'authorization_withdrawn' });
    assert.deepEqual(dbModule.listPendingReflectionInvocationIds(), []);
    assert.deepEqual(
      dbModule.applyReflectionInvocation('suppress-withdrawn', createdAt),
      withdrawn,
    );
    assert.equal(dbModule.getWordSkillRelevance('target', 'production'), null);
  });

  test('records contrast creation as stale when a member disappears without partial effects', () => {
    insertInvocation('contrast-stale', contrastOperation());
    sqlite.prepare(`DELETE FROM words WHERE id = 'alternate'`).run();

    const result = dbModule.applyReflectionInvocation('contrast-stale', appliedAt);
    assert.equal(result.application.state.kind, 'stale');
    assert.match(
      result.application.state.kind === 'stale' ? result.application.state.reason : '',
      /alternate no longer exists/,
    );
    assert.equal(countRows('contrast_clusters'), 0);
    assert.equal(countRows('contrast_cluster_members'), 0);
    assert.equal(countRows('contrast_prompts'), 0);
    assert.equal(countRows('word_skill_relevance'), 0);
    assert.equal(countRows('word_skill_state'), 0);
  });

  test('atomically creates complete contrast content and records every caused effect', () => {
    insertInvocation('contrast-new', contrastOperation());

    const result = dbModule.applyReflectionInvocation('contrast-new', appliedAt);
    assert.equal(result.application.state.kind, 'applied');
    const refs = result.application.state.kind === 'applied'
      ? result.application.state.effectRefs
      : [];
    assert.deepEqual(refs.map((ref) => ref.type), [
      'contrast_cluster',
      'contrast_cluster_member',
      'contrast_cluster_member',
      'contrast_prompt',
      'contrast_prompt',
      'contrast_prompt',
      'contrast_prompt',
      'word_skill_relevance',
      'word_skill_state',
      'word_skill_relevance',
      'word_skill_state',
    ]);

    const clusterId = refs[0]?.id ?? '';
    const cluster = dbModule.getContrastClusterContent().find(({ id }) => id === clusterId);
    assert.equal(cluster?.title, '目标 / 替代');
    assert.equal(cluster?.note, 'Compare intent.');
    assert.deepEqual(
      cluster?.members.map(({ wordId, nuanceNote, displayOrder }) => ({
        wordId,
        nuanceNote,
        displayOrder,
      })),
      [
        { wordId: 'target', nuanceNote: 'intended', displayOrder: 1 },
        { wordId: 'alternate', nuanceNote: 'nearby', displayOrder: 2 },
      ],
    );
    assert.ok(cluster?.prompts.some((prompt) => prompt.promptText === 'Choose the intended word.'));
    for (const wordId of ['target', 'alternate']) {
      assert.equal(
        dbModule.getWordSkillRelevance(wordId, 'contextual_selection')?.relevanceState,
        'normal',
      );
      assert.equal(fetchContextualSchedulerState(wordId)?.enabled, 1);
    }
    assert.deepEqual(dbModule.getContrastCandidateIntake(), []);
    assert.deepEqual(dbModule.applyReflectionInvocation('contrast-new', createdAt), result);
  });

  test('atomically creates immutable V2 production cues initially active', () => {
    const operation = cueRepairOperation({
      changes: [{
        kind: 'create',
        cue: {
          cueType: 'minimal_context',
          text: 'What you know about a fact',
          acceptedWordIds: ['target'],
        },
      }],
    });
    insertInvocation('cue-create', operation);

    const beforeSkillCount = countRows('word_skill_state');
    const beforeAdmissionCount = countRows('word_study_admission_state');
    const result = dbModule.applyReflectionInvocation('cue-create', appliedAt);
    assert.equal(result.application.state.kind, 'applied');
    const refs = result.application.state.kind === 'applied'
      ? result.application.state.effectRefs
      : [];
    assert.deepEqual(refs.map((ref) => ref.type), [
      'production_cue',
      'production_cue_lifecycle_event',
    ]);
    const cue = dbModule.getProductionCue(refs[0]!.id);
    assert.deepEqual(cue, {
      cueId: refs[0]!.id,
      taskId: 'production-task:target:default_production',
      cueType: 'minimal_context',
      text: 'What you know about a fact',
      acceptedWordIds: ['target'],
      createdAt: appliedAt,
      attribution: { origin: 'reflection', invocationId: 'cue-create' },
      active: true,
    });
    assert.equal(countRows('word_skill_state'), beforeSkillCount);
    assert.equal(countRows('word_study_admission_state'), beforeAdmissionCount);
    assert.deepEqual(dbModule.applyReflectionInvocation('cue-create', createdAt), result);
  });

  test('replaces only the named cue and preserves unrelated active cue identities', () => {
    insertInvocation('cue-seed', cueRepairOperation({
      changes: [
        {
          kind: 'create',
          cue: {
            cueType: 'definition_gloss',
            text: 'target',
            acceptedWordIds: ['target'],
          },
        },
        {
          kind: 'create',
          cue: {
            cueType: 'circumstance',
            text: 'When identifying an objective',
            acceptedWordIds: ['target'],
          },
        },
      ],
    }));
    const seeded = dbModule.applyReflectionInvocation('cue-seed', appliedAt);
    assert.equal(seeded.application.state.kind, 'applied');
    const seededCueIds = seeded.application.state.kind === 'applied'
      ? seeded.application.state.effectRefs
        .filter((ref) => ref.type === 'production_cue')
        .map((ref) => ref.id)
      : [];
    assert.equal(seededCueIds.length, 2);

    insertInvocation('cue-replace', cueRepairOperation({
      changes: [{
        kind: 'replace',
        cueId: seededCueIds[0]!,
        replacements: [{
          cueType: 'definition_gloss',
          text: 'target or substitute',
          acceptedWordIds: ['target', 'alternate'],
        }],
      }],
    }));
    const replaced = dbModule.applyReflectionInvocation(
      'cue-replace',
      '2026-07-29T12:02:00.000Z',
    );
    assert.equal(replaced.application.state.kind, 'applied');
    assert.equal(dbModule.getProductionCue(seededCueIds[0]!)?.active, false);
    assert.equal(dbModule.getProductionCue(seededCueIds[1]!)?.active, true);
    const activeCues = dbModule.getActiveProductionCuesForWord('target');
    assert.equal(activeCues.length, 2);
    assert.ok(activeCues.some((cue) => cue.cueId === seededCueIds[1]));
    assert.ok(activeCues.some((cue) => (
      cue.text === 'target or substitute'
      && cue.acceptedWordIds.join(',') === 'target,alternate'
    )));
  });

  test('records terminal deactivation satisfaction and treats later creation independently', () => {
    insertInvocation('cue-seed-lifecycle', cueRepairOperation({
      changes: [{
        kind: 'create',
        cue: {
          cueType: 'definition_gloss',
          text: 'target',
          acceptedWordIds: ['target'],
        },
      }],
    }));
    const seeded = dbModule.applyReflectionInvocation('cue-seed-lifecycle', appliedAt);
    assert.equal(seeded.application.state.kind, 'applied');
    const cueId = seeded.application.state.kind === 'applied'
      ? seeded.application.state.effectRefs.find((ref) => ref.type === 'production_cue')!.id
      : '';

    insertInvocation('cue-deactivate', cueRepairOperation({
      changes: [{ kind: 'deactivate', cueId }],
    }));
    const deactivated = dbModule.applyReflectionInvocation('cue-deactivate', appliedAt);
    assert.equal(deactivated.application.state.kind, 'applied');
    assert.equal(dbModule.getProductionCue(cueId)?.active, false);

    insertInvocation('cue-already-deactivated', cueRepairOperation({
      changes: [{ kind: 'deactivate', cueId }],
    }));
    const already = dbModule.applyReflectionInvocation('cue-already-deactivated', appliedAt);
    assert.equal(already.application.state.kind, 'already_satisfied');
    assert.deepEqual(
      already.application.state.kind === 'already_satisfied'
        ? already.application.state.satisfyingEffectRefs.map((ref) => ref.type)
        : [],
      ['production_cue_lifecycle_event'],
    );

    insertInvocation('cue-independent-create', cueRepairOperation({
      changes: [{
        kind: 'create',
        cue: {
          cueType: 'definition_gloss',
          text: 'target',
          acceptedWordIds: ['target'],
        },
      }],
    }));
    const independentCreate = dbModule.applyReflectionInvocation('cue-independent-create', appliedAt);
    assert.equal(independentCreate.application.state.kind, 'applied');
    const independentlyCreatedCueId = independentCreate.application.state.kind === 'applied'
      ? independentCreate.application.state.effectRefs.find((ref) => ref.type === 'production_cue')!.id
      : '';
    assert.notEqual(independentlyCreatedCueId, cueId);
    assert.equal(dbModule.getProductionCue(cueId)?.active, false);
    assert.equal(dbModule.getProductionCue(independentlyCreatedCueId)?.active, true);

    insertInvocation('cue-wrong-task', {
      ...cueRepairOperation({ changes: [{ kind: 'deactivate', cueId: independentlyCreatedCueId }] }),
      taskId: 'production-task:alternate:default_production',
    });
    const stale = dbModule.applyReflectionInvocation('cue-wrong-task', appliedAt);
    assert.equal(stale.application.state.kind, 'stale');
    assert.equal(dbModule.getProductionCue(independentlyCreatedCueId)?.active, true);
  });

  test('rolls back cue content and records failed application when lifecycle persistence fails', () => {
    sqlite.exec(`
      CREATE TRIGGER fail_production_cue_lifecycle_insert
      BEFORE INSERT ON production_cue_lifecycle_events
      BEGIN
        SELECT RAISE(ABORT, 'forced cue lifecycle failure');
      END;
    `);
    insertInvocation('cue-failure', cueRepairOperation({
      changes: [{
        kind: 'create',
        cue: {
          cueType: 'definition_gloss',
          text: 'target',
          acceptedWordIds: ['target'],
        },
      }],
    }));

    const failed = dbModule.applyReflectionInvocation('cue-failure', appliedAt);
    assert.equal(failed.application.state.kind, 'failed');
    assert.match(
      failed.application.state.kind === 'failed' ? failed.application.state.error : '',
      /forced cue lifecycle failure/,
    );
    assert.equal(countRows('production_cues'), 0);
    assert.equal(countRows('production_cue_lifecycle_events'), 0);
  });

  test('appends authorized cue judgments and projects compensation without scheduling effects', () => {
    insertInvocation('cue-evidence-seed', cueRepairOperation({
      changes: [{
        kind: 'create',
        cue: {
          cueType: 'definition_gloss',
          text: 'target',
          acceptedWordIds: ['target'],
        },
      }],
    }));
    const seeded = dbModule.applyReflectionInvocation('cue-evidence-seed', appliedAt);
    assert.equal(seeded.application.state.kind, 'applied');
    const cueId = seeded.application.state.kind === 'applied'
      ? seeded.application.state.effectRefs.find((ref) => ref.type === 'production_cue')!.id
      : '';
    insertStudyAttempt('attempt-omission', { cueId });
    dbModule.appendProductionCueAttemptEvidenceWithoutTransaction({
      evidenceId: 'attempt-evidence-omission',
      occurredAt: '2026-07-29T12:01:30.000Z',
      taskId: 'production-task:target:default_production',
      cueId,
      sourceAttemptId: 'attempt-omission',
      attemptResult: 'rejected',
      submittedWordId: 'alternate',
    });

    const beforeSkillCount = countRows('word_skill_state');
    const beforeAdmissionCount = countRows('word_study_admission_state');
    insertInvocation('cue-evidence-repair', {
      ...cueRepairOperation({
        changes: [{
          kind: 'replace',
          cueId,
          replacements: [{
            cueType: 'definition_gloss',
            text: 'target',
            acceptedWordIds: ['target', 'alternate'],
          }],
        }],
      }),
      sourceAttemptJudgments: [{
        kind: 'accepted_answer_space_omission',
        sourceAttemptId: 'attempt-omission',
        submittedWordId: 'alternate',
      }],
    });
    const repaired = dbModule.applyReflectionInvocation(
      'cue-evidence-repair',
      '2026-07-29T12:02:00.000Z',
    );
    assert.equal(repaired.application.state.kind, 'applied');
    const judgmentId = repaired.application.state.kind === 'applied'
      ? repaired.application.state.effectRefs.find(
        (ref) => ref.type === 'production_cue_evidence_judgment',
      )!.id
      : '';

    dbModule.projectProductionCueEvidence('2026-07-29T12:03:00.000Z');
    assert.deepEqual(dbModule.getProductionCueEvidenceProjection(cueId), {
      cueId,
      attemptCount: 1,
      acceptedAnchorCount: 0,
      acceptedNonAnchorCount: 0,
      rejectedCount: 1,
      activeJudgmentCount: 1,
      updatedAt: '2026-07-29T12:03:00.000Z',
    });

    dbModule.appendProductionCueEvidenceCompensationWithoutTransaction({
      evidenceId: 'judgment-compensation',
      occurredAt: '2026-07-29T12:04:00.000Z',
      sourceJudgmentEvidenceId: judgmentId,
      reason: 'Learner later withdrew this interpretation.',
    });
    dbModule.projectProductionCueEvidence('2026-07-29T12:05:00.000Z');
    assert.equal(
      dbModule.getProductionCueEvidenceProjection(cueId)?.activeJudgmentCount,
      0,
    );
    assert.equal(countRows('word_skill_state'), beforeSkillCount);
    assert.equal(countRows('word_study_admission_state'), beforeAdmissionCount);
  });

  test('requires an accepted-answer judgment to replace the exact served cue', () => {
    insertInvocation('cue-exact-repair-seed', cueRepairOperation({
      changes: [{
        kind: 'create',
        cue: {
          cueType: 'definition_gloss',
          text: 'target',
          acceptedWordIds: ['target'],
        },
      }],
    }));
    const seeded = dbModule.applyReflectionInvocation('cue-exact-repair-seed', appliedAt);
    assert.equal(seeded.application.state.kind, 'applied');
    const cueId = seeded.application.state.kind === 'applied'
      ? seeded.application.state.effectRefs.find((ref) => ref.type === 'production_cue')!.id
      : '';
    insertStudyAttempt('attempt-exact-repair', { cueId });
    dbModule.appendProductionCueAttemptEvidenceWithoutTransaction({
      evidenceId: 'attempt-evidence-exact-repair',
      occurredAt: appliedAt,
      taskId: 'production-task:target:default_production',
      cueId,
      sourceAttemptId: 'attempt-exact-repair',
      attemptResult: 'rejected',
      submittedWordId: 'alternate',
    });
    insertInvocation('cue-wrong-repair', {
      ...cueRepairOperation({
        changes: [{
          kind: 'create',
          cue: {
            cueType: 'minimal_context',
            text: 'An unrelated new cue',
            acceptedWordIds: ['target', 'alternate'],
          },
        }],
      }),
      sourceAttemptJudgments: [{
        kind: 'accepted_answer_space_omission',
        sourceAttemptId: 'attempt-exact-repair',
        submittedWordId: 'alternate',
      }],
    });

    const result = dbModule.applyReflectionInvocation('cue-wrong-repair', appliedAt);
    assert.equal(result.application.state.kind, 'stale');
    assert.equal(dbModule.getProductionCue(cueId)?.active, true);
    assert.equal(
      sqlite.prepare(`
        SELECT COUNT(*) AS count
        FROM production_cue_evidence_records
        WHERE record_kind = 'judgment'
      `).get().count,
      0,
    );
  });

  test('rejects cue evidence whose source attempt snapshot identifies another cue', () => {
    insertInvocation('cue-snapshot-seed', cueRepairOperation({
      changes: [{
        kind: 'create',
        cue: {
          cueType: 'definition_gloss',
          text: 'target',
          acceptedWordIds: ['target'],
        },
      }],
    }));
    const seeded = dbModule.applyReflectionInvocation('cue-snapshot-seed', appliedAt);
    assert.equal(seeded.application.state.kind, 'applied');
    const cueId = seeded.application.state.kind === 'applied'
      ? seeded.application.state.effectRefs.find((ref) => ref.type === 'production_cue')!.id
      : '';
    insertStudyAttempt('attempt-wrong-snapshot', {
      cueId,
      contentCueId: 'another-cue',
    });

    assert.throws(
      () => dbModule.appendProductionCueAttemptEvidenceWithoutTransaction({
        occurredAt: appliedAt,
        taskId: 'production-task:target:default_production',
        cueId,
        sourceAttemptId: 'attempt-wrong-snapshot',
        attemptResult: 'rejected',
        submittedWordId: 'alternate',
      }),
      /does not identify production cue/,
    );
    assert.equal(countRows('production_cue_evidence_records'), 0);
  });

  test('marks fallback cue evidence projected without inventing cue shadow state', () => {
    insertStudyAttempt('attempt-fallback', { cueId: null });
    dbModule.appendProductionCueAttemptEvidenceWithoutTransaction({
      evidenceId: 'fallback-attempt-evidence',
      occurredAt: appliedAt,
      taskId: 'production-task:target:default_production',
      cueId: null,
      sourceAttemptId: 'attempt-fallback',
      attemptResult: 'rejected',
      submittedWordId: 'alternate',
    });

    dbModule.projectProductionCueEvidence('2026-07-29T12:03:00.000Z');

    assert.equal(
      sqlite.prepare(`
        SELECT projected_at
        FROM production_cue_evidence_records
        WHERE evidence_id = 'fallback-attempt-evidence'
      `).get().projected_at,
      '2026-07-29T12:03:00.000Z',
    );
    assert.equal(countRows('production_cue_evidence_projection'), 0);
  });

  test('prevents destructive deletion of immutable cue facts', () => {
    insertInvocation('cue-delete-seed', cueRepairOperation({
      changes: [{
        kind: 'create',
        cue: {
          cueType: 'definition_gloss',
          text: 'target',
          acceptedWordIds: ['target'],
        },
      }],
    }));
    const seeded = dbModule.applyReflectionInvocation('cue-delete-seed', appliedAt);
    assert.equal(seeded.application.state.kind, 'applied');
    const cueId = seeded.application.state.kind === 'applied'
      ? seeded.application.state.effectRefs.find((ref) => ref.type === 'production_cue')!.id
      : '';
    insertStudyAttempt('attempt-delete-guard', { cueId });
    dbModule.appendProductionCueAttemptEvidenceWithoutTransaction({
      evidenceId: 'delete-guard-evidence',
      occurredAt: appliedAt,
      taskId: 'production-task:target:default_production',
      cueId,
      sourceAttemptId: 'attempt-delete-guard',
      attemptResult: 'rejected',
      submittedWordId: 'alternate',
    });

    assert.throws(
      () => sqlite.prepare(`DELETE FROM production_cue_accepted_words WHERE cue_id = ?`).run(cueId),
      /accepted words cannot be deleted/,
    );
    assert.throws(
      () => sqlite.prepare(`DELETE FROM production_cue_lifecycle_events WHERE cue_id = ?`).run(cueId),
      /lifecycle events cannot be deleted/,
    );
    assert.throws(
      () => sqlite.prepare(`DELETE FROM production_cue_evidence_records WHERE cue_id = ?`).run(cueId),
      /evidence cannot be deleted/,
    );
    assert.throws(
      () => sqlite.prepare(`DELETE FROM production_cues WHERE cue_id = ?`).run(cueId),
      /production cues cannot be deleted/,
    );
  });

  test('attributes only contextual eligibility changes caused by contrast creation', () => {
    sqlite.prepare(`
      INSERT INTO word_skill_relevance (
        word_id, skill_id, relevance_state, updated_at, source_event_id
      ) VALUES ('target', 'contextual_selection', 'normal', ?, NULL)
    `).run(createdAt);
    insertContextualSchedulerState('target', true);
    insertInvocation('contrast-partial-eligibility', contrastOperation());

    const result = dbModule.applyReflectionInvocation('contrast-partial-eligibility', appliedAt);
    assert.equal(result.application.state.kind, 'applied');
    const refs = result.application.state.kind === 'applied'
      ? result.application.state.effectRefs
      : [];
    assert.deepEqual(
      refs.filter((ref) => ref.type.startsWith('word_skill_')),
      [
        { type: 'word_skill_relevance', id: 'alternate/contextual_selection' },
        { type: 'word_skill_state', id: 'alternate/contextual_selection' },
      ],
    );
    assert.equal(
      dbModule.getWordSkillRelevance('target', 'contextual_selection')?.updatedAt,
      createdAt,
    );
    assert.equal(fetchContextualSchedulerState('target')?.last_studied_at, createdAt);
  });

  test('applies revised contrast content while preserving the immutable original proposal', () => {
    const original = contrastOperation();
    const revised = contrastOperation();
    if (
      original.kind !== 'create_contrast_cluster'
      || revised.kind !== 'create_contrast_cluster'
    ) {
      throw new Error('Expected contrast operations.');
    }
    revised.title = '目标与替代：语境对比';
    revised.prompts[0] = {
      ...revised.prompts[0],
      promptText: 'Choose the word that fits this revised context.',
      explanation: 'The edited explanation is the authorized content.',
    };
    const artifact = materializeProposal('revised-contrast-session', original);
    const accepted = dbModule.acceptReflectionProposal({
      proposalId: artifact.proposals[0]!.review.proposalId,
      operation: revised,
      invocationId: 'revised-contrast',
      createdAt,
    });

    assert.deepEqual(accepted.review.disposition, {
      kind: 'accepted',
      acceptanceMode: 'revised',
      acceptedInvocationId: 'revised-contrast',
    });
    assert.deepEqual(
      dbModule.getReflectionArtifactDetail(artifact.artifactId)
        .proposals[0]!.proposal.operation,
      original,
    );
    assert.deepEqual(accepted.invocation.invocation.operation, revised);

    const applied = dbModule.applyReflectionInvocation('revised-contrast', appliedAt);
    assert.equal(applied.application.state.kind, 'applied');
    const cluster = dbModule.getContrastClusterContent()[0];
    assert.equal(cluster?.title, revised.title);
    const editedPrompt = cluster?.prompts.find(
      (prompt) => prompt.promptText === revised.prompts[0]!.promptText,
    );
    assert.equal(editedPrompt?.explanation, revised.prompts[0]!.explanation);
    assert.deepEqual(
      dbModule.getReflectionArtifactDetail(artifact.artifactId)
        .proposals[0]!.proposal.operation,
      original,
    );
  });

  test('recovers pending work and recognizes only a complete exact postcondition', () => {
    insertInvocation('contrast-first', contrastOperation());
    const first = dbModule.applyReflectionInvocation('contrast-first', appliedAt);
    insertInvocation('contrast-exact', contrastOperation());

    assert.deepEqual(dbModule.listPendingReflectionInvocationIds(), ['contrast-exact']);
    const [recovered] = dbModule.recoverPendingReflectionInvocations();
    assert.equal(recovered?.application.state.kind, 'already_satisfied');
    const compareEffectRefs = (left: { type: string; id: string }, right: { type: string; id: string }) => (
      left.type.localeCompare(right.type) || left.id.localeCompare(right.id)
    );
    assert.deepEqual(
      (recovered?.application.state.kind === 'already_satisfied'
        ? recovered.application.state.satisfyingEffectRefs
        : []).toSorted(compareEffectRefs),
      (first.application.state.kind === 'applied' ? first.application.state.effectRefs : [])
        .toSorted(compareEffectRefs),
    );
    assert.deepEqual(dbModule.listPendingReflectionInvocationIds(), []);
    assert.equal(dbModule.getContrastClusters().length, 1);
  });

  test('repairs eligibility instead of treating exact content alone as already satisfied', () => {
    insertInvocation('contrast-content-first', contrastOperation());
    dbModule.applyReflectionInvocation('contrast-content-first', appliedAt);
    sqlite.prepare(`
      DELETE FROM word_skill_relevance
      WHERE word_id = 'alternate'
        AND skill_id = 'contextual_selection'
    `).run();
    sqlite.prepare(`
      DELETE FROM word_skill_state
      WHERE word_id = 'alternate'
        AND skill_id = 'contextual_selection'
    `).run();
    insertInvocation('contrast-repair-eligibility', contrastOperation());

    const result = dbModule.applyReflectionInvocation('contrast-repair-eligibility', appliedAt);
    assert.deepEqual(result.application.state, {
      kind: 'applied',
      appliedAt,
      effectRefs: [
        { type: 'word_skill_relevance', id: 'alternate/contextual_selection' },
        { type: 'word_skill_state', id: 'alternate/contextual_selection' },
      ],
    });
    assert.equal(dbModule.getContrastClusters().length, 1);
    assert.equal(fetchContextualSchedulerState('alternate')?.enabled, 1);
    assert.deepEqual(dbModule.applyReflectionInvocation('contrast-repair-eligibility', createdAt), result);
  });

  test('creates a new cluster when existing content is only a near match', () => {
    insertInvocation('contrast-original', contrastOperation());
    dbModule.applyReflectionInvocation('contrast-original', appliedAt);
    const nearMatch = contrastOperation();
    if (nearMatch.kind !== 'create_contrast_cluster') {
      throw new Error('Expected contrast operation.');
    }
    nearMatch.prompts[0] = {
      ...nearMatch.prompts[0],
      explanation: 'A materially different explanation.',
    };
    insertInvocation('contrast-near-match', nearMatch);

    const result = dbModule.applyReflectionInvocation('contrast-near-match', appliedAt);
    assert.equal(result.application.state.kind, 'applied');
    assert.equal(dbModule.getContrastClusters().length, 2);
  });

  test('rolls back all contrast effects before persisting a failed application status', () => {
    insertInvocation('contrast-failed', contrastOperation());
    sqlite.exec(`
      CREATE TRIGGER fail_reflection_prompt_insert
      BEFORE INSERT ON contrast_prompts
      BEGIN
        SELECT RAISE(ABORT, 'injected prompt failure');
      END;
    `);

    const result = dbModule.applyReflectionInvocation('contrast-failed', appliedAt);
    assert.equal(result.application.state.kind, 'failed');
    assert.match(
      result.application.state.kind === 'failed' ? result.application.state.error : '',
      /injected prompt failure/,
    );
    assert.equal(dbModule.getContrastClusters().length, 0);
    assert.equal(countRows('contrast_cluster_members'), 0);
    assert.equal(countRows('contrast_prompts'), 0);
    assert.equal(countRows('word_skill_relevance'), 0);
    assert.equal(countRows('word_skill_state'), 0);
    assert.deepEqual(dbModule.applyReflectionInvocation('contrast-failed', createdAt), result);
  });

  test('leaves unsupported invocations and domain state untouched', () => {
    insertInvocation(
      'unsupported',
      {
        kind: 'repair_production_cue',
        version: 1,
        wordId: 'target',
        proposedCues: [{ cueType: 'cloze', text: 'Use ____ here.' }],
        repairIntent: 'add_distinguishing_anchor',
      },
      'unsupported',
    );

    const before = dbModule.getReflectionInvocation('unsupported');
    assert.deepEqual(dbModule.applyReflectionInvocation('unsupported', appliedAt), before);
    assert.equal(countRows('word_skill_relevance'), 0);
    assert.equal(countRows('contrast_clusters'), 0);
  });

  test('fails loudly on corrupt immutable authorization without fabricating an application outcome', () => {
    insertInvocation(
      'corrupt-authorization',
      { kind: 'suppress_definition_production', version: 1 } as ReflectionOperation,
    );

    assert.throws(
      () => dbModule.applyReflectionInvocation('corrupt-authorization', appliedAt),
      /Reflection store corruption/,
    );
    const row = sqlite.prepare(`
      SELECT application_state
      FROM reflection_operation_invocations
      WHERE invocation_id = 'corrupt-authorization'
    `).get() as { application_state: string };
    assert.equal(row.application_state, 'pending');
  });
});

function suppressOperation(wordId: string): ReflectionOperation {
  return { kind: 'suppress_definition_production', version: 1, wordId };
}

function contrastOperation(): ReflectionOperation {
  return {
    kind: 'create_contrast_cluster',
    version: 1,
    title: ' 目标 / 替代 ',
    clusterNote: ' Compare intent. ',
    members: [
      { wordId: 'target', nuanceNote: ' intended ' },
      { wordId: 'alternate', nuanceNote: ' nearby ' },
    ],
    prompts: [
      { targetWordId: 'target', promptText: ' Choose the intended word. ', explanation: ' Target fits this context. ' },
      { targetWordId: 'target', promptText: ' Use the intended word here. ', explanation: ' Target fits this context. ' },
      { targetWordId: 'alternate', promptText: ' Choose the nearby word. ', explanation: ' Alternate fits this context. ' },
      { targetWordId: 'alternate', promptText: ' Use the nearby word here. ', explanation: ' Alternate fits this context. ' },
    ],
  };
}

function cueRepairOperation(input: {
  changes: Extract<ReflectionOperation, {
    kind: 'repair_production_cue';
    version: 2;
  }>['changes'];
}): Extract<ReflectionOperation, { kind: 'repair_production_cue'; version: 2 }> {
  return {
    kind: 'repair_production_cue',
    version: 2,
    wordId: 'target',
    taskId: 'production-task:target:default_production',
    changes: input.changes,
    sourceAttemptJudgments: [],
  };
}

function insertInvocation(
  invocationId: string,
  operation: ReflectionOperation,
  applicationState: 'pending' | 'unsupported' = 'pending',
): void {
  sqlite.prepare(`
    INSERT INTO reflection_operation_invocations (
      invocation_id,
      created_at,
      origin_kind,
      origin_proposal_id,
      origin_superseded_proposal_id,
      operation_kind,
      operation_version,
      operation_json,
      application_state,
      application_updated_at,
      unsupported_reason,
      applied_at,
      application_error,
      stale_reason,
      effect_refs_json,
      satisfying_effect_refs_json
    ) VALUES (?, ?, 'manual', NULL, NULL, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, '[]', '[]')
  `).run(
    invocationId,
    createdAt,
    operation.kind,
    operation.version,
    JSON.stringify(operation),
    applicationState,
    createdAt,
    applicationState === 'unsupported' ? 'No faithful adapter is available.' : null,
  );
}

function materializeProposal(
  sourceSessionId: string,
  operation: ReflectionOperation,
): ReturnType<DbModule['materializeReflectionArtifact']>['artifact'] {
  sqlite.prepare(`
    INSERT INTO study_sessions (
      id,
      started_at,
      ended_at,
      processing_state,
      processed_at
    ) VALUES (?, '2026-07-29T11:30:00.000Z', ?, 'processed', ?)
  `).run(sourceSessionId, createdAt, createdAt);
  const evidenceBundle: SessionReflectionBundleV1 = {
    schemaVersion: 'session_reflection_bundle.v1',
    generatedAt: createdAt,
    session: {
      sessionId: sourceSessionId,
      startedAt: '2026-07-29T11:30:00.000Z',
      endedAt: createdAt,
      studyProfile: 'mandarin',
    },
    items: [{
      itemId: 'item',
      sessionActionId: 'action-item',
      occurredAt: '2026-07-29T11:59:00.000Z',
      source: 'production_mistake',
      sourceActionKind: 'production',
      targetWord: wordSnapshot('target', '目标'),
      sessionNote: null,
      existingContent: { contrastClusters: [], knownAcceptedAlternates: [] },
      cuesAsShown: [{
        cueId: null,
        cueType: 'definition_gloss',
        displayOrder: 0,
        text: 'target',
        displayedMeanings: ['meaning'],
      }],
      rawResponse: '替代',
      submittedWord: wordSnapshot('alternate', '替代'),
      responseKind: 'matched_known_word',
    }],
  };
  const result: SessionReflectionResultV4 = {
    schemaVersion: 'session_reflection_result.v4',
    itemResults: [{
      itemId: 'item',
      diagnosisTags: ['persistent_confusion'],
      observation: 'The two words merit a concrete contrast.',
      learnerExplanation: null,
      proposals: [{
        proposalGroupKey: null,
        rationale: 'Make the distinction trainable.',
        operation,
      }],
      questions: [],
      unhandledNeeds: [],
    }],
  };
  return dbModule.materializeReflectionArtifact({
    sourceSessionId,
    reflectionFlowVersion: 'initial_post_session_reflection.v1',
    generatedAt: createdAt,
    provider: 'openai',
    model: 'gpt-5.6-luna',
    promptVersion: 'reflection-v2',
    evidenceBundle,
    result,
  }).artifact;
}

function wordSnapshot(wordId: string, hanzi: string): SessionReflectionBundleV1[
  'items'
][number]['targetWord'] {
  return {
    wordId,
    hanzi,
    pinyin: 'pin1yin1',
    meanings: ['meaning'],
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
  `).run(wordId, hanzi, createdAt);
}

function insertStudyAttempt(
  attemptId: string,
  options: { cueId: string | null; contentCueId?: string } = { cueId: null },
): void {
  sqlite.prepare(`
    INSERT OR IGNORE INTO study_sessions (
      id, started_at, ended_at, processing_state, processed_at
    ) VALUES ('cue-evidence-session', ?, ?, 'processed', ?)
  `).run(createdAt, appliedAt, appliedAt);
  sqlite.prepare(`
    INSERT INTO study_attempt_events (
      id,
      occurred_at,
      session_id,
      session_action_id,
      session_event_sequence,
      action_attempt_sequence,
      action_kind,
      target_word_id,
      sampled_skill_ids_json,
      response,
      outcome,
      rating,
      content_ref_json,
      metadata_json,
      projected_at
    ) VALUES (?, ?, 'cue-evidence-session', 'cue-action', 1, 1, 'production', 'target',
      '["production"]', '替代', 'incorrect', 'forgot', ?, ?, ?)
  `).run(
    attemptId,
    appliedAt,
    options.cueId === null
      ? null
      : JSON.stringify({
        type: 'production_cue',
        taskId: 'production-task:target:default_production',
        cueId: options.contentCueId ?? options.cueId,
      }),
    JSON.stringify({
      production: {
        taskId: 'production-task:target:default_production',
        cueId: options.cueId,
        cueType: 'definition_gloss',
        text: 'target',
        acceptedWordIds: ['target'],
        anchorWordId: 'target',
        submittedText: '替代',
        submittedWordId: 'alternate',
        result: 'rejected',
      },
    }),
    appliedAt,
  );
}

function insertContextualSchedulerState(wordId: string, enabled: boolean): void {
  sqlite.prepare(`
    INSERT INTO word_skill_state (
      word_id, skill_id, enabled, interval_hours, last_studied_at, next_due_at, ease_factor
    ) VALUES (?, 'contextual_selection', ?, 24, ?, ?, 2.5)
  `).run(wordId, enabled ? 1 : 0, createdAt, appliedAt);
}

function fetchContextualSchedulerState(wordId: string) {
  return sqlite.prepare(`
    SELECT enabled, interval_hours, last_studied_at, next_due_at, ease_factor
    FROM word_skill_state
    WHERE word_id = ?
      AND skill_id = 'contextual_selection'
  `).get(wordId) as {
    enabled: number;
    interval_hours: number;
    last_studied_at: string;
    next_due_at: string | null;
    ease_factor: number;
  } | undefined;
}

function countRows(table: string): number {
  const row = sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
    count: number;
  };
  return row.count;
}
