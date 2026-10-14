import { useEffect, useRef, useState } from 'react';
import type {
  ContentDiagnosticItem,
  ContentDiagnosticKind,
  ContentDiagnosticsResponse,
  ContrastClusterDiagnosticItem,
  ProductionCueDiagnosticItem,
  WordDiagnosticItem,
  WordDiagnosticSupplement,
} from '../domain/content-diagnostics';
import { fetchContentDiagnostics } from '../services/api';
import { MeaningList } from '../components/MeaningList';

const KIND_LABELS: Record<ContentDiagnosticKind, string> = {
  word: 'Words',
  contrast_cluster: 'Contrast clusters',
  production_cue: 'Production cues',
};

export function ContentDiagnosticsPage({
  data,
  kind,
  query,
  isLoading,
  onQueryChange,
  onSelectKind,
  onSearch,
}: {
  data: ContentDiagnosticsResponse | null;
  kind: ContentDiagnosticKind;
  query: string;
  isLoading: boolean;
  onQueryChange: (query: string) => void;
  onSelectKind: (kind: ContentDiagnosticKind) => void;
  onSearch: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [connection, setConnection] = useState<{ kind: ContentDiagnosticKind; id: string } | null>(null);
  const originFocus = useRef<HTMLElement | null>(null);
  const originScroll = useRef(0);
  function openConnection(kind: ContentDiagnosticKind, id: string) {
    originFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    originScroll.current = window.scrollY;
    setConnection({ kind, id });
    window.scrollTo(0, 0);
  }
  function returnToOrigin() {
    setConnection(null);
    requestAnimationFrame(() => {
      originFocus.current?.focus({ preventScroll: true });
      window.scrollTo(0, originScroll.current);
    });
  }
  const items = data?.kind === kind ? data.items : [];

  useEffect(() => {
    setSelectedId((current) => items.some((item) => item.id === current) ? current : items[0]?.id ?? null);
  }, [data]);

  const selectedItem = items.find((item) => item.id === selectedId) ?? null;

  return (
    <section className="content-diagnostics-page">
      <header className="header">
        <div>
          <h1 className="title">Content Bin</h1>
          <p className="subtitle">Read-only diagnostics for the primitive units behind study.</p>
        </div>
      </header>

      {connection && selectedItem ? (
        <ConnectedDetail connection={connection} originLabel={itemLabel(selectedItem)} onBack={returnToOrigin} />
      ) : null}
      <div className="content-origin-view" hidden={connection !== null}>
        <div className="content-kind-tabs" role="tablist" aria-label="Content primitive kinds">
          {(Object.keys(KIND_LABELS) as ContentDiagnosticKind[]).map((candidateKind) => (
            <button
              key={candidateKind}
              type="button"
              role="tab"
              aria-selected={kind === candidateKind}
              className={kind === candidateKind ? 'content-kind-tab active' : 'content-kind-tab'}
              disabled={isLoading}
              onClick={() => void onSelectKind(candidateKind)}
            >
              {KIND_LABELS[candidateKind]}
            </button>
          ))}
        </div>

        <form className="content-search" onSubmit={(event) => { event.preventDefault(); onSearch(); }}>
          <input
            type="search"
            value={query}
            placeholder={`Search ${KIND_LABELS[kind].toLocaleLowerCase()} by text or id`}
            aria-label={`Search ${KIND_LABELS[kind]}`}
            onChange={(event) => onQueryChange(event.target.value)}
          />
          <button type="submit" disabled={isLoading || query.trim().length === 0}>
            {isLoading ? 'Loading…' : 'Search'}
          </button>
        </form>

        {data?.kind === kind ? (
          <p className="content-result-note notes">
            {data.items.length} matching {KIND_LABELS[kind].toLocaleLowerCase()}
            {data.hasMore ? ` shown · refine the query to see beyond the first ${data.limit}` : ''}
          </p>
        ) : null}

        {!data ? (
          <div className="panel content-empty-state">
            <h2>Search when you have a primitive in mind</h2>
            <p className="notes">No content is loaded until you submit a word, text fragment, or known id.</p>
          </div>
        ) : items.length === 0 ? (
          <div className="panel content-empty-state">
            <h2>No matching content</h2>
            <p className="notes">Try a different text fragment or id.</p>
          </div>
        ) : (
          <div className="content-diagnostic-layout">
            <aside className="panel content-item-list" aria-label={`${KIND_LABELS[kind]} results`}>
              {items.map((item) => (
              <button
                type="button"
                key={item.id}
                className={item.id === selectedId ? 'content-item-button active' : 'content-item-button'}
                onClick={() => setSelectedId(item.id)}
              >
                <strong>{itemLabel(item)}</strong>
                <span>{itemSummary(item)}</span>
              </button>
              ))}
            </aside>

            <article className="panel content-item-detail">
              {selectedItem ? <DiagnosticDetail item={selectedItem} onOpen={openConnection} /> : (
                <p className="notes">Select a primitive to inspect its details.</p>
              )}
            </article>
          </div>
        )}
      </div>
    </section>
  );
}

type OpenConnection = (kind: ContentDiagnosticKind, id: string) => void;

function ConnectedDetail({ connection, originLabel, onBack }: {
  connection: { kind: ContentDiagnosticKind; id: string };
  originLabel: string;
  onBack: () => void;
}) {
  const [item, setItem] = useState<ContentDiagnosticItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let cancelled = false;
    backButton.current?.focus({ preventScroll: true });
    void fetchContentDiagnostics(connection.kind, connection.id).then((response) => {
      if (cancelled) return;
      const match = response.items.find((candidate) => candidate.kind === connection.kind && candidate.id === connection.id);
      if (match) setItem(match);
      else setError('This connected item is unavailable.');
    }).catch(() => {
      if (!cancelled) setError('Could not load this connected item. Return and try again.');
    });
    return () => { cancelled = true; };
  }, [connection]);
  return <article className="panel content-item-detail">
    <button ref={backButton} className="content-connection-link" type="button" onClick={onBack}>← Back to {originLabel}</button>
    <p className="notes">Connected item · Return to the originating item before opening another connection.</p>
    {error ? <p role="alert">{error}</p> : item ? <DiagnosticDetail item={item} /> : <p role="status">Loading connected item…</p>}
  </article>;
}

function ConnectionLink({ kind, id, children, onOpen }: {
  kind: ContentDiagnosticKind; id: string; children: React.ReactNode; onOpen?: OpenConnection;
}) {
  return onOpen ? <button type="button" className="content-connection-link" onClick={() => onOpen(kind, id)}>{children}</button> : <span>{children}</span>;
}

function DiagnosticDetail({ item, onOpen }: { item: ContentDiagnosticItem; onOpen?: OpenConnection }) {
  if (item.kind === 'word') return <WordDetail item={item} onOpen={onOpen} />;
  if (item.kind === 'contrast_cluster') return <ClusterDetail item={item} onOpen={onOpen} />;
  return <CueDetail item={item} onOpen={onOpen} />;
}

function WordDetail({ item, onOpen }: { item: WordDiagnosticItem; onOpen?: OpenConnection }) {
  const { word } = item;
  return (
    <>
      <DetailHeading eyebrow="Word" title={word.hanzi} id={word.id} state={word.status} />
      <dl className="content-fact-grid">
        <Fact label="Pronunciation" value={word.pinyin} />
        <Fact label="Priority" value={String(word.priority)} />
        <Fact label="Practice streak" value={String(word.learningStreak)} />
        <Fact label="Created" value={formatDate(word.createdAt)} />
      </dl>
      <section className="content-detail-section">
        <h3>Meanings</h3>
        <MeaningList meanings={word.meanings} />
      </section>
      {word.personalNotes ? <DetailText label="Personal notes" value={word.personalNotes} /> : null}
      <section className="content-detail-section">
        <h3>Supplemental info</h3>
        {item.productionCueSupplements.length === 0 ? (
          <p className="notes">No post-reveal production supplement.</p>
        ) : item.productionCueSupplements.map((supplement) => (
          <div className="content-connection" key={supplement.supplementId}>
            <strong>{supplement.englishFrame}</strong>
            <span>{supplement.exampleSentence}</span>
            <span>{supplement.exampleTranslation}</span>
            {supplement.cueId ? <ConnectionLink kind="production_cue" id={supplement.cueId} onOpen={onOpen}>{onOpen ? 'Open cue · ' : ''}{supplementAttachmentLabel(supplement)}</ConnectionLink> : <code>{supplementAttachmentLabel(supplement)}</code>}
          </div>
        ))}
      </section>
      <section className="content-detail-section">
        <h3>Connected content</h3>
        <p>{item.contrastClusters.length} contrast cluster{item.contrastClusters.length === 1 ? '' : 's'}</p>
        {item.contrastClusters.map((cluster) => (
          <div className="content-connection" key={cluster.clusterId}>
            <ConnectionLink kind="contrast_cluster" id={cluster.clusterId} onOpen={onOpen}>{cluster.title}</ConnectionLink>
            <code>{cluster.clusterId}</code>
            {cluster.nuanceNote ? <span>{cluster.nuanceNote}</span> : null}
          </div>
        ))}
        <p>{item.productionTask ? `${item.productionTask.activeCueCount} active of ${item.productionTask.cueCount} durable cues` : 'No production task'}</p>
        {item.productionTask ? <code>{item.productionTask.taskId}</code> : null}
      </section>
    </>
  );
}

function ClusterDetail({ item, onOpen }: { item: ContrastClusterDiagnosticItem; onOpen?: OpenConnection }) {
  return (
    <>
      <DetailHeading eyebrow="Contrast cluster" title={item.title} id={item.id} />
      {item.note ? <DetailText label="Cluster note" value={item.note} /> : null}
      <section className="content-detail-section">
        <h3>Members · {item.members.length}</h3>
        {item.members.map(({ word, nuanceNote }) => (
          <div className="content-connection" key={word.id}>
            <ConnectionLink kind="word" id={word.id} onOpen={onOpen}>{word.hanzi} · {word.pinyin}</ConnectionLink>
            <span>{word.meaning}</span>
            {nuanceNote ? <span>{nuanceNote}</span> : null}
          </div>
        ))}
      </section>
      <section className="content-detail-section">
        <h3>Prompts · {item.prompts.length}</h3>
        {item.prompts.map((prompt) => (
          <div className="content-connection" key={prompt.id}>
            <strong>{prompt.promptText}</strong>
            <code>{prompt.id}</code>
            {prompt.explanation ? <span>{prompt.explanation}</span> : null}
          </div>
        ))}
      </section>
    </>
  );
}

function CueDetail({ item, onOpen }: { item: ProductionCueDiagnosticItem; onOpen?: OpenConnection }) {
  return (
    <>
      <DetailHeading
        eyebrow="Production cue"
        title={item.text}
        id={item.id}
        state={humanize(item.availabilityStatus)}
      />
      <dl className="content-fact-grid">
        <Fact label="Type" value={humanize(item.cueType)} />
        <div><dt>Anchor</dt><dd><ConnectionLink kind="word" id={item.anchorWord.id} onOpen={onOpen}>{item.anchorWord.hanzi} · {item.anchorWord.pinyin}</ConnectionLink></dd></div>
        <Fact label="Origin" value={item.attribution.origin} />
        <Fact label="Created" value={formatDate(item.createdAt)} />
      </dl>
      <DetailText label="Task id" value={item.taskId} code />
      {item.replacementCueId ? <section className="content-detail-section"><h3>Replacement cue</h3><ConnectionLink kind="production_cue" id={item.replacementCueId} onOpen={onOpen}>{item.replacementCueId}</ConnectionLink></section> : null}
      {item.attribution.invocationId ? <DetailText label="Invocation id" value={item.attribution.invocationId} code /> : null}
      <section className="content-detail-section">
        <h3>Accepted words · {item.acceptedWords.length}</h3>
        <div className="content-token-list">
          {item.acceptedWords.map((word) => <ConnectionLink key={word.id} kind="word" id={word.id} onOpen={onOpen}>{word.hanzi} · {word.meaning}</ConnectionLink>)}
        </div>
      </section>
      <section className="content-detail-section">
        <h3>Evidence</h3>
        {item.evidence ? (
          <dl className="content-fact-grid">
            <Fact label="Attempts" value={String(item.evidence.attemptCount)} />
            <Fact label="Anchor accepted" value={String(item.evidence.acceptedAnchorCount)} />
            <Fact label="Other accepted" value={String(item.evidence.acceptedNonAnchorCount)} />
            <Fact label="Rejected" value={String(item.evidence.rejectedCount)} />
            <Fact label="Active judgments" value={String(item.evidence.activeJudgmentCount)} />
            <Fact label="Projected" value={formatDate(item.evidence.updatedAt)} />
          </dl>
        ) : <p className="notes">No projected cue evidence yet.</p>}
      </section>
    </>
  );
}

function DetailHeading({ eyebrow, title, id, state }: { eyebrow: string; title: string; id: string; state?: string }) {
  return (
    <header className="content-detail-heading">
      <div>
        <span className="content-eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        <code>{id}</code>
      </div>
      {state ? <span className="content-state-pill">{state}</span> : null}
    </header>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function DetailText({ label, value, code = false }: { label: string; value: string; code?: boolean }) {
  return <section className="content-detail-section"><h3>{label}</h3>{code ? <code>{value}</code> : <p>{value}</p>}</section>;
}

function itemLabel(item: ContentDiagnosticItem): string {
  if (item.kind === 'word') return `${item.word.hanzi} · ${item.word.pinyin}`;
  if (item.kind === 'contrast_cluster') return item.title;
  return item.text;
}

function itemSummary(item: ContentDiagnosticItem): string {
  if (item.kind === 'word') {
    const supplementNote = item.productionCueSupplements.length > 0 ? ' · has supplement' : '';
    return `${item.word.status} · ${item.word.meaning}${supplementNote}`;
  }
  if (item.kind === 'contrast_cluster') return `${item.members.length} members · ${item.prompts.length} prompts`;
  return `${humanize(item.availabilityStatus)} · ${item.anchorWord.hanzi} · ${humanize(item.cueType)}`;
}

function supplementAttachmentLabel(supplement: WordDiagnosticSupplement): string {
  if (supplement.cueId === null) return 'Meaning-derived fallback';
  return `${supplement.cueType ? humanize(supplement.cueType) : 'cue'} · ${supplement.cueId}`;
}

function humanize(value: string): string {
  return value.replaceAll('_', ' ');
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}
