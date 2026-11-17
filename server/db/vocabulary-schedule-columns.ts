import type { DatabaseSync } from 'node:sqlite';
import type { VocabularyPureCueSchedulerState, VocabularySchedulerState } from './vocabulary-learners.ts';

/**
 * Scheduling facts that reads filter or order on live in real columns, so a due
 * read is one covering index range. The remaining scheduler state stays in
 * `scheduler_state_json`. Domain code keeps one merged state object; these
 * helpers are the only place that splits it for a write or merges it on read.
 */
const WORD_COLUMNS = {
  intervalHours: 'interval_hours', enabled: 'enabled', resetUntil: 'reset_until',
  postCompensationEarliestCheckAt: 'post_compensation_check_at',
} as const;
const PURE_CUE_COLUMNS = {
  intervalHours: 'interval_hours', enabled: 'enabled', resetUntil: 'reset_until', strongSince: 'strong_since',
  strongSuccesses: 'strong_successes', maintenanceIdentity: 'maintenance_identity', postCompensationRecheckAt: 'recheck_at',
} as const;
type Columns = Record<string, string>;
export type VocabularyWordScheduleColumns = { interval_hours: number; enabled: number; reset_until: string | null; post_compensation_check_at: string | null };
export type VocabularyPureCueScheduleColumns = { interval_hours: number; enabled: number; reset_until: string | null; strong_since: string | null;
  strong_successes: number; maintenance_identity: string | null; recheck_at: string | null };

/** SQL select list for the moved word-schedule columns, for a table alias. */
export const WORD_SCHEDULE_COLUMNS_SQL = (alias: string) => Object.values(WORD_COLUMNS).map((column) => `${alias}.${column}`).join(',');
export const PURE_CUE_SCHEDULE_COLUMNS_SQL = (alias: string) => Object.values(PURE_CUE_COLUMNS).map((column) => `${alias}.${column}`).join(',');

function split(state: Record<string, unknown>, columns: Columns): { values: Record<string, unknown>; json: string } {
  const rest: Record<string, unknown> = { ...state }; const values: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(columns)) { values[column] = rest[key] ?? null; delete rest[key]; }
  return { values, json: JSON.stringify(rest) };
}
function interval(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error('Schedule state requires a positive intervalHours');
  return value;
}
function flag(value: unknown): number {
  if (value === null || value === undefined) return 1;
  if (value !== 0 && value !== 1) throw new Error('Schedule state enabled must be 0 or 1');
  return value;
}
export function splitWordSchedulerState(state: Partial<VocabularySchedulerState> & Record<string, unknown>): { columns: VocabularyWordScheduleColumns; json: string } {
  const { values, json } = split(state, WORD_COLUMNS);
  return { json, columns: { interval_hours: interval(values.interval_hours), enabled: flag(values.enabled),
    reset_until: (values.reset_until ?? null) as string | null, post_compensation_check_at: (values.post_compensation_check_at ?? null) as string | null } };
}
export function splitPureCueSchedulerState(state: Partial<VocabularyPureCueSchedulerState> & Record<string, unknown>): { columns: VocabularyPureCueScheduleColumns; json: string } {
  const { values, json } = split(state, PURE_CUE_COLUMNS);
  const successes = values.strong_successes ?? 0;
  if (!Number.isSafeInteger(successes) || (successes as number) < 0) throw new Error('Pure-cue strongSuccesses must be a non-negative integer');
  return { json, columns: { interval_hours: interval(values.interval_hours), enabled: flag(values.enabled),
    reset_until: (values.reset_until ?? null) as string | null, strong_since: (values.strong_since ?? null) as string | null,
    strong_successes: successes as number, maintenance_identity: (values.maintenance_identity ?? null) as string | null,
    recheck_at: (values.recheck_at ?? null) as string | null } };
}

/**
 * Merge a stored row back into one state object. Rows captured before 0077 kept
 * these keys in JSON; a row that carries the columns overrides them. Absent
 * optional facts are omitted, as they were when they lived in JSON.
 */
function merge(row: Record<string, unknown>, columns: Columns): Record<string, unknown> {
  const json = typeof row.scheduler_state_json === 'string' ? JSON.parse(row.scheduler_state_json) as Record<string, unknown> : {};
  const state: Record<string, unknown> = { ...json };
  for (const [key, column] of Object.entries(columns)) {
    if (!(column in row)) continue;
    if (row[column] === null || row[column] === undefined) delete state[key]; else state[key] = row[column];
  }
  return state;
}
export function mergeWordSchedulerState(row: Record<string, unknown>): VocabularySchedulerState {
  return merge(row, WORD_COLUMNS) as VocabularySchedulerState;
}
export function mergePureCueSchedulerState(row: Record<string, unknown>): VocabularyPureCueSchedulerState {
  return merge(row, PURE_CUE_COLUMNS) as VocabularyPureCueSchedulerState;
}

/** Statements that run inside a migration may predate 0077 and must write the shape the schema has. */
export function hasScheduleColumns(db: DatabaseSync, table: 'learner_word_schedules' | 'learner_pure_cue_schedules'): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name='interval_hours'`).get());
}
