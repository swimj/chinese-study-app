import { Fragment, useEffect, useState, type FormEvent } from 'react';
import {
  CONTENT_QUALITY_KINDS,
  type ContentQualityAnalytics,
  type ContentQualityBreakdown,
  type ContentQualityFilters,
  type ContentQualityItem,
  type ContentQualityKind,
} from '../domain/content-quality';
import { fetchContentQualityStats } from '../services/api';
import { ContentImprovementWorkspace, type ImprovementSelection } from './ContentImprovementWorkspace';
import { contentQualityTextBlocks } from './content-quality-presentation';

const PAGE_SIZE = 25;
const KIND_LABELS: Record<ContentQualityKind, string> = {
  production_cue: 'Production cue',
  pure_cue: 'Pure cue',
  contrast_prompt: 'Contrast prompt',
  teaching_package: 'Word introduction',
  rehearsal: 'Word rehearsal',
  supplement: 'Supplement',
};
const SOURCE_LABELS: Record<string, string> = {
  reflection: 'Session reflection',
  manual: 'Manually authored',
  'prepared review': 'Prepared review generation',
  'served pure cue': 'Pure cue (served version)',
  'teaching package': 'Prepared word teaching',
  'production supplement': 'Production supplement',
  'contrast prompt': 'Contrast prompt',
};

function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? (source || 'Unknown source');
}

function percent(numerator: number, denominator: number): string {
  return denominator === 0 ? '—' : `${(100 * numerator / denominator).toFixed(1)}%`;
}

export function ContentQualityPanel() {
  const [improvementSelection, setImprovementSelection] = useState<ImprovementSelection | null>(null);
  function improve(item: ContentQualityItem) {
    setImprovementSelection({ kind: item.kind, sourceId: item.sourceId, contentKey: item.contentKey });
    document.getElementById('content-improvement-workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  const [kind, setKind] = useState<ContentQualityKind | ''>('');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [filters, setFilters] = useState<ContentQualityFilters>({ limit: PAGE_SIZE, offset: 0 });
  const [payload, setPayload] = useState<ContentQualityAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPayload(null);
    void fetchContentQualityStats(filters).then((next) => {
      if (!cancelled) setPayload(next);
    }).catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load content quality.');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [filters, refresh]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFilters({ kind: kind || undefined, since: since || undefined, until: until || undefined, limit: PAGE_SIZE, offset: 0 });
  }

  const invalidDates = Boolean(since && until && since > until);
  const offset = filters.offset ?? 0;

  return <section className="content-quality-panel" aria-labelledby="content-quality-heading">
    <div className="section-heading">
      <h2 id="content-quality-heading">Content quality</h2>
      <button type="button" className="secondary-button" disabled={loading} onClick={() => setRefresh((value) => value + 1)}>Refresh quality</button>
    </div>
    <p className="notes">
      Immediate learner impressions of exact content versions. Each learner has one current vote per version,
      shared across encounters. These votes do not change study behavior.
    </p>
    <form className="content-quality-filters" onSubmit={applyFilters}>
      <label>Content type
        <select value={kind} onChange={(event) => setKind(event.target.value as ContentQualityKind | '')}>
          <option value="">All content</option>
          {CONTENT_QUALITY_KINDS.map((value) => <option key={value} value={value}>{KIND_LABELS[value]}</option>)}
        </select>
      </label>
      <label>Seen from (UTC)
        <input type="date" value={since} max={until || undefined} onChange={(event) => setSince(event.target.value)} />
      </label>
      <label>Seen through (UTC)
        <input type="date" value={until} min={since || undefined} onChange={(event) => setUntil(event.target.value)} />
      </label>
      <button type="submit" className="secondary-button" disabled={loading || invalidDates}>Apply filters</button>
      {invalidDates && <p role="alert">The start date must be on or before the end date.</p>}
    </form>
    <p className="notes content-quality-definition">
      Dates include both UTC days and select encounters. Votes are the current standing votes of learners who saw
      that content in the selected period, even if they voted later. Coverage is rated learner–content pairs ÷
      seen learner–content pairs. Thumbs-down share is down votes ÷ all votes; unrated content is not a positive vote.
    </p>
    {loading && <p role="status">Loading content quality…</p>}
    {error && <p role="alert">{error} Use Refresh quality to retry.</p>}
    {payload && <>
      <div className="operator-usage-tiles">
        <QualityMetric label="Displays" value={String(payload.totals.exposures)} />
        <QualityMetric label="Seen learner–content pairs" value={String(payload.totals.learnerContentPairs)} />
        <QualityMetric label="Current votes" value={String(payload.totals.up + payload.totals.down)} />
        <QualityMetric label="Rating coverage" value={percent(payload.totals.ratedLearners, payload.totals.learnerContentPairs)} />
        <QualityMetric label="Thumbs up / down" value={`${payload.totals.up} / ${payload.totals.down}`} />
        <QualityMetric label="Down share of votes" value={percent(payload.totals.down, payload.totals.up + payload.totals.down)} />
      </div>
      <ContentQualityBreakdowns groups={payload.breakdowns} />
      {payload.totalItems === 0 ? <p>No content displays recorded for these filters yet.</p> : <>
        <div className="operator-usage-table-wrap">
          <table className="operator-usage-table content-quality-table">
            <caption>Content triage · {payload.totalItems} content versions · most down votes first, then displays</caption>
            <thead><tr>
              <th scope="col">Content</th><th scope="col">Type</th><th scope="col">Displays</th>
              <th scope="col">Learners seen</th><th scope="col">Up</th><th scope="col">Down</th>
              <th scope="col">Coverage</th><th scope="col">Down / votes</th>
            </tr></thead>
            <tbody>{payload.items.map((item) => <QualityRow key={item.contentKey} item={item} onImprove={improve} />)}</tbody>
          </table>
        </div>
        <nav className="content-quality-pagination" aria-label="Content quality pages">
          <button type="button" className="secondary-button" disabled={offset === 0} onClick={() => setFilters({ ...filters, offset: Math.max(0, offset - PAGE_SIZE) })}>Previous</button>
          <span>{offset + 1}–{Math.min(offset + payload.items.length, payload.totalItems)} of {payload.totalItems}</span>
          <button type="button" className="secondary-button" disabled={offset + PAGE_SIZE >= payload.totalItems} onClick={() => setFilters({ ...filters, offset: offset + PAGE_SIZE })}>Next</button>
        </nav>
      </>}
    </>}
    <ContentImprovementWorkspace selection={improvementSelection} />
  </section>;
}

export function ContentQualityBreakdowns({ groups }: { groups: ContentQualityBreakdown[] }) {
  if (groups.length === 0) return null;
  return <details>
    <summary>By content type and generation source</summary>
    <p className="notes content-quality-definition">
      All content matching the applied filters, across every page. These are voluntary impressions,
      not controlled model comparisons; content and learners can differ between groups.
    </p>
    <div className="operator-usage-table-wrap">
      <table className="operator-usage-table">
        <caption>Current votes and display coverage by source</caption>
        <thead><tr>
          <th scope="col">Type</th><th scope="col">Source</th><th scope="col">Model</th>
          <th scope="col">Displays</th><th scope="col">Seen learner–content pairs</th>
          <th scope="col">Up</th><th scope="col">Down</th><th scope="col">Coverage</th><th scope="col">Down / votes</th>
        </tr></thead>
        <tbody>{groups.map((group) => <tr key={JSON.stringify([group.kind, group.source, group.model])}>
          <th scope="row">{KIND_LABELS[group.kind]}</th><td>{sourceLabel(group.source)}</td>
          <td>{group.model ?? 'Unknown / not recorded'}</td>
          <td>{group.totals.exposures}</td><td>{group.totals.learnerContentPairs}</td>
          <td>{group.totals.up}</td><td>{group.totals.down}</td>
          <td>{percent(group.totals.ratedLearners, group.totals.learnerContentPairs)}</td>
          <td>{percent(group.totals.down, group.totals.up + group.totals.down)}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </details>;
}

function QualityMetric({ label, value }: { label: string; value: string }) {
  return <div className="operator-usage-tile">
    <div className="operator-usage-tile-label">{label}</div>
    <div className="operator-usage-tile-value">{value}</div>
  </div>;
}

function QualityRow({ item, onImprove }: { item: ContentQualityItem; onImprove: (item: ContentQualityItem) => void }) {
  const textBlocks = contentQualityTextBlocks(item.content);
  return <Fragment>
    <tr>
      <th scope="row" className="content-quality-title">{item.title}</th>
      <td>{KIND_LABELS[item.kind]}</td>
      <td>{item.exposures}</td><td>{item.learnersExposed}</td><td>{item.up}</td><td>{item.down}</td>
      <td>{percent(item.ratedLearners, item.learnersExposed)}</td><td>{percent(item.down, item.up + item.down)}</td>
    </tr>
    <tr><td colSpan={8} className="content-quality-detail-cell">
      <details>
        <summary>Inspect {item.title} · {item.provenance.model ?? 'Model unknown'}</summary>
        <dl className="content-quality-readable">
          {textBlocks.map((block, index) => <div key={index}>
            <dt>{block.label}</dt><dd>{block.text}</dd>
          </div>)}
        </dl>
        <dl className="content-quality-metadata">
          <dt>Content version</dt><dd><code>{item.contentKey}</code></dd>
          <dt>Source ID</dt><dd><code>{item.sourceId}</code></dd>
          {item.wordId && <><dt>Word ID</dt><dd><code>{item.wordId}</code></dd></>}
          <dt>Generation source</dt><dd>{sourceLabel(item.provenance.source)}</dd>
          <dt>Model</dt><dd>{item.provenance.model ?? 'Unknown / not recorded'}</dd>
          <dt>Last seen (UTC)</dt><dd><time dateTime={item.lastSeenAt}>{item.lastSeenAt}</time></dd>
        </dl>
        <button type="button" className="secondary-button" onClick={() => onImprove(item)}>Improve this item</button>
        <details>
          <summary>Exact content snapshot (JSON)</summary>
          <pre className="content-quality-snapshot">{JSON.stringify(item.content, null, 2)}</pre>
        </details>
      </details>
    </td></tr>
  </Fragment>;
}
