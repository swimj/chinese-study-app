import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { ContrastPrompt } from '../domain/study-actions';
import type { ContrastClusterContent, ContrastPromptContent } from '../services/api';

type PromptFormState = {
  mode: 'create' | 'edit';
  promptId: string | null;
  targetWordId: string;
  promptText: string;
  explanation: string;
};

const emptyPromptForm: PromptFormState = {
  mode: 'create',
  promptId: null,
  targetWordId: '',
  promptText: '',
  explanation: '',
};

export function ClusterManagementPage({
  clusters,
  selectedClusterId,
  isSavingPrompt,
  onSelectCluster,
  onCreatePrompt,
  onUpdatePrompt,
  onResolvePromptFeedback,
  onDeletePrompt,
}: {
  clusters: ContrastClusterContent[];
  selectedClusterId: string | null;
  isSavingPrompt: boolean;
  onSelectCluster: (clusterId: string) => void;
  onCreatePrompt: (input: {
    clusterId: string;
    targetWordId: string;
    promptText: string;
    explanation: string;
  }) => Promise<void>;
  onUpdatePrompt: (input: {
    id: string;
    targetWordId: string;
    promptText: string;
    explanation: string;
  }) => Promise<void>;
  onResolvePromptFeedback: (input: { id: string; note?: string }) => Promise<void>;
  onDeletePrompt: (id: string) => Promise<void>;
}) {
  const [promptForm, setPromptForm] = useState<PromptFormState>(emptyPromptForm);
  const [memberSearchInput, setMemberSearchInput] = useState('');
  const [showOnlyFlaggedClusters, setShowOnlyFlaggedClusters] = useState(false);
  const filteredClusters = useMemo(
    () => filterClusters({
      clusters,
      memberSearchInput,
      showOnlyFlaggedClusters,
    }),
    [clusters, memberSearchInput, showOnlyFlaggedClusters],
  );
  const selectedCluster = useMemo(
    () =>
      filteredClusters.find((cluster) => cluster.id === selectedClusterId) ??
      filteredClusters[0] ??
      null,
    [filteredClusters, selectedClusterId],
  );
  const flaggedClusterCount = clusters.filter(clusterHasFlaggedPrompts).length;

  useEffect(() => {
    if (selectedCluster && selectedCluster.id !== selectedClusterId) {
      onSelectCluster(selectedCluster.id);
    }
  }, [onSelectCluster, selectedCluster, selectedClusterId]);

  useEffect(() => {
    setPromptForm({
      ...emptyPromptForm,
      targetWordId: selectedCluster?.members[0]?.wordId ?? '',
    });
  }, [selectedCluster?.id]);

  async function handlePromptSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedCluster) {
      return;
    }

    if (promptForm.mode === 'edit' && promptForm.promptId) {
      await onUpdatePrompt({
        id: promptForm.promptId,
        targetWordId: promptForm.targetWordId,
        promptText: promptForm.promptText,
        explanation: promptForm.explanation,
      });
    } else {
      await onCreatePrompt({
        clusterId: selectedCluster.id,
        targetWordId: promptForm.targetWordId,
        promptText: promptForm.promptText,
        explanation: promptForm.explanation,
      });
    }

    setPromptForm({
      ...emptyPromptForm,
      targetWordId: selectedCluster.members[0]?.wordId ?? '',
    });
  }

  function startEditingPrompt(prompt: ContrastPrompt) {
    setPromptForm({
      mode: 'edit',
      promptId: prompt.id,
      targetWordId: prompt.targetWordId,
      promptText: prompt.promptText,
      explanation: prompt.explanation,
    });
  }

  function resetPromptForm() {
    setPromptForm({
      ...emptyPromptForm,
      targetWordId: selectedCluster?.members[0]?.wordId ?? '',
    });
  }

  async function handleResolvePromptFeedback(prompt: ContrastPromptContent) {
    await onResolvePromptFeedback({ id: prompt.id });
  }

  async function handleDeletePrompt(prompt: ContrastPromptContent) {
    const confirmed = window.confirm('Delete this contrast prompt? This removes it from circulation and cannot be undone.');
    if (!confirmed) {
      return;
    }

    await onDeletePrompt(prompt.id);
    if (promptForm.promptId === prompt.id) {
      resetPromptForm();
    }
  }

  return (
    <section className="clusters-page">
      <header className="header">
        <div>
          <h1 className="title">Clusters</h1>
          <p className="subtitle">Contrast content</p>
        </div>
      </header>

      {clusters.length === 0 ? (
        <div className="panel">
          <p className="notes">No contrast clusters found.</p>
        </div>
      ) : (
        <div className="cluster-layout">
          <aside className="panel cluster-list-panel">
            <h2>Clusters</h2>
            <div className="cluster-filter-controls">
              <label>
                <span className="prompt-label">Member search</span>
                <input
                  type="search"
                  value={memberSearchInput}
                  onChange={(event) => setMemberSearchInput(event.target.value)}
                  placeholder="汉字"
                />
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={showOnlyFlaggedClusters}
                  onChange={(event) => setShowOnlyFlaggedClusters(event.target.checked)}
                />
                <span>Unresolved prompts only ({flaggedClusterCount})</span>
              </label>
            </div>
            <div className="cluster-list">
              {filteredClusters.length === 0 ? (
                <p className="notes">No clusters match the current filters.</p>
              ) : (
                filteredClusters.map((cluster) => {
                  const flaggedPromptCount = getFlaggedPromptCount(cluster);
                  return (
                    <button
                      type="button"
                      key={cluster.id}
                      className={cluster.id === selectedCluster?.id ? 'cluster-list-item active' : 'cluster-list-item'}
                      onClick={() => onSelectCluster(cluster.id)}
                    >
                      <span className="cluster-list-item-title">
                        <span>{cluster.title}</span>
                        {flaggedPromptCount > 0 ? (
                          <span className="cluster-alert-dot" title={`${flaggedPromptCount} unresolved prompt${flaggedPromptCount === 1 ? '' : 's'}`}>
                            !
                          </span>
                        ) : null}
                      </span>
                      <small>
                        {cluster.members.length} words · {cluster.prompts.length} prompts
                        {flaggedPromptCount > 0
                          ? ` · ${flaggedPromptCount} unresolved`
                          : ''}
                      </small>
                    </button>
                  );
                })
              )}
            </div>
          </aside>

          {selectedCluster ? (
            <div className="cluster-detail-stack">
              <section className="panel cluster-detail-panel">
                <div className="cluster-panel-heading">
                  <div>
                    <h2>{selectedCluster.title}</h2>
                    {selectedCluster.note.length > 0 ? <p className="notes">{selectedCluster.note}</p> : null}
                  </div>
                  <span className="badge">{selectedCluster.id}</span>
                </div>

                <h3>Members</h3>
                <div className="cluster-member-grid">
                  {selectedCluster.members.map((member) => (
                    <article key={member.wordId} className="cluster-member-card">
                      <strong>{member.word.hanzi}</strong>
                      <span>{member.word.pinyin}</span>
                      <p>{member.word.meaning}</p>
                      {member.nuanceNote.length > 0 ? <small>{member.nuanceNote}</small> : null}
                    </article>
                  ))}
                </div>
              </section>

              <section className="panel cluster-detail-panel">
                <div className="cluster-panel-heading">
                  <h2>Prompts</h2>
                  {promptForm.mode === 'edit' ? (
                    <button type="button" className="secondary-button" onClick={resetPromptForm}>
                      New prompt
                    </button>
                  ) : null}
                </div>

                {selectedCluster.prompts.length === 0 ? (
                  <p className="notes">No prompts yet.</p>
                ) : (
                  <div className="cluster-prompt-list">
                    {selectedCluster.prompts.map((prompt) => {
                      const target = selectedCluster.members.find((member) => member.wordId === prompt.targetWordId);
                      return (
                        <article key={prompt.id} className="cluster-prompt-card">
                          <div className="cluster-prompt-heading">
                            <div>
                              <span className="prompt-label">Target</span>
                              <strong>{target?.word.hanzi ?? prompt.targetWordId}</strong>
                            </div>
                            <PromptQualityBadge prompt={prompt} />
                          </div>
                          <p>{prompt.promptText}</p>
                          {prompt.explanation.length > 0 ? <small>{prompt.explanation}</small> : null}
                          {prompt.feedback.flagged ? (
                            <div className="cluster-prompt-feedback">
                              <span className="prompt-meta">
                                Marked bad {prompt.feedback.badPromptCount} time{prompt.feedback.badPromptCount === 1 ? '' : 's'}
                                {prompt.feedback.latestBadPromptAt
                                  ? ` · latest ${new Date(prompt.feedback.latestBadPromptAt).toLocaleString()}`
                                  : ''}
                              </span>
                              {prompt.feedback.notes.length > 0 ? (
                                <small>{prompt.feedback.notes.join(' / ')}</small>
                              ) : null}
                            </div>
                          ) : null}
                          <button type="button" className="secondary-button" onClick={() => startEditingPrompt(prompt)}>
                            Edit
                          </button>
                          <div className="cluster-prompt-actions">
                            {prompt.feedback.flagged ? (
                              <button
                                type="button"
                                className="secondary-button"
                                onClick={() => void handleResolvePromptFeedback(prompt)}
                                disabled={isSavingPrompt}
                              >
                                Resolve
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => void handleDeletePrompt(prompt)}
                              disabled={isSavingPrompt}
                            >
                              Delete
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="panel cluster-detail-panel">
                <h2>{promptForm.mode === 'edit' ? 'Edit prompt' : 'New prompt'}</h2>
                <form className="cluster-prompt-form" onSubmit={(event) => void handlePromptSubmit(event)}>
                  <label>
                    <span>Target</span>
                    <select
                      value={promptForm.targetWordId}
                      onChange={(event) => setPromptForm((current) => ({
                        ...current,
                        targetWordId: event.target.value,
                      }))}
                      disabled={isSavingPrompt}
                      required
                    >
                      {selectedCluster.members.map((member) => (
                        <option key={member.wordId} value={member.wordId}>
                          {member.word.hanzi}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Prompt</span>
                    <textarea
                      value={promptForm.promptText}
                      onChange={(event) => setPromptForm((current) => ({
                        ...current,
                        promptText: event.target.value,
                      }))}
                      disabled={isSavingPrompt}
                      rows={3}
                      required
                    />
                  </label>
                  <label>
                    <span>Explanation</span>
                    <textarea
                      value={promptForm.explanation}
                      onChange={(event) => setPromptForm((current) => ({
                        ...current,
                        explanation: event.target.value,
                      }))}
                      disabled={isSavingPrompt}
                      rows={3}
                    />
                  </label>
                  <div className="pagination-actions">
                    <button type="submit" disabled={isSavingPrompt || promptForm.promptText.trim().length === 0}>
                      {isSavingPrompt ? 'Saving...' : promptForm.mode === 'edit' ? 'Save prompt' : 'Create prompt'}
                    </button>
                    {promptForm.mode === 'edit' ? (
                      <button type="button" className="secondary-button" onClick={resetPromptForm} disabled={isSavingPrompt}>
                        Cancel
                      </button>
                    ) : null}
                  </div>
                </form>
              </section>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function PromptQualityBadge({ prompt }: { prompt: ContrastPromptContent }) {
  if (!prompt.feedback.flagged) {
    return null;
  }

  return <span className="badge warning-badge">Bad prompt</span>;
}

function filterClusters({
  clusters,
  memberSearchInput,
  showOnlyFlaggedClusters,
}: {
  clusters: ContrastClusterContent[];
  memberSearchInput: string;
  showOnlyFlaggedClusters: boolean;
}) {
  const normalizedSearch = memberSearchInput.trim();

  return clusters.filter((cluster) => {
    if (showOnlyFlaggedClusters && !clusterHasFlaggedPrompts(cluster)) {
      return false;
    }

    if (normalizedSearch.length === 0) {
      return true;
    }

    return cluster.members.some((member) => member.word.hanzi.includes(normalizedSearch));
  });
}

function clusterHasFlaggedPrompts(cluster: ContrastClusterContent) {
  return cluster.prompts.some((prompt) => prompt.feedback.flagged);
}

function getFlaggedPromptCount(cluster: ContrastClusterContent) {
  return cluster.prompts.filter((prompt) => prompt.feedback.flagged).length;
}
