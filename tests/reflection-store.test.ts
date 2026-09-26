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
  SessionReflectionBundleV2,
  SessionReflectionBundleV5,
  SessionReflectionResultV4,
  SessionReflectionResultV5,
  SessionReflectionResultV6,
  SessionReflectionResultV8,
} from '../src/domain/reflection.js';

type DbModule = typeof import('../server/db.ts');

const generatedAt = '2026-07-29T12:00:00.000Z';
const updatedAt = '2026-07-29T12:01:00.000Z';
const appliedAt = '2026-07-29T12:02:00.000Z';

let dataDir = '';
let sqlite: DatabaseSync;
let dbModule: DbModule;

describe('reflection durable store', { concurrency: false }, () => {
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-reflection-store-'));
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
      DELETE FROM reflection_generation_run_starts;
      DELETE FROM reflection_generation_continuation_runs;
      DELETE FROM reflection_generation_continuations;
      DELETE FROM reflection_artifacts;
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

  test('initializes and validates the eight-table reflection schema', () => {
    assert.doesNotThrow(() => dbModule.validateReflectionSchema());
    const tables = sqlite.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name LIKE 'learner_owned_reflection_%'
      ORDER BY name
    `).all() as Array<{ name: string }>;
    assert.deepEqual(tables.map((row) => row.name), [
      'learner_owned_reflection_artifacts',
      'learner_owned_reflection_generation_run_starts',
      'learner_owned_reflection_generation_runs',
      'learner_owned_reflection_help_inbox',
      'learner_owned_reflection_operation_invocations',
      'learner_owned_reflection_proposal_reviews',
      'learner_owned_reflection_quality_annotations',
    ]);
    const ownershipTrigger = sqlite.prepare(`
      SELECT 1 FROM sqlite_master
      WHERE type = 'trigger'
        AND name = 'learner_owned_reflection_artifacts_source_session_id_same_owner_insert'
    `).get();
    assert(ownershipTrigger);
  });

  test('persists a complete immutable pricing basis with a generation run', () => {
    materializationInput('run-session', suppressOperation('target'));

    const recorded = dbModule.recordReflectionGenerationRun({
      runId: 'run-1',
      sourceSessionId: 'run-session',
      reflectionFlowVersion: 'initial_post_session_reflection.v1',
      startedAt: generatedAt,
      completedAt: updatedAt,
      provider: 'openai',
      model: 'gpt-5.6-luna-high',
      providerModel: 'gpt-5.6-luna',
      promptVersion: 'reflection-v2',
      responseId: 'response-1',
      clientRequestId: null,
      finishReason: 'stop',
      bundleSchemaVersion: 'session_reflection_bundle.v1',
      resultSchemaVersion: 'session_reflection_result.v4',
      diagnostic: null,
      state: 'succeeded',
      failureCode: null,
      eligibleItemCount: 3,
      includedItemCount: 2,
      usage: {
        inputTokens: 1_000,
        cachedInputTokens: 100,
        cacheWriteInputTokens: null,
        outputTokens: 200,
        reasoningTokens: 50,
        totalTokens: 1_200,
      },
      pricingSnapshotId: 'price-v1',
      pricingAsOf: '2026-07-30',
      pricingBasis: { id: 'price-v1', inputPerMillionUsd: 0.2 },
      estimatedCostUsd: 0.00042,
      evidenceBundle: bundle('run-session'),
    });

    assert.deepEqual(recorded, {
      runId: 'run-1',
      sourceSessionId: 'run-session',
      reflectionFlowVersion: 'initial_post_session_reflection.v1',
      startedAt: generatedAt,
      completedAt: updatedAt,
      provider: 'openai',
      model: 'gpt-5.6-luna-high',
      providerModel: 'gpt-5.6-luna',
      promptVersion: 'reflection-v2',
      responseId: 'response-1',
      clientRequestId: null,
      finishReason: 'stop',
      bundleSchemaVersion: 'session_reflection_bundle.v1',
      resultSchemaVersion: 'session_reflection_result.v4',
      diagnostic: null,
      state: 'succeeded',
      failureCode: null,
      eligibleItemCount: 3,
      includedItemCount: 2,
      usage: {
        inputTokens: 1_000,
        cachedInputTokens: 100,
        cacheWriteInputTokens: null,
        outputTokens: 200,
        reasoningTokens: 50,
        totalTokens: 1_200,
      },
      pricingSnapshotId: 'price-v1',
      pricingAsOf: '2026-07-30',
      pricingBasis: { id: 'price-v1', inputPerMillionUsd: 0.2 },
      estimatedCostUsd: 0.00042,
      retryable: false,
    });
    assert.deepEqual(dbModule.listReflectionGenerationRuns(), [recorded]);
  });

  test('sums same-UTC-day estimated spend and ignores null estimates and other days', () => {
    materializationInput('run-session', suppressOperation('target'));
    recordPricedRun('today-priced', '2026-09-10T08:00:00.000Z', 0.4);
    recordPricedRun('today-more', '2026-09-10T23:59:59.000Z', 0.2);
    recordPricedRun('previous-day', '2026-09-09T23:59:59.000Z', 9);
    recordUnpricedRun('today-null', '2026-09-10T12:00:00.000Z');

    const now = new Date('2026-09-10T15:00:00.000Z');
    const spendCap = dbModule.getReflectionSpendCap(now);
    assert.equal(spendCap.lunaOnly, true);
    assert.equal(spendCap.capUsd, 0.5);
    assert.equal(spendCap.dayKey, '2026-09-10');
    assert.equal(spendCap.resetsAt, '2026-09-11T00:00:00.000Z');
    assert.ok(Math.abs(spendCap.spentUsd - 0.6) < 1e-9);
    assert.equal(dbModule.getReflectionSpendCap(new Date('2026-09-11T00:00:00.000Z')).lunaOnly, false);
    assert.equal(dbModule.getReflectionSpendCap(new Date('2026-09-11T00:00:00.000Z')).spentUsd, 0);
  });

  test('lists a durable in-flight provider hand-off until its terminal run is recorded', () => {
    materializationInput('in-flight-session', suppressOperation('target'));
    dbModule.startReflectionGenerationRun({
      runId: 'in-flight-run',
      sourceSessionId: 'in-flight-session',
      reflectionFlowVersion: 'initial_post_session_reflection.v2',
      startedAt: generatedAt,
      provider: 'openai',
      model: 'gpt-5.6-terra-high',
      providerModel: 'gpt-5.6-terra',
      promptVersion: 'reflection-v9',
      clientRequestId: 'provider-request-1',
      eligibleItemCount: 3,
      includedItemCount: 2,
      evidenceBundle: bundle('in-flight-session'),
    });

    assert.deepEqual(dbModule.listReflectionGenerationRuns(), [
      {
        runId: 'in-flight-run',
        sourceSessionId: 'in-flight-session',
        reflectionFlowVersion: 'initial_post_session_reflection.v2',
        startedAt: generatedAt,
        completedAt: null,
        provider: 'openai',
        model: 'gpt-5.6-terra-high',
        providerModel: 'gpt-5.6-terra',
        promptVersion: 'reflection-v9',
        responseId: null,
        clientRequestId: 'provider-request-1',
        finishReason: null,
        bundleSchemaVersion: 'session_reflection_bundle.v1',
        resultSchemaVersion: 'session_reflection_result.v7',
        diagnostic: null,
        state: 'in_flight',
        failureCode: null,
        eligibleItemCount: 3,
        includedItemCount: 2,
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
        retryable: false,
      },
    ]);
  });

  test('prioritizes in-flight provider hand-offs over concluded history within the requested limit', () => {
    dbModule.recordReflectionGenerationRun({
      runId: 'concluded-history',
      sourceSessionId: null,
      reflectionFlowVersion: 'initial_post_session_reflection.v1',
      startedAt: generatedAt,
      completedAt: updatedAt,
      provider: 'openai',
      model: 'gpt-5.6-luna-high',
      providerModel: 'gpt-5.6-luna',
      promptVersion: 'reflection-v2',
      responseId: 'response-history',
      finishReason: 'stop',
      state: 'succeeded',
      failureCode: null,
      eligibleItemCount: 1,
      includedItemCount: 1,
      usage: {
        inputTokens: 10,
        cachedInputTokens: 0,
        cacheWriteInputTokens: null,
        outputTokens: 5,
        reasoningTokens: null,
        totalTokens: 15,
      },
      pricingSnapshotId: null,
      pricingAsOf: null,
      pricingBasis: null,
      estimatedCostUsd: null,
      evidenceBundle: bundle('concluded-history'),
    });
    dbModule.startReflectionGenerationRun({
      runId: 'active-hand-off',
      sourceSessionId: null,
      reflectionFlowVersion: 'initial_post_session_reflection.v2',
      startedAt: updatedAt,
      provider: 'openai',
      model: 'gpt-5.6-terra-high',
      providerModel: 'gpt-5.6-terra',
      promptVersion: 'reflection-v9',
      clientRequestId: 'provider-request-active',
      eligibleItemCount: 1,
      includedItemCount: 1,
      evidenceBundle: bundle('active-hand-off'),
    });

    assert.deepEqual(
      dbModule.listReflectionGenerationRuns(1).map((run) => run.runId),
      ['active-hand-off'],
    );
  });

  test('keeps legacy failed-run evidence readable but never retryable', () => {
    materializationInput('retry-session', suppressOperation('target'));
    const evidenceBundle = bundle('retry-session');
    const failed = dbModule.recordReflectionGenerationRun({
      runId: 'failed-run',
      sourceSessionId: 'retry-session',
      reflectionFlowVersion: 'initial_post_session_reflection.v1',
      startedAt: generatedAt,
      completedAt: updatedAt,
      provider: 'openai',
      model: 'gpt-5.6-luna-high',
      providerModel: 'gpt-5.6-luna',
      promptVersion: 'reflection-v2',
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
      evidenceBundle,
    });
    assert.equal(failed.retryable, false);
    assert.equal(dbModule.getReflectionGenerationContinuationRetrySource('failed-run'), null);

    dbModule.materializeReflectionArtifact(
      materializationInput('retry-session', suppressOperation('target')),
    );
    assert.equal(dbModule.listReflectionGenerationRuns()[0]?.retryable, false);
  });

  test('retains sessionless remediation artifacts and exact-bundle retry provenance', () => {
    const input = materializationInputV2('synthetic-remediation-session');
    input.sourceSessionId = null;
    sqlite.prepare('DELETE FROM study_sessions WHERE id = ?').run('synthetic-remediation-session');

    const materialized = dbModule.materializeReflectionArtifact(input);
    assert.equal(materialized.artifact.sourceSessionId, null);
    assert.equal(
      dbModule.getReflectionArtifactDetail(materialized.artifact.artifactId).sourceSessionId,
      null,
    );

    dbModule.recordReflectionGenerationRun({
      runId: 'sessionless-failed-run',
      sourceSessionId: null,
      reflectionFlowVersion: 'initial_post_session_reflection.v1',
      startedAt: generatedAt,
      completedAt: updatedAt,
      provider: 'openai',
      model: 'gpt-5.6-luna-high',
      providerModel: 'gpt-5.6-luna',
      promptVersion: 'reflection-v9',
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
      evidenceBundle: input.evidenceBundle,
    });
    assert.equal(
      dbModule.getReflectionGenerationContinuationRetrySource('sessionless-failed-run'),
      null,
    );
  });

  test('atomically materializes immutable JSON and exactly one pending row per proposal', () => {
    const input = materializationInput('session-one', suppressOperation('target'));
    input.result.itemResults.push(informationalResult('info'));
    input.evidenceBundle.items.push({
      ...structuredClone(input.evidenceBundle.items[0]!),
      itemId: 'info',
      sourceAttemptId: 'attempt-info',
      sessionActionId: 'action-info',
    });

    const materialized = dbModule.materializeReflectionArtifact(input);
    assert.equal(materialized.created, true);
    assert.equal(materialized.artifact.proposals.length, 1);
    assert.deepEqual(materialized.artifact.proposals[0].review.disposition, { kind: 'pending' });
    assert.equal(materialized.artifact.result.itemResults[1].proposals.length, 0);

    const artifactRow = sqlite.prepare(`
      SELECT evidence_bundle_json, result_json
      FROM reflection_artifacts
      WHERE artifact_id = ?
    `).get(materialized.artifact.artifactId) as {
      evidence_bundle_json: string;
      result_json: string;
    };
    assert.deepEqual(JSON.parse(artifactRow.evidence_bundle_json), input.evidenceBundle);
    assert.deepEqual(JSON.parse(artifactRow.result_json), input.result);
    assert.throws(
      () => sqlite.prepare(`
        UPDATE reflection_artifacts
        SET prompt_version = 'mutated'
        WHERE artifact_id = ?
      `).run(materialized.artifact.artifactId),
      /reflection artifacts are immutable/,
    );
  });

  test('round-trips V2 evidence with a canonical V5 cue repair', () => {
    const input = materializationInputV2('v2-round-trip-session');
    const materialized = dbModule.materializeReflectionArtifact(input);

    assert.equal(materialized.created, true);
    assert.deepEqual(materialized.artifact.evidenceBundle, input.evidenceBundle);
    assert.deepEqual(materialized.artifact.result, input.result);
    assert.equal(materialized.artifact.bundleSchemaVersion, 'session_reflection_bundle.v2');
    assert.equal(materialized.artifact.resultSchemaVersion, 'session_reflection_result.v5');
  });

  test('round-trips V2 evidence with the streamlined V6 item result', () => {
    const input = materializationInputV6('v6-round-trip-session');
    const materialized = dbModule.materializeReflectionArtifact(input);

    assert.equal(materialized.created, true);
    assert.deepEqual(materialized.artifact.evidenceBundle, input.evidenceBundle);
    assert.deepEqual(materialized.artifact.result, input.result);
    assert.equal(materialized.artifact.bundleSchemaVersion, 'session_reflection_bundle.v2');
    assert.equal(materialized.artifact.resultSchemaVersion, 'session_reflection_result.v6');
  });

  test('pairs V5 evidence only with V8 and authorizes only its exact promotion references', () => {
    const input = materializationInputV8('v8-round-trip-session');
    const materialized = dbModule.materializeReflectionArtifact(input);
    assert.equal(materialized.artifact.bundleSchemaVersion, 'session_reflection_bundle.v5');
    assert.equal(materialized.artifact.resultSchemaVersion, 'session_reflection_result.v8');
    const proposal = materialized.artifact.proposals[0]!;
    const operation = proposal.proposal.operation;
    assert.equal(operation.kind, 'promote_pure_elicitation');
    if (operation.kind !== 'promote_pure_elicitation') return;

    assert.throws(() => dbModule.acceptReflectionProposal({
      proposalId: proposal.review.proposalId,
      invocationId: 'v8-hidden-reference',
      createdAt: updatedAt,
      operation: {
        ...operation,
        destination: { kind: 'existing', pureCueId: 'not-in-evidence' },
      },
    }), /enriched intersecting pure cue/);

    const accepted = dbModule.acceptReflectionProposal({
      proposalId: proposal.review.proposalId,
      invocationId: 'v8-exact-promotion',
      createdAt: updatedAt,
      operation,
    });
    assert.equal(accepted.invocation.application.state.kind, 'pending');
  });

  test('V8 authorization keeps revised, replacement, and manual word cues owner-only', () => {
    for (const mode of ['revised', 'replacement', 'manual'] as const) {
      const input = materializationInputV8(`v8-owner-only-${mode}`);
      assert.equal(input.result.schemaVersion, 'session_reflection_result.v8');
      if (input.result.schemaVersion !== 'session_reflection_result.v8') continue;
      const repair: ReflectionOperation = {
        kind: 'repair_production_cue', version: 2,
        wordId: 'target', taskId: 'production-task:target:default_production',
        changes: [{ kind: 'create', cue: {
          cueType: 'minimal_context', text: 'A distinctive context', acceptedWordIds: ['target'],
        } }],
        sourceAttemptJudgments: [],
      };
      if (mode === 'revised') input.result.itemResults[0]!.proposals[0]!.operation = repair;
      if (mode === 'manual') input.result.itemResults[0]!.proposals = [];
      if (mode !== 'replacement') {
        // These exercise ordinary V8 items, not a stage-two outcome.
        input.evidenceBundle.items[0]!.promotionEvidence = null;
        delete input.result.itemResults[0]!.promotionOutcome;
      }
      const { artifact } = dbModule.materializeReflectionArtifact(input);
      const invalid = structuredClone(repair);
      assert.equal(invalid.kind, 'repair_production_cue');
      if (invalid.kind !== 'repair_production_cue' || invalid.version !== 2) continue;
      const change = invalid.changes[0]!;
      if (change.kind !== 'create') throw new Error('Expected created cue');
      change.cue.acceptedWordIds.push('alternate');
      const identity = { invocationId: `invalid-owner-${mode}`, createdAt: updatedAt, operation: invalid };
      assert.throws(() => {
        if (mode === 'manual') {
          dbModule.authorizeManualReflectionOperation({
            ...identity, artifactId: artifact.artifactId, itemId: artifact.result.itemResults[0]!.itemId,
          });
        } else {
          const request = { ...identity, proposalId: artifact.proposals[0]!.review.proposalId };
          if (mode === 'replacement') dbModule.replaceReflectionProposal(request);
          else dbModule.acceptReflectionProposal(request);
        }
      }, /must accept exactly their owner/);
      assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM reflection_operation_invocations WHERE invocation_id = ?')
        .get(identity.invocationId)?.count, 0);
    }
  });

  test('reloads legacy V1 contrast artifacts and applied invocations under their frozen contract', () => {
    const operation: ReflectionOperation = {
      kind: 'create_contrast_cluster',
      version: 1,
      title: '目标 / 替代',
      clusterNote: null,
      members: [
        { wordId: 'target', nuanceNote: null },
        { wordId: 'alternate', nuanceNote: null },
      ],
      prompts: [{
        targetWordId: 'target',
        promptText: 'Choose the intended word.',
        explanation: null,
      }],
    };
    const artifact = dbModule.materializeReflectionArtifact(
      legacyMaterializationInput('legacy-contrast-session', operation),
    ).artifact;
    const proposalId = artifact.proposals[0]!.review.proposalId;
    sqlite.prepare(`
      INSERT INTO reflection_operation_invocations (
        invocation_id, created_at, origin_kind, origin_proposal_id,
        origin_superseded_proposal_id, operation_kind, operation_version,
        operation_json, application_state, application_updated_at,
        unsupported_reason, applied_at, application_error, stale_reason,
        effect_refs_json, satisfying_effect_refs_json
      ) VALUES (
        'legacy-contrast-invocation', ?, 'proposal_acceptance', ?, NULL, ?, ?, ?,
        'applied', ?, NULL, ?, NULL, NULL, ?, '[]'
      )
    `).run(
      updatedAt,
      proposalId,
      operation.kind,
      operation.version,
      JSON.stringify(operation),
      appliedAt,
      appliedAt,
      JSON.stringify([{ type: 'contrast_cluster', id: 'legacy-cluster' }]),
    );
    sqlite.prepare(`
      UPDATE reflection_proposal_reviews
      SET disposition = 'accepted', updated_at = ?, acceptance_mode = 'exact',
          accepted_invocation_id = 'legacy-contrast-invocation'
      WHERE proposal_id = ?
    `).run(appliedAt, proposalId);

    assert.equal(dbModule.listReflectionArtifacts('all')[0]?.readState, 'available');
    assert.equal(
      dbModule.getReflectionArtifactDetail(artifact.artifactId)
        .proposals[0]?.invocation?.invocation.operation.version,
      1,
    );
  });

  test('leaves pending legacy manual invocations readable but outside recovery and application', () => {
    const operation = suppressOperation('target');
    sqlite.prepare(`
      INSERT INTO reflection_operation_invocations (
        invocation_id, created_at, origin_kind, origin_proposal_id,
        origin_superseded_proposal_id, operation_kind, operation_version,
        operation_json, application_state, application_updated_at,
        unsupported_reason, applied_at, application_error, stale_reason,
        effect_refs_json, satisfying_effect_refs_json
      ) VALUES (
        'legacy-manual-pending', ?, 'manual', NULL, NULL, ?, ?, ?,
        'pending', ?, NULL, NULL, NULL, NULL, '[]', '[]'
      )
    `).run(
      updatedAt,
      operation.kind,
      operation.version,
      JSON.stringify(operation),
      updatedAt,
    );

    assert.equal(
      dbModule.getReflectionInvocation('legacy-manual-pending').application.state.kind,
      'pending',
    );
    assert.deepEqual(dbModule.listPendingReflectionInvocationIds(), []);
    assert.throws(
      () => dbModule.applyReflectionInvocation('legacy-manual-pending', appliedAt),
      /older contract and is read-only/,
    );
    assert.equal(
      dbModule.getReflectionInvocation('legacy-manual-pending').application.state.kind,
      'pending',
    );
  });

  test('rejects mismatched bundle and result generations', () => {
    const v1 = legacyMaterializationInput('mismatch-v1-session', suppressOperation('target'));
    const v2 = materializationInputV2('mismatch-v2-session');
    assert.throws(
      () => dbModule.materializeReflectionArtifact({
        ...v1,
        result: v2.result,
      } as Parameters<DbModule['materializeReflectionArtifact']>[0]),
      /is not compatible with session_reflection_bundle.v1/,
    );
    assert.throws(
      () => dbModule.materializeReflectionArtifact({
        ...v2,
        result: v1.result,
      } as Parameters<DbModule['materializeReflectionArtifact']>[0]),
      /is not compatible with session_reflection_bundle.v2/,
    );
  });

  test('keeps legacy V2 cue repairs readable but rejects exact and revised authorization', () => {
    const exactArtifact = dbModule.materializeReflectionArtifact(
      materializationInputV2('v2-exact-session'),
    ).artifact;
    const exactOperation = exactArtifact.proposals[0]!.proposal.operation;
    assert.throws(() => dbModule.acceptReflectionProposal({
      proposalId: exactArtifact.proposals[0]!.review.proposalId,
      operation: exactOperation,
      invocationId: 'v2-exact-invocation',
      createdAt: updatedAt,
    }), /older contract and is read-only/);

    const revisedArtifact = dbModule.materializeReflectionArtifact(
      materializationInputV2('v2-revised-session'),
    ).artifact;
    const revisedOperation = structuredClone(revisedArtifact.proposals[0]!.proposal.operation);
    assert.equal(revisedOperation.kind, 'repair_production_cue');
    if (revisedOperation.kind === 'repair_production_cue' && revisedOperation.version === 2) {
      const create = revisedOperation.changes[0];
      assert.equal(create?.kind, 'create');
      if (create?.kind === 'create') create.cue.text = 'A learner-edited bounded context';
    }
    assert.throws(() => dbModule.acceptReflectionProposal({
      proposalId: revisedArtifact.proposals[0]!.review.proposalId,
      operation: revisedOperation,
      invocationId: 'v2-revised-invocation',
      createdAt: updatedAt,
    }), /older contract and is read-only/);
    assert.equal(exactArtifact.proposals[0]!.review.disposition.kind, 'pending');
    assert.equal(revisedArtifact.proposals[0]!.review.disposition.kind, 'pending');
  });

  test('materializes separate candidates for the same session and flow', () => {
    const first = dbModule.materializeReflectionArtifact(
      materializationInput('idempotent-session', suppressOperation('target')),
    );
    const secondInput = materializationInput(
      'idempotent-session',
      suppressOperation('alternate'),
    );
    secondInput.artifactId = 'must-not-be-inserted';
    const second = dbModule.materializeReflectionArtifact(secondInput);

    assert.equal(second.created, true);
    assert.notEqual(second.artifact.artifactId, first.artifact.artifactId);
    assert.deepEqual(
      second.artifact.proposals[0].proposal.operation,
      suppressOperation('alternate'),
    );
    const count = sqlite.prepare(`
      SELECT COUNT(*) AS count
      FROM reflection_artifacts
    `).get() as { count: number };
    assert.equal(count.count, 2);
  });

  test('rolls back materialization when the source session provenance is missing', () => {
    const input = materializationInput('missing-source-session', suppressOperation('target'));
    sqlite.prepare('DELETE FROM study_sessions WHERE id = ?').run('missing-source-session');

    assert.throws(
      () => dbModule.materializeReflectionArtifact(input),
      /cross-learner private reference/,
    );
    const counts = sqlite.prepare(`
      SELECT
        (SELECT COUNT(*) FROM reflection_artifacts) AS artifact_count,
        (SELECT COUNT(*) FROM reflection_proposal_reviews) AS review_count
    `).get() as { artifact_count: number; review_count: number };
    assert.equal(counts.artifact_count, 0);
    assert.equal(counts.review_count, 0);
  });

  test('permits an artifact to name its run before optional run logging writes it', () => {
    const input = materializationInput('forward-run-session', suppressOperation('target'));
    input.sourceRunId = 'run-recorded-after-artifact';

    const materialized = dbModule.materializeReflectionArtifact(input);

    assert.equal(materialized.created, true);
    assert.equal(materialized.artifact.sourceRunId, 'run-recorded-after-artifact');
  });

  test('keeps open proposal queue semantics separate from recent informational history', () => {
    const openArtifact = dbModule.materializeReflectionArtifact(
      materializationInput('open-session', suppressOperation('target')),
    ).artifact;
    const deferred = dbModule.deferReflectionProposal(
      openArtifact.proposals[0].review.proposalId,
      updatedAt,
    );
    assert.deepEqual(deferred.disposition, { kind: 'deferred' });

    const informationalInput = materializationInput(
      'information-session',
      suppressOperation('target'),
    );
    informationalInput.result.itemResults[0] = informationalResult('item');
    dbModule.materializeReflectionArtifact(informationalInput);

    assert.deepEqual(
      dbModule.listReflectionArtifacts('open').map((artifact) => artifact.sourceSessionId),
      ['open-session'],
    );
    assert.deepEqual(
      new Set(dbModule.listReflectionArtifacts('all').map((artifact) => artifact.sourceSessionId)),
      new Set(['open-session', 'information-session']),
    );

    const dismissed = dbModule.dismissReflectionProposal(
      deferred.proposalId,
      'Not useful for this learner.',
      appliedAt,
    );
    assert.deepEqual(dismissed.disposition, {
      kind: 'dismissed',
      reason: 'Not useful for this learner.',
    });
    assert.deepEqual(dbModule.listReflectionArtifacts('open'), []);
    const reopened = dbModule.reopenReflectionProposal(deferred.proposalId, appliedAt);
    assert.deepEqual(reopened.disposition, { kind: 'pending' });
    assert.deepEqual(
      dbModule.listReflectionArtifacts('open').map((artifact) => artifact.sourceSessionId),
      ['open-session'],
    );
    const dismissedAgain = dbModule.dismissReflectionProposal(
      deferred.proposalId,
      'Not useful for this learner.',
      appliedAt,
    );
    assert.deepEqual(dismissedAgain.disposition, {
      kind: 'dismissed',
      reason: 'Not useful for this learner.',
    });
    assert.throws(
      () => dbModule.deferReflectionProposal(deferred.proposalId),
      /Invalid proposal review transition: dismissed -> deferred/,
    );
  });

  test('disagreement feedback is durable but cannot authorize manual changes', () => {
    const input = materializationInputV8('disagreement-session');
    assert.equal(input.result.schemaVersion, 'session_reflection_result.v8');
    const result: SessionReflectionResultV8 = {
      schemaVersion: 'session_reflection_result.v8',
      itemResults: [{
        itemId: 'item',
        diagnosisTags: ['production_cue_overloaded'],
        learnerExplanation: 'The content review disagrees: this response does not satisfy the original cue.',
        promotionOutcome: 'disagreement',
        proposals: [],
        questions: [],
      }],
    };
    if (input.evidenceBundle.schemaVersion !== 'session_reflection_bundle.v5') throw new Error('Expected enriched evidence');
    const artifact = dbModule.materializeReflectionArtifact({ ...input, evidenceBundle: input.evidenceBundle, result }).artifact;
    assert.equal(artifact.proposals.length, 0);
    assert.equal(artifact.helpInbox.length, 1);
    assert.throws(() => dbModule.authorizeManualReflectionOperation({
      artifactId: artifact.artifactId,
      itemId: 'item',
      operation: suppressOperation('target'),
      createdAt: updatedAt,
    }), /Stage disagreement is non-actionable/);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM reflection_operation_invocations').get()?.count, 0);
    assert.equal(dbModule.getWordSkillRelevance('target', 'production'), null);
  });

  test('checkpoints the explicit handoff and exposes the actual in-flight stage contract', () => {
    const input = materializationInputV8('handoff-checkpoint');
    if (input.evidenceBundle.schemaVersion !== 'session_reflection_bundle.v5') throw new Error('Expected enriched evidence');
    const diagnosisBundle = {
      ...input.evidenceBundle,
      schemaVersion: 'session_reflection_bundle.v4' as const,
      items: input.evidenceBundle.items.map(({ promotionEvidence: _promotionEvidence, ...item }) => item),
    };
    const continuation = dbModule.createReflectionGenerationContinuation({
      sourceSessionId: 'handoff-checkpoint',
      reflectionFlowVersion: dbModule.STAGED_INITIAL_REFLECTION_FLOW_VERSION,
      createdAt: generatedAt, eligibleItemCount: 1, includedItemCount: 1, diagnosisBundle,
    });
    const handoff = {
      axis: 'Expressing the shared instinct.',
      boundaries: 'Only in this bounded situation, not every sense.',
      responseValidity: 'The learner response naturally satisfies the exact original cue.',
    };
    const prepared = dbModule.prepareReflectionGenerationPromotion({
      continuationId: continuation.continuationId,
      preparedAt: updatedAt,
      diagnosisResult: {
        schemaVersion: 'staged_reflection_diagnosis_result.v1',
        itemResults: [{ kind: 'shared_axis', itemId: 'item', diagnosisTags: [], handoff }],
      },
    });
    assert.deepEqual(prepared.promotionBundle?.items[0]?.handoff, handoff);
    assert.equal('learnerExplanation' in prepared.promotionBundle!.items[0]!, false);
    assert.deepEqual(dbModule.getReflectionGenerationContinuation(continuation.continuationId), prepared);
    for (const stage of ['diagnosis', 'promotion'] as const) {
      const runId = `in-flight-${stage}`;
      dbModule.linkReflectionGenerationContinuationRun({ continuationId: continuation.continuationId, runId, stage, createdAt: updatedAt });
      dbModule.startReflectionGenerationRun({
        runId, sourceSessionId: 'handoff-checkpoint', reflectionFlowVersion: dbModule.STAGED_INITIAL_REFLECTION_FLOW_VERSION,
        startedAt: updatedAt, provider: 'openai', model: 'gpt-5.6-luna-high', providerModel: 'gpt-5.6-luna',
        promptVersion: stage === 'diagnosis' ? 'reflection-staged-v2' : 'pure-cue-promotion-v1',
        clientRequestId: `request-${stage}`,
        eligibleItemCount: stage === 'promotion' ? 19 : 1,
        includedItemCount: stage === 'promotion' ? 19 : 1,
        evidenceBundle: stage === 'diagnosis' ? diagnosisBundle : prepared.promotionBundle!,
      });
    }
    const runs = dbModule.listReflectionGenerationRuns();
    assert.equal(runs.find((run) => run.runId === 'in-flight-diagnosis')?.resultSchemaVersion, 'staged_reflection_diagnosis_result.v1');
    assert.equal(runs.find((run) => run.runId === 'in-flight-diagnosis')?.eligibleItemCount, 1);
    const inFlightPromotion = runs.find((run) => run.runId === 'in-flight-promotion');
    assert.equal(inFlightPromotion?.resultSchemaVersion, 'pure_cue_promotion_result.v1');
    assert.equal(inFlightPromotion?.bundleSchemaVersion, 'pure_cue_promotion_bundle.v1');
    assert.equal(inFlightPromotion?.eligibleItemCount, prepared.promotionBundle?.items.length);
    assert.equal(inFlightPromotion?.includedItemCount, prepared.promotionBundle?.items.length);
    const concluded = dbModule.recordReflectionGenerationRun({
      runId: 'concluded-promotion',
      sourceSessionId: 'handoff-checkpoint',
      reflectionFlowVersion: dbModule.STAGED_INITIAL_REFLECTION_FLOW_VERSION,
      startedAt: updatedAt,
      completedAt: updatedAt,
      provider: 'openai',
      model: 'gpt-5.6-luna-high',
      providerModel: 'gpt-5.6-luna',
      promptVersion: 'pure-cue-promotion-v1',
      responseId: null,
      clientRequestId: 'request-concluded-promotion',
      finishReason: 'stop',
      resultSchemaVersion: 'pure_cue_promotion_result.v1',
      state: 'succeeded',
      failureCode: null,
      eligibleItemCount: 19,
      includedItemCount: 19,
      usage: {
        inputTokens: 1,
        cachedInputTokens: null,
        cacheWriteInputTokens: null,
        outputTokens: 1,
        reasoningTokens: null,
        totalTokens: 2,
      },
      pricingSnapshotId: null,
      pricingAsOf: null,
      pricingBasis: null,
      estimatedCostUsd: null,
      evidenceBundle: prepared.promotionBundle!,
    });
    assert.equal(concluded.eligibleItemCount, prepared.promotionBundle?.items.length);
    assert.equal(concluded.includedItemCount, prepared.promotionBundle?.items.length);
  });

  test('overlapping second-opinion evidence is omitted without retiring omitted proposals', () => {
    const originals = ['overlap-a', 'overlap-b'].map((sessionId) => {
      const artifact = dbModule.materializeReflectionArtifact(materializationInput(sessionId, suppressOperation('target'))).artifact;
      const proposalId = artifact.proposals[0]!.review.proposalId;
      dbModule.deferReflectionProposal(proposalId, updatedAt);
      return { artifactId: artifact.artifactId, proposalId };
    });
    const selected = originals.map((entry) => entry.proposalId);
    const first = dbModule.buildStagedDeferredSecondOpinionBundle(selected, appliedAt);
    const reversed = dbModule.buildStagedDeferredSecondOpinionBundle([...selected].reverse(), appliedAt);
    assert.equal(first.bundle.items.length, 1);
    assert.equal(first.eligibleItemCount, 2);
    assert.equal(first.overlapOmittedItemCount, 1);
    assert.deepEqual(first.sourceProposalIds, reversed.sourceProposalIds);
    const continuation = dbModule.createReflectionGenerationContinuation({
      sourceSessionId: null,
      reflectionFlowVersion: dbModule.STAGED_DEFERRED_SECOND_OPINION_FLOW_VERSION,
      createdAt: appliedAt,
      eligibleItemCount: first.eligibleItemCount,
      includedItemCount: first.bundle.items.length,
      overlapOmittedItemCount: first.overlapOmittedItemCount,
      diagnosisBundle: first.bundle,
      sourceProposalIds: first.sourceProposalIds,
    });
    assert.equal(dbModule.getReflectionGenerationContinuation(continuation.continuationId).overlapOmittedItemCount, 1);
    dbModule.materializeReflectionArtifact({
      sourceSessionId: null,
      reflectionFlowVersion: dbModule.STAGED_DEFERRED_SECOND_OPINION_FLOW_VERSION,
      generatedAt: appliedAt,
      provider: 'openai', model: 'gpt-5.6-luna-high', promptVersion: 'reflection-staged-v2',
      sourceProposalIds: first.sourceProposalIds,
      evidenceBundle: {
        ...first.bundle, schemaVersion: 'curated_reflection_bundle.v2',
        items: first.bundle.items.map((item) => ({ ...item, promotionEvidence: null })),
      },
      result: {
        schemaVersion: 'session_reflection_result.v8',
        itemResults: first.bundle.items.map((item) => ({
          itemId: item.itemId, diagnosisTags: [], learnerExplanation: 'Keep practicing.', proposals: [], questions: [],
        })),
      },
    });
    for (const source of originals) {
      const state = dbModule.getReflectionArtifactDetail(source.artifactId).proposals[0]!.review.disposition.kind;
      assert.equal(state, first.sourceProposalIds.includes(source.proposalId) ? 'requested_second_opinion' : 'deferred');
    }
  });

  test('creates a sessionless curated bundle and retires only its selected deferred original on success', () => {
    const source = dbModule.materializeReflectionArtifact(
      materializationInput('second-opinion-source', suppressOperation('target')),
    );
    const originalProposalId = source.artifact.proposals[0]!.review.proposalId;
    dbModule.deferReflectionProposal(originalProposalId, updatedAt);

    const { bundle, sourceProposalIds } = dbModule.buildStagedDeferredSecondOpinionBundle(
      [originalProposalId],
      appliedAt,
    );
    assert.equal(bundle.schemaVersion, 'curated_reflection_diagnosis_bundle.v2');
    assert.equal(bundle.items.length, 1);
    assert.notEqual(bundle.items[0]!.itemId, 'item');
    assert.equal('session' in bundle, false);
    assert.equal('source' in bundle, false);
    assert.deepEqual(sourceProposalIds, [originalProposalId]);

    const replacement = dbModule.materializeReflectionArtifact({
      sourceSessionId: null,
      reflectionFlowVersion: dbModule.STAGED_DEFERRED_SECOND_OPINION_FLOW_VERSION,
      generatedAt: appliedAt,
      provider: 'openai',
      model: 'gpt-5.6-luna-high',
      promptVersion: 'reflection-staged-v2',
      evidenceBundle: {
        ...bundle,
        schemaVersion: 'curated_reflection_bundle.v2',
        items: bundle.items.map((item) => ({ ...item, promotionEvidence: null })),
      },
      sourceProposalIds,
      result: {
        schemaVersion: 'session_reflection_result.v8',
        itemResults: [{
          itemId: bundle.items[0]!.itemId,
          diagnosisTags: ['ordinary_retrieval_noise'],
          learnerExplanation: 'No additional intervention is needed.',
          proposals: [],
          questions: [],
        }],
      },
    });

    assert.equal(replacement.artifact.sourceSessionId, null);
    assert.deepEqual(
      dbModule.getReflectionArtifactDetail(source.artifact.artifactId).proposals[0]?.review.disposition,
      { kind: 'requested_second_opinion' },
    );
    assert.equal(
      dbModule.getReflectionQualityStats().arms.reduce((count, arm) => count + arm.dismissCount, 0),
      0,
    );
    assert.equal(
      dbModule.getReflectionQualityStats().arms.reduce((count, arm) => count + arm.terminalReviewCount, 0),
      1,
    );
    assert.throws(
      () => dbModule.reopenReflectionProposal(originalProposalId),
      /Invalid proposal review transition: requested_second_opinion -> pending/,
    );
  });

  test('builds one curated bundle when session-local action ids repeat across source sessions', () => {
    insertWord('other-target', '其他');
    insertWord('other-response', '另外');
    const firstInput = materializationInput(
      'second-opinion-cross-session-a',
      suppressOperation('target'),
    );
    firstInput.evidenceBundle.items[0]!.sourceAttemptId = 'attempt-cross-session-a';
    const first = dbModule.materializeReflectionArtifact(firstInput);
    const firstProposalId = first.artifact.proposals[0]!.review.proposalId;
    dbModule.deferReflectionProposal(firstProposalId, updatedAt);

    const secondInput = materializationInput(
      'second-opinion-cross-session-b',
      suppressOperation('other-target'),
    );
    if (secondInput.evidenceBundle.schemaVersion !== 'session_reflection_bundle.v5') throw new Error('Expected V5 evidence');
    const secondItem = secondInput.evidenceBundle.items[0]!;
    secondItem.targetWord = { ...secondItem.targetWord, wordId: 'other-target' };
    secondItem.submittedWord = { ...secondItem.submittedWord!, wordId: 'other-response' };
    secondItem.servedCue.acceptedWordIds = ['other-target'];
    secondInput.evidenceBundle.items[0]!.sourceAttemptId = 'attempt-cross-session-b';
    const second = dbModule.materializeReflectionArtifact(secondInput);
    const secondProposalId = second.artifact.proposals[0]!.review.proposalId;
    dbModule.deferReflectionProposal(secondProposalId, updatedAt);

    const { bundle } = dbModule.buildStagedDeferredSecondOpinionBundle(
      [firstProposalId, secondProposalId],
      appliedAt,
    );

    assert.equal(bundle.items.length, 2);
    assert.equal(bundle.items[0]!.sessionActionId, bundle.items[1]!.sessionActionId);
    assert.notEqual(bundle.items[0]!.itemId, bundle.items[1]!.itemId);
  });

  test('authorizes exact and revised supported operations as immutable pending invocations', () => {
    const exactArtifact = dbModule.materializeReflectionArtifact(
      materializationInput('exact-session', suppressOperation('target')),
    ).artifact;
    const exact = dbModule.acceptReflectionProposal({
      proposalId: exactArtifact.proposals[0].review.proposalId,
      operation: suppressOperation('target'),
      invocationId: 'exact-invocation',
      createdAt: updatedAt,
    });
    assert.deepEqual(exact.review.disposition, {
      kind: 'accepted',
      acceptanceMode: 'exact',
      acceptedInvocationId: 'exact-invocation',
    });
    assert.deepEqual(exact.invocation.application.state, { kind: 'pending' });

    const revisedArtifact = dbModule.materializeReflectionArtifact(
      materializationInput('revised-session', suppressOperation('target')),
    ).artifact;
    const revised = dbModule.acceptReflectionProposal({
      proposalId: revisedArtifact.proposals[0].review.proposalId,
      operation: suppressOperation('alternate'),
      invocationId: 'revised-invocation',
      createdAt: updatedAt,
    });
    assert.equal(revised.review.disposition.kind, 'accepted');
    assert.equal(
      revised.review.disposition.kind === 'accepted'
        ? revised.review.disposition.acceptanceMode
        : null,
      'revised',
    );
    assert.deepEqual(revised.invocation.invocation.operation, suppressOperation('alternate'));

    assert.throws(
      () => sqlite.prepare(`
        UPDATE reflection_operation_invocations
        SET operation_json = ?
        WHERE invocation_id = 'exact-invocation'
      `).run(JSON.stringify(suppressOperation('alternate'))),
      /reflection invocation authorization is immutable/,
    );
  });

  test('supersedes a proposal when the user authorizes a different handle', () => {
    const artifact = dbModule.materializeReflectionArtifact(
      materializationInput('replacement-session', suppressOperation('target')),
    ).artifact;
    const replacement: ReflectionOperation = {
      kind: 'repair_production_cue',
      version: 1,
      wordId: 'target',
      repairIntent: 'add_distinguishing_anchor',
      proposedCues: [{ cueType: 'minimal_context', text: 'Use a distinguishing context.' }],
    };

    const replaced = dbModule.replaceReflectionProposal({
      proposalId: artifact.proposals[0]!.review.proposalId,
      operation: replacement,
      invocationId: 'replacement-invocation',
      createdAt: updatedAt,
    });

    assert.deepEqual(replaced.review.disposition, {
      kind: 'superseded',
      supersession: {
        source: 'user_replacement',
        actor: 'user',
        reason: 'The user authorized a different operation during proposal review.',
        replacementProposalId: null,
        replacementInvocationId: 'replacement-invocation',
        satisfyingEffectRefs: [],
      },
    });
    assert.deepEqual(replaced.invocation.invocation.origin, {
      kind: 'user_replacement',
      supersededProposalId: artifact.proposals[0]!.review.proposalId,
    });
    assert.equal(replaced.invocation.application.state.kind, 'unsupported');
    assert.deepEqual(
      dbModule.getReflectionArtifactDetail(artifact.artifactId).proposals[0]?.invocation,
      replaced.invocation,
    );
    assert.throws(
      () => dbModule.replaceReflectionProposal({
        proposalId: artifact.proposals[0]!.review.proposalId,
        operation: replacement,
      }),
      /Invalid proposal review transition: superseded -> superseded/,
    );
  });

  test('persists application outcomes and rejects non-lifecycle transitions', () => {
    const artifact = dbModule.materializeReflectionArtifact(
      materializationInput('application-session', suppressOperation('target')),
    ).artifact;
    const accepted = dbModule.acceptReflectionProposal({
      proposalId: artifact.proposals[0].review.proposalId,
      operation: suppressOperation('target'),
      invocationId: 'application-invocation',
      createdAt: updatedAt,
    });

    const applied = dbModule.transitionReflectionInvocationApplication(
      accepted.invocation.invocation.invocationId,
      {
        kind: 'applied',
        appliedAt,
        effectRefs: [{ type: 'word_skill_relevance', id: 'target:production' }],
      },
      appliedAt,
    );
    assert.deepEqual(applied.application.state, {
      kind: 'applied',
      appliedAt,
      effectRefs: [{ type: 'word_skill_relevance', id: 'target:production' }],
    });
    assert.deepEqual(
      dbModule.getReflectionArtifactDetail(artifact.artifactId)
        .proposals[0].invocation?.application.state,
      applied.application.state,
    );
    assert.throws(
      () => dbModule.transitionReflectionInvocationApplication(
        accepted.invocation.invocation.invocationId,
        { kind: 'failed', error: 'too late' },
      ),
      /Invalid operation application transition: applied -> failed/,
    );
  });

  test('records unsupported standing authorization and withdraws it without rewriting acceptance', () => {
    const operation: ReflectionOperation = {
      kind: 'accept_production_alternate',
      version: 1,
      targetWordId: 'target',
      alternateWordId: 'alternate',
    };
    const artifact = dbModule.materializeReflectionArtifact(
      materializationInput('unsupported-session', operation),
    ).artifact;
    const accepted = dbModule.acceptReflectionProposal({
      proposalId: artifact.proposals[0].review.proposalId,
      operation,
      invocationId: 'unsupported-invocation',
      createdAt: updatedAt,
    });
    assert.equal(accepted.invocation.application.state.kind, 'unsupported');
    assert.match(
      accepted.invocation.application.state.kind === 'unsupported'
        ? accepted.invocation.application.state.reason
        : '',
      /No faithful application adapter/,
    );

    const withdrawn = dbModule.withdrawReflectionInvocationAuthorization(
      accepted.invocation.invocation.invocationId,
      appliedAt,
    );
    assert.deepEqual(withdrawn.application.state, { kind: 'authorization_withdrawn' });
    const detail = dbModule.getReflectionArtifactDetail(artifact.artifactId);
    assert.equal(detail.proposals[0].review.disposition.kind, 'accepted');
    assert.deepEqual(
      detail.proposals[0].invocation?.application.state,
      { kind: 'authorization_withdrawn' },
    );
  });

  test('rejects empty causal application effects and malformed supersession sources', () => {
    const applicationArtifact = dbModule.materializeReflectionArtifact(
      materializationInput('effect-invariant-session', suppressOperation('target')),
    ).artifact;
    const accepted = dbModule.acceptReflectionProposal({
      proposalId: applicationArtifact.proposals[0].review.proposalId,
      operation: suppressOperation('target'),
      invocationId: 'effect-invariant-invocation',
      createdAt: updatedAt,
    });
    assert.throws(
      () => dbModule.transitionReflectionInvocationApplication(
        accepted.invocation.invocation.invocationId,
        { kind: 'applied', appliedAt, effectRefs: [] },
        appliedAt,
      ),
      /at least one reference/,
    );
    assert.throws(
      () => dbModule.transitionReflectionInvocationApplication(
        accepted.invocation.invocation.invocationId,
        { kind: 'already_satisfied', satisfyingEffectRefs: [] },
        appliedAt,
      ),
      /at least one reference/,
    );

    const supersessionArtifact = dbModule.materializeReflectionArtifact(
      materializationInput('supersession-invariant-session', suppressOperation('target')),
    ).artifact;
    assert.throws(
      () => dbModule.supersedeReflectionProposal({
        proposalId: supersessionArtifact.proposals[0].review.proposalId,
        supersession: {
          source: 'external_state',
          actor: 'system',
          reason: 'Changed elsewhere.',
          replacementProposalId: null,
          replacementInvocationId: null,
          satisfyingEffectRefs: [],
        },
        updatedAt,
      }),
      /non-empty satisfying effect references/,
    );
  });

  test('rejects revised operations that reference words outside the proposal evidence item', () => {
    insertWord('unseen', '未见');
    const artifact = dbModule.materializeReflectionArtifact(
      materializationInput('evidence-visibility-session', suppressOperation('target')),
    ).artifact;
    assert.throws(
      () => dbModule.acceptReflectionProposal({
        proposalId: artifact.proposals[0].review.proposalId,
        operation: suppressOperation('unseen'),
        invocationId: 'unseen-invocation',
        createdAt: updatedAt,
      }),
      /word id unseen is not present in item item/,
    );
  });

  test('fails loudly when a review row cannot be traced to immutable proposal content', () => {
    const artifact = dbModule.materializeReflectionArtifact(
      materializationInput('corrupt-session', suppressOperation('target')),
    ).artifact;
    sqlite.prepare(`
      INSERT INTO reflection_proposal_reviews (
        proposal_id,
        artifact_id,
        item_id,
        proposal_index,
        disposition,
        updated_at
      ) VALUES ('rogue-review', ?, 'item', 99, 'pending', ?)
    `).run(artifact.artifactId, updatedAt);

    assert.throws(
      () => dbModule.getReflectionArtifactDetail(artifact.artifactId),
      /review rows that cannot be traced to immutable proposals/,
    );
  });
});

function materializationInput(
  sessionId: string,
  operation: ReflectionOperation,
): Parameters<DbModule['materializeReflectionArtifact']>[0] {
  const legacy = legacyMaterializationInput(sessionId, operation);
  const v2 = bundleV2(sessionId);
  const evidenceBundle: SessionReflectionBundleV5 = {
    ...v2,
    schemaVersion: 'session_reflection_bundle.v5',
    items: v2.items.map((item) => ({
      ...item,
      servedCue: { ...item.servedCue, supplement: null },
      promotionEvidence: null,
    })),
  };
  return {
    ...legacy,
    reflectionFlowVersion: 'initial_post_session_reflection.v4',
    promptVersion: 'reflection-staged-v2',
    evidenceBundle,
    result: currentResult(operation),
  };
}

function legacyMaterializationInput(
  sessionId: string,
  operation: ReflectionOperation,
): Parameters<DbModule['materializeReflectionArtifact']>[0] {
  sqlite.prepare(`
    INSERT OR IGNORE INTO study_sessions (
      id,
      started_at,
      ended_at,
      processing_state,
      processed_at
    ) VALUES (?, '2026-07-29T11:30:00.000Z', ?, 'processed', ?)
  `).run(sessionId, generatedAt, generatedAt);
  return {
    sourceSessionId: sessionId,
    reflectionFlowVersion: 'initial_post_session_reflection.v1',
    generatedAt,
    provider: 'openai',
    model: 'gpt-5.6-luna',
    promptVersion: 'initial-reflection.v1',
    evidenceBundle: bundle(sessionId),
    result: legacyResult(operation),
  };
}

function materializationInputV2(
  sessionId: string,
): Parameters<DbModule['materializeReflectionArtifact']>[0] {
  sqlite.prepare(`
    INSERT OR IGNORE INTO study_sessions (
      id,
      started_at,
      ended_at,
      processing_state,
      processed_at
    ) VALUES (?, '2026-07-29T11:30:00.000Z', ?, 'processed', ?)
  `).run(sessionId, generatedAt, generatedAt);
  return {
    sourceSessionId: sessionId,
    reflectionFlowVersion: 'initial_post_session_reflection.v2',
    generatedAt,
    provider: 'openai',
    model: 'gpt-5.6-luna',
    promptVersion: 'reflection-v3',
    evidenceBundle: bundleV2(sessionId),
    result: resultV5(),
  };
}

function materializationInputV6(
  sessionId: string,
): Parameters<DbModule['materializeReflectionArtifact']>[0] {
  sqlite.prepare(`
    INSERT OR IGNORE INTO study_sessions (
      id,
      started_at,
      ended_at,
      processing_state,
      processed_at
    ) VALUES (?, '2026-07-29T11:30:00.000Z', ?, 'processed', ?)
  `).run(sessionId, generatedAt, generatedAt);
  return {
    sourceSessionId: sessionId,
    reflectionFlowVersion: 'initial_post_session_reflection.v2',
    generatedAt,
    provider: 'openai',
    model: 'gpt-5.6-luna',
    promptVersion: 'reflection-v7',
    evidenceBundle: bundleV2(sessionId),
    result: resultV6(),
  };
}

function materializationInputV8(
  sessionId: string,
): Parameters<DbModule['materializeReflectionArtifact']>[0] {
  sqlite.prepare(`
    INSERT OR IGNORE INTO study_sessions (
      id, started_at, ended_at, processing_state, processed_at
    ) VALUES (?, '2026-07-29T11:30:00.000Z', ?, 'processed', ?)
  `).run(sessionId, generatedAt, generatedAt);
  const base = bundleV2(sessionId);
  const item = base.items[0]!;
  const responseWordId = item.submittedWord!.wordId;
  sqlite.prepare(`
    INSERT OR REPLACE INTO study_attempt_events (
      id, occurred_at, session_id, session_action_id, session_event_sequence,
      action_attempt_sequence, action_kind, target_word_id,
      sampled_skill_ids_json, response, outcome, rating,
      content_ref_json, metadata_json, projected_at
    ) VALUES (
      ?, ?, ?, ?, 1, 1, 'production', 'target', '["production"]', '替代',
      'incorrect', 'forgot', NULL, ?, ?
    )
  `).run(
    item.sourceAttemptId,
    generatedAt,
    sessionId,
    item.sessionActionId,
    JSON.stringify({
      production: {
        taskId: 'production-task:target:default_production',
        cueId: null,
        cueType: 'definition_gloss',
        text: 'target',
        acceptedWordIds: ['target'],
        supplement: null,
        anchorWordId: 'target',
        submittedText: '替代',
        submittedWordId: responseWordId,
        result: 'rejected',
      },
    }),
    generatedAt,
  );
  const evidenceBundle: SessionReflectionBundleV5 = {
    ...base,
    schemaVersion: 'session_reflection_bundle.v5',
    items: [{
      ...item,
      servedCue: { ...item.servedCue, acceptedWordIds: ['target'], supplement: null },
      promotionEvidence: {
        diagnosisTags: ['production_cue_overloaded'],
        words: ['target', responseWordId].map((wordId) => ({
          wordId,
          activeProductionCues: [{
            cueId: `cue-${wordId}`,
            taskId: `production-task:${wordId}:default_production`,
            cueType: 'definition_gloss',
            text: `broad ${wordId}`,
            acceptedWordIds: [wordId],
          }],
        })),
        intersectingPureCues: [{
          id: 'pure-1',
          stimulus: 'shared axis',
          axisNote: 'explicit axis',
          acceptedWordIds: ['target'],
        }],
      },
    }],
  };
  const result: SessionReflectionResultV8 = {
    schemaVersion: 'session_reflection_result.v8',
    itemResults: [{
      itemId: item.itemId,
      diagnosisTags: ['production_cue_overloaded'],
      learnerExplanation: 'The pair shares a broad axis.',
      promotionOutcome: 'promoted',
      proposals: [{
        proposalGroupKey: null,
        rationale: 'Promote the explicit pair.',
        operation: {
          kind: 'promote_pure_elicitation',
          version: 1,
          sourceAttemptId: item.sourceAttemptId,
          targetWordId: 'target',
          responseWordId,
          destination: { kind: 'existing', pureCueId: 'pure-1' },
          wordPlans: ['target', responseWordId].map((wordId) => ({
            wordId,
            deactivateCueIds: [`cue-${wordId}`],
            distinctiveCueDrafts: [],
          })),
        },
      }],
      questions: [],
    }],
  };
  return {
    sourceSessionId: sessionId,
    reflectionFlowVersion: 'initial_post_session_reflection.v4',
    generatedAt,
    provider: 'openai',
    model: 'gpt-5.6-luna',
    promptVersion: 'pure-cue-promotion-v1',
    evidenceBundle,
    result,
  };
}

function bundleV2(sessionId: string): SessionReflectionBundleV2 {
  const { cuesAsShown: _legacyCuesAsShown, ...baseItem } = productionItem('item');
  return {
    schemaVersion: 'session_reflection_bundle.v2',
    generatedAt,
    session: {
      sessionId,
      startedAt: '2026-07-29T11:30:00.000Z',
      endedAt: generatedAt,
      studyProfile: 'mandarin',
    },
    items: [{
      ...baseItem,
      sourceAttemptId: 'attempt-item',
      servedCue: {
        cueId: null,
        cueType: 'definition_gloss',
        text: 'target',
        acceptedWordIds: ['target'],
      },
    }],
  };
}

function resultV5(): SessionReflectionResultV5 {
  return {
    schemaVersion: 'session_reflection_result.v5',
    itemResults: [{
      itemId: 'item',
      diagnosisTags: ['valid_or_near_valid_alternate'],
      observation: 'The fallback omitted a known accepted answer.',
      learnerExplanation: null,
      proposals: [{
        proposalGroupKey: null,
        rationale: 'Create a durable cue with the explicit answer space.',
        operation: {
          kind: 'repair_production_cue',
          version: 2,
          wordId: 'target',
          taskId: 'production-task:target:default_production',
          changes: [{
            kind: 'create',
            cue: {
              cueType: 'minimal_context',
              text: 'A bounded context',
              acceptedWordIds: ['target', 'alternate'],
            },
          }],
          sourceAttemptJudgments: [{
            kind: 'accepted_answer_space_omission',
            sourceAttemptId: 'attempt-item',
            submittedWordId: 'alternate',
          }],
        },
      }],
      questions: [],
      unhandledNeeds: [],
    }],
  };
}

function resultV6(): SessionReflectionResultV6 {
  const legacy = resultV5();
  return {
    schemaVersion: 'session_reflection_result.v6',
    itemResults: legacy.itemResults.map((item) => ({
      itemId: item.itemId,
      diagnosisTags: item.diagnosisTags,
      learnerExplanation: 'The broad cue admits the alternate, so the repaired cue should make that local overlap explicit.',
      proposals: item.proposals,
      questions: item.questions,
    })),
  };
}

function bundle(sessionId: string): SessionReflectionBundleV1 {
  return {
    schemaVersion: 'session_reflection_bundle.v1',
    generatedAt,
    session: {
      sessionId,
      startedAt: '2026-07-29T11:30:00.000Z',
      endedAt: generatedAt,
      studyProfile: 'mandarin',
    },
    items: [productionItem('item')],
  };
}

function productionItem(itemId: string): SessionReflectionBundleV1['items'][number] {
  return {
    itemId,
    sessionActionId: `action-${itemId}`,
    occurredAt: '2026-07-29T11:59:00.000Z',
    source: 'production_mistake',
    sourceActionKind: 'production',
    targetWord: {
      wordId: 'target',
      hanzi: '目标',
      pinyin: 'mùbiāo',
      meanings: ['target'],
    },
    sessionNote: null,
    existingContent: { contrastClusters: [], knownAcceptedAlternates: [] },
    cuesAsShown: [{
      cueId: null,
      cueType: 'definition_gloss',
      displayOrder: 0,
      text: 'target',
      displayedMeanings: ['target'],
    }],
    rawResponse: '替代',
    submittedWord: {
      wordId: 'alternate',
      hanzi: '替代',
      pinyin: 'tìdài',
      meanings: ['alternate'],
    },
    responseKind: 'matched_known_word',
  };
}

function legacyResult(operation: ReflectionOperation): SessionReflectionResultV4 {
  return {
    schemaVersion: 'session_reflection_result.v4',
    itemResults: [{
      itemId: 'item',
      diagnosisTags: ['persistent_confusion'],
      observation: 'The learner supplied a visible alternate.',
      learnerExplanation: null,
      proposals: [{
        proposalGroupKey: null,
        rationale: 'This operation may make the study state more faithful.',
        operation,
      }],
      questions: [],
      unhandledNeeds: [],
    }],
  };
}

function currentResult(operation: ReflectionOperation): SessionReflectionResultV8 {
  return {
    schemaVersion: 'session_reflection_result.v8',
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

function informationalResult(itemId: string): SessionReflectionResultV8['itemResults'][number] {
  return {
    itemId,
    diagnosisTags: ['ordinary_retrieval_noise'],
    learnerExplanation: 'No durable intervention is warranted.',
    proposals: [],
    questions: [],
  };
}

function suppressOperation(wordId: string): ReflectionOperation {
  return {
    kind: 'suppress_definition_production',
    version: 1,
    wordId,
  };
}

function recordPricedRun(runId: string, completedAt: string, estimatedCostUsd: number): void {
  dbModule.recordReflectionGenerationRun({
    runId,
    sourceSessionId: 'run-session',
    reflectionFlowVersion: 'initial_post_session_reflection.v1',
    startedAt: completedAt,
    completedAt,
    provider: 'openai',
    model: 'gpt-5.6-luna-high',
    providerModel: 'gpt-5.6-luna',
    promptVersion: 'reflection-v2',
    responseId: `${runId}-response`,
    clientRequestId: null,
    finishReason: 'stop',
    bundleSchemaVersion: 'session_reflection_bundle.v1',
    resultSchemaVersion: 'session_reflection_result.v4',
    diagnostic: null,
    state: 'succeeded',
    failureCode: null,
    eligibleItemCount: 1,
    includedItemCount: 1,
    usage: {
      inputTokens: 10,
      cachedInputTokens: null,
      cacheWriteInputTokens: null,
      outputTokens: 5,
      reasoningTokens: null,
      totalTokens: 15,
    },
    pricingSnapshotId: 'price-v1',
    pricingAsOf: '2026-07-30',
    pricingBasis: { id: 'price-v1' },
    estimatedCostUsd,
    evidenceBundle: bundle('run-session'),
  });
}

function recordUnpricedRun(runId: string, completedAt: string): void {
  dbModule.recordReflectionGenerationRun({
    runId,
    sourceSessionId: 'run-session',
    reflectionFlowVersion: 'initial_post_session_reflection.v1',
    startedAt: completedAt,
    completedAt,
    provider: 'openai',
    model: 'gpt-5.6-luna-high',
    providerModel: 'gpt-5.6-luna',
    promptVersion: 'reflection-v2',
    responseId: `${runId}-response`,
    clientRequestId: null,
    finishReason: 'stop',
    bundleSchemaVersion: 'session_reflection_bundle.v1',
    resultSchemaVersion: 'session_reflection_result.v4',
    diagnostic: null,
    state: 'succeeded',
    failureCode: null,
    eligibleItemCount: 1,
    includedItemCount: 1,
    usage: {
      inputTokens: 10,
      cachedInputTokens: null,
      cacheWriteInputTokens: null,
      outputTokens: 5,
      reasoningTokens: null,
      totalTokens: 15,
    },
    pricingSnapshotId: null,
    pricingAsOf: null,
    pricingBasis: null,
    estimatedCostUsd: null,
    evidenceBundle: bundle('run-session'),
  });
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
