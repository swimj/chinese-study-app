import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { after, before, describe, test } from 'node:test';

const repoRoot = path.resolve('.');
let dataDir = '';

describe('reflection persistence across process reload', { concurrency: false }, () => {
  before(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reflection-persistence-reload-'));
  });

  after(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('reconstructs queue, detail, review, and application state in a fresh process', () => {
    const written = runInFreshProcess<WrittenProcessState>(`
      const db = await import('./server/db.ts');
      const { getDb } = await import('./server/db/connection.ts');
      const database = getDb();
      const generatedAt = '2026-07-29T12:00:00.000Z';
      const appliedAt = '2026-07-29T12:02:00.000Z';

      database.prepare(\`
        INSERT INTO words (
          id, hanzi, traditional, pinyin, meaning, meanings_json,
          personal_notes, examples_json, status, priority, created_at,
          learning_streak, last_learning_success_on, last_learning_covered_on
        ) VALUES (
          'target', '目标', '目標', 'mùbiāo', 'target', '["target"]',
          '', '[]', 'review', 0, ?, 0, NULL, NULL
        )
      \`).run(generatedAt);
      database.prepare(\`
        INSERT INTO study_sessions (
          id, started_at, ended_at, processing_state, processed_at
        ) VALUES (
          'reload-session', '2026-07-29T11:30:00.000Z', ?,
          'processed', ?
        )
      \`).run(generatedAt, generatedAt);

      const evidenceBundle = {
        schemaVersion: 'session_reflection_bundle.v1',
        generatedAt,
        session: {
          sessionId: 'reload-session',
          startedAt: '2026-07-29T11:30:00.000Z',
          endedAt: generatedAt,
          studyProfile: 'mandarin',
        },
        items: [{
          itemId: 'item-1',
          source: 'production_mistake',
          sourceActionKind: 'production',
          sessionActionId: 'action-1',
          occurredAt: '2026-07-29T11:59:00.000Z',
          targetWord: {
            wordId: 'target',
            hanzi: '目标',
            pinyin: 'mùbiāo',
            meanings: ['target'],
          },
          sessionNote: null,
          existingContent: {
            contrastClusters: [],
            knownAcceptedAlternates: [],
          },
          cuesAsShown: [{
            cueId: null,
            cueType: 'definition_gloss',
            displayOrder: 0,
            text: 'target',
            displayedMeanings: ['target'],
          }],
          rawResponse: 'other response',
          submittedWord: null,
          responseKind: 'unmatched_text',
        }],
      };
      const result = {
        schemaVersion: 'session_reflection_result.v4',
        itemResults: [{
          itemId: 'item-1',
          diagnosisTags: ['persistent_confusion'],
          observation: 'The durable state should survive a process boundary.',
          learnerExplanation: null,
          proposals: [{
            proposalGroupKey: null,
            rationale: 'Suppress this production goal.',
            operation: {
              kind: 'suppress_definition_production',
              version: 1,
              wordId: 'target',
            },
          }, {
            proposalGroupKey: null,
            rationale: 'Keep a cue draft available for later review.',
            operation: {
              kind: 'repair_production_cue',
              version: 1,
              wordId: 'target',
              proposedCues: [{
                cueType: 'minimal_context',
                text: 'A concrete target.',
              }],
              repairIntent: 'add_contextual_triangulation',
            },
          }],
          questions: [],
          unhandledNeeds: [],
        }],
      };

      const artifact = db.materializeReflectionArtifact({
        artifactId: 'reload-artifact',
        sourceSessionId: 'reload-session',
        reflectionFlowVersion: 'initial_post_session_reflection.v1',
        generatedAt,
        provider: 'openai',
        model: 'gpt-5.6-luna-high',
        promptVersion: 'reflection-v2',
        evidenceBundle,
        result,
      }).artifact;
      const accepted = db.acceptReflectionProposal({
        proposalId: artifact.proposals[0].review.proposalId,
        operation: result.itemResults[0].proposals[0].operation,
        invocationId: 'reload-invocation',
        createdAt: '2026-07-29T12:01:00.000Z',
      });
      const applied = db.applyReflectionInvocation(
        accepted.invocation.invocation.invocationId,
        appliedAt,
      );
      const deferred = db.deferReflectionProposal(
        artifact.proposals[1].review.proposalId,
        '2026-07-29T12:03:00.000Z',
      );

      console.log(JSON.stringify({
        artifactId: artifact.artifactId,
        accepted: accepted.review.disposition,
        applied: applied.application.state,
        deferred: deferred.disposition,
      }));
      database.close();
    `);

    assert.equal(written.artifactId, 'reload-artifact');
    assert.deepEqual(written.accepted, {
      kind: 'accepted',
      acceptanceMode: 'exact',
      acceptedInvocationId: 'reload-invocation',
    });
    assert.deepEqual(written.applied, {
      kind: 'applied',
      appliedAt: '2026-07-29T12:02:00.000Z',
      effectRefs: [{ type: 'word_skill_relevance', id: 'target/production' }],
    });
    assert.deepEqual(written.deferred, { kind: 'deferred' });

    const reloaded = runInFreshProcess<ReloadedProcessState>(`
      const db = await import('./server/db.ts');
      const { getDb } = await import('./server/db/connection.ts');
      const queue = db.listReflectionArtifacts('open');
      const history = db.listReflectionArtifacts('all');
      const detail = db.getReflectionArtifactDetail('reload-artifact');
      const bySource = db.getReflectionArtifactBySessionAndFlow(
        'reload-session',
        'initial_post_session_reflection.v1',
      );
      const relevance = db.getWordSkillRelevance('target', 'production');

      console.log(JSON.stringify({ queue, history, detail, bySource, relevance }));
      getDb().close();
    `);

    assert.deepEqual(
      reloaded.queue.map((artifact: { artifactId: string }) => artifact.artifactId),
      ['reload-artifact'],
    );
    assert.equal(reloaded.queue[0].openProposalCount, 1);
    assert.deepEqual(
      reloaded.history.map((artifact: { artifactId: string }) => artifact.artifactId),
      ['reload-artifact'],
    );
    assert.equal(reloaded.bySource.artifactId, 'reload-artifact');
    assert.equal(
      reloaded.detail.result.itemResults[0].observation,
      'The durable state should survive a process boundary.',
    );
    assert.deepEqual(reloaded.detail.proposals[0].review.disposition, {
      kind: 'accepted',
      acceptanceMode: 'exact',
      acceptedInvocationId: 'reload-invocation',
    });
    assert.deepEqual(reloaded.detail.proposals[0].invocation, {
      invocation: {
        invocationId: 'reload-invocation',
        createdAt: '2026-07-29T12:01:00.000Z',
        origin: {
          kind: 'proposal_acceptance',
          proposalId: reloaded.detail.proposals[0].review.proposalId,
        },
        operation: {
          kind: 'suppress_definition_production',
          version: 1,
          wordId: 'target',
        },
      },
      application: {
        invocationId: 'reload-invocation',
        updatedAt: '2026-07-29T12:02:00.000Z',
        state: {
          kind: 'applied',
          appliedAt: '2026-07-29T12:02:00.000Z',
          effectRefs: [{ type: 'word_skill_relevance', id: 'target/production' }],
        },
      },
    });
    assert.deepEqual(
      reloaded.detail.proposals[1].review.disposition,
      { kind: 'deferred' },
    );
    assert.equal(reloaded.detail.proposals[1].invocation, null);
    assert.equal(reloaded.relevance.relevanceState, 'suppressed');
  });
});

type WrittenProcessState = {
  artifactId: string;
  accepted: unknown;
  applied: unknown;
  deferred: unknown;
};

type ReloadedProcessState = {
  queue: Array<{ artifactId: string; openProposalCount: number }>;
  history: Array<{ artifactId: string }>;
  bySource: { artifactId: string };
  detail: {
    result: { itemResults: Array<{ observation: string }> };
    proposals: Array<{
      review: { proposalId: string; disposition: unknown };
      invocation: unknown;
    }>;
  };
  relevance: { relevanceState: string };
};

function runInFreshProcess<T>(source: string): T {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '--eval', source],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        APP_MODE: 'study',
        APP_DATA_DIR: dataDir,
        APP_STUDY_PROFILE: 'mandarin',
      },
      encoding: 'utf8',
      timeout: 30_000,
    },
  );

  assert.equal(
    result.status,
    0,
    `Fresh process failed.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.equal(result.signal, null);
  const output = result.stdout.trim();
  assert.notEqual(output, '', `Fresh process produced no JSON.\nstderr:\n${result.stderr}`);
  return JSON.parse(output) as T;
}
