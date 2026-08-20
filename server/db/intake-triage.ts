import { randomUUID } from 'node:crypto';
import type {
  IntakeTriageAnnotation,
  IntakeTriageJudgment,
  IntakeTriageAssessment,
} from '../../src/domain/intake-triage.ts';
import type { SelectedIntakeTriageWord } from '../intake-triage/evidence.ts';
import { fingerprintIntakeTriageLexicalSnapshot } from '../intake-triage/fingerprint.ts';
import type { IntakeTriageRunMetadata } from '../intake-triage/provider.ts';
import type { RunCostEstimate } from '../llm/run-pricing.ts';
import { getDb } from './connection.ts';
import {
  sinkWordPriorityWithoutTransaction,
  suppressDefinitionProductionWithoutTransaction,
} from './domain-commands.ts';
import { PRIORITY_TIER_REGULAR, type PriorityWord } from './types.ts';

export type IntakeTriagePageState = {
  annotationsByWordId: Map<string, IntakeTriageAnnotation>;
  candidateWordIds: Set<string>;
};

export type IntakeTriageRunRecord = {
  runId: string;
  state: 'succeeded' | 'failed';
  startedAt: string;
  completedAt: string;
  provider: string;
  modelConfig: string;
  promptVersion: string;
  includedWordCount: number;
  failureCode: string | null;
  clientRequestId: string;
  responseId: string | null;
  estimatedCostUsd: number | null;
};

type AssessmentRow = {
  assessment_id: string;
  run_id: string;
  word_id: string;
  content_fingerprint: string;
  judgment: IntakeTriageJudgment;
  rationale: string;
  created_at: string;
  disposition: 'accepted' | 'dismissed' | null;
};

export class IntakeTriageAssessmentError extends Error {
  readonly code: 'not_found' | 'stale' | 'already_reviewed' | 'not_actionable';

  constructor(code: IntakeTriageAssessmentError['code'], message: string) {
    super(message);
    this.name = 'IntakeTriageAssessmentError';
    this.code = code;
  }
}

export function ensureIntakeTriageSchema(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS intake_triage_runs (
      run_id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('succeeded', 'failed')),
      provider TEXT NOT NULL,
      model_config TEXT NOT NULL,
      provider_model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      included_word_count INTEGER NOT NULL CHECK (included_word_count >= 0),
      failure_code TEXT,
      client_request_id TEXT NOT NULL,
      response_id TEXT,
      finish_reason TEXT,
      token_usage_json TEXT NOT NULL,
      pricing_snapshot_id TEXT,
      pricing_as_of TEXT,
      pricing_basis_json TEXT,
      estimated_cost_usd REAL,
      CHECK (
        (state = 'succeeded' AND failure_code IS NULL)
        OR (state = 'failed' AND failure_code IS NOT NULL)
      ),
      CHECK (
        (pricing_snapshot_id IS NULL AND pricing_as_of IS NULL AND pricing_basis_json IS NULL AND estimated_cost_usd IS NULL)
        OR (pricing_snapshot_id IS NOT NULL AND pricing_as_of IS NOT NULL AND pricing_basis_json IS NOT NULL AND estimated_cost_usd IS NOT NULL)
      )
    );

    CREATE TABLE IF NOT EXISTS intake_triage_assessments (
      assessment_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES intake_triage_runs(run_id) ON DELETE CASCADE,
      word_id TEXT NOT NULL REFERENCES words(id),
      content_fingerprint TEXT NOT NULL,
      judgment TEXT NOT NULL CHECK (
        judgment IN ('full_study', 'recognition_only', 'defer_active_study', 'uncertain')
      ),
      rationale TEXT NOT NULL CHECK (length(trim(rationale)) BETWEEN 1 AND 400),
      created_at TEXT NOT NULL,
      UNIQUE(run_id, word_id)
    );

    CREATE TABLE IF NOT EXISTS intake_triage_assessment_dispositions (
      assessment_id TEXT PRIMARY KEY REFERENCES intake_triage_assessments(assessment_id) ON DELETE CASCADE,
      disposition TEXT NOT NULL CHECK (disposition IN ('accepted', 'dismissed')),
      effect_kind TEXT,
      effect_state TEXT,
      effect_ref TEXT,
      created_at TEXT NOT NULL,
      CHECK (
        (disposition = 'accepted' AND effect_kind IS NOT NULL AND effect_state IS NOT NULL AND effect_ref IS NOT NULL)
        OR (disposition = 'dismissed' AND effect_kind IS NULL AND effect_state IS NULL AND effect_ref IS NULL)
      )
    );

    CREATE TRIGGER IF NOT EXISTS intake_triage_runs_no_update
    BEFORE UPDATE ON intake_triage_runs
    BEGIN
      SELECT RAISE(ABORT, 'intake triage runs are immutable');
    END;

    CREATE TRIGGER IF NOT EXISTS intake_triage_assessments_no_update
    BEFORE UPDATE ON intake_triage_assessments
    BEGIN
      SELECT RAISE(ABORT, 'intake triage assessments are immutable');
    END;

    CREATE TRIGGER IF NOT EXISTS intake_triage_dispositions_no_update
    BEFORE UPDATE ON intake_triage_assessment_dispositions
    BEGIN
      SELECT RAISE(ABORT, 'intake triage dispositions are immutable');
    END;
  `);
}

export function ensureIntakeTriageIndexes(): void {
  getDb().exec(`
    CREATE INDEX IF NOT EXISTS idx_intake_triage_runs_completed
      ON intake_triage_runs(completed_at DESC, run_id ASC);
    CREATE INDEX IF NOT EXISTS idx_intake_triage_assessments_word
      ON intake_triage_assessments(word_id, created_at DESC, assessment_id ASC);
  `);
}

export function validateIntakeTriageSchema(): void {
  assertColumns('intake_triage_runs', [
    'run_id', 'started_at', 'completed_at', 'state', 'provider', 'model_config',
    'provider_model', 'prompt_version', 'included_word_count', 'failure_code',
    'client_request_id', 'response_id', 'finish_reason', 'token_usage_json',
    'pricing_snapshot_id', 'pricing_as_of', 'pricing_basis_json', 'estimated_cost_usd',
  ]);
  assertColumns('intake_triage_assessments', [
    'assessment_id', 'run_id', 'word_id', 'content_fingerprint', 'judgment',
    'rationale', 'created_at',
  ]);
  assertColumns('intake_triage_assessment_dispositions', [
    'assessment_id', 'disposition', 'effect_kind', 'effect_state', 'effect_ref', 'created_at',
  ]);
}

export function getIntakeTriagePageState(
  words: PriorityWord[],
  promptVersion: string,
): IntakeTriagePageState {
  const annotationsByWordId = new Map<string, IntakeTriageAnnotation>();
  const candidateWordIds = new Set<string>();

  for (const entry of words) {
    const wordId = entry.word.id;
    const acceptedSuppression = getDb().prepare(`
      SELECT relevance_state
      FROM word_skill_relevance
      WHERE word_id = ?
        AND skill_id = 'production'
        AND relevance_state = 'suppressed'
    `).get(wordId) as { relevance_state: string } | undefined;
    if (acceptedSuppression) {
      const acceptedAssessment = getDb().prepare(`
        SELECT
          assessments.assessment_id,
          assessments.rationale
        FROM intake_triage_assessments AS assessments
        INNER JOIN intake_triage_assessment_dispositions AS dispositions
          ON dispositions.assessment_id = assessments.assessment_id
        WHERE assessments.word_id = ?
          AND assessments.judgment = 'recognition_only'
          AND dispositions.disposition = 'accepted'
        ORDER BY dispositions.created_at DESC, assessments.assessment_id ASC
        LIMIT 1
      `).get(wordId) as { assessment_id: string; rationale: string } | undefined;
      annotationsByWordId.set(wordId, {
        kind: 'production_suppressed',
        assessmentId: acceptedAssessment?.assessment_id ?? null,
        rationale: acceptedAssessment?.rationale ?? null,
      });
      continue;
    }

    const fingerprint = fingerprintWord(entry);
    const assessment = getLatestAssessment(wordId, fingerprint, promptVersion);
    if (!assessment) {
      candidateWordIds.add(wordId);
      continue;
    }
    if (assessment.disposition === 'dismissed' || assessment.judgment === 'full_study') continue;
    annotationsByWordId.set(wordId, {
      kind: 'recommendation',
      assessmentId: assessment.assessment_id,
      judgment: assessment.judgment,
      rationale: assessment.rationale,
    });
  }

  return { annotationsByWordId, candidateWordIds };
}

export function materializeSuccessfulIntakeTriageRun(input: {
  runId: string;
  startedAt: string;
  completedAt: string;
  selectedWords: SelectedIntakeTriageWord[];
  assessments: IntakeTriageAssessment[];
  metadata: IntakeTriageRunMetadata;
  costEstimate: RunCostEstimate | null;
}): IntakeTriageRunRecord {
  if (input.assessments.length !== input.selectedWords.length) {
    throw new Error('Validated intake assessments lost positional alignment.');
  }
  getDb().exec('BEGIN');
  try {
    insertRun({
      ...input,
      state: 'succeeded',
      failureCode: null,
      includedWordCount: input.selectedWords.length,
    });
    for (const [index, assessment] of input.assessments.entries()) {
      const selectedWord = input.selectedWords[index];
      if (!selectedWord) throw new Error('Validated intake assessment lost its selected word.');
      getDb().prepare(`
        INSERT INTO intake_triage_assessments (
          assessment_id,
          run_id,
          word_id,
          content_fingerprint,
          judgment,
          rationale,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        input.runId,
        selectedWord.wordId,
        selectedWord.contentFingerprint,
        assessment.judgment,
        assessment.rationale.trim(),
        input.completedAt,
      );
    }
    getDb().exec('COMMIT');
  } catch (error) {
    getDb().exec('ROLLBACK');
    throw error;
  }
  return runRecord(input.runId);
}

export function recordFailedIntakeTriageRun(input: {
  runId: string;
  startedAt: string;
  completedAt: string;
  includedWordCount: number;
  metadata: IntakeTriageRunMetadata;
  failureCode: string;
  costEstimate: RunCostEstimate | null;
}): IntakeTriageRunRecord {
  insertRun({ ...input, state: 'failed' });
  return runRecord(input.runId);
}

export function acceptIntakeTriageAssessment(
  assessmentId: string,
  activePromptVersion: string,
): { disposition: 'accepted'; effectKind: string; effectState: string; effectRef: string } {
  getDb().exec('BEGIN');
  try {
    const assessment = getAssessment(assessmentId);
    assertAssessmentPendingAndCurrent(assessment, activePromptVersion);
    if (assessment.judgment !== 'defer_active_study' && assessment.judgment !== 'recognition_only') {
      throw new IntakeTriageAssessmentError('not_actionable', 'This intake assessment has no supported action.');
    }

    const now = new Date().toISOString();
    let effectKind: string;
    let effectState = 'applied';
    let effectRef: string;
    if (assessment.judgment === 'defer_active_study') {
      sinkWordPriorityWithoutTransaction({ wordId: assessment.word_id, updatedAt: now });
      effectKind = 'priority_sunk';
      effectRef = `user_word_priority/${encodeURIComponent(assessment.word_id)}`;
    } else {
      const result = suppressDefinitionProductionWithoutTransaction({
        wordId: assessment.word_id,
        updatedAt: now,
        sourceEventId: null,
      });
      effectKind = 'definition_production_suppressed';
      effectState = result.kind;
      effectRef = `word_skill_relevance/${encodeURIComponent(assessment.word_id)}/production`;
    }
    getDb().prepare(`
      INSERT INTO intake_triage_assessment_dispositions (
        assessment_id, disposition, effect_kind, effect_state, effect_ref, created_at
      ) VALUES (?, 'accepted', ?, ?, ?, ?)
    `).run(assessmentId, effectKind, effectState, effectRef, now);
    getDb().exec('COMMIT');
    return { disposition: 'accepted', effectKind, effectState, effectRef };
  } catch (error) {
    getDb().exec('ROLLBACK');
    throw error;
  }
}

export function dismissIntakeTriageAssessment(
  assessmentId: string,
): { disposition: 'dismissed' } {
  const assessment = getAssessment(assessmentId);
  if (assessment.disposition !== null) {
    throw new IntakeTriageAssessmentError('already_reviewed', 'This intake assessment was already reviewed.');
  }
  getDb().prepare(`
    INSERT INTO intake_triage_assessment_dispositions (
      assessment_id, disposition, effect_kind, effect_state, effect_ref, created_at
    ) VALUES (?, 'dismissed', NULL, NULL, NULL, ?)
  `).run(assessmentId, new Date().toISOString());
  return { disposition: 'dismissed' };
}

function insertRun(input: {
  runId: string;
  startedAt: string;
  completedAt: string;
  state: 'succeeded' | 'failed';
  includedWordCount: number;
  metadata: IntakeTriageRunMetadata;
  failureCode: string | null;
  costEstimate: RunCostEstimate | null;
}): void {
  getDb().prepare(`
    INSERT INTO intake_triage_runs (
      run_id, started_at, completed_at, state, provider, model_config,
      provider_model, prompt_version, included_word_count, failure_code,
      client_request_id, response_id, finish_reason, token_usage_json,
      pricing_snapshot_id, pricing_as_of, pricing_basis_json, estimated_cost_usd
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.runId,
    input.startedAt,
    input.completedAt,
    input.state,
    input.metadata.provider,
    input.metadata.modelConfig,
    input.metadata.providerModel,
    input.metadata.promptVersion,
    input.includedWordCount,
    input.failureCode,
    input.metadata.clientRequestId,
    input.metadata.responseId,
    input.metadata.finishReason,
    JSON.stringify(input.metadata.usage),
    input.costEstimate?.pricing.id ?? null,
    input.costEstimate?.pricing.pricingAsOf ?? null,
    input.costEstimate === null ? null : JSON.stringify(input.costEstimate.pricing),
    input.costEstimate?.estimatedCostUsd ?? null,
  );
}

function getLatestAssessment(
  wordId: string,
  fingerprint: string,
  promptVersion: string,
): AssessmentRow | null {
  const row = getDb().prepare(`
    SELECT
      assessments.assessment_id,
      assessments.run_id,
      assessments.word_id,
      assessments.content_fingerprint,
      assessments.judgment,
      assessments.rationale,
      assessments.created_at,
      dispositions.disposition
    FROM intake_triage_assessments AS assessments
    INNER JOIN intake_triage_runs AS runs ON runs.run_id = assessments.run_id
    LEFT JOIN intake_triage_assessment_dispositions AS dispositions
      ON dispositions.assessment_id = assessments.assessment_id
    WHERE assessments.word_id = ?
      AND assessments.content_fingerprint = ?
      AND runs.prompt_version = ?
      AND runs.state = 'succeeded'
    ORDER BY runs.completed_at DESC, assessments.assessment_id ASC
    LIMIT 1
  `).get(wordId, fingerprint, promptVersion) as AssessmentRow | undefined;
  return row ?? null;
}

function getAssessment(assessmentId: string): AssessmentRow {
  const row = getDb().prepare(`
    SELECT
      assessments.assessment_id,
      assessments.run_id,
      assessments.word_id,
      assessments.content_fingerprint,
      assessments.judgment,
      assessments.rationale,
      assessments.created_at,
      dispositions.disposition
    FROM intake_triage_assessments AS assessments
    LEFT JOIN intake_triage_assessment_dispositions AS dispositions
      ON dispositions.assessment_id = assessments.assessment_id
    WHERE assessments.assessment_id = ?
  `).get(assessmentId) as AssessmentRow | undefined;
  if (!row) throw new IntakeTriageAssessmentError('not_found', 'Intake assessment not found.');
  return row;
}

function assertAssessmentPendingAndCurrent(assessment: AssessmentRow, activePromptVersion: string): void {
  if (assessment.disposition !== null) {
    throw new IntakeTriageAssessmentError('already_reviewed', 'This intake assessment was already reviewed.');
  }
  const run = getDb().prepare(`
    SELECT prompt_version
    FROM intake_triage_runs
    WHERE run_id = ?
  `).get(assessment.run_id) as { prompt_version: string };
  if (run.prompt_version !== activePromptVersion) {
    throw new IntakeTriageAssessmentError('stale', 'This intake assessment uses an older prompt version.');
  }
  const word = getDb().prepare(`
    SELECT id, hanzi, traditional, pinyin, meaning, meanings_json, examples_json, status
    FROM words
    WHERE id = ?
  `).get(assessment.word_id) as {
    id: string;
    hanzi: string;
    traditional: string | null;
    pinyin: string;
    meaning: string;
    meanings_json: string;
    examples_json: string;
    status: string;
  } | undefined;
  if (!word || word.status !== 'unstudied') {
    throw new IntakeTriageAssessmentError('stale', 'This intake assessment no longer targets an unstudied word.');
  }
  const fingerprint = fingerprintIntakeTriageLexicalSnapshot({
    hanzi: word.hanzi,
    traditional: word.traditional,
    pinyin: word.pinyin,
    meanings: parseStringArray(word.meanings_json, word.meaning),
    examples: parseStringArray(word.examples_json),
  });
  if (fingerprint !== assessment.content_fingerprint) {
    throw new IntakeTriageAssessmentError('stale', 'This word changed after the intake assessment was generated.');
  }
  const priority = getDb().prepare(`
    SELECT bump_count, force_top, priority_tier, required_for_next_session
    FROM user_word_priority
    WHERE word_id = ?
  `).get(assessment.word_id) as {
    bump_count: number;
    force_top: number;
    priority_tier: number;
    required_for_next_session: number;
  } | undefined;
  if (priority && (
    priority.bump_count > 0
    || priority.force_top !== 0
    || priority.priority_tier !== PRIORITY_TIER_REGULAR
    || priority.required_for_next_session !== 0
  )) {
    throw new IntakeTriageAssessmentError('stale', 'This word now has an explicit user priority override.');
  }
}

function fingerprintWord(entry: PriorityWord): string {
  return fingerprintIntakeTriageLexicalSnapshot({
    hanzi: entry.word.hanzi,
    traditional: entry.word.traditional,
    pinyin: entry.word.pinyin,
    meanings: entry.word.meanings,
    examples: entry.word.examples,
  });
}

function parseStringArray(raw: string, fallback = ''): string[] {
  try {
    const value = JSON.parse(raw) as unknown;
    if (Array.isArray(value)) {
      const strings = value.filter((entry): entry is string => typeof entry === 'string');
      if (strings.length > 0 || fallback.length === 0) return strings;
    }
  } catch {
    // Fall through to the legacy meaning when available.
  }
  return fallback.length === 0 ? [] : [fallback];
}

function runRecord(runId: string): IntakeTriageRunRecord {
  const row = getDb().prepare(`
    SELECT run_id, state, started_at, completed_at, provider, model_config,
      prompt_version, included_word_count, failure_code, client_request_id,
      response_id, estimated_cost_usd
    FROM intake_triage_runs
    WHERE run_id = ?
  `).get(runId) as {
    run_id: string;
    state: 'succeeded' | 'failed';
    started_at: string;
    completed_at: string;
    provider: string;
    model_config: string;
    prompt_version: string;
    included_word_count: number;
    failure_code: string | null;
    client_request_id: string;
    response_id: string | null;
    estimated_cost_usd: number | null;
  };
  return {
    runId: row.run_id,
    state: row.state,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    provider: row.provider,
    modelConfig: row.model_config,
    promptVersion: row.prompt_version,
    includedWordCount: row.included_word_count,
    failureCode: row.failure_code,
    clientRequestId: row.client_request_id,
    responseId: row.response_id,
    estimatedCostUsd: row.estimated_cost_usd,
  };
}

function assertColumns(tableName: string, expected: string[]): void {
  const rows = getDb().prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  const actual = rows.map((row) => row.name);
  if (actual.length !== expected.length || expected.some((name) => !actual.includes(name))) {
    throw new Error(`Invalid ${tableName} schema. Expected columns: ${expected.join(', ')}`);
  }
}
