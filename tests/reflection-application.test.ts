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
      PRAGMA defer_foreign_keys = ON;
      BEGIN;
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
    insertWord('target', '目标');
    insertWord('alternate', '替代');
  });

  after(() => {
    sqlite.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
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
    assert.equal(cluster?.prompts[0]?.promptText, 'Choose the intended word.');
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
    assert.equal(cluster?.prompts[0]?.promptText, revised.prompts[0]!.promptText);
    assert.equal(cluster?.prompts[0]?.explanation, revised.prompts[0]!.explanation);
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
    assert.deepEqual(
      recovered?.application.state.kind === 'already_satisfied'
        ? recovered.application.state.satisfyingEffectRefs
        : [],
      first.application.state.kind === 'applied' ? first.application.state.effectRefs : [],
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
    prompts: [{
      targetWordId: 'target',
      promptText: ' Choose the intended word. ',
      explanation: ' Target fits this context. ',
    }],
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
