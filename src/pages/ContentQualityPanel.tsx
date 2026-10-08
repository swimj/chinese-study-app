import { useEffect, useState } from 'react';
import {
  CONTENT_QUALITY_KINDS,
  type ContentQualityBreakdown,
  type ContentQualityKind,
  type ContentQualityRatingEntry,
  type ContentQualityRatedSnapshot,
} from '../domain/content-quality';
import { fetchContentQualityRatingLedger } from '../services/api';
import { ContentImprovementWorkspace, type ImprovementSelection } from './ContentImprovementWorkspace';
import { contentQualityTextBlocks } from './content-quality-presentation';

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
  const [payload, setPayload] = useState<Awaited<ReturnType<typeof fetchContentQualityRatingLedger>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [kind, setKind] = useState<ContentQualityKind | ''>('');
  const [rating, setRating] = useState<'up' | 'down' | ''>('');
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<'updatedAt' | 'title' | 'kind' | 'rating' | 'up' | 'down' | 'totalRatings'>('updatedAt');
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc');
  const [view, setView] = useState<'ratings' | 'snapshot'>('ratings');
  const [dateWindow, setDateWindow] = useState(lastSevenUtcDays);

  function improve(item: Pick<ContentQualityRatingEntry, 'kind' | 'sourceId' | 'contentKey'>) {
    setImprovementSelection({ kind: item.kind, sourceId: item.sourceId, contentKey: item.contentKey });
    document.getElementById('content-improvement-workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPayload(null);
    void fetchContentQualityRatingLedger().then((next) => {
      if (!cancelled) setPayload(next);
    }).catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load content quality.');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [refresh]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const selectedRatings = (payload?.ratings ?? []).filter((entry) =>
    (!kind || entry.kind === kind) && (!rating || entry.rating === rating)
    && (!dateWindow.from || entry.updatedAt >= `${dateWindow.from}T00:00:00.000Z`)
    && (!dateWindow.through || entry.updatedAt < `${addUtcDays(dateWindow.through, 1)}T00:00:00.000Z`)
    && (!normalizedQuery || `${entry.title} ${JSON.stringify(entry.content)}`.toLocaleLowerCase().includes(normalizedQuery)));
  const orderedRatings = [...selectedRatings].sort((a, b) => {
    const left = sortBy === 'updatedAt' ? a.updatedAt : sortBy === 'title' ? a.title : sortBy === 'kind' ? a.kind : sortBy === 'rating' ? a.rating : '';
    const right = sortBy === 'updatedAt' ? b.updatedAt : sortBy === 'title' ? b.title : sortBy === 'kind' ? b.kind : sortBy === 'rating' ? b.rating : '';
    const compared = left.localeCompare(right);
    return (direction === 'asc' ? compared : -compared) || a.contentKey.localeCompare(b.contentKey);
  });
  const snapshotsByKey = new Map<string, ContentQualityRatedSnapshot>();
  for (const entry of selectedRatings) {
    let snapshot = snapshotsByKey.get(entry.contentKey);
    if (!snapshot) {
      snapshot = { contentKey: entry.contentKey, kind: entry.kind, sourceId: entry.sourceId, title: entry.title, content: entry.content, up: 0, down: 0, totalRatings: 0, updatedAt: entry.updatedAt };
      snapshotsByKey.set(entry.contentKey, snapshot);
    }
    snapshot[entry.rating] += 1;
    snapshot.totalRatings += 1;
    if (entry.updatedAt > snapshot.updatedAt) snapshot.updatedAt = entry.updatedAt;
  }
  const orderedSnapshots = [...snapshotsByKey.values()].sort((a, b) => {
    const left = sortBy === 'updatedAt' ? a.updatedAt : sortBy === 'title' ? a.title : sortBy === 'kind' ? a.kind : a[sortBy === 'rating' ? 'totalRatings' : sortBy];
    const right = sortBy === 'updatedAt' ? b.updatedAt : sortBy === 'title' ? b.title : sortBy === 'kind' ? b.kind : b[sortBy === 'rating' ? 'totalRatings' : sortBy];
    const compared = typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right));
    return (direction === 'asc' ? compared : -compared) || a.contentKey.localeCompare(b.contentKey);
  });

  function changeView(next: 'ratings' | 'snapshot') {
    setView(next);
    setSortBy(next === 'ratings' ? 'updatedAt' : 'totalRatings');
    setDirection('desc');
  }

  return <section className="content-quality-panel" aria-labelledby="content-quality-heading">
    <div className="section-heading">
      <h2 id="content-quality-heading">Content quality ratings</h2>
      <button type="button" className="secondary-button" disabled={loading} onClick={() => setRefresh((value) => value + 1)}>Refresh ratings</button>
    </div>
    <p className="notes">Latest saved votes, one per learner and exact content version. Changing a vote updates its time; clearing a vote removes it.</p>
    {loading && <p role="status">Loading content quality…</p>}
    {error && <p role="alert">{error} Use Refresh ratings to retry.</p>}
    {payload && <>
      <div className="operator-usage-tiles"><QualityMetric label="Ratings matching filters" value={String(selectedRatings.length)} /></div>
      <div className="operator-usage-table-wrap">
        <table className="operator-usage-table content-quality-table">
          <caption>Ratings · last 7 UTC days by default · <label>View <select aria-label="Table view" value={view} onChange={(event) => changeView(event.target.value as 'ratings' | 'snapshot')}>
            <option value="ratings">Latest ratings</option><option value="snapshot">Aggregate by snapshot</option>
          </select></label></caption>
          <thead><tr>
            <th scope="col" aria-sort={sortBy === 'updatedAt' ? direction === 'asc' ? 'ascending' : 'descending' : 'none'}><SortButton label={view === 'ratings' ? 'Changed (UTC)' : 'Latest rating (UTC)'} active={sortBy === 'updatedAt'} direction={direction} onClick={() => toggleSort('updatedAt', sortBy, direction, setSortBy, setDirection)} /></th>
            <th scope="col" aria-sort={sortBy === 'title' ? direction === 'asc' ? 'ascending' : 'descending' : 'none'}><SortButton label="Item" active={sortBy === 'title'} direction={direction} onClick={() => toggleSort('title', sortBy, direction, setSortBy, setDirection)} /></th>
            <th scope="col" aria-sort={sortBy === 'kind' ? direction === 'asc' ? 'ascending' : 'descending' : 'none'}><SortButton label="Type" active={sortBy === 'kind'} direction={direction} onClick={() => toggleSort('kind', sortBy, direction, setSortBy, setDirection)} /></th>
            {view === 'ratings' ? <th scope="col" aria-sort={sortBy === 'rating' ? direction === 'asc' ? 'ascending' : 'descending' : 'none'}><SortButton label="Vote" active={sortBy === 'rating'} direction={direction} onClick={() => toggleSort('rating', sortBy, direction, setSortBy, setDirection)} /></th> : <>
              <th scope="col" aria-sort={sortBy === 'up' ? direction === 'asc' ? 'ascending' : 'descending' : 'none'}><SortButton label="Useful" active={sortBy === 'up'} direction={direction} onClick={() => toggleSort('up', sortBy, direction, setSortBy, setDirection)} /></th>
              <th scope="col" aria-sort={sortBy === 'down' ? direction === 'asc' ? 'ascending' : 'descending' : 'none'}><SortButton label="Needs work" active={sortBy === 'down'} direction={direction} onClick={() => toggleSort('down', sortBy, direction, setSortBy, setDirection)} /></th>
              <th scope="col" aria-sort={sortBy === 'totalRatings' ? direction === 'asc' ? 'ascending' : 'descending' : 'none'}><SortButton label="Rated pairs" active={sortBy === 'totalRatings'} direction={direction} onClick={() => toggleSort('totalRatings', sortBy, direction, setSortBy, setDirection)} /></th>
            </>}
          </tr></thead>
          <tbody><tr className="content-quality-filter-row">
            <td><label className="content-quality-date-filter"><span>From</span><input aria-label="Ratings from (UTC)" type="date" value={dateWindow.from} max={dateWindow.through || undefined} onChange={(event) => setDateWindow({ ...dateWindow, from: event.target.value })} />
              <span>Through</span><input aria-label="Ratings through (UTC)" type="date" value={dateWindow.through} min={dateWindow.from || undefined} onChange={(event) => setDateWindow({ ...dateWindow, through: event.target.value })} /></label></td>
            <td><label className="content-quality-visually-hidden" htmlFor="quality-item-filter">Filter item details</label><input id="quality-item-filter" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter item" /></td>
            <td><label className="content-quality-visually-hidden" htmlFor="quality-kind-filter">Filter content type</label><select id="quality-kind-filter" value={kind} onChange={(event) => setKind(event.target.value as ContentQualityKind | '')}>
              <option value="">All types</option>{CONTENT_QUALITY_KINDS.map((value) => <option key={value} value={value}>{KIND_LABELS[value]}</option>)}
            </select></td>
            {view === 'ratings' ? <td><label className="content-quality-visually-hidden" htmlFor="quality-vote-filter">Filter vote</label><select id="quality-vote-filter" value={rating} onChange={(event) => setRating(event.target.value as 'up' | 'down' | '')}>
              <option value="">All votes</option><option value="up">Useful</option><option value="down">Needs work</option>
            </select></td> : <td colSpan={3}><label className="content-quality-visually-hidden" htmlFor="quality-vote-filter">Filter ratings included in aggregate</label><select id="quality-vote-filter" value={rating} onChange={(event) => setRating(event.target.value as 'up' | 'down' | '')}>
              <option value="">All votes</option><option value="up">Useful only</option><option value="down">Needs work only</option>
            </select><span className="content-quality-filter-note">Filter which votes are counted.</span></td>}
          </tr>{view === 'ratings' ? orderedRatings.map((entry, index) => <RatingRow key={`${entry.contentKey}:${entry.updatedAt}:${index}`} entry={entry} onImprove={improve} />)
            : orderedSnapshots.map((item) => <SnapshotRow key={item.contentKey} item={item} onImprove={improve} />)}</tbody>
        </table>
      </div>
      {view === 'ratings' ? orderedRatings.length === 0 && <p>No current ratings match these filters.</p> : orderedSnapshots.length === 0 && <p>No rated snapshots match these filters.</p>}
    </>}
    <ContentImprovementWorkspace selection={improvementSelection} />
  </section>;
}

function lastSevenUtcDays() {
  const today = new Date().toISOString().slice(0, 10);
  return { from: addUtcDays(today, -6), through: today };
}

function addUtcDays(day: string, offset: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function toggleSort<K extends 'updatedAt' | 'title' | 'kind' | 'rating' | 'up' | 'down' | 'totalRatings'>(key: K, current: K, direction: 'asc' | 'desc', setKey: (value: K) => void, setDirection: (value: 'asc' | 'desc') => void) {
  setKey(key); setDirection(current === key && direction === 'desc' ? 'asc' : 'desc');
}

function SortButton({ label, active, direction, onClick }: { label: string; active: boolean; direction: 'asc' | 'desc'; onClick: () => void }) {
  return <button type="button" className="operator-column-button" onClick={onClick}>{label}{active ? direction === 'asc' ? ' ↑' : ' ↓' : ' ▾'}</button>;
}

function RatingRow({ entry, onImprove }: { entry: ContentQualityRatingEntry; onImprove: (item: Pick<ContentQualityRatingEntry, 'kind' | 'sourceId' | 'contentKey'>) => void }) {
  const textBlocks = contentQualityTextBlocks(entry.content);
  return <tr>
    <td><time dateTime={entry.updatedAt}>{entry.updatedAt.replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, '')}</time></td>
    <th scope="row" className="content-quality-title"><details><summary>{entry.title}</summary>
      <dl className="content-quality-readable">{textBlocks.map((block, index) => <div key={index}><dt>{block.label}</dt><dd>{block.text}</dd></div>)}</dl>
      <button type="button" className="secondary-button" onClick={() => onImprove(entry)}>Improve this item</button>
      <details><summary>Exact content snapshot (JSON)</summary><pre className="content-quality-snapshot">{JSON.stringify(entry.content, null, 2)}</pre></details>
    </details></th>
    <td>{KIND_LABELS[entry.kind]}</td><td>{entry.rating === 'up' ? 'Useful' : 'Needs work'}</td>
  </tr>;
}

function SnapshotRow({ item, onImprove }: { item: ContentQualityRatedSnapshot; onImprove: (item: Pick<ContentQualityRatingEntry, 'kind' | 'sourceId' | 'contentKey'>) => void }) {
  const textBlocks = contentQualityTextBlocks(item.content);
  return <tr><td><time dateTime={item.updatedAt}>{item.updatedAt.replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, '')}</time></td><th scope="row" className="content-quality-title"><details><summary>{item.title}</summary>
    <dl className="content-quality-readable">{textBlocks.map((block, index) => <div key={index}><dt>{block.label}</dt><dd>{block.text}</dd></div>)}</dl>
    <button type="button" className="secondary-button" onClick={() => onImprove(item)}>Improve this item</button>
    <details><summary>Exact content snapshot (JSON)</summary><pre className="content-quality-snapshot">{JSON.stringify(item.content, null, 2)}</pre></details>
  </details></th><td>{KIND_LABELS[item.kind]}</td><td>{item.up}</td><td>{item.down}</td><td>{item.totalRatings}</td></tr>;
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
