import type { ModelInvocationRow } from '../domain/model-invocations';

export type InvocationGroup = 'day' | 'model' | 'invocationType' | 'learnerId';
export type InvocationSort = 'timestamp' | 'model' | 'invocationType' | 'spendUsd' | 'learnerId';
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
    const key = by === 'day' ? row.timestamp.slice(0, 10) : row[by];
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
    // Unknown spend stays last in either direction, rather than looking like zero.
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
