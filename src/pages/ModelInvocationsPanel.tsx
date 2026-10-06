import { useEffect, useState, type FormEvent } from 'react';
import type { ModelInvocationRow } from '../domain/model-invocations';
import { fetchModelInvocations } from '../services/api';
import { formatInvocationLatency, invocationStatusLabels, formatInvocationSpend, groupInvocations, invocationDateRange, sortInvocations, summarizeInvocations, type InvocationGroup, type InvocationSort } from './model-invocation-presentation';

const PAGE_SIZE = 50;
const GROUP_LABELS: Record<InvocationGroup, string> = { day: 'Day (UTC)', model: 'Model', invocationType: 'Invocation type', learnerId: 'User' };

export function ModelInvocationsPanel() {
  const [range, setRange] = useState(invocationDateRange);
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [rows, setRows] = useState<ModelInvocationRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [groupBy, setGroupBy] = useState<InvocationGroup | ''>('');
  const [sortBy, setSortBy] = useState<InvocationSort>('timestamp');
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc');
  const [groupSort, setGroupSort] = useState<'key' | 'count' | 'knownSpendUsd'>('knownSpendUsd');
  const [page, setPage] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRows(null);
    void fetchModelInvocations(range.from, range.to).then((payload) => {
      if (!cancelled) setRows(payload.rows);
    }).catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load model invocations.');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range, refresh]);

  const invalidDates = !from || !to || from > to;
  function applyRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (invalidDates) return;
    setPage(0);
    setRange({ from, to });
  }
  const summary = summarizeInvocations(rows ?? []);
  const sorted = sortInvocations(rows ?? [], sortBy, direction);
  const groups = groupBy ? groupInvocations(rows ?? [], groupBy).sort((a, b) => {
    const comparison = groupSort === 'key' ? a.key.localeCompare(b.key) : a[groupSort] - b[groupSort];
    return (direction === 'asc' ? comparison : -comparison) || a.key.localeCompare(b.key);
  }) : [];
  const total = groupBy ? groups.length : sorted.length;
  const visiblePage = Math.min(page, Math.max(0, Math.ceil(total / PAGE_SIZE) - 1));
  const offset = visiblePage * PAGE_SIZE;

  return <section aria-labelledby="model-invocations-heading">
    <div className="section-heading">
      <h2 id="model-invocations-heading">Model invocations</h2>
      <button className="secondary-button" type="button" disabled={loading} onClick={() => setRefresh((value) => value + 1)}>Refresh ledger</button>
    </div>
    <form className="operator-ledger-controls" onSubmit={applyRange}>
      <label>From (UTC)<input type="date" required value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} /></label>
      <label>Through (UTC)<input type="date" required value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} /></label>
      <button className="secondary-button" type="submit" disabled={loading || invalidDates}>Apply dates</button>
      {from && to && from > to && <p role="alert">The start date must be on or before the end date.</p>}
    </form>
    <details className="operator-spend-notes"><summary>Coverage and spend</summary><p className="notes">
      Production calls recorded since the ledger was introduced; older calls are not backfilled.
      Each invocation belongs to the user who initiated the work, including shared content preparation.
      Dates include both UTC days. Spend is in USD: provider-reported cost takes precedence over token-based estimates.
      Unknown spend is excluded from sums, so totals may be incomplete. Running and failed calls are included. Latency measures the provider request through response receipt; timed-out calls show the configured timeout. Later response validation can change Completed to Invalid response. Historical calls have no recorded latency.
    </p></details>
    {loading && <p role="status">Loading model invocations…</p>}
    {error && <p role="alert">{error} Use Refresh ledger to retry.</p>}
    {rows && <>
      <p className="notes">{range.from} through {range.to} (UTC)</p>
      <div className="operator-usage-tiles">
        <LedgerMetric label="Invocations" value={String(summary.count)} />
        <LedgerMetric label="Known spend (USD)" value={summary.count > 0 && summary.unknownCount === summary.count ? 'Unknown' : formatInvocationSpend(summary.knownSpendUsd)} />
        <LedgerMetric label="Reported / estimated calls" value={`${summary.reportedCount} / ${summary.estimatedCount}`} />
        <LedgerMetric label="Calls with unknown spend" value={String(summary.unknownCount)} />
      </div>
      <div className="operator-ledger-controls">
        <label>Group by<select value={groupBy} onChange={(event) => { setGroupBy(event.target.value as InvocationGroup | ''); setPage(0); }}>
          <option value="">Individual calls</option>
          {Object.entries(GROUP_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        {groupBy ? <label>Sort groups<select value={groupSort} onChange={(event) => { setGroupSort(event.target.value as typeof groupSort); setPage(0); }}>
          <option value="key">{GROUP_LABELS[groupBy]}</option><option value="count">Invocations</option><option value="knownSpendUsd">Known spend</option>
        </select></label> : <label>Sort calls<select value={sortBy} onChange={(event) => { setSortBy(event.target.value as InvocationSort); setPage(0); }}>
          <option value="timestamp">Timestamp</option><option value="model">Model</option><option value="invocationType">Invocation type</option><option value="spendUsd">Spend</option><option value="latencyMs">Latency</option><option value="learnerId">User</option>
        </select></label>}
        <label>Order<select value={direction} onChange={(event) => { setDirection(event.target.value as typeof direction); setPage(0); }}>
          <option value="desc">Descending</option><option value="asc">Ascending</option>
        </select></label>
      </div>
      {rows.length === 0 ? <p>No model invocations recorded in this date range.</p> : <>
        <div className="operator-usage-table-wrap" tabIndex={0} role="region" aria-label="Model invocation results">
          {groupBy ? <table className="operator-usage-table operator-ledger-table">
            <caption>Totals by {GROUP_LABELS[groupBy].toLowerCase()} · all calls in the applied date range</caption>
            <thead><tr><th scope="col">{GROUP_LABELS[groupBy]}</th><th scope="col">Invocations</th><th scope="col">Known spend (USD)</th><th scope="col">Reported</th><th scope="col">Estimated</th><th scope="col">Unknown spend</th></tr></thead>
            <tbody>{groups.slice(offset, offset + PAGE_SIZE).map((group) => <tr key={group.key}>
              <th scope="row">{groupBy === 'learnerId' ? <InvocationUser learnerId={group.key} displayName={rows.find((row) => row.learnerId === group.key)?.userDisplayName ?? null} /> : group.key}</th><td>{group.count}</td><td>{group.unknownCount === group.count ? 'Unknown' : formatInvocationSpend(group.knownSpendUsd)}</td><td>{group.reportedCount}</td><td>{group.estimatedCount}</td><td>{group.unknownCount}</td>
            </tr>)}</tbody>
          </table> : <ModelInvocationTable rows={sorted.slice(offset, offset + PAGE_SIZE)} />}
        </div>
        <nav className="operator-ledger-controls" aria-label="Model invocation pages">
          <button className="secondary-button" type="button" disabled={visiblePage === 0} onClick={() => setPage(visiblePage - 1)}>Previous</button>
          <span>{offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total} {groupBy ? 'groups' : 'calls'}</span>
          <button className="secondary-button" type="button" disabled={offset + PAGE_SIZE >= total} onClick={() => setPage(visiblePage + 1)}>Next</button>
        </nav>
      </>}
    </>}
  </section>;
}

function LedgerMetric({ label, value }: { label: string; value: string }) {
  return <div className="operator-usage-tile"><div className="operator-usage-tile-label">{label}</div><div className="operator-usage-tile-value">{value}</div></div>;
}

export function ModelInvocationTable({ rows }: { rows: ModelInvocationRow[] }) {
  return <table className="operator-usage-table operator-ledger-table">
    <caption>Individual model calls · timestamps in UTC</caption>
    <thead><tr><th scope="col">Timestamp (UTC)</th><th scope="col">Model</th><th scope="col">Invocation type</th><th scope="col">Spend (USD)</th><th scope="col">User</th><th scope="col">Latency</th><th scope="col">Status</th></tr></thead>
    <tbody>{rows.map((row) => <tr key={row.id}>
      <td><time dateTime={row.timestamp}>{row.timestamp.replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, '')}</time></td>
      <td>{row.model}<span className="operator-ledger-secondary">{row.provider}</span></td>
      <td>{row.invocationType.replaceAll('_', ' ')}</td>
      <td>{formatInvocationSpend(row.spendUsd)}{row.spendUsd !== null && <span className="operator-ledger-secondary">{row.spendSource}</span>}</td>
      <td><InvocationUser learnerId={row.learnerId} displayName={row.userDisplayName} /></td><td>{formatInvocationLatency(row.latencyMs)}</td><td>{invocationStatusLabels[row.status]}</td>
    </tr>)}</tbody>
  </table>;
}

function InvocationUser({ learnerId, displayName }: { learnerId: string; displayName: string | null }) {
  return <>{displayName || learnerId}{displayName && <span className="operator-ledger-secondary">{learnerId}</span>}</>;
}
