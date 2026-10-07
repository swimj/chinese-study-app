import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import type { ModelInvocationRow } from '../domain/model-invocations';
import { invocationStatusLabels, type DiscreteInvocationField, type InvocationFilters, type InvocationGroup, type InvocationSort, type NumericInvocationFilter } from './model-invocation-presentation';

export const INVOCATION_COLUMNS: { key: InvocationSort; label: string; group: InvocationGroup }[] = [
  { key: 'timestamp', label: 'Timestamp (UTC)', group: 'day' },
  { key: 'model', label: 'Model', group: 'model' },
  { key: 'invocationType', label: 'Invocation type', group: 'invocationType' },
  { key: 'spendUsd', label: 'Spend (USD)', group: 'spendUsd' },
  { key: 'learnerId', label: 'User', group: 'learnerId' },
  { key: 'latencyMs', label: 'Latency', group: 'latencyMs' },
  { key: 'status', label: 'Status', group: 'status' },
];

export function columnHasFilter(column: InvocationSort, filters: InvocationFilters): boolean {
  if (column === 'timestamp') return Boolean(filters.from || filters.to);
  if (column === 'spendUsd' || column === 'latencyMs') return Boolean(filters.numeric[column]) || (column === 'spendUsd' && filters.discrete.spendSource !== undefined);
  return filters.discrete[column] !== undefined || (column === 'model' && filters.discrete.provider !== undefined);
}

export function InvocationColumnDialog({ column, rows, filters, sortBy, direction, groupBy, onFilters, onSort, onGroup, onClose }: {
  column: typeof INVOCATION_COLUMNS[number]; rows: ModelInvocationRow[]; filters: InvocationFilters;
  sortBy: InvocationSort; direction: 'asc' | 'desc'; groupBy: InvocationGroup | '';
  onFilters: (filters: InvocationFilters) => void;
  onSort: (sort: InvocationSort, direction: 'asc' | 'desc') => void;
  onGroup: (group: InvocationGroup | '') => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<InvocationFilters>(filters);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, []);
  const close = () => ref.current?.close();
  const numericKey = column.key === 'spendUsd' || column.key === 'latencyMs' ? column.key : null;
  const range = numericKey ? draft.numeric[numericKey] ?? { min: '', max: '', unknown: 'include' } : null;
  const invalidDates = Boolean(draft.from && draft.to && draft.from > draft.to);
  const invalidRange = range !== null && range.unknown !== 'only' && ((range.min !== '' && (!Number.isFinite(Number(range.min)) || Number(range.min) < 0))
    || (range.max !== '' && (!Number.isFinite(Number(range.max)) || Number(range.max) < 0))
    || (range.min !== '' && range.max !== '' && Number(range.min) > Number(range.max)));
  const invalid = column.key === 'timestamp' ? invalidDates : invalidRange;
  function setRange(next: NumericInvocationFilter) {
    if (!numericKey) return;
    const numeric = { ...draft.numeric };
    if (next.min === '' && next.max === '' && next.unknown === 'include') delete numeric[numericKey];
    else numeric[numericKey] = next;
    setDraft({ ...draft, numeric });
  }
  function setSelected(field: DiscreteInvocationField, selected: string[] | undefined) {
    const discrete = { ...draft.discrete };
    if (selected === undefined) delete discrete[field]; else discrete[field] = selected;
    setDraft({ ...draft, discrete });
  }
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (invalid) return;
    onFilters(draft);
    close();
  }
  function clearColumn() {
    const next = { ...draft, discrete: { ...draft.discrete }, numeric: { ...draft.numeric } };
    if (column.key === 'timestamp') { next.from = ''; next.to = ''; }
    else if (numericKey) { delete next.numeric[numericKey]; if (numericKey === 'spendUsd') delete next.discrete.spendSource; }
    else { delete next.discrete[column.key as DiscreteInvocationField]; if (column.key === 'model') delete next.discrete.provider; }
    setDraft(next);
  }
  function choiceLabel(field: DiscreteInvocationField, value: string) {
    if (field === 'status') return invocationStatusLabels[value as ModelInvocationRow['status']];
    if (field === 'learnerId') {
      const name = rows.find((row) => row.learnerId === value)?.userDisplayName;
      return name ? `${name} · ${value}` : value;
    }
    return field === 'invocationType' ? value.replaceAll('_', ' ') : value;
  }
  function choices(field: DiscreteInvocationField, label: string) {
    const values = [...new Set([...rows.map((row) => row[field]), ...(draft.discrete[field] ?? [])])].sort();
    const selected = draft.discrete[field];
    return <fieldset className="operator-column-choices"><legend>{label}</legend>
      <div className="operator-column-actions">
        <button type="button" className="secondary-button" onClick={() => setSelected(field, undefined)}>All</button>
        <button type="button" className="secondary-button" onClick={() => setSelected(field, [])}>None</button>
        <span>{selected === undefined ? 'All' : `${selected.length} selected`}</span>
      </div>
      <div className="operator-column-choice-list">
        {values.length === 0 && <p className="notes">No values recorded yet.</p>}
        {values.map((value) => <label key={value}><input type="checkbox" checked={selected === undefined || selected.includes(value)} onChange={(event) => {
          const current = selected ?? values;
          setSelected(field, event.target.checked ? [...current, value] : current.filter((item) => item !== value));
        }} /><span>{choiceLabel(field, value)}</span></label>)}
      </div>
    </fieldset>;
  }
  return createPortal(<dialog ref={ref} className="operator-column-dialog" aria-labelledby="operator-column-title" onClose={(event) => {
    // StrictMode replays setup after cleanup; the old close event can arrive after reopening.
    if (!event.currentTarget.open) onClose();
  }} onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
    <div className="operator-column-dialog-body">
      <div className="operator-column-title"><h3 id="operator-column-title">{column.label}</h3><button type="button" className="secondary-button" onClick={close} aria-label="Close column controls">Close</button></div>
      <fieldset><legend>Sort</legend><div className="operator-column-actions">
        <button type="button" className="secondary-button" aria-pressed={sortBy === column.key && direction === 'asc'} onClick={() => onSort(column.key, 'asc')}>Ascending ↑</button>
        <button type="button" className="secondary-button" aria-pressed={sortBy === column.key && direction === 'desc'} onClick={() => onSort(column.key, 'desc')}>Descending ↓</button>
      </div></fieldset>
      <fieldset><legend>Grouping</legend><button type="button" className="secondary-button" aria-pressed={groupBy === column.group} onClick={() => onGroup(groupBy === column.group ? '' : column.group)}>
        {groupBy === column.group ? 'Remove grouping' : column.group === 'day' ? 'Group by UTC day' : `Group by ${column.label.toLowerCase()}`}
      </button></fieldset>
      <form onSubmit={apply}>
        {column.key === 'timestamp' && <fieldset><legend>Inclusive UTC dates</legend><div className="operator-column-range">
          <label>From<input type="date" value={draft.from} max={draft.to || undefined} onChange={(event) => setDraft({ ...draft, from: event.target.value })} /></label>
          <label>Through<input type="date" value={draft.to} min={draft.from || undefined} onChange={(event) => setDraft({ ...draft, to: event.target.value })} /></label>
        </div><p className="notes">Leave either date blank for no bound.</p></fieldset>}
        {range && <fieldset><legend>{numericKey === 'spendUsd' ? 'Spend range (USD)' : 'Latency range (seconds)'}</legend>
          <div className="operator-column-range">
            <label>Minimum<input type="number" step="any" min="0" disabled={range.unknown === 'only'} value={range.min} onChange={(event) => setRange({ ...range, min: event.target.value })} /></label>
            <label>Maximum<input type="number" step="any" min="0" disabled={range.unknown === 'only'} value={range.max} onChange={(event) => setRange({ ...range, max: event.target.value })} /></label>
          </div><label className="operator-column-unknown">Unknown values<select value={range.unknown} onChange={(event) => setRange({ ...range, unknown: event.target.value as NumericInvocationFilter['unknown'] })}>
            <option value="include">Include unknown</option><option value="exclude">Exclude unknown</option><option value="only">Unknown only</option>
          </select></label>
        </fieldset>}
        {column.key === 'model' && <>{choices('model', 'Models')}{choices('provider', 'Providers')}</>}
        {column.key === 'invocationType' && choices('invocationType', 'Invocation types')}
        {column.key === 'learnerId' && choices('learnerId', 'Users')}
        {column.key === 'status' && choices('status', 'Statuses')}
        {column.key === 'spendUsd' && choices('spendSource', 'Spend sources')}
        {invalid && <p role="alert">{column.key === 'timestamp' ? 'The start date must be on or before the end date.' : 'The minimum must not exceed the maximum; numeric bounds must be nonnegative.'}</p>}
        <div className="operator-column-actions operator-column-footer"><button type="button" className="secondary-button" onClick={clearColumn}>Clear filter</button><button type="submit" disabled={invalid}>Apply filter</button></div>
      </form>
    </div>
  </dialog>, document.body);
}
