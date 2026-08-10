import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { ReflectionOperation } from '../src/domain/reflection.ts';
import {
  buildReflectionVerificationMaterializationInput,
  reflectionVerificationFixture,
} from '../scripts/lib/reflection-verification-fixture.ts';

type DbModule = typeof import('../server/db.ts');

const acceptedAt = '2026-07-29T12:01:00.000Z';
let dataDir = '';
let sqlite: DatabaseSync;
let dbModule: DbModule;

describe('reflection verification fixture', { concurrency: false }, () => {
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-reflection-verification-'));
    const previousMode = process.env.APP_MODE;
    const previousDataDir = process.env.APP_DATA_DIR;
    const previousSeedDataPath = process.env.APP_SEED_DATA_PATH;
    const previousIncludeDevContrastSeed = process.env.APP_INCLUDE_DEV_CONTRAST_SEED;

    try {
      process.env.APP_MODE = 'dev';
      process.env.APP_DATA_DIR = dataDir;
      process.env.APP_SEED_DATA_PATH = path.resolve('server/seeds/reflection-dev.json');
      process.env.APP_INCLUDE_DEV_CONTRAST_SEED = 'false';
      dbModule = await import(`${pathToFileURL(path.resolve('server/db.ts')).href}?test=${Date.now()}`);
    } finally {
      if (previousMode === undefined) delete process.env.APP_MODE;
      else process.env.APP_MODE = previousMode;
      if (previousDataDir === undefined) delete process.env.APP_DATA_DIR;
      else process.env.APP_DATA_DIR = previousDataDir;
      if (previousSeedDataPath === undefined) delete process.env.APP_SEED_DATA_PATH;
      else process.env.APP_SEED_DATA_PATH = previousSeedDataPath;
      if (previousIncludeDevContrastSeed === undefined) delete process.env.APP_INCLUDE_DEV_CONTRAST_SEED;
      else process.env.APP_INCLUDE_DEV_CONTRAST_SEED = previousIncludeDevContrastSeed;
    }

    sqlite = new DatabaseSync(path.join(dataDir, 'app.db'));
    sqlite.exec('PRAGMA foreign_keys = ON;');
  });

  after(() => {
    sqlite.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('seeds the brainstorm cases and exposes their due production work', () => {
    const words = new Map(dbModule.getWords().map((word) => [word.id, word]));
    assert.equal(words.get('fixture-word-001')?.hanzi, '俞');
    assert.equal(words.get('fixture-word-002')?.hanzi, '难怪');
    assert.equal(words.get('fixture-word-003')?.hanzi, '怪不得');
    assert.equal(words.get('fixture-word-004')?.hanzi, '吃惊');
    assert.equal(words.get('fixture-word-005')?.hanzi, '震撼');
    assert.equal(words.get('fixture-word-006')?.hanzi, '在意');
    assert.equal(words.get('fixture-word-007')?.hanzi, '介意');

    const productionItems = dbModule
      .getSessionPayload('2026-07-29')
      .buckets.review
      .filter((item) => item.actionKind === 'production');
    const productionTargets = new Set(productionItems.map((item) => item.targetWordId));
    for (const wordId of [
      'fixture-word-001',
      'fixture-word-002',
      'fixture-word-004',
      'fixture-word-006',
    ]) {
      assert(productionTargets.has(wordId), `Expected due production work for ${wordId}.`);
    }
    for (const item of productionItems.filter((item) => item.targetWordId.startsWith('fixture-word-'))) {
      assert.match(item.targetWordId, /^fixture-word-\d{3}$/);
      assert.match(item.sessionActionId, /^review\/fixture-word-\d{3}\/production$/);
    }
  });

  test('proves fixture proposal authorization, effects, and withdrawal against SQLite state', () => {
    sqlite.prepare(`
      INSERT INTO study_sessions (
        id,
        started_at,
        ended_at,
        processing_state,
        processed_at
      ) VALUES (?, ?, ?, 'processed', ?)
    `).run(
      reflectionVerificationFixture.sessionId,
      reflectionVerificationFixture.startedAt,
      reflectionVerificationFixture.generatedAt,
      reflectionVerificationFixture.generatedAt,
    );
    const artifact = dbModule.materializeReflectionArtifact(
      buildReflectionVerificationMaterializationInput(),
    ).artifact;

    const suppress = proposalOperation(artifact, 'suppress_definition_production');
    const suppressAccepted = dbModule.acceptReflectionProposal({
      proposalId: proposalId(artifact, 'suppress_definition_production'),
      operation: suppress,
      invocationId: 'fixture-suppress',
      createdAt: acceptedAt,
    });
    assert.equal(suppressAccepted.review.disposition.kind, 'accepted');
    const suppressApplied = dbModule.applyReflectionInvocation('fixture-suppress', acceptedAt);
    assert.equal(suppressApplied.application.state.kind, 'applied');
    assert.deepEqual(dbModule.getWordSkillRelevance('fixture-word-001', 'production'), {
      wordId: 'fixture-word-001',
      skillId: 'production',
      relevanceState: 'suppressed',
      updatedAt: acceptedAt,
      sourceEventId: null,
    });

    const originalContrast = proposalOperation(artifact, 'create_contrast_cluster');
    if (originalContrast.kind !== 'create_contrast_cluster') {
      throw new Error('Expected contrast fixture operation.');
    }
    const revisedContrast: ReflectionOperation = {
      ...originalContrast,
      title: '在意 / 介意 — edited contextual contrast',
    };
    const contrastAccepted = dbModule.acceptReflectionProposal({
      proposalId: proposalId(artifact, 'create_contrast_cluster'),
      operation: revisedContrast,
      invocationId: 'fixture-contrast',
      createdAt: acceptedAt,
    });
    assert.deepEqual(contrastAccepted.review.disposition, {
      kind: 'accepted',
      acceptanceMode: 'revised',
      acceptedInvocationId: 'fixture-contrast',
    });
    const contrastApplied = dbModule.applyReflectionInvocation('fixture-contrast', acceptedAt);
    assert.equal(contrastApplied.application.state.kind, 'applied');
    const clusterRef = contrastApplied.application.state.kind === 'applied'
      ? contrastApplied.application.state.effectRefs.find((ref) => ref.type === 'contrast_cluster')
      : undefined;
    assert(clusterRef);
    const cluster = dbModule.getContrastClusterContent().find(({ id }) => id === clusterRef.id);
    assert.equal(cluster?.title, revisedContrast.title);
    assert.deepEqual(cluster?.members.map((member) => member.wordId), [
      'fixture-word-006',
      'fixture-word-007',
    ]);
    assert.equal(cluster?.prompts.length, 4);

    const cueRepair = proposalOperation(artifact, 'repair_production_cue');
    const meaningRowsBefore = countRows('word_meanings');
    const cueAccepted = dbModule.acceptReflectionProposal({
      proposalId: proposalId(artifact, 'repair_production_cue'),
      operation: cueRepair,
      invocationId: 'fixture-cue-repair',
      createdAt: acceptedAt,
    });
    assert.equal(cueAccepted.invocation.application.state.kind, 'unsupported');
    assert.equal(countRows('word_meanings'), meaningRowsBefore);

    const alternate = proposalOperation(artifact, 'accept_production_alternate');
    const alternateAccepted = dbModule.acceptReflectionProposal({
      proposalId: proposalId(artifact, 'accept_production_alternate'),
      operation: alternate,
      invocationId: 'fixture-alternate',
      createdAt: acceptedAt,
    });
    assert.equal(alternateAccepted.invocation.application.state.kind, 'unsupported');
    const withdrawn = dbModule.withdrawReflectionInvocationAuthorization('fixture-alternate', acceptedAt);
    assert.deepEqual(withdrawn.application.state, { kind: 'authorization_withdrawn' });

    const detail = dbModule.getReflectionArtifactDetail(artifact.artifactId);
    const alternateProposal = detail.proposals.find(
      (proposal) => proposal.proposal.operation.kind === 'accept_production_alternate',
    );
    assert.equal(alternateProposal?.review.disposition.kind, 'accepted');
    assert.deepEqual(alternateProposal?.invocation?.application.state, { kind: 'authorization_withdrawn' });

    const persisted = sqlite.prepare(`
      SELECT application_state, effect_refs_json
      FROM reflection_operation_invocations
      WHERE invocation_id = 'fixture-contrast'
    `).get() as { application_state: string; effect_refs_json: string };
    assert.equal(persisted.application_state, 'applied');
    assert.equal(JSON.parse(persisted.effect_refs_json).length, 11);
  });
});

function proposalId(
  artifact: ReturnType<DbModule['materializeReflectionArtifact']>['artifact'],
  kind: ReflectionOperation['kind'],
): string {
  const proposal = artifact.proposals.find((entry) => entry.proposal.operation.kind === kind);
  if (!proposal) throw new Error(`Fixture proposal ${kind} is missing.`);
  return proposal.review.proposalId;
}

function proposalOperation(
  artifact: ReturnType<DbModule['materializeReflectionArtifact']>['artifact'],
  kind: ReflectionOperation['kind'],
): ReflectionOperation {
  const proposal = artifact.proposals.find((entry) => entry.proposal.operation.kind === kind);
  if (!proposal) throw new Error(`Fixture proposal ${kind} is missing.`);
  return proposal.proposal.operation;
}

function countRows(table: 'word_meanings'): number {
  return (sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}
