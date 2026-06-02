import { Fragment, useEffect, useMemo, useState, type FormEvent } from 'react';
import type { ContrastClusterContent, ContrastIntakeWord } from '../services/api';
import type { Word } from '../types';

type MemberEditorState = {
  mode: 'existing' | 'new';
  wordId: string;
  wordHanzi: string;
  nuanceNote: string;
};

type PromptEditorState = {
  mode: 'existing' | 'new';
  promptId: string | null;
  targetWordId: string;
  promptText: string;
  explanation: string;
};

export function IntakePage({
  words,
  selectedWordIndex,
  isSaving,
  onSelectWordIndex,
  onResolveWord,
  onMergeSuggestedClusters,
  onSuppressProduction,
  onReportBadPrompt,
  onCreateClusterForWord,
  clusters,
  selectedClusterId,
  wordSearchResults,
  isSavingCluster,
  onSelectCluster,
  onSearchWords,
  onCreateCluster,
  onUpdateCluster,
  onAddMember,
  onUpdateMember,
  onRemoveMember,
  onCreatePrompt,
  onUpdatePrompt,
  onResolvePromptFeedback,
  onDeletePrompt,
}: {
  words: ContrastIntakeWord[];
  selectedWordIndex: number;
  isSaving: boolean;
  onSelectWordIndex: (index: number) => void;
  onResolveWord: (targetWordId: string) => Promise<void>;
  onMergeSuggestedClusters: (input: { targetWordId: string; destinationClusterId: string }) => Promise<string>;
  onSuppressProduction: (targetWordId: string) => Promise<void>;
  onReportBadPrompt: (input: { targetWordId: string; note?: string }) => Promise<void>;
  onCreateClusterForWord: (input: {
    targetWordId: string;
    candidateWordIds?: string[];
    title: string;
    note?: string;
  }) => Promise<string>;
  clusters: ContrastClusterContent[];
  selectedClusterId: string | null;
  wordSearchResults: Word[];
  isSavingCluster: boolean;
  onSelectCluster: (clusterId: string) => void;
  onSearchWords: (query: string) => Promise<void>;
  onCreateCluster: (input: { title: string; note?: string }) => Promise<void>;
  onUpdateCluster: (input: { id: string; title: string; note: string }) => Promise<void>;
  onAddMember: (input: { clusterId: string; wordId: string; nuanceNote?: string }) => Promise<void>;
  onUpdateMember: (input: { clusterId: string; wordId: string; nuanceNote?: string; displayOrder?: number | null }) => Promise<void>;
  onRemoveMember: (input: { clusterId: string; wordId: string }) => Promise<void>;
  onCreatePrompt: (input: { clusterId: string; targetWordId: string; promptText: string; explanation: string }) => Promise<void>;
  onUpdatePrompt: (input: { id: string; targetWordId: string; promptText: string; explanation: string }) => Promise<void>;
  onResolvePromptFeedback: (input: { id: string; note?: string }) => Promise<void>;
  onDeletePrompt: (id: string) => Promise<void>;
}) {
  const [focusMode, setFocusMode] = useState<'intake' | 'cluster'>('intake');
  const [lastIntakeWordId, setLastIntakeWordId] = useState<string | null>(words[0]?.targetWordId ?? null);
  const [intakeSearch, setIntakeSearch] = useState('');
  const [intakeWindowStart, setIntakeWindowStart] = useState(0);
  const [clusterSearch, setClusterSearch] = useState('');
  const [showOnlyNeedsMoreLoveClusters, setShowOnlyNeedsMoreLoveClusters] = useState(false);
  const [showOnlyOpenIntakeOverlapClusters, setShowOnlyOpenIntakeOverlapClusters] = useState(false);
  const [showOnlyFlaggedPromptClusters, setShowOnlyFlaggedPromptClusters] = useState(false);
  const [clusterWindowStart, setClusterWindowStart] = useState(0);
  const [newClusterTitle, setNewClusterTitle] = useState('');
  const [newClusterNote, setNewClusterNote] = useState('');
  const [memberAddQuery, setMemberAddQuery] = useState('');
  const [expandedMemberWordId, setExpandedMemberWordId] = useState<string | null>(null);
  const [expandedPromptId, setExpandedPromptId] = useState<string | null>(null);
  const [addPromptRowOpen, setAddPromptRowOpen] = useState(false);
  const [memberEditor, setMemberEditor] = useState<MemberEditorState | null>(null);
  const [promptEditor, setPromptEditor] = useState<PromptEditorState | null>(null);
  const [editingClusterTitle, setEditingClusterTitle] = useState(false);
  const [clusterTitleDraft, setClusterTitleDraft] = useState('');

  const intakeFiltered = useMemo(() => {
    const q = intakeSearch.trim();
    if (q.length === 0) {
      return words;
    }
    return words.filter((word) =>
      word.targetWord.hanzi.includes(q) || word.targetWord.meaning.toLowerCase().includes(q.toLowerCase()),
    );
  }, [intakeSearch, words]);
  const selectedIntakeWord = intakeFiltered[selectedWordIndex] ?? intakeFiltered[0] ?? null;
  const intakeVisible = intakeFiltered.slice(intakeWindowStart, intakeWindowStart + 3);

  const intakeTargetWordIdSet = useMemo(() => new Set(words.map((word) => word.targetWordId)), [words]);
  const clusterFiltered = useMemo(() => {
    const q = clusterSearch.trim();
    return clusters.filter((cluster) =>
      (!showOnlyNeedsMoreLoveClusters || clusterNeedsMoreLove(cluster)) &&
      (!showOnlyOpenIntakeOverlapClusters || clusterHasOpenIntakeOverlap(cluster, intakeTargetWordIdSet)) &&
      (!showOnlyFlaggedPromptClusters || clusterHasFlaggedPrompts(cluster)) &&
      (
        q.length === 0 ||
        cluster.title.toLowerCase().includes(q.toLowerCase()) ||
        cluster.members.some((member) => member.word.hanzi.includes(q))
      ),
    );
  }, [
    clusterSearch,
    clusters,
    intakeTargetWordIdSet,
    showOnlyNeedsMoreLoveClusters,
    showOnlyOpenIntakeOverlapClusters,
    showOnlyFlaggedPromptClusters,
  ]);
  const needsMoreLoveClusterCount = useMemo(
    () => clusters.filter((cluster) => clusterNeedsMoreLove(cluster)).length,
    [clusters],
  );
  const openIntakeOverlapClusterCount = useMemo(
    () => clusters.filter((cluster) => clusterHasOpenIntakeOverlap(cluster, intakeTargetWordIdSet)).length,
    [clusters, intakeTargetWordIdSet],
  );
  const flaggedPromptClusterCount = useMemo(
    () => clusters.filter((cluster) => clusterHasFlaggedPrompts(cluster)).length,
    [clusters],
  );

  const selectedCluster =
    clusterFiltered.find((cluster) => cluster.id === selectedClusterId) ??
    clusters.find((cluster) => cluster.id === selectedClusterId) ??
    clusterFiltered[0] ??
    clusters[0] ??
    null;
  const clusterVisible = clusterFiltered.slice(clusterWindowStart, clusterWindowStart + 3);

  useEffect(() => {
    if (words.length > 0 && !selectedIntakeWord) {
      onSelectWordIndex(0);
    }
  }, [selectedIntakeWord, onSelectWordIndex, words.length]);

  useEffect(() => {
    if (focusMode === 'intake' && selectedIntakeWord) {
      setLastIntakeWordId(selectedIntakeWord.targetWordId);
    }
  }, [selectedIntakeWord, focusMode]);

  useEffect(() => {
    if (words.length > 0) {
      setFocusMode('intake');
    } else if (clusters.length > 0) {
      setFocusMode('cluster');
    }
  }, [clusters.length, words.length]);

  useEffect(() => {
    setMemberEditor(null);
    setPromptEditor(null);
    setExpandedMemberWordId(null);
    setExpandedPromptId(null);
    setAddPromptRowOpen(false);
    setMemberAddQuery('');
    setEditingClusterTitle(false);
    setClusterTitleDraft(selectedCluster?.title ?? '');
  }, [selectedCluster?.id]);

  async function handleResolve() {
    if (!selectedIntakeWord) {
      return;
    }
    const unresolvedCandidateCount = selectedIntakeWord.candidates.filter((candidate) => candidate.unaddressed).length;
    if (unresolvedCandidateCount > 0) {
      const confirmed = window.confirm(`${unresolvedCandidateCount} candidate(s) appear unaddressed. Resolve anyway?`);
      if (!confirmed) {
        return;
      }
    }
    await onResolveWord(selectedIntakeWord.targetWordId);
  }

  async function handleCreateClusterForWord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedIntakeWord || newClusterTitle.trim().length === 0) {
      return;
    }
    const clusterId = await onCreateClusterForWord({
      targetWordId: selectedIntakeWord.targetWordId,
      candidateWordIds: selectedIntakeWord.resolvedCandidateWordIds,
      title: newClusterTitle,
      note: newClusterNote,
    });
    setNewClusterTitle('');
    setNewClusterNote('');
    openCluster(clusterId);
  }

  async function handleCreateCluster(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newClusterTitle.trim().length === 0) {
      return;
    }
    await onCreateCluster({ title: newClusterTitle, note: newClusterNote });
    setNewClusterTitle('');
    setNewClusterNote('');
  }

  function openCluster(clusterId: string) {
    onSelectCluster(clusterId);
    setFocusMode('cluster');
  }

  async function handleMergeSuggestedCluster(destinationClusterId: string) {
    if (!selectedIntakeWord || selectedIntakeWord.suggestedClusters.length < 2) {
      return;
    }

    const destinationCluster = selectedIntakeWord.suggestedClusters.find((cluster) => cluster.id === destinationClusterId);
    if (!destinationCluster) {
      return;
    }

    const sourceTitles = selectedIntakeWord.suggestedClusters
      .filter((cluster) => cluster.id !== destinationClusterId)
      .map((cluster) => cluster.title);
    const confirmed = window.confirm(
      `Merge ${sourceTitles.length} other suggested group(s) into "${destinationCluster.title}"?\n\nMerged groups: ${sourceTitles.join(', ')}`,
    );
    if (!confirmed) {
      return;
    }

    const clusterId = await onMergeSuggestedClusters({
      targetWordId: selectedIntakeWord.targetWordId,
      destinationClusterId,
    });
    openCluster(clusterId);
  }

  function backToLastIntake() {
    if (!lastIntakeWordId) {
      setFocusMode('intake');
      return;
    }
    const index = intakeFiltered.findIndex((word) => word.targetWordId === lastIntakeWordId);
    if (index >= 0) {
      onSelectWordIndex(index);
    }
    setFocusMode('intake');
  }

  async function submitMemberEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCluster || !memberEditor) {
      return;
    }
    if (memberEditor.mode === 'new') {
      await onAddMember({
        clusterId: selectedCluster.id,
        wordId: memberEditor.wordId,
        nuanceNote: memberEditor.nuanceNote,
      });
    } else {
      await onUpdateMember({
        clusterId: selectedCluster.id,
        wordId: memberEditor.wordId,
        nuanceNote: memberEditor.nuanceNote,
      });
    }
    setMemberEditor(null);
    setMemberAddQuery('');
  }

  async function submitPromptEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCluster || !promptEditor) {
      return;
    }
    if (promptEditor.mode === 'new') {
      await onCreatePrompt({
        clusterId: selectedCluster.id,
        targetWordId: promptEditor.targetWordId,
        promptText: promptEditor.promptText,
        explanation: promptEditor.explanation,
      });
    } else if (promptEditor.promptId) {
      await onUpdatePrompt({
        id: promptEditor.promptId,
        targetWordId: promptEditor.targetWordId,
        promptText: promptEditor.promptText,
        explanation: promptEditor.explanation,
      });
    }
    setPromptEditor(null);
  }

  async function handleDeleteMemberFromEditor() {
    if (!selectedCluster || !memberEditor || memberEditor.mode !== 'existing') {
      return;
    }
    await onRemoveMember({ clusterId: selectedCluster.id, wordId: memberEditor.wordId });
    setMemberEditor(null);
    setExpandedMemberWordId(null);
    setMemberAddQuery('');
  }

  async function handleDeletePromptFromEditor() {
    if (!promptEditor || promptEditor.mode !== 'existing' || !promptEditor.promptId) {
      return;
    }
    await onDeletePrompt(promptEditor.promptId);
    setPromptEditor(null);
    setExpandedPromptId(null);
    setAddPromptRowOpen(false);
  }

  return (
    <section className="intake-page">
      <header className="header">
        <div>
          <h1 className="title">Contrast Management</h1>
          <p className="subtitle">Intake triage and cluster editing in one workflow</p>
        </div>
      </header>

      <div className="intake-layout">
        <aside className="panel cluster-list-panel" style={{ display: 'grid', gridTemplateRows: '1fr 1fr', gap: '1rem' }}>
          <section>
            <div className="cluster-panel-heading">
              <h2>Intake Queue</h2>
              <span className="badge">{intakeFiltered.length}</span>
            </div>
            <input type="search" placeholder="Search intake word" value={intakeSearch} onChange={(event) => setIntakeSearch(event.target.value)} />
            <div className="cluster-list">
              {intakeVisible.map((word) => (
                <button
                  key={word.targetWordId}
                  type="button"
                  className={selectedIntakeWord?.targetWordId === word.targetWordId && focusMode === 'intake' ? 'cluster-list-item active' : 'cluster-list-item'}
                  onClick={() => {
                    const index = intakeFiltered.findIndex((entry) => entry.targetWordId === word.targetWordId);
                    if (index >= 0) {
                      onSelectWordIndex(index);
                    }
                    setFocusMode('intake');
                  }}
                >
                  <span>{word.targetWord.hanzi}</span>
                  <small>{word.openRowCount} mentions</small>
                </button>
              ))}
            </div>
            <div className="pagination-actions">
              <button type="button" className="secondary-button" onClick={() => setIntakeWindowStart((current) => Math.max(0, current - 1))} disabled={intakeWindowStart === 0}>Prev</button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setIntakeWindowStart((current) => Math.min(Math.max(intakeFiltered.length - 3, 0), current + 1))}
                disabled={intakeWindowStart >= Math.max(intakeFiltered.length - 3, 0)}
              >
                Next
              </button>
            </div>
          </section>
          <section>
            <div className="cluster-panel-heading">
              <h2>Clusters</h2>
              <span className="badge">{clusterFiltered.length}</span>
            </div>
            <input type="search" placeholder="Search cluster" value={clusterSearch} onChange={(event) => setClusterSearch(event.target.value)} />
            <div className="cluster-filter-controls">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={showOnlyNeedsMoreLoveClusters}
                  onChange={(event) => setShowOnlyNeedsMoreLoveClusters(event.target.checked)}
                />
                <span>Needs more love / partial ({needsMoreLoveClusterCount})</span>
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={showOnlyOpenIntakeOverlapClusters}
                  onChange={(event) => setShowOnlyOpenIntakeOverlapClusters(event.target.checked)}
                />
                <span>Open-intake overlap ({openIntakeOverlapClusterCount})</span>
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={showOnlyFlaggedPromptClusters}
                  onChange={(event) => setShowOnlyFlaggedPromptClusters(event.target.checked)}
                />
                <span>Unresolved bad prompts ({flaggedPromptClusterCount})</span>
              </label>
            </div>
            <div className="cluster-list">
              {clusterVisible.map((cluster) => (
                <ClusterListItem
                  key={cluster.id}
                  cluster={cluster}
                  isActive={selectedCluster?.id === cluster.id && focusMode === 'cluster'}
                  onClick={() => openCluster(cluster.id)}
                />
              ))}
            </div>
            <div className="pagination-actions">
              <button type="button" className="secondary-button" onClick={() => setClusterWindowStart((current) => Math.max(0, current - 1))} disabled={clusterWindowStart === 0}>Prev</button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setClusterWindowStart((current) => Math.min(Math.max(clusterFiltered.length - 3, 0), current + 1))}
                disabled={clusterWindowStart >= Math.max(clusterFiltered.length - 3, 0)}
              >
                Next
              </button>
            </div>
          </section>
        </aside>

        <section className="panel cluster-detail-panel">
          {focusMode === 'intake' && selectedIntakeWord ? (
            <div>
              <div className="cluster-panel-heading">
                <div>
                  <h2>{selectedIntakeWord.targetWord.hanzi}</h2>
                  <p className="notes">{selectedIntakeWord.targetWord.pinyin} · {selectedIntakeWord.targetWord.meaning}</p>
                </div>
                <span className="badge">{selectedIntakeWord.openRowCount} open</span>
              </div>

              <div className="intake-word-table-wrapper">
                <table className="intake-word-table">
                  <tbody>
                    <IntakeWordTableRow
                      label="Target"
                      hanzi={selectedIntakeWord.targetWord.hanzi}
                      meaning={selectedIntakeWord.targetWord.meaning}
                      count={selectedIntakeWord.openRowCount}
                      isUnaddressed={false}
                      productionSuppressed={selectedIntakeWord.productionSuppressed}
                      badProductionPromptReported={selectedIntakeWord.badProductionPromptReported}
                      disableActions={isSaving}
                      onSuppressProduction={() => void onSuppressProduction(selectedIntakeWord.targetWordId)}
                      onReportBadPrompt={() => void onReportBadPrompt({ targetWordId: selectedIntakeWord.targetWordId })}
                    />
                    {selectedIntakeWord.candidates.map((candidate) => {
                      const matchedWordId = candidate.matchedWordId;
                      return (
                        <IntakeWordTableRow
                          key={candidate.key}
                          label="Candidate"
                          hanzi={candidate.matchedWord?.hanzi ?? candidate.candidateText ?? 'Unresolved candidate'}
                          meaning={candidate.matchedWord?.meaning ?? 'No matched meaning yet.'}
                          count={candidate.count}
                          isUnaddressed={candidate.unaddressed}
                          productionSuppressed={candidate.productionSuppressed}
                          badProductionPromptReported={candidate.badProductionPromptReported}
                          disableActions={isSaving || !matchedWordId}
                          onSuppressProduction={matchedWordId
                            ? () => void onSuppressProduction(matchedWordId)
                            : undefined}
                          onReportBadPrompt={matchedWordId
                            ? () => void onReportBadPrompt({ targetWordId: matchedWordId })
                            : undefined}
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="pagination-actions">
                <button type="button" onClick={() => void handleResolve()} disabled={isSaving}>
                  {isSaving ? 'Saving...' : 'Mark resolved'}
                </button>
              </div>

              <h3>Suggested Groups</h3>
              {selectedIntakeWord.suggestedClusters.length > 1 ? (
                <p className="notes">Pick the group that should survive. The other suggested groups will merge into it.</p>
              ) : null}
              <div className="cluster-prompt-list">
                {selectedIntakeWord.suggestedClusters.length === 0 ? (
                  <p className="notes">No suggested groups yet.</p>
                ) : (
                  selectedIntakeWord.suggestedClusters.map((cluster) => (
                    <article key={cluster.id} className="cluster-prompt-card">
                      <strong>{cluster.title}</strong>
                      <p>{cluster.members.map((member) => member.word.hanzi).join(' / ')}</p>
                      <ClusterMemberStateSummary cluster={cluster} />
                      <div className="pagination-actions">
                        <button type="button" className="secondary-button" onClick={() => openCluster(cluster.id)}>
                          Open cluster editor
                        </button>
                        {selectedIntakeWord.suggestedClusters.length > 1 ? (
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => void handleMergeSuggestedCluster(cluster.id)}
                            disabled={isSaving}
                          >
                            {isSaving ? 'Merging...' : 'Merge others into this group'}
                          </button>
                        ) : null}
                      </div>
                    </article>
                  ))
                )}
              </div>

              <h3>Create Group</h3>
              <form className="cluster-prompt-form" onSubmit={(event) => void handleCreateClusterForWord(event)}>
                <label>
                  <span>Title</span>
                  <input value={newClusterTitle} onChange={(event) => setNewClusterTitle(event.target.value)} />
                </label>
                <label>
                  <span>Note</span>
                  <input value={newClusterNote} onChange={(event) => setNewClusterNote(event.target.value)} />
                </label>
                <button type="submit" disabled={isSaving || newClusterTitle.trim().length === 0}>
                  Create group with target and candidates
                </button>
              </form>
            </div>
          ) : focusMode === 'cluster' && selectedCluster ? (
            <div>
              <div className="cluster-panel-heading">
                <div>
                  {editingClusterTitle ? (
                    <div className="pagination-actions">
                      <input
                        value={clusterTitleDraft}
                        onChange={(event) => setClusterTitleDraft(event.target.value)}
                        aria-label="Cluster title"
                      />
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={isSavingCluster || clusterTitleDraft.trim().length === 0}
                        onClick={() => {
                          void onUpdateCluster({
                            id: selectedCluster.id,
                            title: clusterTitleDraft.trim(),
                            note: selectedCluster.note,
                          }).then(() => {
                            setEditingClusterTitle(false);
                          });
                        }}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => {
                          setClusterTitleDraft(selectedCluster.title);
                          setEditingClusterTitle(false);
                        }}
                        disabled={isSavingCluster}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <h2>
                      {selectedCluster.title}
                      <button
                        type="button"
                        className="secondary-button"
                        style={{ marginLeft: '0.5rem', fontSize: '0.8rem', padding: '0.1rem 0.35rem' }}
                        title="Edit cluster title"
                        onClick={() => {
                          setClusterTitleDraft(selectedCluster.title);
                          setEditingClusterTitle(true);
                        }}
                      >
                        ✎
                      </button>
                    </h2>
                  )}
                  {selectedCluster.note.length > 0 ? <p className="notes">{selectedCluster.note}</p> : null}
                </div>
                <div className="pagination-actions">
                  <button type="button" className="secondary-button" onClick={backToLastIntake} disabled={!lastIntakeWordId}>
                    Back to intake
                  </button>
                </div>
              </div>

              <h3>Members</h3>

              {memberEditor ? (
                <form className="cluster-prompt-form" onSubmit={(event) => void submitMemberEdit(event)}>
                  <h4>{memberEditor.mode === 'new' ? `Add ${memberEditor.wordHanzi}` : `Edit ${memberEditor.wordHanzi}`}</h4>
                  <label>
                    <span>Nuance note</span>
                    <textarea
                      value={memberEditor.nuanceNote}
                      onChange={(event) => setMemberEditor((current) => current ? { ...current, nuanceNote: event.target.value } : null)}
                      rows={2}
                    />
                  </label>
                  <div className="pagination-actions">
                    <button type="submit" disabled={isSavingCluster}>{memberEditor.mode === 'new' ? 'Add member' : 'Save member'}</button>
                    {memberEditor.mode === 'existing' ? (
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={isSavingCluster || selectedCluster.members.length <= 1}
                        onClick={() => void handleDeleteMemberFromEditor()}
                      >
                        Delete member
                      </button>
                    ) : null}
                    <button type="button" className="secondary-button" onClick={() => setMemberEditor(null)} disabled={isSavingCluster}>Cancel</button>
                  </div>
                </form>
              ) : (
                <table style={{ width: '100%', fontSize: '0.84rem', borderCollapse: 'collapse', border: '1px solid rgba(255,255,255,0.14)' }}>
                  <tbody>
                    {selectedCluster.members.map((member) => (
                      <tr key={`${member.wordId}-group`}>
                        <td colSpan={2} style={{ padding: 0 }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <tbody>
                              <tr
                                style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer' }}
                                onClick={() => setExpandedMemberWordId((current) => current === member.wordId ? null : member.wordId)}
                              >
                                <td style={{ padding: '0.4rem 0.55rem', width: '38%' }}>
                                  {member.word.hanzi}
                                </td>
                                <td style={{ padding: '0.4rem 0.55rem', color: 'rgba(255,255,255,0.78)' }}>
                                  {truncate(member.nuanceNote, 40)}
                                </td>
                              </tr>
                              {expandedMemberWordId === member.wordId ? (
                                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                                  <td colSpan={2} style={{ padding: '0.5rem 0.6rem' }}>
                                    <div style={{ display: 'grid', gap: '0.3rem' }}>
                                  <small>{member.word.meaning}</small>
                                  {member.productionSuppressed ? <small className="badge warning-badge">Production suppressed</small> : null}
                                  {member.badProductionPromptReported ? <small className="badge warning-badge">Bad production prompt</small> : null}
                                  {member.nuanceNote.length > 0 ? <small>{member.nuanceNote}</small> : <small className="notes">No nuance note yet.</small>}
                                  <div>
                                    <button
                                          type="button"
                                          className="secondary-button"
                                          onClick={() => setMemberEditor({
                                            mode: 'existing',
                                            wordId: member.wordId,
                                            wordHanzi: member.word.hanzi,
                                            nuanceNote: member.nuanceNote,
                                          })}
                                        >
                                          Edit member
                                        </button>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              ) : null}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    ))}
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                      <td style={{ padding: '0.4rem 0.55rem', width: '38%' }}>
                        <form
                          onSubmit={(event) => event.preventDefault()}
                          style={{ margin: 0 }}
                        >
                          <input
                            type="search"
                            value={memberAddQuery}
                            placeholder="Add member +"
                            onChange={(event) => {
                              const value = event.target.value;
                              setMemberAddQuery(value);
                              void onSearchWords(value);
                            }}
                            style={{
                              width: '100%',
                              background: 'transparent',
                              border: 'none',
                              padding: 0,
                              color: 'rgba(255,255,255,0.9)',
                            }}
                          />
                        </form>
                      </td>
                      <td style={{ padding: '0.4rem 0.55rem', color: 'rgba(255,255,255,0.62)' }}>
                        {memberAddQuery.trim().length > 0 ? 'Search results below' : ''}
                      </td>
                    </tr>
                    {memberAddQuery.trim().length > 0 ? (
                      wordSearchResults
                        .filter((word) => !selectedCluster.members.some((member) => member.wordId === word.id))
                        .slice(0, 6)
                        .map((word) => (
                          <tr
                            key={word.id}
                            style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer' }}
                            onClick={() => {
                              setMemberEditor({
                                mode: 'new',
                                wordId: word.id,
                                wordHanzi: word.hanzi,
                                nuanceNote: '',
                              });
                              setMemberAddQuery('');
                            }}
                          >
                            <td style={{ padding: '0.4rem 0.55rem', width: '38%' }}>{word.hanzi}</td>
                            <td style={{ padding: '0.4rem 0.55rem', color: 'rgba(255,255,255,0.78)' }}>
                              {truncate(word.meaning, 40)}
                            </td>
                          </tr>
                        ))
                    ) : null}
                    {memberAddQuery.trim().length > 0 &&
                    wordSearchResults.filter((word) => !selectedCluster.members.some((member) => member.wordId === word.id)).length === 0 ? (
                      <tr>
                        <td colSpan={2} style={{ padding: '0.4rem 0.55rem' }}>
                          <small className="notes">No matching words.</small>
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              )}

              <h3>Prompts</h3>
              {promptEditor ? (
                <form className="cluster-prompt-form" onSubmit={(event) => void submitPromptEdit(event)}>
                  <h4>{promptEditor.mode === 'new' ? 'Add prompt' : 'Edit prompt'}</h4>
                  <label>
                    <span>Target</span>
                    <select
                      value={promptEditor.targetWordId}
                      onChange={(event) => setPromptEditor((current) => current ? { ...current, targetWordId: event.target.value } : null)}
                    >
                      {selectedCluster.members.map((member) => (
                        <option key={member.wordId} value={member.wordId}>{member.word.hanzi}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Prompt</span>
                    <textarea
                      value={promptEditor.promptText}
                      onChange={(event) => setPromptEditor((current) => current ? { ...current, promptText: event.target.value } : null)}
                      rows={3}
                      required
                    />
                  </label>
                  <label>
                    <span>Explanation</span>
                    <textarea
                      value={promptEditor.explanation}
                      onChange={(event) => setPromptEditor((current) => current ? { ...current, explanation: event.target.value } : null)}
                      rows={2}
                    />
                  </label>
                  <div className="pagination-actions">
                    <button type="submit" disabled={isSavingCluster || promptEditor.promptText.trim().length === 0}>
                      {promptEditor.mode === 'new' ? 'Add prompt' : 'Save prompt'}
                    </button>
                    {promptEditor.mode === 'existing' && promptEditor.promptId ? (
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => void handleDeletePromptFromEditor()}
                        disabled={isSavingCluster}
                      >
                        Delete prompt
                      </button>
                    ) : null}
                    <button type="button" className="secondary-button" onClick={() => setPromptEditor(null)} disabled={isSavingCluster}>Cancel</button>
                  </div>
                </form>
              ) : (
                <table style={{ width: '100%', fontSize: '0.84rem', borderCollapse: 'collapse', border: '1px solid rgba(255,255,255,0.14)' }}>
                  <tbody>
                    {selectedCluster.prompts.map((prompt) => {
                      const targetHanzi = selectedCluster.members.find((member) => member.wordId === prompt.targetWordId)?.word.hanzi ?? prompt.targetWordId;
                      return (
                        <Fragment key={prompt.id}>
                          <tr
                            style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer' }}
                            onClick={() => setExpandedPromptId((current) => current === prompt.id ? null : prompt.id)}
                          >
                            <td style={{ padding: '0.4rem 0.55rem', width: '38%' }}>{targetHanzi}</td>
                            <td style={{ padding: '0.4rem 0.55rem', color: 'rgba(255,255,255,0.78)' }}>
                              {truncate(prompt.promptText, 46)}
                            </td>
                          </tr>
                          {expandedPromptId === prompt.id ? (
                            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                              <td colSpan={2} style={{ padding: '0.5rem 0.6rem' }}>
                                <div style={{ display: 'grid', gap: '0.35rem' }}>
                                  <small>{prompt.promptText}</small>
                                  {prompt.explanation.trim().length > 0
                                    ? <small>{prompt.explanation}</small>
                                    : <small className="notes">No explanation yet.</small>}
                                  <div className="pagination-actions">
                                    <button
                                      type="button"
                                      className="secondary-button"
                                      onClick={() => setPromptEditor({
                                        mode: 'existing',
                                        promptId: prompt.id,
                                        targetWordId: prompt.targetWordId,
                                        promptText: prompt.promptText,
                                        explanation: prompt.explanation,
                                      })}
                                    >
                                      Edit prompt
                                    </button>
                                    {prompt.feedback.flagged ? (
                                      <button
                                        type="button"
                                        className="secondary-button"
                                        onClick={() => void onResolvePromptFeedback({ id: prompt.id })}
                                        disabled={isSavingCluster}
                                      >
                                        Resolve bad prompt
                                      </button>
                                    ) : null}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                    <tr
                      style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer' }}
                      onClick={() => setAddPromptRowOpen(true)}
                    >
                      <td style={{ padding: '0.4rem 0.55rem', width: '38%', color: 'rgba(255,255,255,0.75)' }}>
                        Add prompt +
                      </td>
                      <td style={{ padding: '0.4rem 0.55rem' }} />
                    </tr>
                    {addPromptRowOpen ? (
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                        <td style={{ padding: '0.4rem 0.55rem', width: '38%' }}>
                          <select
                            value=""
                            onChange={(event) => {
                              const targetWordId = event.target.value;
                              if (targetWordId.trim().length === 0) {
                                return;
                              }
                              setPromptEditor({
                                mode: 'new',
                                promptId: null,
                                targetWordId,
                                promptText: '',
                                explanation: '',
                              });
                              setAddPromptRowOpen(false);
                            }}
                            disabled={isSavingCluster || selectedCluster.members.length === 0}
                            autoFocus
                          >
                            <option value="">Select member</option>
                            {selectedCluster.members.map((member) => (
                              <option key={member.wordId} value={member.wordId}>
                                {member.word.hanzi}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td style={{ padding: '0.4rem 0.55rem', color: 'rgba(255,255,255,0.62)' }}>
                          Choose target word
                        </td>
                      </tr>
                    ) : null}
                    {selectedCluster.prompts.length === 0 ? (
                      <tr>
                        <td colSpan={2} style={{ padding: '0.4rem 0.55rem' }}>
                          <small className="notes">No prompts yet.</small>
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              )}
            </div>
          ) : (
            <div>
              <h2>No selection</h2>
              <p className="notes">Create a cluster or choose an intake word.</p>
              <form className="cluster-prompt-form" onSubmit={(event) => void handleCreateCluster(event)}>
                <label>
                  <span>Title</span>
                  <input value={newClusterTitle} onChange={(event) => setNewClusterTitle(event.target.value)} />
                </label>
                <label>
                  <span>Note</span>
                  <input value={newClusterNote} onChange={(event) => setNewClusterNote(event.target.value)} />
                </label>
                <button type="submit" disabled={newClusterTitle.trim().length === 0}>Create cluster</button>
              </form>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

function IntakeWordTableRow({
  label,
  hanzi,
  meaning,
  count,
  isUnaddressed,
  productionSuppressed,
  badProductionPromptReported,
  disableActions,
  onSuppressProduction,
  onReportBadPrompt,
}: {
  label: string;
  hanzi: string;
  meaning: string;
  count: number;
  isUnaddressed: boolean;
  productionSuppressed: boolean;
  badProductionPromptReported: boolean;
  disableActions: boolean;
  onSuppressProduction?: () => void;
  onReportBadPrompt?: () => void;
}) {
  return (
    <tr className={label === 'Target' ? 'intake-word-table-row intake-word-table-row-target' : 'intake-word-table-row'}>
      <td className="intake-word-table-cell intake-word-table-cell-label">
        <small>{label}</small>
      </td>
      <td className="intake-word-table-cell">
        <strong className="intake-candidate-row-hanzi">{hanzi}</strong>
        <small className="intake-candidate-row-meaning">{truncate(meaning, 70)}</small>
      </td>
      <td className="intake-word-table-cell intake-word-table-cell-meta">
        <small>{count} row{count === 1 ? '' : 's'}</small>
        {isUnaddressed ? <small className="badge warning-badge">Unaddressed</small> : null}
        {productionSuppressed ? <small className="badge warning-badge">Production suppressed</small> : null}
        {badProductionPromptReported ? <small className="badge warning-badge">Bad production prompt</small> : null}
      </td>
      <td className="intake-word-table-cell intake-word-table-cell-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={disableActions || productionSuppressed || !onSuppressProduction}
          onClick={onSuppressProduction}
        >
          {productionSuppressed ? 'Suppressed' : 'Suppress'}
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={disableActions || badProductionPromptReported || !onReportBadPrompt}
          onClick={onReportBadPrompt}
        >
          {badProductionPromptReported ? 'Bad prompt logged' : 'Bad prompt'}
        </button>
      </td>
    </tr>
  );
}

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1)}…`;
}

function clusterNeedsMoreLove(cluster: ContrastClusterContent): boolean {
  return cluster.members.length < 2 || cluster.prompts.length === 0;
}

function clusterHasOpenIntakeOverlap(
  cluster: ContrastClusterContent,
  intakeTargetWordIdSet: Set<string>,
): boolean {
  return cluster.members.some((member) => intakeTargetWordIdSet.has(member.wordId));
}

function clusterHasFlaggedPrompts(cluster: ContrastClusterContent): boolean {
  return cluster.prompts.some((prompt) => prompt.feedback.flagged);
}

function ClusterListItem({
  cluster,
  isActive,
  onClick,
}: {
  cluster: ContrastClusterContent;
  isActive: boolean;
  onClick: () => void;
}) {
  const suppressedCount = cluster.members.filter((member) => member.productionSuppressed).length;
  const badPromptCount = cluster.members.filter((member) => member.badProductionPromptReported).length;
  const flaggedPromptCount = cluster.prompts.filter((prompt) => prompt.feedback.flagged).length;

  return (
    <button
      type="button"
      className={isActive ? 'cluster-list-item active' : 'cluster-list-item'}
      onClick={onClick}
    >
      <span>{cluster.title}</span>
      <small>
        {cluster.members.length} words · {cluster.prompts.length} prompts
        {flaggedPromptCount > 0 ? ` · ${flaggedPromptCount} unresolved` : ''}
        {suppressedCount > 0 ? ` · ${suppressedCount} suppressed` : ''}
        {badPromptCount > 0 ? ` · ${badPromptCount} bad-prompt` : ''}
      </small>
    </button>
  );
}

function ClusterMemberStateSummary({ cluster }: { cluster: ContrastClusterContent }) {
  const suppressedCount = cluster.members.filter((member) => member.productionSuppressed).length;
  const badPromptCount = cluster.members.filter((member) => member.badProductionPromptReported).length;
  if (suppressedCount === 0 && badPromptCount === 0) {
    return null;
  }

  return (
    <small>
      {suppressedCount > 0 ? `${suppressedCount} production suppressed` : ''}
      {suppressedCount > 0 && badPromptCount > 0 ? ' · ' : ''}
      {badPromptCount > 0 ? `${badPromptCount} bad production prompt` : ''}
    </small>
  );
}
