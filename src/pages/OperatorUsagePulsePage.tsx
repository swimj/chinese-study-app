import { ServiceBannerPanel } from './ServiceBannerPanel';
import { ContentSharingPanel } from './ContentSharingPanel';
import { WhatsNewEditor } from './WhatsNewEditor';
import { useEffect, useState } from 'react';
import { ModelInvocationsPanel } from './ModelInvocationsPanel';
import './OperatorUsagePulsePage.css';
import { PreparationFailuresPanel } from './PreparationFailuresPanel';
import { ContentQualityPanel } from './ContentQualityPanel';
import {
  fetchOperatorUsagePulse,
  type UsageDailySnapshot,
  type UsagePulsePayload,
} from '../services/api';

const OPERATOR_TABS = [
  { id: 'usage', label: 'Usage' },
  { id: 'invocations', label: 'Model invocations' },
  { id: 'sharing', label: 'Content sharing' },
  { id: 'quality', label: 'Content quality' },
  { id: 'failures', label: 'Preparation failures' },
  { id: 'whats-new', label: 'What’s new' },
  { id: 'banner', label: 'Service banner' },
] as const;
type OperatorTab = typeof OPERATOR_TABS[number]['id'];

export function OperatorUsagePulsePage({ legacyContentEditing = true }: { legacyContentEditing?: boolean } = {}) {
  const [tab, setTab] = useState<OperatorTab>('usage');
  return <section className="panel operator-usage-pulse">
    <h2>Operator</h2>
    <div className="operator-tabs" role="tablist" aria-label="Operator views">
      {OPERATOR_TABS.map((item, index) => <button
        key={item.id} type="button" role="tab" id={`operator-tab-${item.id}`}
        aria-controls={`operator-panel-${item.id}`} aria-selected={tab === item.id}
        tabIndex={tab === item.id ? 0 : -1}
        className="secondary-button" onClick={() => setTab(item.id)}
        onKeyDown={(event) => {
          const nextIndex = event.key === 'ArrowRight' ? (index + 1) % OPERATOR_TABS.length
            : event.key === 'ArrowLeft' ? (index + OPERATOR_TABS.length - 1) % OPERATOR_TABS.length
            : event.key === 'Home' ? 0 : event.key === 'End' ? OPERATOR_TABS.length - 1 : null;
          if (nextIndex === null) return;
          event.preventDefault();
          const next = OPERATOR_TABS[nextIndex].id;
          setTab(next);
          document.getElementById(`operator-tab-${next}`)?.focus();
        }}
      >{item.label}</button>)}
    </div>
    <div role="tabpanel" id={`operator-panel-${tab}`} aria-labelledby={`operator-tab-${tab}`} tabIndex={0}>
      {tab === 'usage' && <UsagePulsePanel />}
      {tab === 'invocations' && <ModelInvocationsPanel />}
      {tab === 'sharing' && <ContentSharingPanel />}
      {tab === 'quality' && <ContentQualityPanel legacyContentEditing={legacyContentEditing} />}
      {tab === 'failures' && <PreparationFailuresPanel />}
      {tab === 'whats-new' && <WhatsNewEditor />}
      {tab === 'banner' && <ServiceBannerPanel />}
    </div>
  </section>;
}


function UsagePulsePanel() {
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
    <section>
      <h2>Usage pulse</h2>
      <p className="notes">
        Operator-only cohort view. Historical days are daily snapshots; today is live.
        Mean stash is as-of each snapshot&apos;s capture time.
      </p>
      <details><summary>Metric definitions</summary><p className="notes">
        Practice sums recorded correct-day gains in completed sessions. Missing counts
        contribute zero, so Practice is a lower bound when records are missing. Review correct and wrong count completed
        exercises without and with a lapse, including contrast and pure cues; reinforcement attempts
        do not add exercises. Session time totals active time in completed sessions. Proposals accepted
        counts acceptance events, regardless of application outcome. A dash means unavailable historical
        data.
      </p></details>
      {loading ? <p className="notes">Loading…</p> : null}
      {error ? <p className="notes">{error}</p> : null}
      {payload ? (
        <>
          <div className="operator-usage-tiles">
            <MetricTile label="DAU (today)" value={formatInt(payload.today.dau)} />
            <MetricTile label="Sessions (today)" value={formatInt(payload.today.sessionsCompleted)} />
            <MetricTile label="New words (today)" value={formatInt(payload.today.newWords)} />
            <MetricTile label="Practice (today)" value={formatNullableNumber(payload.today.practiceCompleted)} />
            <MetricTile label="Review correct (today)" value={formatInt(payload.today.reviewCorrect)} />
            <MetricTile label="Review wrong (today)" value={formatInt(payload.today.reviewWrong)} />
            <MetricTile label="Proposals accepted (today)" value={formatInt(payload.today.proposalsAccepted)} />
            <MetricTile label="Mean stash" value={formatNullableNumber(payload.today.meanStashSize)} />
            <MetricTile
              label="Total session time"
              value={formatDuration(payload.today.sessionActiveMs)}
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
          <div className="operator-usage-table-wrap" role="region" aria-label="Daily usage totals" tabIndex={0}>
            <table className="operator-usage-table">
              <thead>
                <tr>
                  <th>Day (UTC)</th>
                  <th>DAU</th>
                  <th>Sessions</th>
                  <th>New words</th>
                  <th>Practice</th>
                  <th>Review correct</th>
                  <th>Review wrong</th>
                  <th>Proposals accepted</th>
                  <th>Mean stash</th>
                  <th>Session time</th>
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
      <td>{formatNullableNumber(row.practiceCompleted)}</td>
      <td>{formatInt(row.reviewCorrect)}</td>
      <td>{formatInt(row.reviewWrong)}</td>
      <td>{formatInt(row.proposalsAccepted)}</td>
      <td>{formatNullableNumber(row.meanStashSize)}</td>
      <td>{formatDuration(row.sessionActiveMs)}</td>
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
