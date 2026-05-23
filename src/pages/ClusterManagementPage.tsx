import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { ContrastPrompt } from '../domain/study-actions';
import type { ContrastClusterContent } from '../services/api';

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
}) {
  const selectedCluster = useMemo(
    () => clusters.find((cluster) => cluster.id === selectedClusterId) ?? clusters[0] ?? null,
    [clusters, selectedClusterId],
  );
  const [promptForm, setPromptForm] = useState<PromptFormState>(emptyPromptForm);

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
            <div className="cluster-list">
              {clusters.map((cluster) => (
                <button
                  type="button"
                  key={cluster.id}
                  className={cluster.id === selectedCluster?.id ? 'cluster-list-item active' : 'cluster-list-item'}
                  onClick={() => onSelectCluster(cluster.id)}
                >
                  <span>{cluster.title}</span>
                  <small>{cluster.members.length} words · {cluster.prompts.length} prompts</small>
                </button>
              ))}
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
                          <div>
                            <span className="prompt-label">Target</span>
                            <strong>{target?.word.hanzi ?? prompt.targetWordId}</strong>
                          </div>
                          <p>{prompt.promptText}</p>
                          {prompt.explanation.length > 0 ? <small>{prompt.explanation}</small> : null}
                          <button type="button" className="secondary-button" onClick={() => startEditingPrompt(prompt)}>
                            Edit
                          </button>
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
