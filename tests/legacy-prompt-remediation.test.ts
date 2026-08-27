import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  normalizeSessionReflectionResultV7,
  type SessionReflectionResultV7Wire,
} from '../src/domain/reflection.ts';
import { generatePreparedReflectionBundle } from '../server/reflection/generation.ts';
import type { LunaReflectionProvider } from '../server/reflection/luna-provider.ts';
import {
  createLegacyPromptRemediationPlan,
  executeLegacyPromptRemediation,
  LegacyPromptRemediationGenerationError,
} from '../scripts/lib/legacy-prompt-remediation.ts';

type DbModule = typeof import('../server/db.ts');

const generatedAt = '2026-08-27T03:00:00.000Z';
let dataDir = '';
let sqlite: DatabaseSync;
let dbModule: DbModule;

describe('SWI-39 legacy prompt remediation', { concurrency: false }, () => {
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-swi-39-'));
    const previousMode = process.env.APP_MODE;
    const previousDataDir = process.env.APP_DATA_DIR;
    try {
      process.env.APP_MODE = 'study';
      process.env.APP_DATA_DIR = dataDir;
      const moduleUrl = `${pathToFileURL(path.resolve('server/db.ts')).href}?swi-39=${Date.now()}`;
      dbModule = await import(moduleUrl);
    } finally {
      restoreEnv('APP_MODE', previousMode);
      restoreEnv('APP_DATA_DIR', previousDataDir);
    }
    sqlite = new DatabaseSync(path.join(dataDir, 'app.db'));
    sqlite.function('current_learner_id', () => 'test-learner');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    seedExclusions();
  });

  after(() => {
    sqlite.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('builds bounded synthetic V4 batches and reports skipped contrast exclusions', () => {
    const plan = createLegacyPromptRemediationPlan({
      db: sqlite,
      learnerId: 'test-learner',
      studyProfile: 'mandarin',
      generatedAt,
    });

    assert.equal(plan.activeDefinitionExclusionCount, 26);
    assert.equal(plan.selectedDefinitionExclusions.length, 26);
    assert.deepEqual(plan.batches.map((batch) => batch.bundle.items.length), [25, 1]);
    assert.equal(plan.skippedContrastExclusions.length, 1);
    assert.equal(plan.skippedContrastExclusions[0]?.promptId, 'contrast-prompt');
    const item = plan.batches[0]?.bundle.items[0];
    assert(item);
    assert.equal(item.responseKind, 'no_clue');
    assert.equal(item.rawResponse, null);
    assert.equal(item.submittedWord, null);
    assert.equal(item.learnerRequestedReview, true);
    assert.equal(item.sessionNote, 'Legacy bad prompt 00');
    assert.equal(item.servedCue.cueId, null);
    assert.equal(item.servedCue.text, 'meaning 00; sense 00');
    assert.deepEqual(item.servedCue.acceptedWordIds, ['word-00']);
    assert.match(item.sourceAttemptId, /^synthetic-reflection-attempt:/);
    assert.match(item.sessionActionId!, /^synthetic-reflection-action:/);
    assert.deepEqual(item.existingContent.contrastClusters[0], {
      clusterId: 'cluster-00',
      title: 'Word 00 / Word 01',
      memberWordIds: ['word-00', 'word-01'],
      promptCount: 1,
      notes: ['Legacy contrast', 'target nuance', 'sibling nuance'],
    });
  });

  test('drops synthetic attempt judgments while retaining normalized cue changes', () => {
    const bundle = createLegacyPromptRemediationPlan({
      db: sqlite,
      learnerId: 'test-learner',
      studyProfile: 'mandarin',
      generatedAt,
    }).batches[0]!.bundle;
    const item = bundle.items[0]!;
    const wire: SessionReflectionResultV7Wire = {
      schemaVersion: 'session_reflection_result.v7',
      itemResults: [{
        itemId: item.itemId,
        diagnosisTags: ['production_cue_overloaded'],
        learnerExplanation: 'The fallback cue is too broad.',
        proposals: [{
          proposalGroupKey: null,
          rationale: 'Use a narrower durable cue.',
          operation: {
            kind: 'repair_production_cue',
            wordId: item.targetWord.wordId,
            changes: [{
              kind: 'create',
              cue: {
                cueType: 'minimal_context',
                text: 'A narrower context',
                acceptedWordIds: [item.targetWord.wordId],
              },
            }],
            sourceAttemptJudgments: [{ kind: 'misleading_or_overloaded_cue' }],
          },
        }],
        questions: [],
      }],
    };

    const normalized = normalizeSessionReflectionResultV7(wire, bundle);
    const operation = normalized.itemResults[0]?.proposals[0]?.operation;
    assert(operation?.kind === 'repair_production_cue' && operation.version === 2);
    assert.equal(operation.changes[0]?.kind, 'create');
    assert.deepEqual(operation.sourceAttemptJudgments, []);
  });

  test('dry-run writes nothing; apply materializes sessionless runs, artifacts, and Help once', async () => {
    const initialPlan = createLegacyPromptRemediationPlan({
      db: sqlite,
      learnerId: 'test-learner',
      studyProfile: 'mandarin',
      generatedAt,
    });
    const changesBeforeDryRun = sqlite.prepare('SELECT total_changes() AS count').get() as { count: number };
    const dryRun = await executeLegacyPromptRemediation({ plan: initialPlan, apply: false });
    const changesAfterDryRun = sqlite.prepare('SELECT total_changes() AS count').get() as { count: number };
    assert.equal(dryRun.mode, 'dry_run');
    assert.equal(dryRun.generatedBatches.length, 0);
    assert.equal(changesAfterDryRun.count, changesBeforeDryRun.count);

    let providerCalls = 0;
    const provider: LunaReflectionProvider = {
      async generate(bundle) {
        providerCalls += 1;
        return {
          result: {
            schemaVersion: 'session_reflection_result.v7',
            itemResults: bundle.items.map((item) => ({
              itemId: item.itemId,
              diagnosisTags: ['ordinary_retrieval_noise'],
              learnerExplanation: 'No durable change is needed.',
              proposals: [],
              questions: [],
            })),
          },
          metadata: {
            provider: 'openai',
            modelConfig: 'gpt-5.6-luna-high',
            providerModel: 'gpt-5.6-luna',
            promptVersion: 'reflection-v8',
            responseId: `response-${providerCalls}`,
            finishReason: 'stop',
            usage: {
              inputTokens: 10,
              cachedInputTokens: 0,
              cacheWriteInputTokens: null,
              outputTokens: 10,
              reasoningTokens: 0,
              totalTokens: 20,
            },
          },
        };
      },
    };
    const apply = await executeLegacyPromptRemediation({
      plan: initialPlan,
      apply: true,
      generateBatch: async (batch) => {
        const runId = randomUUID();
        try {
          const generated = await generatePreparedReflectionBundle({
            sourceSessionId: null,
            builtBundle: {
              bundle: batch.bundle,
              eligibleItemCount: batch.bundle.items.length,
              includedItemCount: batch.bundle.items.length,
            },
            provider,
            generatedAt,
            runId,
            now: () => generatedAt,
          });
          return { runId: generated.runId, artifactId: generated.artifactId };
        } catch (error) {
          throw new LegacyPromptRemediationGenerationError(runId, error);
        }
      },
    });

    assert.equal(apply.mode, 'apply');
    assert.equal(providerCalls, 2);
    assert.deepEqual(apply.generatedBatches.map((batch) => batch.state), ['succeeded', 'succeeded']);
    assert.equal(count('reflection_artifacts'), 2);
    assert.equal(count('reflection_generation_runs'), 2);
    assert.equal(count('reflection_help_inbox'), 26);
    assert.equal(count('definition_fallback_exclusions'), 26);
    assert.equal(count('contrast_prompt_exclusions'), 1);
    const storedSources = sqlite.prepare(`
      SELECT source_session_id FROM reflection_artifacts
      UNION ALL
      SELECT source_session_id FROM reflection_generation_runs
    `).all() as Array<{ source_session_id: string | null }>;
    assert(storedSources.every((row) => row.source_session_id === null));
    const retrySource = dbModule.getReflectionGenerationRetrySource(
      apply.generatedBatches[0]!.runId,
    );
    assert.equal(retrySource.sourceSessionId, null);

    const rerunPlan = createLegacyPromptRemediationPlan({
      db: sqlite,
      learnerId: 'test-learner',
      studyProfile: 'mandarin',
      generatedAt: '2026-08-27T04:00:00.000Z',
    });
    assert.equal(rerunPlan.selectedDefinitionExclusions.length, 0);
    assert.equal(rerunPlan.batches.length, 0);
    const rerun = await executeLegacyPromptRemediation({
      plan: rerunPlan,
      apply: true,
      generateBatch: async () => {
        providerCalls += 1;
        throw new Error('must not run');
      },
    });
    assert.equal(rerun.generatedBatches.length, 0);
    assert.equal(providerCalls, 2);
    assert.equal(count('reflection_artifacts'), 2);
    assert.equal(count('reflection_generation_runs'), 2);
  });
});

function seedExclusions(): void {
  for (let index = 0; index < 26; index += 1) {
    const suffix = String(index).padStart(2, '0');
    sqlite.prepare(`
      INSERT INTO words (
        id, hanzi, pinyin, meaning, meanings_json, personal_notes, examples_json,
        status, priority, created_at, learning_streak,
        last_learning_success_on, last_learning_covered_on
      ) VALUES (?, ?, 'pin1yin1', ?, ?, '', '[]', 'review', 1, ?, 0, NULL, NULL)
    `).run(
      `word-${suffix}`,
      `Word ${suffix}`,
      `meaning ${suffix}`,
      JSON.stringify([`meaning ${suffix}`, `sense ${suffix}`]),
      generatedAt,
    );
    sqlite.prepare(`
      INSERT INTO word_meanings (
        id, word_id, position, text, show_on_production_prompt, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 1, ?, ?)
    `).run(`meaning-${suffix}-0`, `word-${suffix}`, 0, `meaning ${suffix}`, generatedAt, generatedAt);
    sqlite.prepare(`
      INSERT INTO word_meanings (
        id, word_id, position, text, show_on_production_prompt, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 1, ?, ?)
    `).run(`meaning-${suffix}-1`, `word-${suffix}`, 1, `sense ${suffix}`, generatedAt, generatedAt);
    sqlite.prepare(`
      INSERT INTO definition_fallback_exclusions (
        learner_id, word_id, origin, source_feedback_ids_json,
        migration_id, created_at, note
      ) VALUES ('test-learner', ?, 'legacy_bad_prompt_migration', ?, NULL, ?, ?)
    `).run(
      `word-${suffix}`,
      JSON.stringify([`feedback-${suffix}`]),
      `2026-08-27T02:${suffix}:00.000Z`,
      `Legacy bad prompt ${suffix}`,
    );
  }
  sqlite.exec(`
    INSERT INTO contrast_clusters (id, title, note)
    VALUES ('cluster-00', 'Word 00 / Word 01', 'Legacy contrast');
    INSERT INTO contrast_cluster_members (cluster_id, word_id, nuance_note, display_order)
    VALUES
      ('cluster-00', 'word-00', 'target nuance', 0),
      ('cluster-00', 'word-01', 'sibling nuance', 1);
    INSERT INTO contrast_prompts (id, cluster_id, target_word_id, prompt_text, explanation)
    VALUES ('contrast-prompt', 'cluster-00', 'word-00', 'Choose Word 00', 'Because.');
    INSERT INTO contrast_prompt_exclusions (
      learner_id, prompt_id, target_word_id, origin, source_feedback_ids_json,
      migration_id, created_at, note
    ) VALUES (
      'test-learner', 'contrast-prompt', 'word-00', 'legacy_bad_prompt_migration',
      '["contrast-feedback"]', NULL, '${generatedAt}', 'Handle manually'
    );
  `);
}

function count(tableName: string): number {
  return (sqlite.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count: number }).count;
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
