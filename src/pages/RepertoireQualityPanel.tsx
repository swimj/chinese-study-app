import { useEffect, useRef, useState, type ReactNode } from 'react';
import type {
  RepertoireCohort, RepertoireCueRow, RepertoireCueVersion, RepertoireModel,
  RepertoireOutcomes, RepertoirePath, RepertoireQualityDetail, RepertoireQualityPage,
  RepertoireQualityView, RepertoireRepairRow,
} from '../domain/repertoire-quality';
import { fetchRepertoireQuality, fetchRepertoireQualityDetail } from '../services/api';
import './RepertoireQualityPanel.css';

type Section = 'cohorts' | RepertoireQualityView;
type LoadResult<T> = { key: string; value: T; error?: never } | { key: string; error: string; value?: never };
type Selection = { view: RepertoireQualityView; id: string; target: string };

const sections: { id: Section; label: string }[] = [
  { id: 'cohorts', label: 'Compare cohorts' },
  { id: 'cues', label: 'Cues' },
  { id: 'repairs', label: 'Repair quality' },
];
const modelLabels: Record<RepertoireModel, string> = { sol: 'Sol', luna: 'Luna' };
const pathLabels: Record<RepertoirePath, string> = {
  practice: 'Practice preparation', reflection: 'Reflection bootstrap', bulk: 'Bulk backfill',
};
const integer = new Intl.NumberFormat();
const percentage = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 });
const dollars = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4,
});
const dateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC',
});

function DateTime({ date }: { date: string }) {
  return <time dateTime={date}>{dateTime.format(new Date(date))} UTC</time>;
}

function count(value: number) {
  return integer.format(value);
}

function fraction(numerator: number, denominator: number) {
  return denominator ? `${count(numerator)} / ${count(denominator)}` : '—';
}

function missCount(outcomes: RepertoireOutcomes) {
  return outcomes.answered - outcomes.acceptedFirst;
}

function MetricList({ metrics }: { metrics: [string, ReactNode][] }) {
  return <dl className="repertoire-quality-metrics">
    {metrics.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
  </dl>;
}

function Cell({ label, children, secondary }: { label: string; children: ReactNode; secondary?: ReactNode }) {
  return <td role="cell">
    <span className="repertoire-quality-cell-label" aria-hidden="true">{label}</span>
    <span className="repertoire-quality-value">{children}</span>
    {secondary !== undefined && <span className="repertoire-quality-secondary">{secondary}</span>}
  </td>;
}

function QualityTable({ label, headings, children }: {
  label: string; headings: [string, number][]; children: ReactNode;
}) {
  return <table className="repertoire-quality-table" role="table">
    <caption className="repertoire-quality-sr-only">{label}</caption>
    <colgroup>{headings.map(([heading, width]) => <col key={heading} style={{ width: `${width}%` }} />)}</colgroup>
    <thead role="rowgroup">
      <tr role="row">{headings.map(([heading]) => <th key={heading} scope="col" role="columnheader">{heading}</th>)}</tr>
    </thead>
    <tbody role="rowgroup">{children}</tbody>
  </table>;
}

function FirstMissMetrics({ outcomes }: { outcomes: RepertoireOutcomes }) {
  return <MetricList metrics={[
    ['Judged unfair', count(outcomes.unfairFirstMisses)],
    ['Unclassified', count(outcomes.unclassifiedFirstMisses)],
  ]} />;
}

function Cohorts({ cohorts, onBrowse }: { cohorts: RepertoireCohort[]; onBrowse: (model: RepertoireModel) => void }) {
  if (!cohorts.length) return <p>No attributed Sol or Luna repertoires.</p>;
  return <>
    <QualityTable label="Repertoire quality by model" headings={[
      ['Authoring model', 22], ['Served encounters', 27], ['First try accepted', 25], ['Authoring per word', 26],
    ]}>
      {cohorts.map(cohort => <tr key={cohort.model} role="row">
        <th scope="row" role="rowheader">
          <button className="repertoire-quality-link" type="button" aria-label={`Browse ${modelLabels[cohort.model]} cues`}
            onClick={() => onBrowse(cohort.model)}>{modelLabels[cohort.model]}</button>
        </th>
        <Cell label="Served encounters" secondary={`${count(cohort.exercisesServed)} of ${count(cohort.exercises)} exercises`}>
          {count(cohort.served)}
        </Cell>
        <Cell label="First try accepted" secondary={cohort.answered ? `${fraction(cohort.acceptedFirst, cohort.answered)} answered` : undefined}>
          {cohort.answered ? percentage.format(cohort.acceptedFirst / cohort.answered) : '—'}
        </Cell>
        <Cell label="Authoring per word" secondary={<>
          {count(cohort.wordsPublished)} words published
          {cohort.pricedCalls < cohort.calls && <> · {fraction(cohort.pricedCalls, cohort.calls)} calls priced</>}
        </>}>
          {cohort.authoringSpendUsd !== null && cohort.wordsPublished > 0
            ? dollars.format(cohort.authoringSpendUsd / cohort.wordsPublished) : '—'}
        </Cell>
      </tr>)}
    </QualityTable>
    <details className="repertoire-quality-summary">
      <summary>First miss breakdown</summary>
      <div className="repertoire-quality-card repertoire-quality-split">
        {cohorts.map(cohort => <section key={cohort.model}>
          <h4>{modelLabels[cohort.model]} <span className="repertoire-quality-secondary">
            · {count(missCount(cohort))} misses / {count(cohort.answered)} answered
          </span></h4>
          <FirstMissMetrics outcomes={cohort} />
        </section>)}
      </div>
    </details>
    <details className="repertoire-quality-summary">
      <summary>Metric definitions</summary>
      <dl>
        <div><dt>Served</dt><dd>Closed session encounters on the first published revision.</dd></div>
        <div><dt>First try accepted</dt><dd>First effective answer accepted, out of encounters with an answer.</dd></div>
        <div><dt>First misses</dt><dd>Rejected first effective answers. Unclassified includes misses without a retained unfair judgment.</dd></div>
        <div><dt>Authoring per word</dt><dd>Known spend on repertoire authoring calls, including attempts with no publication, divided by distinct words published.</dd></div>
      </dl>
    </details>
  </>;
}

function CueTable({ rows, open }: { rows: RepertoireCueRow[]; open: (row: RepertoireCueRow, button: HTMLButtonElement) => void }) {
  if (!rows.length) return <p>No attributed cues on this page.</p>;
  return <QualityTable label="Attributed repertoire cues" headings={[
    ['Cue', 44], ['Served', 15], ['First try accepted', 23], ['Later changes', 18],
  ]}>
    {rows.map(row => <tr key={row.id} role="row">
      <th scope="row" role="rowheader">
        <button className="repertoire-quality-link" type="button" onClick={event => open(row, event.currentTarget)}>
          <span lang="zh">{row.target}</span> · {row.prompt}
        </button>
        <span className="repertoire-quality-secondary">
          {modelLabels[row.model]} · {pathLabels[row.path]}{row.promptVersion && <> · {row.promptVersion}</>}
        </span>
      </th>
      <Cell label="Served">{count(row.outcomes.served)}</Cell>
      <Cell label="First try accepted">{fraction(row.outcomes.acceptedFirst, row.outcomes.answered)}</Cell>
      <Cell label="Later changes">{count(row.laterChanges)}</Cell>
    </tr>)}
  </QualityTable>;
}

const repairLabels = { edit: 'Edit', replacement: 'Replacement', retirement: 'Retirement' } as const;

function RepairTable({ rows, open, capturedAt }: {
  rows: RepertoireRepairRow[]; open: (row: RepertoireRepairRow, button: HTMLButtonElement) => void; capturedAt: string;
}) {
  if (!rows.length) return <p>No single exercise repairs on this page.</p>;
  return <QualityTable label="Single exercise repairs" headings={[
    ['Exercise', 32], ['Before', 15], ['After', 15], ['First misses after', 23], ['Later changes', 15],
  ]}>
    {rows.map(row => <tr key={row.id} role="row">
      <th scope="row" role="rowheader">
        <button className="repertoire-quality-link" type="button" onClick={event => open(row, event.currentTarget)}>
          <span lang="zh">{row.target}</span> · {row.prompt}
        </button>
        <span className="repertoire-quality-secondary">{repairLabels[row.kind]} · <DateTime date={row.appliedAt} /></span>
      </th>
      <Cell label="Before" secondary={row.before.answered ? `${fraction(row.before.acceptedFirst, row.before.answered)} first tries accepted` : undefined}>
        {count(row.before.served)} served
      </Cell>
      <Cell label="After" secondary={row.after && <>
        {row.after.answered > 0 && <>{fraction(row.after.acceptedFirst, row.after.answered)} first tries accepted · </>}
        {elapsedSinceRepair(row.appliedAt, capturedAt)}
      </>}>
        {row.after ? `${count(row.after.served)} served` : 'Retired'}
      </Cell>
      <Cell label="First misses after" secondary={row.after?.answered && missCount(row.after) > 0
        ? `${count(row.after.unfairFirstMisses)} unfair · ${count(row.after.unclassifiedFirstMisses)} unclassified` : undefined}>
        {!row.after ? '—' : !row.after.served ? 'No subsequent use'
          : !row.after.answered ? 'No answered encounters' : fraction(missCount(row.after), row.after.answered)}
      </Cell>
      <Cell label="Later changes">{count(row.laterChanges)}</Cell>
    </tr>)}
  </QualityTable>;
}

function elapsedSinceRepair(appliedAt: string, capturedAt: string) {
  const days = Math.max(0, Math.floor((Date.parse(capturedAt) - Date.parse(appliedAt)) / 86_400_000));
  return days === 0 ? 'Less than a day since repair' : `${count(days)} ${days === 1 ? 'day' : 'days'} since repair`;
}

const changeLabels: Record<RepertoireCueVersion['change'], string> = {
  published: 'Published', source: 'Before repair', edit: 'Edited', replacement: 'Replacement', retirement: 'Retired', metadata: 'Other revision',
};

function Revision({ version }: { version: RepertoireCueVersion }) {
  const { outcomes } = version;
  return <li>
    <h4>{changeLabels[version.change]} · v{version.version} <span className="repertoire-quality-secondary">
      <DateTime date={version.recordedAt} />
    </span></h4>
    <blockquote>{version.prompt}</blockquote>
    {version.availability === 'quarantined' && <p className="repertoire-quality-secondary">Quarantined</p>}
    <MetricList metrics={[
      ['Served encounters', count(outcomes.served)],
      ['First try accepted', fraction(outcomes.acceptedFirst, outcomes.answered)],
      ['Skips', count(outcomes.skipped)],
    ]} />
    {missCount(outcomes) > 0 && <details className="repertoire-quality-summary">
      <summary>{count(missCount(outcomes))} first {missCount(outcomes) === 1 ? 'miss' : 'misses'}</summary>
      <FirstMissMetrics outcomes={outcomes} />
    </details>}
    <p className="repertoire-quality-secondary">Learner feedback · {count(outcomes.negative)} negative · {count(outcomes.comments)} {outcomes.comments === 1 ? 'comment' : 'comments'}</p>
  </li>;
}

function CueHistory({ detail }: { detail: RepertoireQualityDetail }) {
  const first = detail.versions[0];
  return <ol className="repertoire-quality-history">
    {detail.generatedPrompt !== null && <li>
      <h4>Model draft</h4>
      <blockquote>{detail.generatedPrompt}</blockquote>
      {detail.publication === 'operator' && first?.change === 'published' &&
        <p className="repertoire-quality-secondary">
          {first.prompt === detail.generatedPrompt ? 'Published with the same cue text' : 'Cue text edited before publication'}
        </p>}
    </li>}
    {detail.versions.map(version => <Revision key={`${version.contentId}:${version.version}`} version={version} />)}
  </ol>;
}

function PageControls({ page, pageSize, total, onPage }: {
  page: number; pageSize: number; total: number; onPage: (page: number) => void;
}) {
  if (total <= pageSize && page === 1) return null;
  const last = Math.max(1, Math.ceil(total / pageSize));
  return <nav className="repertoire-quality-pagination" aria-label="Results pages">
    <button className="secondary-button" type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
    <span role="status">Page {count(page)} of {count(last)} · {count(total)} results</span>
    <button className="secondary-button" type="button" disabled={page >= last} onClick={() => onPage(page + 1)}>Next</button>
  </nav>;
}

export function RepertoireQualityPanel() {
  const [section, setSection] = useState<Section>('cohorts');
  const [model, setModel] = useState<RepertoireModel | ''>('');
  const [page, setPage] = useState(1);
  const [listRetry, setListRetry] = useState(0);
  const [list, setList] = useState<LoadResult<RepertoireQualityPage> | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [detailRetry, setDetailRetry] = useState(0);
  const [detail, setDetail] = useState<LoadResult<RepertoireQualityDetail> | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const modelSelect = useRef<HTMLSelectElement>(null);
  const repairHeading = useRef<HTMLHeadingElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const focusModelOnBrowse = useRef(false);
  const focusResultsOnPage = useRef(false);
  const lastCueButton = useRef<HTMLElement | null>(null);
  const view: RepertoireQualityView = section === 'repairs' ? 'repairs' : 'cues';
  const modelFilter = section === 'cues' ? model : '';
  const listKey = `${view}:${page}:${modelFilter}:${listRetry}`;
  const detailKey = selection && `${selection.view}:${selection.id}:${detailRetry}`;

  useEffect(() => {
    const controller = new AbortController();
    void fetchRepertoireQuality({ view, page, model: modelFilter || undefined }, controller.signal)
      .then(value => {
        if (!controller.signal.aborted) setList({ key: listKey, value });
      }, () => {
        if (!controller.signal.aborted) setList({ key: listKey, error: 'Could not load repertoire quality.' });
      });
    return () => controller.abort();
  }, [listKey, view, page, modelFilter]);

  useEffect(() => {
    if (!selection || !detailKey) return;
    const controller = new AbortController();
    void fetchRepertoireQualityDetail(selection.view, selection.id, controller.signal)
      .then(value => {
        if (!controller.signal.aborted) setDetail({ key: detailKey, value });
      }, () => {
        if (!controller.signal.aborted) setDetail({ key: detailKey, error: 'Could not load cue history.' });
      });
    return () => controller.abort();
  }, [selection, detailKey]);

  useEffect(() => {
    if (selection) heading.current?.focus();
  }, [selection]);

  useEffect(() => {
    if (section === 'cues' && focusModelOnBrowse.current) {
      focusModelOnBrowse.current = false;
      modelSelect.current?.focus();
    }
  }, [section]);

  useEffect(() => {
    if (list?.key === listKey && list.value && focusResultsOnPage.current) {
      focusResultsOnPage.current = false;
      results.current?.focus();
    }
  }, [list, listKey]);

  function changeSection(next: Section, nextModel: RepertoireModel | '' = '') {
    if (next === section) return;
    focusModelOnBrowse.current = next === 'cues' && nextModel !== '';
    focusResultsOnPage.current = false;
    setSection(next);
    setModel(nextModel);
    setPage(1);
    setSelection(null);
  }

  function open(id: string, target: string, button: HTMLButtonElement) {
    lastCueButton.current = button;
    setSelection({ view, id, target });
  }

  function close() {
    setSelection(null);
    const button = lastCueButton.current;
    requestAnimationFrame(() => {
      if (button?.isConnected) button.focus();
      else if (section === 'cues') modelSelect.current?.focus();
      else repairHeading.current?.focus();
    });
  }

  const result = list?.key === listKey ? list : null;
  const detailResult = detail?.key === detailKey ? detail : null;
  const data = result?.value;
  const loading = !result;
  const capturedAt = data?.capturedAt;

  return <section className="repertoire-quality" aria-labelledby="repertoire-quality-heading">
    <header>
      <h2 id="repertoire-quality-heading">Repertoire quality</h2>
      {capturedAt && <p className="repertoire-quality-secondary">Snapshot · <DateTime date={capturedAt} /></p>}
    </header>
    <nav className="repertoire-quality-nav" aria-label="Repertoire quality views">
      {sections.map(item => <button key={item.id} type="button" aria-pressed={section === item.id}
        aria-controls="repertoire-quality-view" onClick={() => changeSection(item.id)}>{item.label}</button>)}
    </nav>
    <div id="repertoire-quality-view" className="repertoire-quality-section">
      {section === 'cues' && !selection && <div className="repertoire-quality-controls">
        <label>Authoring model
          <select ref={modelSelect} value={model} onChange={event => {
            const value = event.currentTarget.value;
            focusResultsOnPage.current = false;
            setModel(value === 'sol' || value === 'luna' ? value : '');
            setPage(1);
          }}>
            <option value="">All models</option><option value="sol">Sol</option><option value="luna">Luna</option>
          </select>
        </label>
      </div>}
      {loading && !selection && <p role="status">Loading repertoire quality…</p>}
      {result?.error && !selection && <div className="repertoire-quality-section">
        <p role="alert">{result.error}</p>
        <div><button type="button" className="secondary-button" onClick={() => setListRetry(value => value + 1)}>Retry</button></div>
      </div>}
      {data && section === 'cohorts' && <Cohorts cohorts={data.cohorts} onBrowse={next => changeSection('cues', next)} />}
      {data && section === 'repairs' && !selection && <>
        <h3 ref={repairHeading} tabIndex={-1}>Single exercise repairs</h3>
        <MetricList metrics={[
          ['Applied', count(data.repairTotals.applied)],
          ['Retirements', count(data.repairTotals.retired)],
          ['Served after repair', count(data.repairTotals.servedAfter)],
          ['With a first miss after', count(data.repairTotals.firstMissAfter)],
          ['With an unfair first miss after', count(data.repairTotals.unfairAfter)],
          ['Changed again', count(data.repairTotals.changedAgain)],
        ]} />
        <details className="repertoire-quality-summary"><summary>How follow-up is counted</summary>
          <p className="repertoire-quality-secondary">
            Before and after count encounters on the exact source and repaired revisions. Days since repair are measured at the
            snapshot. A repaired revision with no subsequent use has no observed outcome.
          </p>
        </details>
      </>}
      {section !== 'cohorts' && data && <div hidden={selection !== null} className="repertoire-quality-section" ref={results} tabIndex={-1}
        role="region" aria-label={`${section === 'repairs' ? 'Repair' : 'Cue'} results, page ${count(data.page)}`}>
        {section === 'cues' && <CueTable rows={data.cueRows} open={(row, button) => open(row.id, row.target, button)} />}
        {section === 'repairs' && <RepairTable rows={data.repairRows} capturedAt={data.capturedAt}
          open={(row, button) => open(row.id, row.target, button)} />}
        <PageControls page={data.page} pageSize={data.pageSize} total={data.total} onPage={nextPage => {
          focusResultsOnPage.current = true;
          setPage(nextPage);
        }} />
      </div>}
      {selection && <section className="repertoire-quality-card" aria-labelledby="repertoire-quality-detail-heading">
        <header className="repertoire-quality-detail-head">
          <h3 ref={heading} tabIndex={-1} id="repertoire-quality-detail-heading"><span lang="zh">{detailResult?.value?.target ?? selection.target}</span> · Cue history</h3>
          <button className="repertoire-quality-link" type="button" onClick={close}>Back to {section === 'repairs' ? 'repairs' : 'cues'}</button>
        </header>
        {!detailResult && <p role="status">Loading cue history…</p>}
        {detailResult?.error && <>
          <p role="alert">{detailResult.error}</p>
          <button className="secondary-button" type="button" onClick={() => setDetailRetry(value => value + 1)}>Retry</button>
        </>}
        {detailResult?.value && <CueHistory detail={detailResult.value} />}
      </section>}
    </div>
  </section>;
}
