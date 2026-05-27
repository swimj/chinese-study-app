import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { ContrastClusterContent, ContrastIntakeGroup } from '../services/api';
import type { Word } from '../types';

type IntakeActionMode = 'create' | 'existing' | 'prompt';

type PromptFormState = {
  targetWordId: string;
  promptText: string;
  explanation: string;
};

const emptyPromptForm: PromptFormState = {
  targetWordId: '',
  promptText: '',
  explanation: '',
};

export function IntakePage({
  groups,
  activeGroupIndex,
  isSaving,
  wordSearchResults,
  wordSearchLoading,
  onSelectGroupIndex,
  onSearchCandidateWords,
  onAcceptGroup,
  onDismissGroup,
  onCreateCluster,
  onAddToCluster,
  onAddPrompt,
}: {
  groups: ContrastIntakeGroup[];
  activeGroupIndex: number;
  isSaving: boolean;
  wordSearchResults: Word[];
  wordSearchLoading: boolean;
  onSelectGroupIndex: (index: number) => void;
  onSearchCandidateWords: (query: string) => Promise<void>;
  onAcceptGroup: (selector: IntakeGroupSelector) => Promise<void>;
  onDismissGroup: (selector: IntakeGroupSelector) => Promise<void>;
  onCreateCluster: (input: IntakeGroupSelector & {
    resolvedCandidateWordId: string;
    title: string;
    note: string;
    targetNuanceNote: string;
    candidateNuanceNote: string;
    prompt: PromptFormState;
  }) => Promise<void>;
  onAddToCluster: (input: IntakeGroupSelector & {
    clusterId: string;
    resolvedCandidateWordId: string;
    targetNuanceNote: string;
    candidateNuanceNote: string;
    prompt: PromptFormState;
  }) => Promise<void>;
  onAddPrompt: (input: IntakeGroupSelector & {
    clusterId: string;
    prompt: PromptFormState;
  }) => Promise<void>;
}) {
  const activeGroup = groups[activeGroupIndex] ?? null;

  return (
    <section className="intake-page">
      <header className="header">
        <div>
          <h1 className="title">Intake</h1>
          <p className="subtitle">Contextual selection candidates</p>
        </div>
        <span className="badge">{groups.length} open</span>
      </header>

      {groups.length === 0 || !activeGroup ? (
        <div className="panel">
          <p className="notes">No open contrast intake groups.</p>
        </div>
      ) : (
        <div className="intake-layout">
          <aside className="panel cluster-list-panel">
            <h2>Queue</h2>
            <div className="cluster-list">
              {groups.map((group, index) => (
                <button
                  key={group.groupKey}
                  type="button"
                  className={index === activeGroupIndex ? 'cluster-list-item active' : 'cluster-list-item'}
                  onClick={() => onSelectGroupIndex(index)}
                  disabled={isSaving}
                >
                  <span>{formatGroupTitle(group)}</span>
                  <small>{group.count} seen · latest {formatTimestamp(group.latestCreatedAt)}</small>
                </button>
              ))}
            </div>
          </aside>

          <IntakeGroupDetail
            group={activeGroup}
            groupIndex={activeGroupIndex}
            groupCount={groups.length}
            isSaving={isSaving}
            wordSearchResults={wordSearchResults}
            wordSearchLoading={wordSearchLoading}
            onPrevious={() => onSelectGroupIndex(activeGroupIndex - 1)}
            onNext={() => onSelectGroupIndex(activeGroupIndex + 1)}
            onSearchCandidateWords={onSearchCandidateWords}
            onAcceptGroup={onAcceptGroup}
            onDismissGroup={onDismissGroup}
            onCreateCluster={onCreateCluster}
            onAddToCluster={onAddToCluster}
            onAddPrompt={onAddPrompt}
          />
        </div>
      )}
    </section>
  );
}

type IntakeGroupSelector = {
  targetWordId: string;
  candidateText?: string | null;
  matchedWordId?: string | null;
};

function IntakeGroupDetail({
  group,
  groupIndex,
  groupCount,
  isSaving,
  wordSearchResults,
  wordSearchLoading,
  onPrevious,
  onNext,
  onSearchCandidateWords,
  onAcceptGroup,
  onDismissGroup,
  onCreateCluster,
  onAddToCluster,
  onAddPrompt,
}: {
  group: ContrastIntakeGroup;
  groupIndex: number;
  groupCount: number;
  isSaving: boolean;
  wordSearchResults: Word[];
  wordSearchLoading: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onSearchCandidateWords: (query: string) => Promise<void>;
  onAcceptGroup: (selector: IntakeGroupSelector) => Promise<void>;
  onDismissGroup: (selector: IntakeGroupSelector) => Promise<void>;
  onCreateCluster: (input: IntakeGroupSelector & {
    resolvedCandidateWordId: string;
    title: string;
    note: string;
    targetNuanceNote: string;
    candidateNuanceNote: string;
    prompt: PromptFormState;
  }) => Promise<void>;
  onAddToCluster: (input: IntakeGroupSelector & {
    clusterId: string;
    resolvedCandidateWordId: string;
    targetNuanceNote: string;
    candidateNuanceNote: string;
    prompt: PromptFormState;
  }) => Promise<void>;
  onAddPrompt: (input: IntakeGroupSelector & {
    clusterId: string;
    prompt: PromptFormState;
  }) => Promise<void>;
}) {
  const initialResolvedWord = group.matchedWord;
  const singleWordIntake = !group.matchedWordId && !group.candidateText;
  const [resolvedWord, setResolvedWord] = useState<Word | null>(initialResolvedWord);
  const [candidateQuery, setCandidateQuery] = useState(group.candidateText ?? '');
  const [mode, setMode] = useState<IntakeActionMode>('create');
  const [clusterTitle, setClusterTitle] = useState('');
  const [clusterNote, setClusterNote] = useState('');
  const [targetNuanceNote, setTargetNuanceNote] = useState('');
  const [candidateNuanceNote, setCandidateNuanceNote] = useState('');
  const [selectedClusterId, setSelectedClusterId] = useState('');
  const [promptForm, setPromptForm] = useState<PromptFormState>(emptyPromptForm);
  const [searchAttempted, setSearchAttempted] = useState(false);

  const selector = useMemo(() => ({
    targetWordId: group.targetWordId,
    candidateText: group.candidateText,
    matchedWordId: group.matchedWordId,
  }), [group.candidateText, group.matchedWordId, group.targetWordId]);
  const selectedCluster = group.relevantClusters.find((cluster) => cluster.id === selectedClusterId) ?? null;
  const sharedClusters = group.relevantClusters.filter((cluster) => group.coverage.sharedClusterIds.includes(cluster.id));
  const expandableClusters = resolvedWord
    ? group.relevantClusters.filter((cluster) => getMissingExpansionWord(group, resolvedWord, cluster) !== null)
    : [];
  const canCreateSet = !singleWordIntake;
  const canExpandSet = expandableClusters.length > 0;
  const canAddPrompt = sharedClusters.length > 0;
  const selectedClusterMemberIds = new Set(selectedCluster?.members.map((member) => member.wordId) ?? []);
  const expansionWord = selectedCluster && resolvedWord ? getMissingExpansionWord(group, resolvedWord, selectedCluster) : null;
  const canSubmitContent = Boolean((singleWordIntake || resolvedWord) && promptForm.targetWordId && promptForm.promptText.trim().length > 0);
  const canAcceptCovered = group.coverage.usablePromptCount > 0;

  useEffect(() => {
    setResolvedWord(group.matchedWord);
    setCandidateQuery(group.candidateText ?? '');
    setMode(group.coverage.hasSharedCluster ? 'prompt' : singleWordIntake ? 'prompt' : 'create');
    setClusterTitle(
      group.matchedWord || group.candidateText
        ? `${group.targetWord.hanzi} / ${group.matchedWord?.hanzi ?? group.candidateText ?? ''}`.trim()
        : group.targetWord.hanzi,
    );
    setClusterNote('');
    setTargetNuanceNote('');
    setCandidateNuanceNote('');
    setSelectedClusterId(group.coverage.sharedClusterIds[0] ?? group.relevantClusters[0]?.id ?? '');
    setPromptForm({
      ...emptyPromptForm,
      targetWordId: group.targetWordId,
    });
    setSearchAttempted(false);
  }, [group]);

  useEffect(() => {
    if (singleWordIntake) {
      if (mode === 'prompt') {
        setSelectedClusterId((current) =>
          sharedClusters.some((cluster) => cluster.id === current) ? current : sharedClusters[0]?.id ?? '',
        );
      }
      return;
    }

    if (!resolvedWord) {
      return;
    }

    const nextSharedClusters = group.relevantClusters.filter((cluster) => {
      const memberIds = new Set(cluster.members.map((member) => member.wordId));
      return memberIds.has(group.targetWordId) && memberIds.has(resolvedWord.id);
    });
    const nextExpandableClusters = group.relevantClusters.filter((cluster) => getMissingExpansionWord(group, resolvedWord, cluster) !== null);

    if (mode === 'prompt') {
      setSelectedClusterId((current) =>
        nextSharedClusters.some((cluster) => cluster.id === current) ? current : nextSharedClusters[0]?.id ?? '',
      );
      return;
    }

    if (mode === 'existing') {
      setSelectedClusterId((current) =>
        nextExpandableClusters.some((cluster) => cluster.id === current) ? current : nextExpandableClusters[0]?.id ?? '',
      );
    }
  }, [group, mode, resolvedWord, sharedClusters, singleWordIntake]);

  useEffect(() => {
    if (mode === 'existing' && expansionWord && promptForm.targetWordId !== expansionWord.id) {
      setPromptForm((current) => ({
        ...current,
        targetWordId: expansionWord.id,
      }));
    }
  }, [expansionWord, mode, promptForm.targetWordId]);

  async function handleCandidateSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearchAttempted(true);
    await onSearchCandidateWords(candidateQuery);
  }

  async function handleCreateCluster(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resolvedWord || !canSubmitContent) {
      return;
    }

    await onCreateCluster({
      ...selector,
      resolvedCandidateWordId: resolvedWord.id,
      title: clusterTitle,
      note: clusterNote,
      targetNuanceNote,
      candidateNuanceNote,
      prompt: promptForm,
    });
  }

  async function handleAddToCluster(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resolvedWord || !selectedClusterId || !expansionWord || !canSubmitContent) {
      return;
    }

    await onAddToCluster({
      ...selector,
      clusterId: selectedClusterId,
      resolvedCandidateWordId: resolvedWord.id,
      targetNuanceNote,
      candidateNuanceNote,
      prompt: promptForm,
    });
  }

  async function handleAddPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedClusterId || !canSubmitContent) {
      return;
    }

    await onAddPrompt({
      ...selector,
      clusterId: selectedClusterId,
      prompt: promptForm,
    });
  }

  return (
    <div className="cluster-detail-stack">
      <section className="panel cluster-detail-panel">
        <div className="pagination-bar">
          <div className="pagination-summary">
            <span className="badge">{groupIndex + 1} / {groupCount}</span>
          </div>
          <div className="pagination-actions">
            <button type="button" className="secondary-button" onClick={onPrevious} disabled={isSaving || groupIndex === 0}>
              Previous
            </button>
            <button type="button" className="secondary-button" onClick={onNext} disabled={isSaving || groupIndex >= groupCount - 1}>
              Next
            </button>
          </div>
        </div>

        <div className={singleWordIntake ? 'intake-word-single' : 'intake-word-pair'}>
          <WordCard title="Target" word={group.targetWord} />
          {!singleWordIntake ? (
            <WordCard title="Candidate" word={resolvedWord} fallback={group.candidateText ?? 'Unresolved'} />
          ) : null}
        </div>

        {!group.matchedWord && !singleWordIntake ? (
          <form className="intake-search-form" onSubmit={(event) => void handleCandidateSearch(event)}>
            <label>
              <span>Resolve candidate</span>
              <input
                type="text"
                value={candidateQuery}
                onChange={(event) => setCandidateQuery(event.target.value)}
                disabled={isSaving || wordSearchLoading}
              />
            </label>
            <button type="submit" disabled={isSaving || wordSearchLoading || candidateQuery.trim().length === 0}>
              {wordSearchLoading ? 'Searching...' : 'Search'}
            </button>
            {wordSearchResults.length > 0 ? (
              <div className="intake-search-results">
                {wordSearchResults.map((word) => (
                  <button
                    key={word.id}
                    type="button"
                    className={resolvedWord?.id === word.id ? 'cluster-list-item active' : 'cluster-list-item'}
                    onClick={() => {
                      setResolvedWord(word);
                      setClusterTitle(`${group.targetWord.hanzi} / ${word.hanzi}`);
                    }}
                    disabled={isSaving}
                  >
                    <span>{word.hanzi}</span>
                    <small>{word.pinyin} · {word.meaning}</small>
                  </button>
                ))}
              </div>
            ) : searchAttempted && !wordSearchLoading ? (
              <p className="notes">No matching words found.</p>
            ) : null}
          </form>
        ) : null}
      </section>

      <section className="panel cluster-detail-panel">
        <div className="cluster-panel-heading">
          <div>
            <h2>Evidence</h2>
            <p className="notes">{group.count} seen · {formatTimestamp(group.firstCreatedAt)} to {formatTimestamp(group.latestCreatedAt)}</p>
          </div>
          {canAcceptCovered ? <span className="badge">covered</span> : <span className="badge">needs content</span>}
        </div>
        {group.notes.length > 0 ? (
          <div className="intake-note-list">
            {group.notes.map((note) => <p key={note}>{note}</p>)}
          </div>
        ) : null}
        <div className="intake-source-list">
          {group.sources.map((source) => (
            <div key={source.id} className="intake-source-row">
              <span>{formatTimestamp(source.createdAt)}</span>
              <span>{source.sourceActionKind ?? 'manual'}</span>
              <span>{source.note || source.candidateText || 'No note'}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel cluster-detail-panel">
        <div className="cluster-panel-heading">
          <h2>Existing content</h2>
          <span className="badge">{group.coverage.usablePromptCount} usable prompts</span>
        </div>
        {group.relevantClusters.length === 0 ? (
          <p className="notes">No relevant contrast clusters.</p>
        ) : (
          <div className="intake-cluster-list">
            {group.relevantClusters.map((cluster) => (
              <ExistingClusterCard
                key={cluster.id}
                cluster={cluster}
                shared={group.coverage.sharedClusterIds.includes(cluster.id)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="panel cluster-detail-panel">
        <div className="priority-subtabs" role="tablist" aria-label="Intake actions">
          {canCreateSet ? (
            <button type="button" className={mode === 'create' ? 'priority-subtab active' : 'priority-subtab'} onClick={() => setMode('create')}>
              New set
            </button>
          ) : null}
          {canExpandSet ? (
            <button type="button" className={mode === 'existing' ? 'priority-subtab active' : 'priority-subtab'} onClick={() => setMode('existing')}>
              Expand set
            </button>
          ) : null}
          {canAddPrompt ? (
            <button type="button" className={mode === 'prompt' ? 'priority-subtab active' : 'priority-subtab'} onClick={() => setMode('prompt')}>
              Add prompt
            </button>
          ) : null}
        </div>

        {!canCreateSet && !canExpandSet && !canAddPrompt ? (
          <p className="notes">No existing cluster contains this intake word yet.</p>
        ) : mode === 'create' && canCreateSet ? (
          <form className="cluster-prompt-form" onSubmit={(event) => void handleCreateCluster(event)}>
            <TextInput label="Title" value={clusterTitle} disabled={isSaving} onChange={setClusterTitle} />
            <TextareaInput label="Set note" value={clusterNote} disabled={isSaving} rows={2} onChange={setClusterNote} />
            <TextareaInput label={`${group.targetWord.hanzi} nuance`} value={targetNuanceNote} disabled={isSaving} rows={2} onChange={setTargetNuanceNote} />
            {!singleWordIntake ? (
              <TextareaInput label={`${resolvedWord?.hanzi ?? 'Candidate'} nuance`} value={candidateNuanceNote} disabled={isSaving} rows={2} onChange={setCandidateNuanceNote} />
            ) : null}
            <PromptFields
              group={group}
              resolvedWord={singleWordIntake ? null : resolvedWord}
              selectedCluster={null}
              promptForm={promptForm}
              disabled={isSaving}
              onChange={setPromptForm}
            />
            <button type="submit" disabled={isSaving || !resolvedWord || clusterTitle.trim().length === 0 || !canSubmitContent}>
              {isSaving ? 'Saving...' : 'Create set'}
            </button>
          </form>
        ) : mode === 'existing' && canExpandSet ? (
          <form className="cluster-prompt-form" onSubmit={(event) => void handleAddToCluster(event)}>
            <ClusterSelect
              clusters={expandableClusters}
              selectedClusterId={selectedClusterId}
              disabled={isSaving}
              onChange={setSelectedClusterId}
            />
            {expansionWord ? (
              <TextareaInput
                label={`${expansionWord.hanzi} nuance`}
                value={expansionWord.id === group.targetWordId ? targetNuanceNote : candidateNuanceNote}
                disabled={isSaving}
                rows={2}
                onChange={expansionWord.id === group.targetWordId ? setTargetNuanceNote : setCandidateNuanceNote}
              />
            ) : null}
            <PromptFields
              group={group}
              resolvedWord={singleWordIntake ? null : resolvedWord}
              selectedCluster={null}
              targetOverride={expansionWord}
              promptForm={promptForm}
              disabled={isSaving}
              onChange={setPromptForm}
            />
            <button type="submit" disabled={isSaving || !resolvedWord || !selectedClusterId || !expansionWord || !canSubmitContent}>
              {isSaving ? 'Saving...' : 'Expand set'}
            </button>
          </form>
        ) : canAddPrompt ? (
          <form className="cluster-prompt-form" onSubmit={(event) => void handleAddPrompt(event)}>
            <ClusterSelect
              clusters={sharedClusters}
              selectedClusterId={selectedClusterId}
              disabled={isSaving}
              onChange={setSelectedClusterId}
            />
            <PromptFields
              group={group}
              resolvedWord={singleWordIntake ? null : resolvedWord}
              selectedCluster={selectedCluster}
              promptForm={promptForm}
              disabled={isSaving}
              onChange={setPromptForm}
            />
            <button type="submit" disabled={isSaving || !selectedClusterId || !canSubmitContent}>
              {isSaving ? 'Saving...' : 'Add prompt'}
            </button>
          </form>
        ) : (
          <p className="notes">No action is available for the current selection.</p>
        )}

        <div className="intake-terminal-actions">
          <button type="button" className="secondary-button" onClick={() => void onAcceptGroup(selector)} disabled={isSaving || !canAcceptCovered}>
            Mark covered
          </button>
          <button type="button" className="secondary-button" onClick={() => void onDismissGroup(selector)} disabled={isSaving}>
            Dismiss
          </button>
        </div>
      </section>
    </div>
  );
}

function WordCard({ title, word, fallback }: { title: string; word: Word | null; fallback?: string }) {
  return (
    <article className="cluster-member-card">
      <span className="prompt-label">{title}</span>
      {word ? (
        <>
          <strong>{word.hanzi}</strong>
          <span>{word.pinyin}</span>
          <p>{word.meaning}</p>
          {word.personalNotes.length > 0 ? <small>{word.personalNotes}</small> : null}
        </>
      ) : (
        <>
          <strong>{fallback ?? 'Unresolved'}</strong>
          <p className="notes">No matched word.</p>
        </>
      )}
    </article>
  );
}

function formatGroupTitle(group: ContrastIntakeGroup): string {
  const candidateLabel = group.matchedWord?.hanzi ?? group.candidateText;
  return candidateLabel ? `${group.targetWord.hanzi} / ${candidateLabel}` : group.targetWord.hanzi;
}

function ExistingClusterCard({ cluster, shared }: { cluster: ContrastClusterContent; shared: boolean }) {
  return (
    <article className={shared ? 'cluster-prompt-card intake-shared-cluster' : 'cluster-prompt-card'}>
      <div>
        <span className="prompt-label">{shared ? 'Shared' : 'Related'}</span>
        <strong>{cluster.title}</strong>
      </div>
      <p>{cluster.members.map((member) => member.word.hanzi).join(' / ')}</p>
      <small>{cluster.prompts.length} prompts</small>
    </article>
  );
}

function getMissingExpansionWord(
  group: ContrastIntakeGroup,
  resolvedWord: Word,
  cluster: ContrastClusterContent,
): Word | null {
  const memberIds = new Set(cluster.members.map((member) => member.wordId));
  const hasTarget = memberIds.has(group.targetWordId);
  const hasCandidate = memberIds.has(resolvedWord.id);

  if (hasTarget === hasCandidate) {
    return null;
  }

  return hasTarget ? resolvedWord : group.targetWord;
}

function ClusterSelect({
  clusters,
  selectedClusterId,
  disabled,
  onChange,
}: {
  clusters: ContrastClusterContent[];
  selectedClusterId: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span>Set</span>
      <select value={selectedClusterId} disabled={disabled || clusters.length === 0} required onChange={(event) => onChange(event.target.value)}>
        {clusters.map((cluster) => (
          <option key={cluster.id} value={cluster.id}>
            {cluster.title}
          </option>
        ))}
      </select>
    </label>
  );
}

function PromptFields({
  group,
  resolvedWord,
  selectedCluster,
  targetOverride,
  promptForm,
  disabled,
  onChange,
}: {
  group: ContrastIntakeGroup;
  resolvedWord: Word | null;
  selectedCluster: ContrastClusterContent | null;
  targetOverride?: Word | null;
  promptForm: PromptFormState;
  disabled: boolean;
  onChange: (value: PromptFormState) => void;
}) {
  const targetOptions = targetOverride
    ? [targetOverride]
    : [
        ...(selectedCluster?.members.map((member) => member.word) ?? []),
        group.targetWord,
        resolvedWord,
      ].filter((word): word is Word => Boolean(word));
  const uniqueTargetOptions = [...new Map(targetOptions.map((word) => [word.id, word])).values()];

  return (
    <>
      <label>
        <span>Prompt target</span>
        <select
          value={promptForm.targetWordId}
          disabled={disabled}
          required
          onChange={(event) => onChange({ ...promptForm, targetWordId: event.target.value })}
        >
          {uniqueTargetOptions.map((word) => (
            <option key={word.id} value={word.id}>
              {word.hanzi}
            </option>
          ))}
        </select>
      </label>
      <TextareaInput
        label="Prompt"
        value={promptForm.promptText}
        disabled={disabled}
        rows={3}
        onChange={(promptText) => onChange({ ...promptForm, promptText })}
      />
      <TextareaInput
        label="Explanation"
        value={promptForm.explanation}
        disabled={disabled}
        rows={3}
        onChange={(explanation) => onChange({ ...promptForm, explanation })}
      />
    </>
  );
}

function TextInput({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <input type="text" value={value} disabled={disabled} required onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function TextareaInput({
  label,
  value,
  disabled,
  rows,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  rows: number;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <textarea value={value} disabled={disabled} rows={rows} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
