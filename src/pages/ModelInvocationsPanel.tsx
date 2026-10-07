import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ModelInvocationRow } from '../domain/model-invocations';
import { fetchModelInvocations } from '../services/api';
import { InvocationColumnDialog, INVOCATION_COLUMNS, columnHasFilter } from './InvocationColumnDialog';
import {
  defaultInvocationFilters, filterInvocations, formatInvocationLatency, invocationStatusLabels,
  formatInvocationSpend, groupedInvocationRows, invocationGroupKey, invocationWindowSummaries,
  isFailedInvocation, nextInvocationLimit, INVOCATION_BATCH_SIZE, sortInvocations, summarizeInvocations,
  type InvocationFilters, type InvocationGroup, type InvocationSort,
} from './model-invocation-presentation';

export function ModelInvocationsPanel() {
  const [filters, setFilters] = useState(defaultInvocationFilters);
  const [rows, setRows] = useState<ModelInvocationRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [groupBy, setGroupBy] = useState<InvocationGroup | ''>('');
  const [sortBy, setSortBy] = useState<InvocationSort>('timestamp');
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc');
  const [visibleCount, setVisibleCount] = useState(INVOCATION_BATCH_SIZE);
  const [activeColumn, setActiveColumn] = useState<InvocationSort | null>(null);
  const [shadeFailures, setShadeFailures] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchModelInvocations().then((payload) => {
      if (!cancelled) { setRows(payload.rows); setVisibleCount(INVOCATION_BATCH_SIZE); setNow(new Date()); }
    }).catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load model invocations.');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refresh]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const selected = filterInvocations(rows ?? [], filters);
  const ordered = groupedInvocationRows(sortInvocations(selected, sortBy, direction), groupBy, direction);
  const canLoadMore = visibleCount < ordered.length;
  useEffect(() => {
    if (!canLoadMore || !sentinel.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setVisibleCount((current) => nextInvocationLimit(current, ordered.length));
    }, { rootMargin: '200px' });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [canLoadMore, visibleCount, ordered.length, filters, sortBy, direction, groupBy]);

  function changeFilters(next: InvocationFilters) { setFilters(next); setVisibleCount(INVOCATION_BATCH_SIZE); }
  function changeSort(next: InvocationSort, order: 'asc' | 'desc') { setSortBy(next); setDirection(order); setVisibleCount(INVOCATION_BATCH_SIZE); }
  function changeGroup(next: InvocationGroup | '') { setGroupBy(next); setVisibleCount(INVOCATION_BATCH_SIZE); }
  const column = INVOCATION_COLUMNS.find((item) => item.key === activeColumn);
  const summaries = invocationWindowSummaries(rows ?? [], selected, now);
  const headers = INVOCATION_COLUMNS.map((item) => {
    const filtered = columnHasFilter(item.key, filters);
    const grouped = groupBy === item.group;
    const sorted = sortBy === item.key;
    return <th key={item.key} scope="col" aria-sort={sorted ? direction === 'asc' ? 'ascending' : 'descending' : 'none'}>
      <button className="operator-column-button" type="button" aria-haspopup="dialog" aria-expanded={activeColumn === item.key}
        onClick={() => setActiveColumn(item.key)} aria-label={`${item.label}: sort, group or filter${filtered ? '; filter active' : ''}${grouped ? '; grouped' : ''}`}>
        <span>{item.label}{sorted ? direction === 'asc' ? ' ↑' : ' ↓' : ' ▾'}</span>
        {(filtered || grouped) && <span className="operator-column-indicators">{filtered && 'Filtered'}{filtered && grouped && ' · '}{grouped && 'Grouped'}</span>}
      </button>
    </th>;
  });

  return <section aria-labelledby="model-invocations-heading">
    <div className="section-heading">
      <h2 id="model-invocations-heading">Model invocations</h2>
      <button className="secondary-button" type="button" disabled={loading} onClick={() => setRefresh((value) => value + 1)}>Refresh ledger</button>
    </div>
    <details className="operator-spend-notes"><summary>Coverage and spend</summary><p className="notes">
      Production calls recorded since the ledger was introduced; older calls are not backfilled.
      Each invocation belongs to the user who initiated the work, including shared content preparation.
      Spend is in USD: provider-reported cost takes precedence over token-based estimates. Unknown spend is excluded from sums.
      Today and Last 7 days use UTC calendar days including today, regardless of column filters. Current selection includes every filtered call, including calls not yet shown.
      Latency measures the provider request through response receipt; timed-out calls show the configured timeout. Historical calls have no recorded latency.
    </p></details>
    {loading && <p role="status">{rows ? 'Refreshing model invocations…' : 'Loading model invocations…'}</p>}
    {error && <p role="alert">{error} Use Refresh ledger to retry.{rows && ' Showing previously loaded data.'}</p>}
    {rows && <>
      <div className="operator-usage-table-wrap" tabIndex={0} role="region" aria-label="Invocation summary">
        <table className="operator-usage-table operator-ledger-summary">
          <caption>Invocation totals · UTC calendar days</caption>
          <thead><tr><th scope="col">Period</th><th scope="col">Invocations</th><th scope="col">Known spend (USD)</th><th scope="col">Unknown spend count</th></tr></thead>
          <tbody>{summaries.map((summary) => <tr key={summary.label}><th scope="row">{summary.label}</th><td>{summary.count}</td>
            <td>{summary.count > 0 && summary.unknownCount === summary.count ? 'Unknown' : formatInvocationSpend(summary.knownSpendUsd)}</td><td>{summary.unknownCount}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="operator-ledger-controls">
        <label className="operator-ledger-checkbox"><input type="checkbox" checked={shadeFailures} onChange={(event) => setShadeFailures(event.target.checked)} />Shade failures</label>
        <button type="button" className="secondary-button" onClick={() => changeFilters({ from: '', to: '', discrete: {}, numeric: {} })}>Clear all filters</button>
        {groupBy && <button type="button" className="secondary-button" onClick={() => changeGroup('')}>Remove grouping</button>}
      </div>
      <p className="notes">Use column headers to sort, group or filter. Dates: {filters.from || 'beginning'} through {filters.to || 'latest'} (UTC).</p>
      <div className="operator-usage-table-wrap" tabIndex={0} role="region" aria-label="Model invocation results">
        <ModelInvocationTable rows={ordered.slice(0, visibleCount)} headers={headers} groupBy={groupBy} allSelectedRows={selected} shadeFailures={shadeFailures} />
      </div>
      {selected.length === 0 && <p>No model invocations match these filters.</p>}
      <div ref={sentinel} className="operator-ledger-load-more">
        <p role="status">Showing {Math.min(visibleCount, ordered.length)} of {ordered.length} calls</p>
        {canLoadMore && <button type="button" className="secondary-button" onClick={() => setVisibleCount((current) => nextInvocationLimit(current, ordered.length))}>Load more calls</button>}
      </div>
      {column && <InvocationColumnDialog key={column.key} column={column} rows={rows} filters={filters} sortBy={sortBy} direction={direction} groupBy={groupBy}
        onFilters={changeFilters} onSort={changeSort} onGroup={changeGroup} onClose={() => setActiveColumn(null)} />}
    </>}
  </section>;
}

export function ModelInvocationTable({ rows, headers, groupBy = '', allSelectedRows = rows, shadeFailures = false }: {
  rows: ModelInvocationRow[]; headers?: ReactNode; groupBy?: InvocationGroup | ''; allSelectedRows?: ModelInvocationRow[]; shadeFailures?: boolean;
}) {
  const groupSummaries = new Map<string, ReturnType<typeof summarizeInvocations>>();
  if (groupBy) {
    const grouped = new Map<string, ModelInvocationRow[]>();
    for (const row of allSelectedRows) {
      const key = invocationGroupKey(row, groupBy);
      const values = grouped.get(key) ?? []; values.push(row); grouped.set(key, values);
    }
    for (const [key, values] of grouped) groupSummaries.set(key, summarizeInvocations(values));
  }
  function groupLabel(row: ModelInvocationRow): ReactNode {
    if (groupBy === 'learnerId') return <InvocationUser learnerId={row.learnerId} displayName={row.userDisplayName} />;
    if (groupBy === 'status') return invocationStatusLabels[row.status];
    if (groupBy === 'spendUsd') return row.spendUsd === null ? 'Unknown spend' : `$${row.spendUsd} USD`;
    if (groupBy === 'latencyMs') return row.latencyMs === null ? 'Unknown latency' : `${row.latencyMs} ms`;
    return groupBy ? invocationGroupKey(row, groupBy).replaceAll('_', ' ') : '';
  }
  return <table className="operator-usage-table operator-ledger-table">
    <caption>Model calls · timestamps in UTC{groupBy ? ` · grouped by ${INVOCATION_COLUMNS.find((item) => item.group === groupBy)?.label.toLowerCase()}` : ''}</caption>
    <thead><tr>{headers ?? INVOCATION_COLUMNS.map((column) => <th key={column.key} scope="col">{column.label}</th>)}</tr></thead>
    <tbody>{rows.map((row, index) => {
      const key = groupBy ? invocationGroupKey(row, groupBy) : '';
      const summary = groupSummaries.get(key);
      const startGroup = groupBy && (index === 0 || key !== invocationGroupKey(rows[index - 1], groupBy));
      return <Fragment key={row.id}>
        {startGroup && summary && <tr className="operator-ledger-group"><th colSpan={7} scope="rowgroup">{groupLabel(row)}<span className="operator-ledger-secondary">
          {summary.count} calls · {summary.unknownCount === summary.count ? 'Unknown' : formatInvocationSpend(summary.knownSpendUsd)} known spend · {summary.unknownCount} unknown spend
        </span></th></tr>}
        <tr className={shadeFailures && isFailedInvocation(row) ? 'operator-ledger-failure' : undefined}>
          <td><time dateTime={row.timestamp}>{row.timestamp.replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, '')}</time></td>
          <td>{row.model}<span className="operator-ledger-secondary">{row.provider}</span></td>
          <td>{row.invocationType.replaceAll('_', ' ')}</td>
          <td>{formatInvocationSpend(row.spendUsd)}{row.spendUsd !== null && <span className="operator-ledger-secondary">{row.spendSource}</span>}</td>
          <td><InvocationUser learnerId={row.learnerId} displayName={row.userDisplayName} /></td><td>{formatInvocationLatency(row.latencyMs)}</td><td>{invocationStatusLabels[row.status]}</td>
        </tr>
      </Fragment>;
    })}</tbody>
  </table>;
}

function InvocationUser({ learnerId, displayName }: { learnerId: string; displayName: string | null }) {
  return <>{displayName || learnerId}{displayName && <span className="operator-ledger-secondary">{learnerId}</span>}</>;
}
