import { getDb } from './connection.ts';
import { CLERK_AUTH_PROVIDER, resolveLearnerId } from './identity.ts';
import { PRIORITY_TIER_REGULAR } from './types.ts';
import {
  readStudyCommitDiagnostics,
  type StudyCommitFailureDiagnostic,
} from '../study-commit-diagnostics.ts';

export const USAGE_PULSE_WINDOW_DAYS = 7;

export type UsageDailySnapshot = {
  dayKey: string;
  capturedAt: string;
  dau: number;
  sessionsCompleted: number;
  newWords: number;
  modelSpendUsd: number;
  medianStashSize: number | null;
  medianSessionActiveMs: number | null;
  learnersInactive7d: number;
  sessionsAbandoned: number;
  learnersSpendWithoutAccepts: number;
  studyCommitFailures: number;
};

export type UsagePulsePayload = {
  generatedAt: string;
  today: UsageDailySnapshot;
  days: UsageDailySnapshot[];
};

type SnapshotRow = {
  day_key: string;
  captured_at: string;
  dau: number;
  sessions_completed: number;
  new_words: number;
  model_spend_usd: number;
  median_stash_size: number | null;
  median_session_active_ms: number | null;
  learners_inactive_7d: number;
  sessions_abandoned: number;
  learners_spend_without_accepts: number;
  study_commit_failures: number;
};

export function utcDayKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function addUtcDays(dayKey: string, deltaDays: number): string {
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid UTC day key: ${dayKey}`);
  }
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
}

export function enumerateUtcDayKeys(endDayKey: string, dayCount: number): string[] {
  if (!Number.isInteger(dayCount) || dayCount < 1) {
    throw new Error('Expected positive integer dayCount');
  }
  const keys: string[] = [];
  for (let offset = dayCount - 1; offset >= 0; offset -= 1) {
    keys.push(addUtcDays(endDayKey, -offset));
  }
  return keys;
}

export function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function computeUsagePulseDay(input: {
  dayKey: string;
  capturedAt?: string;
  dataDir?: string | null;
  studyCommitFailures?: StudyCommitFailureDiagnostic[] | null;
  smokeClerkUserId?: string | null;
}): UsageDailySnapshot {
  const dayKey = input.dayKey.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
    throw new Error(`Invalid UTC day key: ${dayKey}`);
  }
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  const inactiveWindowStart = addUtcDays(dayKey, -(USAGE_PULSE_WINDOW_DAYS - 1));
  const smokeLearnerId = resolveConfiguredSmokeLearnerId(input.smokeClerkUserId);

  const dauRow = getDb().prepare(`
    SELECT COUNT(DISTINCT learner_id) AS value
    FROM learner_owned_review_session_summaries
    WHERE day_key = ?
  `).get(dayKey) as { value: number };

  const sessionsCompletedRow = getDb().prepare(`
    SELECT COUNT(*) AS value
    FROM learner_owned_review_session_summaries
    WHERE day_key = ?
  `).get(dayKey) as { value: number };

  const newWordsRow = getDb().prepare(`
    SELECT COALESCE(SUM(new_study_count), 0) AS value
    FROM learner_owned_daily_new_word_intake
    WHERE day_key = ?
  `).get(dayKey) as { value: number };

  const spendRow = getDb().prepare(`
    SELECT COALESCE(SUM(estimated_cost_usd), 0) AS value
    FROM learner_owned_reflection_generation_runs
    WHERE estimated_cost_usd IS NOT NULL
      AND substr(completed_at, 1, 10) = ?
  `).get(dayKey) as { value: number };

  const intakeSpendRow = getDb().prepare(`
    SELECT COALESCE(SUM(estimated_cost_usd), 0) AS value
    FROM learner_owned_intake_triage_runs
    WHERE estimated_cost_usd IS NOT NULL
      AND substr(completed_at, 1, 10) = ?
  `).get(dayKey) as { value: number } | undefined;

  const modelSpendUsd = Number(spendRow.value) + Number(intakeSpendRow?.value ?? 0);

  const sessionDurations = (getDb().prepare(`
    SELECT active_duration_ms AS value
    FROM learner_owned_review_session_summaries
    WHERE day_key = ?
  `).all(dayKey) as Array<{ value: number }>).map((row) => row.value);

  const stashSizes = (getDb().prepare(`
    SELECT learners.learner_id AS learner_id,
      (
        SELECT COUNT(*)
        FROM learner_owned_user_word_priority AS priority
        LEFT JOIN learner_word_state AS word_state
          ON word_state.learner_id = priority.learner_id
         AND word_state.word_id = priority.word_id
        WHERE priority.learner_id = learners.learner_id
          AND COALESCE(word_state.status, 'unstudied') = 'unstudied'
          AND priority.priority_tier >= ?
      ) AS stash_size
    FROM learners
  `).all(PRIORITY_TIER_REGULAR) as Array<{ learner_id: string; stash_size: number }>)
    .map((row) => row.stash_size);

  const learnersInactive7dRow = getDb().prepare(`
    SELECT COUNT(*) AS value
    FROM learners
    WHERE (? IS NULL OR learners.learner_id != ?)
      AND NOT EXISTS (
        SELECT 1
        FROM learner_owned_review_session_summaries AS summaries
        WHERE summaries.learner_id = learners.learner_id
          AND summaries.day_key >= ?
          AND summaries.day_key <= ?
      )
  `).get(smokeLearnerId, smokeLearnerId, inactiveWindowStart, dayKey) as { value: number };

  const sessionsAbandonedRow = getDb().prepare(`
    SELECT COUNT(*) AS value
    FROM learner_owned_study_sessions AS sessions
    WHERE substr(sessions.started_at, 1, 10) = ?
      AND NOT EXISTS (
        SELECT 1
        FROM learner_owned_review_session_summaries AS summaries
        WHERE summaries.learner_id = sessions.learner_id
          AND summaries.session_id = sessions.id
      )
  `).get(dayKey) as { value: number };

  const spendWithoutAcceptsRow = getDb().prepare(`
    SELECT COUNT(*) AS value
    FROM (
      SELECT runs.learner_id AS learner_id
      FROM learner_owned_reflection_generation_runs AS runs
      WHERE runs.estimated_cost_usd IS NOT NULL
        AND runs.estimated_cost_usd > 0
        AND substr(runs.completed_at, 1, 10) = ?
      GROUP BY runs.learner_id
      HAVING NOT EXISTS (
        SELECT 1
        FROM learner_owned_reflection_proposal_reviews AS reviews
        WHERE reviews.learner_id = runs.learner_id
          AND reviews.disposition = 'accepted'
          AND substr(reviews.updated_at, 1, 10) = ?
      )
    )
  `).get(dayKey, dayKey) as { value: number };

  const studyCommitFailures = countStudyCommitFailuresForDay({
    dayKey,
    dataDir: input.dataDir,
    diagnostics: input.studyCommitFailures,
  });

  return {
    dayKey,
    capturedAt,
    dau: Number(dauRow.value),
    sessionsCompleted: Number(sessionsCompletedRow.value),
    newWords: Number(newWordsRow.value),
    modelSpendUsd,
    medianStashSize: medianOf(stashSizes),
    medianSessionActiveMs: medianOf(sessionDurations),
    learnersInactive7d: Number(learnersInactive7dRow.value),
    sessionsAbandoned: Number(sessionsAbandonedRow.value),
    learnersSpendWithoutAccepts: Number(spendWithoutAcceptsRow.value),
    studyCommitFailures,
  };
}

export function upsertUsageDailySnapshot(snapshot: UsageDailySnapshot): void {
  getDb().prepare(`
    INSERT INTO usage_daily_snapshots (
      day_key,
      captured_at,
      dau,
      sessions_completed,
      new_words,
      model_spend_usd,
      median_stash_size,
      median_session_active_ms,
      learners_inactive_7d,
      sessions_abandoned,
      learners_spend_without_accepts,
      study_commit_failures
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(day_key) DO UPDATE SET
      captured_at = excluded.captured_at,
      dau = excluded.dau,
      sessions_completed = excluded.sessions_completed,
      new_words = excluded.new_words,
      model_spend_usd = excluded.model_spend_usd,
      median_stash_size = excluded.median_stash_size,
      median_session_active_ms = excluded.median_session_active_ms,
      learners_inactive_7d = excluded.learners_inactive_7d,
      sessions_abandoned = excluded.sessions_abandoned,
      learners_spend_without_accepts = excluded.learners_spend_without_accepts,
      study_commit_failures = excluded.study_commit_failures
  `).run(
    snapshot.dayKey,
    snapshot.capturedAt,
    snapshot.dau,
    snapshot.sessionsCompleted,
    snapshot.newWords,
    snapshot.modelSpendUsd,
    snapshot.medianStashSize,
    snapshot.medianSessionActiveMs,
    snapshot.learnersInactive7d,
    snapshot.sessionsAbandoned,
    snapshot.learnersSpendWithoutAccepts,
    snapshot.studyCommitFailures,
  );
}

export function listUsageDailySnapshots(dayKeys: readonly string[]): UsageDailySnapshot[] {
  if (dayKeys.length === 0) return [];
  const placeholders = dayKeys.map(() => '?').join(', ');
  const rows = getDb().prepare(`
    SELECT
      day_key,
      captured_at,
      dau,
      sessions_completed,
      new_words,
      model_spend_usd,
      median_stash_size,
      median_session_active_ms,
      learners_inactive_7d,
      sessions_abandoned,
      learners_spend_without_accepts,
      study_commit_failures
    FROM usage_daily_snapshots
    WHERE day_key IN (${placeholders})
    ORDER BY day_key ASC
  `).all(...dayKeys) as SnapshotRow[];
  return rows.map(mapSnapshotRow);
}

export function captureUsagePulseDay(input: {
  dayKey: string;
  dataDir?: string | null;
  capturedAt?: string;
}): UsageDailySnapshot {
  const snapshot = computeUsagePulseDay(input);
  upsertUsageDailySnapshot(snapshot);
  return snapshot;
}

export function ensureUsagePulseSnapshots(input: {
  todayDayKey?: string;
  windowDays?: number;
  dataDir?: string | null;
  now?: Date;
}): { capturedDayKeys: string[] } {
  const todayDayKey = input.todayDayKey ?? utcDayKey(input.now);
  const windowDays = input.windowDays ?? USAGE_PULSE_WINDOW_DAYS;
  const yesterday = addUtcDays(todayDayKey, -1);
  const dayKeys = enumerateUtcDayKeys(yesterday, windowDays);
  const existing = new Set(listUsageDailySnapshots(dayKeys).map((row) => row.dayKey));
  const capturedDayKeys: string[] = [];
  const capturedAt = (input.now ?? new Date()).toISOString();
  for (const dayKey of dayKeys) {
    if (existing.has(dayKey)) continue;
    captureUsagePulseDay({
      dayKey,
      dataDir: input.dataDir,
      capturedAt,
    });
    capturedDayKeys.push(dayKey);
  }
  return { capturedDayKeys };
}

export function getUsagePulse(input: {
  dataDir?: string | null;
  now?: Date;
  windowDays?: number;
}): UsagePulsePayload {
  const now = input.now ?? new Date();
  const todayDayKey = utcDayKey(now);
  const windowDays = input.windowDays ?? USAGE_PULSE_WINDOW_DAYS;
  ensureUsagePulseSnapshots({
    todayDayKey,
    windowDays,
    dataDir: input.dataDir,
    now,
  });

  const yesterday = addUtcDays(todayDayKey, -1);
  const historicalKeys = enumerateUtcDayKeys(yesterday, windowDays);
  const days = listUsageDailySnapshots(historicalKeys);
  const today = computeUsagePulseDay({
    dayKey: todayDayKey,
    capturedAt: now.toISOString(),
    dataDir: input.dataDir,
  });

  return {
    generatedAt: now.toISOString(),
    today,
    days,
  };
}

const SMOKE_CLERK_USER_ID_PATTERN = /^user_[A-Za-z0-9_]+$/;

function resolveConfiguredSmokeLearnerId(smokeClerkUserId?: string | null): string | null {
  const configuredId = smokeClerkUserId === undefined
    ? process.env.APP_SMOKE_CLERK_USER_ID
    : smokeClerkUserId;
  const clerkUserId = configuredId?.trim() ?? '';
  if (!SMOKE_CLERK_USER_ID_PATTERN.test(clerkUserId)) return null;
  return resolveLearnerId(CLERK_AUTH_PROVIDER, clerkUserId);
}

function mapSnapshotRow(row: SnapshotRow): UsageDailySnapshot {
  return {
    dayKey: row.day_key,
    capturedAt: row.captured_at,
    dau: row.dau,
    sessionsCompleted: row.sessions_completed,
    newWords: row.new_words,
    modelSpendUsd: row.model_spend_usd,
    medianStashSize: row.median_stash_size,
    medianSessionActiveMs: row.median_session_active_ms,
    learnersInactive7d: row.learners_inactive_7d,
    sessionsAbandoned: row.sessions_abandoned,
    learnersSpendWithoutAccepts: row.learners_spend_without_accepts,
    studyCommitFailures: row.study_commit_failures,
  };
}

function countStudyCommitFailuresForDay(input: {
  dayKey: string;
  dataDir?: string | null;
  diagnostics?: StudyCommitFailureDiagnostic[] | null;
}): number {
  const diagnostics = input.diagnostics ?? (
    input.dataDir
      ? readStudyCommitDiagnostics({ dataDir: input.dataDir, limit: Number.MAX_SAFE_INTEGER }).diagnostics
      : []
  );
  return diagnostics.filter((diagnostic) => diagnostic.at.slice(0, 10) === input.dayKey).length;
}
