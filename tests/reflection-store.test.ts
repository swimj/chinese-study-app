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
  SessionReflectionResultV4,
  SessionReflectionResultV5,
  SessionReflectionResultV6,
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
      retryable: true,
    });
    assert.deepEqual(dbModule.listReflectionGenerationRuns(), [recorded]);
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
      promptVersion: 'reflection-v8',
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
        promptVersion: 'reflection-v8',
        responseId: null,
        clientRequestId: 'provider-request-1',
        finishReason: null,
        bundleSchemaVersion: 'session_reflection_bundle.v4',
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
      promptVersion: 'reflection-v8',
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

  test('retains failed-run evidence for retry until an artifact exists', () => {
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
    assert.equal(failed.retryable, true);
    assert.deepEqual(dbModule.getReflectionGenerationRetrySource('failed-run'), {
      runId: 'failed-run',
      sourceSessionId: 'retry-session',
      reflectionFlowVersion: 'initial_post_session_reflection.v1',
      model: 'gpt-5.6-luna-high',
      eligibleItemCount: 1,
      includedItemCount: 1,
      evidenceBundle,
    });

    dbModule.materializeReflectionArtifact(
      materializationInput('retry-session', suppressOperation('target')),
    );
    assert.equal(dbModule.listReflectionGenerationRuns()[0]?.retryable, true);
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
      promptVersion: 'reflection-v8',
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
    const retry = dbModule.getReflectionGenerationRetrySource('sessionless-failed-run');
    assert.equal(retry.sourceSessionId, null);
    assert.deepEqual(retry.evidenceBundle, input.evidenceBundle);
  });

  test('atomically materializes immutable JSON and exactly one pending row per proposal', () => {
    const input = materializationInput('session-one', suppressOperation('target'));
    input.result.itemResults.push(informationalResult('info'));
    input.evidenceBundle.items.push(productionItem('info'));

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
      materializationInput('legacy-contrast-session', operation),
    ).artifact;
    const accepted = dbModule.acceptReflectionProposal({
      proposalId: artifact.proposals[0]!.review.proposalId,
      operation,
      invocationId: 'legacy-contrast-invocation',
      createdAt: updatedAt,
    });
    dbModule.applyReflectionInvocation(
      accepted.invocation.invocation.invocationId,
      appliedAt,
    );

    assert.equal(dbModule.listReflectionArtifacts('all')[0]?.readState, 'available');
    assert.equal(
      dbModule.getReflectionArtifactDetail(artifact.artifactId)
        .proposals[0]?.invocation?.invocation.operation.version,
      1,
    );
  });

  test('rejects mismatched bundle and result generations', () => {
    const v1 = materializationInput('mismatch-v1-session', suppressOperation('target'));
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

  test('authorizes exact and contained revised V2 cue repairs against immutable evidence', () => {
    const exactArtifact = dbModule.materializeReflectionArtifact(
      materializationInputV2('v2-exact-session'),
    ).artifact;
    const exactOperation = exactArtifact.proposals[0]!.proposal.operation;
    const exact = dbModule.acceptReflectionProposal({
      proposalId: exactArtifact.proposals[0]!.review.proposalId,
      operation: exactOperation,
      invocationId: 'v2-exact-invocation',
      createdAt: updatedAt,
    });
    assert.deepEqual(exact.review.disposition, {
      kind: 'accepted',
      acceptanceMode: 'exact',
      acceptedInvocationId: 'v2-exact-invocation',
    });

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
    const revised = dbModule.acceptReflectionProposal({
      proposalId: revisedArtifact.proposals[0]!.review.proposalId,
      operation: revisedOperation,
      invocationId: 'v2-revised-invocation',
      createdAt: updatedAt,
    });
    assert.equal(
      revised.review.disposition.kind === 'accepted'
        ? revised.review.disposition.acceptanceMode
        : null,
      'revised',
    );
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
    assert.throws(
      () => dbModule.deferReflectionProposal(deferred.proposalId),
      /Invalid proposal review transition: dismissed -> deferred/,
    );
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
    result: result(operation),
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

function result(operation: ReflectionOperation): SessionReflectionResultV4 {
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

function informationalResult(itemId: string): SessionReflectionResultV4['itemResults'][number] {
  return {
    itemId,
    diagnosisTags: ['ordinary_retrieval_noise'],
    observation: 'No durable intervention is warranted.',
    learnerExplanation: null,
    proposals: [],
    questions: [],
    unhandledNeeds: [],
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
