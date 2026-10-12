import { useEffect, useState } from 'react';
import { resolveContentExerciseResponse, type ContentExerciseSnapshot, type TeachingPackageSnapshot, type WordContentDocument } from '../domain/word-content';
import { IntroductionPlayer } from '../features/introduction-lab/IntroductionPlayer';
import { initialIntroductionPlayerState, reduceIntroductionPlayer } from '../features/introduction-lab/player';
import type { ImprovementCase, ImprovementCheck, ImprovementDraftFields } from '../domain/content-improvement';
import { CONTENT_QUALITY_KINDS, type ContentQualityKind } from '../domain/content-quality';
import { applyContentImprovement, closeContentImprovement, createContentImprovement, fetchContentImprovement, fetchContentImprovementHistory, fetchContentImprovements, saveContentImprovement, validateContentImprovement } from '../services/api';

export type ImprovementSelection = { kind: ContentQualityKind; sourceId: string; contentKey?: string };
const LABELS: Record<string, string> = { production_cue: 'Production cue', pure_cue: 'Pure cue', contrast_prompt: 'Contrast prompt', teaching_package: 'Word introduction', rehearsal: 'Word rehearsal', supplement: 'Supplement', cueText: 'Cue', stimulus: 'Prompt', teachingNote: 'Teaching note', promptText: 'Prompt', explanation: 'Explanation', targetWordId: 'Target word ID', acceptedWordIds: 'Accepted word IDs', acceptedAnswers: 'Accepted answers', axisNote: 'Distinction', hanzi: 'Answer', traditional: 'Traditional form', text: 'Text', contract: 'Practice focus', instruction: 'Instruction', englishFrame: 'English frame', exampleSentence: 'Example sentence', exampleTranslation: 'Example translation' };
const label = (key: string) => LABELS[key] ?? key.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ');
const draftOf = (item: ImprovementCase): ImprovementDraftFields => ({ diagnosis: item.diagnosis, rationale: item.rationale, generalLesson: item.generalLesson, proposalOrigin: item.proposalOrigin, proposed: item.proposed });

/** Recursive fields retain the adapter's shape, including source identities. Validation owns domain rules. */
function ContentFields({ value, onChange, path = 'Proposed content' }: { value: unknown; onChange: (value: unknown) => void; path?: string }) {
  if (typeof value === 'string') return <label>{label(path)}<textarea rows={value.length > 120 ? 4 : 2} value={value} onChange={event => onChange(event.target.value)} /></label>;
  if (Array.isArray(value)) return <fieldset><legend>{label(path)}</legend>{value.map((entry, index) => <ContentFields key={index} value={entry} path={`${path} ${index + 1}`} onChange={next => onChange(value.map((old, i) => i === index ? next : old))} />)}</fieldset>;
  if (value && typeof value === 'object') return <div className="improvement-fields">{Object.entries(value).filter(([key]) => !['id', 'schemaVersion', 'wordContentId', 'contentId', 'responseMode', 'kind', 'wordId', 'targetWordId', 'acceptedWordIds', 'formId', 'useId', 'exampleId'].includes(key)).map(([key, entry]) => <ContentFields key={key} path={key} value={entry} onChange={next => onChange({ ...value, [key]: next })} />)}</div>;
  return <p>{label(path)}: {String(value)}</p>;
}

function ReadableContent({ value }: { value: unknown }) {
  if (value == null) return null;
  if (typeof value !== 'object') return <span>{String(value)}</span>;
  if (Array.isArray(value)) return <ol>{value.map((entry, index) => <li key={index}><ReadableContent value={entry} /></li>)}</ol>;
  return <dl>{Object.entries(value).filter(([key]) => !['id', 'sourceId', 'wordId', 'exerciseId', 'packageId', 'wordContentId', 'responseMode', 'matchingProfile', 'schemaVersion', 'kind', 'source', 'fingerprint', 'createdAt', 'updatedAt'].includes(key)).map(([key, entry]) => <div key={key}><dt>{label(key)}</dt><dd><ReadableContent value={entry} /></dd></div>)}</dl>;
}

function PackagePreview({ snapshot, content }: { snapshot: TeachingPackageSnapshot; content: WordContentDocument }) {
  const [state, setState] = useState(initialIntroductionPlayerState);
  const [playing, setPlaying] = useState(false);
  return <><button type="button" className="secondary-button" onClick={() => setPlaying(!playing)}>{playing ? 'Close introduction player' : 'Try learner introduction'}</button>{playing ? <IntroductionPlayer snapshot={snapshot} content={content} state={state} onAction={action => setState(current => reduceIntroductionPlayer(current, action, snapshot))} onRestart={() => setState(initialIntroductionPlayerState())} /> : <ReadableContent value={snapshot} />}</>;
}

function ContentPreview({ value, interactive = true }: { value: unknown; interactive?: boolean }) {
  const [revealed, setRevealed] = useState(false);
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const stimulus = record.stimulus && typeof record.stimulus === 'object' ? (record.stimulus as Record<string, unknown>).text : record.stimulus;
  const exercise = record.responseMode === 'hanzi_entry' && Array.isArray(record.acceptedAnswers) ? record as ContentExerciseSnapshot : null;
  const prompt = record.cueText ?? stimulus ?? record.promptText ?? record.prompt_text;
  if (record.snapshot && record.content && !interactive) return <ReadableContent value={record.snapshot} />;
  if (record.snapshot && record.content) return <PackagePreview snapshot={record.snapshot as TeachingPackageSnapshot} content={record.content as WordContentDocument} />;
  return <div className="improvement-preview">{typeof prompt === 'string' ? <>
    <p className="improvement-prompt">{prompt}</p>
    <label>Try an answer (preview only)<input value={answer} onChange={event => setAnswer(event.target.value)} /></label>
    {exercise && <button type="button" className="secondary-button" onClick={() => { setResult(resolveContentExerciseResponse(exercise, answer).outcome === 'accepted' ? 'Accepted answer' : 'Answer not accepted'); setRevealed(true); }}>Check preview answer</button>}
    {result && <p role="status">{result}</p>}
    <button type="button" className="secondary-button" onClick={() => setRevealed(!revealed)}>{revealed ? 'Hide reveal' : 'Reveal content'}</button>
    {revealed && <ReadableContent value={value} />}
  </> : <ReadableContent value={value} />}</div>;
}

export function ContentImprovementWorkspace({ selection }: { selection: ImprovementSelection | null }) {
  const [source, setSource] = useState<ImprovementSelection>({ kind: 'production_cue', sourceId: '' });
  const [status, setStatus] = useState<ImprovementCase['status']>('draft');
  const [offset, setOffset] = useState(0);
  const [list, setList] = useState<{ items: ImprovementCase[]; total: number }>({ items: [], total: 0 });
  const [selected, setSelected] = useState<ImprovementCase | null>(null);
  const [draft, setDraft] = useState<ImprovementDraftFields | null>(null);
  const [check, setCheck] = useState<ImprovementCheck | null>(null);
  const [history, setHistory] = useState<ImprovementCase[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [approved, setApproved] = useState(false);
  const [answerApproved, setAnswerApproved] = useState(false);
  const [resolution, setResolution] = useState('');
  const [importText, setImportText] = useState('');
  const dirty = Boolean(selected && draft && JSON.stringify(draftOf(selected)) !== JSON.stringify(draft));
  useEffect(() => { if (selection) setSource(selection); }, [selection]);
  useEffect(() => {
    let cancelled = false;
    void fetchContentImprovements(status, offset).then(result => { if (!cancelled) setList(result); }).catch(cause => { if (!cancelled) setError(String(cause)); });
    return () => { cancelled = true; };
  }, [status, offset, refresh]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const warnNavigation = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || target.closest('#content-improvement-workspace') || !target.closest('a, button[role=tab], nav[aria-label=Primary] button')) return;
      if (!window.confirm('You have unsaved content edits. Leave this workspace and discard them?')) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    const warnTabKey = (event: KeyboardEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('[role=tab]') || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      if (!window.confirm('You have unsaved content edits. Leave this workspace and discard them?')) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    window.addEventListener('beforeunload', warn);
    document.addEventListener('click', warnNavigation, true);
    document.addEventListener('keydown', warnTabKey, true);
    return () => { window.removeEventListener('beforeunload', warn); document.removeEventListener('click', warnNavigation, true); document.removeEventListener('keydown', warnTabKey, true); };
  }, [dirty]);
  function accept(item: ImprovementCase) { setSelected(item); setDraft(draftOf(item)); setCheck(null); setApproved(false); setAnswerApproved(false); setHistory(null); setResolution(''); setImportText(''); }
  function edit(next: ImprovementDraftFields) { setDraft(next); setCheck(null); setApproved(false); setAnswerApproved(false); }
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (cause) { setError(`${cause instanceof Error ? cause.message : String(cause)} Your local draft remains here. If another editor changed this case, copy your draft before loading the saved version.`); }
    finally { setBusy(false); }
  }
  function maySwitch() { return !dirty || window.confirm('Discard unsaved edits and open another case? Save the draft first to retain these edits.'); }
  const editable = selected?.status === 'draft';
  return <section id="content-improvement-workspace" className="improvement-workspace" aria-labelledby="improvement-heading">
    <h2 id="improvement-heading">Improve content</h2>
    <p>Work freely through diagnosis, revision, and preview. Saving retains a draft; applying changes future eligible content.</p>
    <form className="improvement-source" onSubmit={event => { event.preventDefault(); if (maySwitch()) void run(async () => { accept(await createContentImprovement(source)); setRefresh(value => value + 1); }); }}>
      <label>Content type<select value={source.kind} onChange={event => setSource({ kind: event.target.value as ContentQualityKind, sourceId: '' })}>{CONTENT_QUALITY_KINDS.filter(kind => kind !== 'definition_fallback').map(kind => <option key={kind} value={kind}>{LABELS[kind]}</option>)}</select></label>
      <label>Source ID<input required value={source.sourceId} onChange={event => setSource({ kind: source.kind, sourceId: event.target.value })} /></label>
      <button type="submit" disabled={busy || !source.sourceId.trim()}>Open improvement draft</button>
      {source.contentKey && <p className="notes">Selected learner-rated version: <code>{source.contentKey}</code></p>}
    </form>
    <label>Cases<select value={status} onChange={event => { setStatus(event.target.value as ImprovementCase['status']); setOffset(0); }}><option value="draft">Unresolved drafts</option><option value="applied">Applied corrections</option><option value="closed">Closed cases</option></select></label>
    <div className="improvement-case-list">{list.items.map(item => <button key={item.id} type="button" className="secondary-button" disabled={busy} aria-pressed={selected?.id === item.id} onClick={() => { if (maySwitch()) void run(async () => accept(await fetchContentImprovement(item.id))); }}>{item.source.title} · revision {item.revision}</button>)}{!list.total && <p>No cases in this view.</p>}</div>
    {list.total > 25 && <nav aria-label="Improvement cases"><button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>Previous</button><span>{offset + 1}–{Math.min(offset + 25, list.total)} of {list.total}</span><button type="button" disabled={offset + 25 >= list.total} onClick={() => setOffset(offset + 25)}>Next</button></nav>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}{busy && <p role="status">Working…</p>}
    {selected && draft && <article>
      <h3>{selected.source.title}</h3>
      <p>{selected.status} · revision {selected.revision} · <strong>{selected.source.scope === 'shared' ? 'Shared content: affects all eligible learners' : 'Private content: limited to its owner'}</strong></p>
      <details><summary>Generation provenance for the source</summary><dl><dt>Source</dt><dd>{selected.source.provenance?.source ?? 'Unknown'}</dd><dt>Model</dt><dd>{selected.source.provenance?.model ?? 'Unknown / not recorded'}</dd></dl></details>
      <ul>{selected.source.impact.map((impact, index) => <li key={index}>{impact}</li>)}</ul>
      {selected.flagged && <details><summary>Exact learner-rated version and generation provenance</summary><ReadableContent value={selected.flagged.content} /><pre>{JSON.stringify(selected.flagged.provenance, null, 2)}</pre><p>This snapshot is retained separately from the source captured when the draft was opened.</p></details>}
      <fieldset disabled={busy || !editable}>
        <legend>Editorial judgment {dirty ? '· unsaved changes' : '· saved'}</legend>
        <label>Diagnosis — what should improve?<textarea rows={3} value={draft.diagnosis} onChange={event => edit({ ...draft, diagnosis: event.target.value })} /></label>
        <label>Rationale — why is this revision better?<textarea rows={3} value={draft.rationale} onChange={event => edit({ ...draft, rationale: event.target.value })} /></label>
        <label>Possible general lesson (optional)<textarea rows={2} value={draft.generalLesson} onChange={event => edit({ ...draft, generalLesson: event.target.value })} /></label>
        <label>Proposal authored by<select value={draft.proposalOrigin} onChange={event => edit({ ...draft, proposalOrigin: event.target.value as 'operator' | 'agent' })}><option value="operator">Operator</option><option value="agent">Agent proposal</option></select></label>
        {draft.proposalOrigin === 'agent' && <p className="notes">{selected.status === 'applied' ? 'Agent proposal accepted by the applying operator.' : 'Agent proposals require your review and explicit approval before application.'}</p>}
        <h4>Revision</h4><ContentFields value={draft.proposed} onChange={proposed => edit({ ...draft, proposed: proposed as ImprovementDraftFields['proposed'] })} />
      </fieldset>
      <div className="improvement-comparison"><section><h4>Source captured at draft creation</h4><ContentPreview key={`${selected.id}-original`} value={selected.source.preview} interactive={false} /></section><section><h4>{selected.status === 'applied' ? 'Applied revision' : check ? 'Validated revision preview' : 'Proposed content · not validated'}</h4><ContentPreview key={`${selected.id}-${check?.revision ?? 'draft'}`} value={selected.outcome?.appliedSource?.preview ?? check?.preview ?? draft.proposed} /></section></div>
      <p className="notes">Preview does not record study attempts or change progress. Saved exercise previews use the learner answer matcher. Validate the saved draft to resolve source references and check its content contract.</p>
      <div className="improvement-actions">
        {editable && <><button type="button" disabled={busy || !dirty} onClick={() => void run(async () => { accept(await saveContentImprovement(selected.id, selected.revision, draft)); setRefresh(value => value + 1); setNotice('Draft saved. Production content is unchanged.'); })}>Save draft</button><button type="button" className="secondary-button" disabled={busy || dirty} onClick={() => void run(async () => { setCheck(await validateContentImprovement(selected.id, selected.revision)); setApproved(false); setAnswerApproved(false); })}>Validate saved draft</button></>}
        <button type="button" className="secondary-button" disabled={busy} onClick={() => { if (maySwitch()) void run(async () => accept(await fetchContentImprovement(selected.id))); }}>Load saved version</button>
      </div>
      {check && <section aria-label="Validation"><h4>Validation</h4>{check.errors.length ? <ul>{check.errors.map((message, index) => <li key={index}>{message}</li>)}</ul> : <p>Content checks passed.</p>}{check.sourceChanged && <p role="alert">The source has changed since this case was opened. Application is blocked; review the current source and open a new case.</p>}{check.sourceChanged && <details><summary>Current source</summary><ReadableContent value={check.currentSource.preview} /></details>}
        {editable && <fieldset disabled={busy || dirty || check.sourceChanged || check.errors.length > 0}><legend>Approve application</legend>{check.answerSpaceChanged && <label className="improvement-checkbox"><input type="checkbox" checked={answerApproved} onChange={event => setAnswerApproved(event.target.checked)} />I approve changing which answers this content accepts.</label>}<label className="improvement-checkbox"><input type="checkbox" checked={approved} onChange={event => setApproved(event.target.checked)} />I reviewed this revision and its scope and approve applying it to production.</label><button type="button" disabled={!approved || (check.answerSpaceChanged && !answerApproved)} onClick={() => void run(async () => { accept(await applyContentImprovement(selected.id, selected.revision, answerApproved)); setRefresh(value => value + 1); setNotice('Correction applied. Original evidence remains in this case.'); })}>Apply approved revision</button></fieldset>}
      </section>}
      {selected.outcome && <><p role="status">{selected.outcome.summary}</p>{selected.outcome.replacementSourceId && <p>Replacement source: <code>{selected.outcome.replacementSourceId}</code> <button type="button" className="secondary-button" disabled={busy} onClick={() => setSource({ kind: selected.source.kind, sourceId: selected.outcome!.replacementSourceId! })}>Select replacement for improvement</button></p>}</>}{selected.resolution && <p>Resolution: {selected.resolution}</p>}
      {editable && <details><summary>Resolve without applying</summary><label>Resolution reason<textarea value={resolution} onChange={event => setResolution(event.target.value)} /></label><button type="button" disabled={busy || dirty || !resolution.trim()} onClick={() => void run(async () => { accept(await closeContentImprovement(selected.id, selected.revision, resolution)); setRefresh(value => value + 1); })}>Close case without changing content</button></details>}
      <details><summary>Evidence history</summary><button type="button" className="secondary-button" disabled={busy} onClick={() => void run(async () => setHistory(await fetchContentImprovementHistory(selected.id)))}>Load recorded revisions</button>{history?.map(item => <details key={item.revision}><summary>Revision {item.revision} · {item.status} · {item.updatedAt}</summary><p>{item.diagnosis}</p><p>{item.rationale}</p><pre>{JSON.stringify(item, null, 2)}</pre></details>)}</details>
      <details><summary>Agent handoff and structured draft</summary><p>Case ID: <code>{selected.id}</code> · expected revision: {selected.revision}. Agents use the same operator-authorized API and validation.</p><label>Current draft export<textarea readOnly rows={8} value={JSON.stringify({ ...draft, expectedRevision: selected.revision }, null, 2)} /></label>{editable && <><label>Import proposed content JSON<textarea rows={5} value={importText} onChange={event => setImportText(event.target.value)} /></label><button type="button" disabled={busy || !importText.trim()} onClick={() => { try { const parsed: unknown = JSON.parse(importText); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Proposed content must be a JSON object.'); edit({ ...draft, proposed: parsed as Record<string, unknown>, proposalOrigin: 'agent' }); setImportText(''); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } }}>Import into unsaved proposal</button></>}<details><summary>Full retained case (JSON)</summary><pre>{JSON.stringify(selected, null, 2)}</pre></details></details>
    </article>}
  </section>;
}
