import { useEffect, useState } from 'react';
import {
  fetchOperatorUsagePulse,
  type UsageDailySnapshot,
  type UsagePulsePayload,
} from '../services/api';

export function OperatorUsagePulsePage() {
  const [payload, setPayload] = useState<UsagePulsePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const next = await fetchOperatorUsagePulse();
        if (!cancelled) setPayload(next);
      } catch (err) {
        if (!cancelled) {
          setPayload(null);
          setError(err instanceof Error ? err.message : 'Failed to load usage pulse');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = payload ? [...payload.days, payload.today] : [];

  return (
    <section className="panel operator-usage-pulse">
      <h2>Usage pulse</h2>
      <p className="notes">
        Operator-only cohort view. Historical days are daily snapshots; today is live.
        Stash median is as-of each snapshot&apos;s capture time.
      </p>
      {loading ? <p className="notes">Loading…</p> : null}
      {error ? <p className="notes">{error}</p> : null}
      {payload ? (
        <>
          <div className="operator-usage-tiles">
            <MetricTile label="DAU (today)" value={formatInt(payload.today.dau)} />
            <MetricTile label="Sessions (today)" value={formatInt(payload.today.sessionsCompleted)} />
            <MetricTile label="New words (today)" value={formatInt(payload.today.newWords)} />
            <MetricTile label="Model spend (today)" value={formatUsd(payload.today.modelSpendUsd)} />
            <MetricTile label="Median stash" value={formatNullableNumber(payload.today.medianStashSize)} />
            <MetricTile
              label="Median session time"
              value={formatDuration(payload.today.medianSessionActiveMs)}
            />
          </div>

          <h3>Sparse signals (today)</h3>
          <ul className="notes">
            <li>Inactive learners (0 completes in 7d): {payload.today.learnersInactive7d}</li>
            <li>Abandoned sessions: {payload.today.sessionsAbandoned}</li>
            <li>Learners with spend and 0 accepts: {payload.today.learnersSpendWithoutAccepts}</li>
            <li>Study-commit failures: {payload.today.studyCommitFailures}</li>
          </ul>

          <h3>Last 7 completed days + today</h3>
          <div className="operator-usage-table-wrap">
            <table className="operator-usage-table">
              <thead>
                <tr>
                  <th>Day (UTC)</th>
                  <th>DAU</th>
                  <th>Sessions</th>
                  <th>New words</th>
                  <th>Spend</th>
                  <th>Med stash</th>
                  <th>Med session</th>
                  <th>Inactive 7d</th>
                  <th>Abandoned</th>
                  <th>Spend∅accept</th>
                  <th>Commit fail</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <SnapshotRow
                    key={`${row.dayKey}:${row.capturedAt}`}
                    row={row}
                    isToday={row.dayKey === payload.today.dayKey}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <p className="notes">Generated at {payload.generatedAt}</p>
        </>
      ) : null}
    </section>
  );
}

function SnapshotRow({ row, isToday }: { row: UsageDailySnapshot; isToday: boolean }) {
  return (
    <tr>
      <td>{row.dayKey}{isToday ? ' (live)' : ''}</td>
      <td>{formatInt(row.dau)}</td>
      <td>{formatInt(row.sessionsCompleted)}</td>
      <td>{formatInt(row.newWords)}</td>
      <td>{formatUsd(row.modelSpendUsd)}</td>
      <td>{formatNullableNumber(row.medianStashSize)}</td>
      <td>{formatDuration(row.medianSessionActiveMs)}</td>
      <td>{formatInt(row.learnersInactive7d)}</td>
      <td>{formatInt(row.sessionsAbandoned)}</td>
      <td>{formatInt(row.learnersSpendWithoutAccepts)}</td>
      <td>{formatInt(row.studyCommitFailures)}</td>
    </tr>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="operator-usage-tile">
      <div className="operator-usage-tile-label">{label}</div>
      <div className="operator-usage-tile-value">{value}</div>
    </div>
  );
}

function formatInt(value: number): string {
  return String(value);
}

function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}

function formatNullableNumber(value: number | null): string {
  if (value === null) return '—';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatDuration(valueMs: number | null): string {
  if (valueMs === null) return '—';
  const totalSeconds = Math.round(valueMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}
