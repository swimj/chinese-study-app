import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, beforeEach, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  translateIntakeTriageProviderResponse,
  validateIntakeTriageProviderResponse,
  type IntakeTriageAssessment,
  type IntakeTriageJudgment,
} from '../src/domain/intake-triage.ts';
import type { SelectedIntakeTriageWord } from '../server/intake-triage/evidence.ts';

type DbModule = typeof import('../server/db.ts');

let dataDir = '';
let sqlite: DatabaseSync;
let dbModule: DbModule;
let evidenceModule: typeof import('../server/intake-triage/evidence.ts');
let generationModule: typeof import('../server/intake-triage/generation.ts');
let providerModule: typeof import('../server/intake-triage/provider.ts');

describe('intake triage advisor', { concurrency: false }, () => {
  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-intake-triage-'));
    const previousMode = process.env.APP_MODE;
    const previousDataDir = process.env.APP_DATA_DIR;
    const previousStudyProfile = process.env.APP_STUDY_PROFILE;
    process.env.APP_MODE = 'study';
    process.env.APP_DATA_DIR = dataDir;
    process.env.APP_STUDY_PROFILE = 'mandarin';

    dbModule = await import(`${pathToFileURL(path.resolve('server/db.ts')).href}?test=${Date.now()}`);
    evidenceModule = await import('../server/intake-triage/evidence.ts');
    generationModule = await import('../server/intake-triage/generation.ts');
    providerModule = await import('../server/intake-triage/provider.ts');

    if (previousMode === undefined) delete process.env.APP_MODE;
    else process.env.APP_MODE = previousMode;
    if (previousDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousDataDir;
    if (previousStudyProfile === undefined) delete process.env.APP_STUDY_PROFILE;
    else process.env.APP_STUDY_PROFILE = previousStudyProfile;

    sqlite = new DatabaseSync(path.join(dataDir, 'app.db'));
    sqlite.exec('PRAGMA foreign_keys = ON;');
  });

  beforeEach(() => {
    sqlite.exec(`
      DELETE FROM intake_triage_assessment_dispositions;
      DELETE FROM intake_triage_assessments;
      DELETE FROM intake_triage_runs;
      DELETE FROM word_skill_relevance;
      DELETE FROM user_word_priority;
      DELETE FROM words;
    `);
  });

  after(() => {
    sqlite.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('selection excludes bumped words while provider input contains only lexical evidence', () => {
    insertWord('plain', '仔', 80, ['young animal', 'small thing']);
    insertWord('bumped', '兹', 90, ['hereby']);
    dbModule.updateWordUserPriority('bumped', { bumpDelta: 1 });

    const selectedWords = evidenceModule.selectIntakeTriageWords();
    const request = evidenceModule.buildIntakeTriageProviderRequest(selectedWords);

    assert.deepEqual(selectedWords.map((word) => word.wordId), ['plain']);
    assert.equal(selectedWords[0]?.contentFingerprint.length, 64);
    assert.deepEqual(request.words, [{
      hanzi: '仔',
      pinyin: 'pinyin',
      meanings: ['young animal', 'small thing'],
      examples: [],
    }]);
    assert.equal(JSON.stringify(request).includes('plain'), false);
  });

  test('same-Hanzi entries remain distinct exact targets', () => {
    insertWord('zi-reading', '仔', 80, ['young animal']);
    insertWord('zai-reading', '仔', 79, ['careful, detailed']);
    sqlite.prepare('UPDATE words SET pinyin = ? WHERE id = ?').run('zi3', 'zi-reading');
    sqlite.prepare('UPDATE words SET pinyin = ? WHERE id = ?').run('zai3', 'zai-reading');

    const selectedWords = evidenceModule.selectIntakeTriageWords();
    const request = evidenceModule.buildIntakeTriageProviderRequest(selectedWords);

    assert.deepEqual(selectedWords.map(({ wordId, providerWord }) => ({ wordId, pinyin: providerWord.pinyin })), [
      { wordId: 'zi-reading', pinyin: 'zi3' },
      { wordId: 'zai-reading', pinyin: 'zai3' },
    ]);
    assert.deepEqual(request.words.map(({ hanzi, pinyin }) => ({ hanzi, pinyin })), [
      { hanzi: '仔', pinyin: 'zi3' },
      { hanzi: '仔', pinyin: 'zai3' },
    ]);
    assert.notEqual(selectedWords[0]?.contentFingerprint, selectedWords[1]?.contentFingerprint);
  });

  test('provider input requires Hanzi and pinyin to identify entries uniquely', () => {
    insertWord('word-1', '仔', 80, ['young animal']);
    const [selectedWord] = evidenceModule.selectIntakeTriageWords();
    if (!selectedWord) throw new Error('Expected selected word');

    assert.throws(
      () => evidenceModule.buildIntakeTriageProviderRequest([
        selectedWord,
        { ...selectedWord, wordId: 'duplicate-app-word' },
      ]),
      /Hanzi and pinyin references must be unique/,
    );
  });

  test('materializes recommendations and dismissing one leaves the word unchanged', () => {
    insertWord('word-1', '的', 80, ['taxi, as in 打的']);
    const selectedWords = evidenceModule.selectIntakeTriageWords();
    const run = dbModule.materializeSuccessfulIntakeTriageRun(successfulRun(selectedWords, [
      { judgment: 'defer_active_study', rationale: 'Bound use in a fixed expression.' },
    ]));
    assert.equal(run.includedWordCount, 1);
    assert.equal(run.clientRequestId, 'run-client-1');
    assert.equal(run.responseId, 'response-1');
    assert.equal(run.estimatedCostUsd, 0.000008);

    const page = evidenceModule.getIntakeTriagePriorityWords();
    const annotation = page.words[0]?.intakeTriage;
    assert.equal(annotation?.kind, 'recommendation');
    if (!annotation || annotation.kind !== 'recommendation') throw new Error('Expected recommendation');

    dbModule.dismissIntakeTriageAssessment(annotation.assessmentId);

    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM user_word_priority').get().count, 0);
    assert.equal(evidenceModule.getIntakeTriagePriorityWords().words[0]?.intakeTriage, null);
    assert.equal(evidenceModule.getIntakeTriagePriorityWords().analysisCandidateCount, 0);
  });

  test('accepting move-to-bottom sinks the word and records an accepted effect', () => {
    insertWord('word-1', '夹', 80, ['used in 夹肢窝']);
    const assessmentId = materializeOne('word-1', 'defer_active_study');

    const result = dbModule.acceptIntakeTriageAssessment(assessmentId, 'intake-triage-v1');

    assert.equal(result.effectKind, 'priority_sunk');
    assert.equal(sqlite.prepare('SELECT priority_tier FROM user_word_priority WHERE word_id = ?').get('word-1').priority_tier, -1);
    assert.equal(sqlite.prepare('SELECT disposition FROM intake_triage_assessment_dispositions').get().disposition, 'accepted');
  });

  test('accepting recognition-only suppresses definition production without changing unstudied status', () => {
    insertWord('word-1', '仔', 80, ['bound morpheme']);
    const assessmentId = materializeOne('word-1', 'recognition_only');

    const result = dbModule.acceptIntakeTriageAssessment(assessmentId, 'intake-triage-v1');

    assert.equal(result.effectKind, 'definition_production_suppressed');
    const relevance = sqlite.prepare(
      'SELECT skill_id, relevance_state FROM word_skill_relevance WHERE word_id = ?',
    ).get('word-1') as { skill_id: string; relevance_state: string };
    assert.equal(relevance.skill_id, 'production');
    assert.equal(relevance.relevance_state, 'suppressed');
    assert.equal(sqlite.prepare('SELECT status FROM words WHERE id = ?').get('word-1').status, 'unstudied');
    assert.equal(evidenceModule.getIntakeTriagePriorityWords().words[0]?.intakeTriage?.kind, 'production_suppressed');
  });

  test('recognition-only acceptance records already-satisfied suppression truthfully', () => {
    insertWord('word-1', '仔', 80, ['bound morpheme']);
    const assessmentId = materializeOne('word-1', 'recognition_only');
    sqlite.prepare(`
      INSERT INTO word_skill_relevance (
        word_id, skill_id, relevance_state, updated_at, source_event_id
      ) VALUES (?, 'production', 'suppressed', ?, NULL)
    `).run('word-1', '2026-08-20T00:00:00.000Z');

    const result = dbModule.acceptIntakeTriageAssessment(assessmentId, 'intake-triage-v1');

    assert.equal(result.effectState, 'already_satisfied');
    assert.equal(
      sqlite.prepare('SELECT effect_state FROM intake_triage_assessment_dispositions').get().effect_state,
      'already_satisfied',
    );
  });

  test('changed lexical content makes a pending action stale', () => {
    insertWord('word-1', '兹', 80, ['here']);
    const assessmentId = materializeOne('word-1', 'defer_active_study');
    sqlite.prepare(`UPDATE words SET meanings_json = '["different"]' WHERE id = ?`).run('word-1');

    assert.throws(
      () => dbModule.acceptIntakeTriageAssessment(assessmentId, 'intake-triage-v1'),
      (error: unknown) => error instanceof dbModule.IntakeTriageAssessmentError && error.code === 'stale',
    );
  });

  test('response translation tolerates reordering and rejects unknown lexical references', () => {
    insertWord('word-1', '兹', 80, ['here']);
    insertWord('word-2', '仔', 79, ['careful']);
    sqlite.prepare('UPDATE words SET pinyin = ? WHERE id = ?').run('zi1', 'word-1');
    sqlite.prepare('UPDATE words SET pinyin = ? WHERE id = ?').run('zai3', 'word-2');
    const request = evidenceModule.buildIntakeTriageProviderRequest(
      evidenceModule.selectIntakeTriageWords(),
    );
    const response = { assessments: [
      { hanzi: '仔', pinyin: 'zai3', judgment: 'defer_active_study' as const, rationale: 'Bound use.' },
      { hanzi: '兹', pinyin: 'zi1', judgment: 'full_study' as const, rationale: 'Useful literary form.' },
    ] };

    assert.deepEqual(validateIntakeTriageProviderResponse(response, request), []);
    assert.deepEqual(translateIntakeTriageProviderResponse(response, request), [
      { judgment: 'full_study', rationale: 'Useful literary form.' },
      { judgment: 'defer_active_study', rationale: 'Bound use.' },
    ]);
    assert.equal(validateIntakeTriageProviderResponse({
      assessments: [{ ...response.assessments[0]!, pinyin: 'zi3' }, response.assessments[1]!],
    }, request).length > 0, true);
  });

  test('provider contract failure records a safe failed run and no assessments', async () => {
    insertWord('word-1', '的', 80, ['taxi, as in 打的']);
    const service = generationModule.createIntakeTriageGenerationService({
      provider: {
        async generate(_request, options) {
          throw new providerModule.IntakeTriageProviderError(
            'schema_invalid',
            runMetadata(options.clientRequestId),
          );
        },
      },
      now: () => new Date('2026-08-20T00:00:00.000Z'),
    });

    await assert.rejects(
      service.generate(),
      (error: unknown) => error instanceof generationModule.IntakeTriageGenerationError
        && error.providerCode === 'schema_invalid',
    );
    assert.equal(sqlite.prepare('SELECT state FROM intake_triage_runs').get().state, 'failed');
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM intake_triage_assessments').get().count, 0);
    const columns = sqlite.prepare('PRAGMA table_info(intake_triage_runs)').all() as Array<{ name: string }>;
    assert.equal(columns.some(({ name }) => name === 'bundle_json' || name === 'result_json'), false);
  });

  test('fixed provider uses Luna high and validates exact structured output', async () => {
    insertWord('word-1', '迈克尔', 80, ['Michael']);
    const selectedWords = evidenceModule.selectIntakeTriageWords();
    const request = evidenceModule.buildIntakeTriageProviderRequest(selectedWords);
    let requestBody: Record<string, unknown> | null = null;
    const provider = providerModule.createIntakeTriageProvider({
      environment: { OPENAI_API_KEY: 'unit-test-secret' },
      systemPrompt: 'advisor prompt',
      fetchImplementation: (async (_input: string | URL | Request, init?: RequestInit) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({
          id: 'response-1',
          model: 'gpt-5.6-luna',
          choices: [{
            finish_reason: 'stop',
            message: { content: JSON.stringify({
              assessments: [{
                hanzi: '迈克尔',
                pinyin: 'pinyin',
                judgment: 'full_study',
                rationale: 'Useful transliteration pattern.',
              }],
            }) },
          }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }) as typeof globalThis.fetch,
    });

    const generated = await provider.generate(request, { clientRequestId: 'run-visible-1' });

    assert.equal(requestBody?.model, 'gpt-5.6-luna');
    assert.equal(requestBody?.reasoning_effort, 'high');
    assert.equal(generated.assessments[0]?.judgment, 'full_study');
    assert.equal(generated.metadata.clientRequestId, 'run-visible-1');
    assert.equal(JSON.stringify(requestBody).includes('word-1'), false);
    assert.equal(JSON.stringify(requestBody).includes('schemaVersion'), false);
    assert.equal(JSON.stringify(requestBody).includes('unit-test-secret'), false);
  });

  test('provider rejects missing configuration before making a request', async () => {
    insertWord('word-1', '兹', 80, ['hereby']);
    let called = false;
    const provider = providerModule.createIntakeTriageProvider({
      environment: {},
      systemPrompt: 'advisor prompt',
      fetchImplementation: (async () => {
        called = true;
        throw new Error('unexpected fetch');
      }) as typeof globalThis.fetch,
    });

    await assert.rejects(
      provider.generate(
        evidenceModule.buildIntakeTriageProviderRequest(evidenceModule.selectIntakeTriageWords()),
        { clientRequestId: 'run-missing-config' },
      ),
      (error: unknown) => error instanceof providerModule.IntakeTriageProviderError
        && error.code === 'missing_config',
    );
    assert.equal(called, false);
  });
});

function materializeOne(
  wordId: string,
  judgment: Extract<IntakeTriageJudgment, 'defer_active_study' | 'recognition_only'>,
): string {
  const selectedWords = evidenceModule.selectIntakeTriageWords();
  assert.equal(selectedWords[0]?.wordId, wordId);
  dbModule.materializeSuccessfulIntakeTriageRun(successfulRun(selectedWords, [
    { judgment, rationale: 'Useful rationale.' },
  ]));
  return (sqlite.prepare('SELECT assessment_id FROM intake_triage_assessments').get() as { assessment_id: string }).assessment_id;
}

function successfulRun(
  selectedWords: SelectedIntakeTriageWord[],
  assessments: IntakeTriageAssessment[],
) {
  return {
    runId: `run-${Math.random()}`,
    startedAt: '2026-08-20T00:00:00.000Z',
    completedAt: '2026-08-20T00:00:01.000Z',
    selectedWords,
    assessments,
    metadata: runMetadata('run-client-1'),
    costEstimate: {
      estimatedCostUsd: 0.000008,
      pricing: {
        id: 'test-pricing',
        pricingAsOf: '2026-08-20',
        provider: 'openai',
        providerModel: 'gpt-5.6-luna',
        serviceTier: 'standard' as const,
        contextBand: 'short' as const,
        currency: 'USD' as const,
        inputPerMillionUsd: 0.2,
        cachedInputPerMillionUsd: 0.02,
        cacheWriteInputPerMillionUsd: 0.25,
        outputPerMillionUsd: 1.2,
      },
    },
  };
}

function runMetadata(clientRequestId: string) {
  return {
    provider: 'openai',
    modelConfig: 'gpt-5.6-luna-high',
    providerModel: 'gpt-5.6-luna',
    promptVersion: 'intake-triage-v1',
    clientRequestId,
    responseId: 'response-1',
    finishReason: 'stop',
    usage: {
      inputTokens: 10,
      cachedInputTokens: null,
      cacheWriteInputTokens: null,
      outputTokens: 5,
      reasoningTokens: 2,
      totalTokens: 15,
    },
  };
}

function insertWord(id: string, hanzi: string, priority: number, meanings: string[]): void {
  sqlite.prepare(`
    INSERT INTO words (
      id, hanzi, traditional, pinyin, meaning, meanings_json, personal_notes,
      examples_json, status, priority, created_at, learning_streak,
      last_learning_success_on, last_learning_covered_on
    ) VALUES (?, ?, NULL, 'pinyin', ?, ?, '', '[]', 'unstudied', ?, ?, 0, NULL, NULL)
  `).run(id, hanzi, meanings[0] ?? '', JSON.stringify(meanings), priority, `2026-08-${priority % 20 + 1}T00:00:00.000Z`);
}
