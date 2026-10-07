import type { ModelInvocationRow } from '../domain/model-invocations';

export type InvocationGroup = 'day' | 'model' | 'invocationType' | 'learnerId' | 'status' | 'spendUsd' | 'latencyMs';
export type InvocationSort = 'timestamp' | 'model' | 'invocationType' | 'spendUsd' | 'latencyMs' | 'learnerId' | 'status';
export type SpendSummary = { count: number; knownSpendUsd: number; unknownCount: number; estimatedCount: number; reportedCount: number };

export function summarizeInvocations(rows: ModelInvocationRow[]): SpendSummary {
  return rows.reduce<SpendSummary>((summary, row) => ({
    count: summary.count + 1,
    knownSpendUsd: summary.knownSpendUsd + (row.spendUsd ?? 0),
    unknownCount: summary.unknownCount + Number(row.spendUsd === null),
    estimatedCount: summary.estimatedCount + Number(row.spendUsd !== null && row.spendSource === 'estimated'),
    reportedCount: summary.reportedCount + Number(row.spendUsd !== null && row.spendSource === 'reported'),
  }), { count: 0, knownSpendUsd: 0, unknownCount: 0, estimatedCount: 0, reportedCount: 0 });
}

export function groupInvocations(rows: ModelInvocationRow[], by: InvocationGroup) {
  const groups = new Map<string, ModelInvocationRow[]>();
  for (const row of rows) {
    const key = invocationGroupKey(row, by);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return [...groups].map(([key, group]) => ({ key, ...summarizeInvocations(group) }));
}

export function sortInvocations(rows: ModelInvocationRow[], by: InvocationSort, direction: 'asc' | 'desc') {
  return [...rows].sort((a, b) => {
    const av = a[by];
    const bv = b[by];
    // Unknown values stay last in either direction, rather than looking like zero.
    if (av === null) return bv === null ? a.id.localeCompare(b.id) : 1;
    if (bv === null) return -1;
    const comparison = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
    return (direction === 'asc' ? comparison : -comparison) || a.id.localeCompare(b.id);
  });
}

export function invocationDateRange(now = new Date()) {
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - 6);
  return { from: from.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
}

export function formatInvocationSpend(value: number | null): string {
  if (value === null) return 'Unknown';
  if (value > 0 && value < 0.0001) return '<$0.0001';
  return `$${value.toFixed(4)}`;
}


export function formatInvocationLatency(value: number | null): string {
  if (value === null) return '—';
  const milliseconds = Math.round(value);
  return milliseconds < 1000 ? `${milliseconds} ms` : `${milliseconds / 1000} s`;
}

export const invocationStatusLabels: Record<ModelInvocationRow['status'], string> = {
  running: 'Running', completed: 'Completed', failed: 'Failed',
  timed_out: 'Timed out', invalid_response: 'Invalid response',
};

export type DiscreteInvocationField = 'model' | 'invocationType' | 'learnerId' | 'status' | 'provider' | 'spendSource';
export type NumericInvocationField = 'spendUsd' | 'latencyMs';
export type NumericInvocationFilter = { min: string; max: string; unknown: 'include' | 'exclude' | 'only' };
export type InvocationFilters = {
  from: string;
  to: string;
  discrete: Partial<Record<DiscreteInvocationField, string[]>>;
  numeric: Partial<Record<NumericInvocationField, NumericInvocationFilter>>;
};

export function defaultInvocationFilters(now = new Date()): InvocationFilters {
  return { ...invocationDateRange(now), discrete: {}, numeric: {} };
}

export function filterInvocations(rows: ModelInvocationRow[], filters: InvocationFilters): ModelInvocationRow[] {
  return rows.filter((row) => {
    const day = row.timestamp.slice(0, 10);
    if ((filters.from && day < filters.from) || (filters.to && day > filters.to)) return false;
    for (const [field, selected] of Object.entries(filters.discrete)) {
      if (!selected.includes(row[field as DiscreteInvocationField])) return false;
    }
    for (const [field, range] of Object.entries(filters.numeric)) {
      const rawValue = row[field as NumericInvocationField];
      const value = field === 'latencyMs' && rawValue !== null ? rawValue / 1000 : rawValue;
      if (value === null) { if (range.unknown === 'exclude') return false; continue; }
      if (range.unknown === 'only') return false;
      if ((range.min !== '' && value < Number(range.min)) || (range.max !== '' && value > Number(range.max))) return false;
    }
    return true;
  });
}

export function invocationWindowSummaries(rows: ModelInvocationRow[], selected: ModelInvocationRow[], now = new Date()) {
  const { from, to } = invocationDateRange(now);
  const days = (start: string) => rows.filter((row) => row.timestamp.slice(0, 10) >= start && row.timestamp.slice(0, 10) <= to);
  return [
    { label: 'Today', ...summarizeInvocations(days(to)) },
    { label: 'Last 7 days', ...summarizeInvocations(days(from)) },
    { label: 'Current selection', ...summarizeInvocations(selected) },
  ];
}

export function invocationGroupKey(row: ModelInvocationRow, by: InvocationGroup): string {
  return by === 'day' ? row.timestamp.slice(0, 10) : String(row[by] ?? 'Unknown');
}

/** Keep sorted calls together by group before taking a rendering slice. */
export function groupedInvocationRows(rows: ModelInvocationRow[], by: InvocationGroup | '', direction: 'asc' | 'desc') {
  if (!by) return rows;
  const groups = new Map<string, ModelInvocationRow[]>();
  for (const row of rows) {
    const key = invocationGroupKey(row, by);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const numeric = by === 'spendUsd' || by === 'latencyMs';
  return [...groups].sort(([a], [b]) => {
    if (a === 'Unknown') return b === 'Unknown' ? 0 : 1;
    if (b === 'Unknown') return -1;
    const comparison = numeric ? Number(a) - Number(b) : a.localeCompare(b);
    return direction === 'asc' ? comparison : -comparison;
  }).flatMap(([, group]) => group);
}

export const INVOCATION_BATCH_SIZE = 50;
export function nextInvocationLimit(current: number, total: number): number {
  return Math.min(total, current + INVOCATION_BATCH_SIZE);
}

export function isFailedInvocation(row: ModelInvocationRow): boolean {
  return row.status === 'failed' || row.status === 'timed_out' || row.status === 'invalid_response';
}
