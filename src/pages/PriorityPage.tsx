import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import type { IntakeTriagePriorityWord, IntakeTriageRunReceipt, PriorityWord } from '../types';
import { MeaningList } from '../components/MeaningList';
import { PriorityWordBank } from '../features/priority/PriorityWordBank';
import { partitionPriorityBank } from '../features/priority/priority-page-model';
import { studyProfile } from '../study-profile';

type PrioritySubtab = 'manage' | 'triage';

export function PriorityPage({
  rows,
  triageRows,
  searchHanzi,
  requireAddedMatches,
  searchNotice,
  searchSubmitting,
  highlightedWordIds,
  onSearchHanziChange,
  onRequireAddedMatchesChange,
  onSearchSubmit,
  onHighlightsHandled,
  updatingWordId,
  priorityBatchSubmitting,
  bulkDismissSubmitting,
  analysisCandidateCount,
  advisorGenerating,
  advisorRunReceipt,
  advisorUpdatingAssessmentId,
  onRequireForNextSession,
  onMoveSelectedToTop,
  onMoveSelectedToStash,
  onRemoveSelected,
  onDismissFromTriage,
  onBulkDismissFromTriage,
  onRunAdvisor,
  onAcceptAdvisorAssessment,
  onDismissAdvisorAssessment,
}: {
  rows: PriorityWord[];
  triageRows: IntakeTriagePriorityWord[];
  searchHanzi: string;
  requireAddedMatches: boolean;
  searchNotice: string | null;
  searchSubmitting: boolean;
  highlightedWordIds: string[];
  onSearchHanziChange: (value: string) => void;
  onRequireAddedMatchesChange: (value: boolean) => void;
  onSearchSubmit: () => void;
  onHighlightsHandled: () => void;
  updatingWordId: string | null;
  priorityBatchSubmitting: boolean;
  bulkDismissSubmitting: boolean;
  analysisCandidateCount: number;
  advisorGenerating: boolean;
  advisorRunReceipt: IntakeTriageRunReceipt | null;
  advisorUpdatingAssessmentId: string | null;
  onRequireForNextSession: (wordIds: string[], requiredForNextSession: boolean) => Promise<void>;
  onMoveSelectedToTop: (wordIds: string[]) => Promise<void>;
  onMoveSelectedToStash: (wordIds: string[]) => Promise<void>;
  onRemoveSelected: (wordIds: string[]) => Promise<void>;
  onDismissFromTriage: (wordId: string) => void;
  onBulkDismissFromTriage: (wordIds: string[]) => void;
  onRunAdvisor: () => void;
  onAcceptAdvisorAssessment: (assessmentId: string) => void;
  onDismissAdvisorAssessment: (assessmentId: string) => void;
}) {
  const [activeSubtab, setActiveSubtab] = useState<PrioritySubtab>('manage');
  const [expandedDefinitionByWordId, setExpandedDefinitionByWordId] = useState<Record<string, boolean>>({});
  const [selectedManageWordIds, setSelectedManageWordIds] = useState<string[]>([]);
  const [bulkSelectActive, setBulkSelectActive] = useState(false);
  const [selectedTriageWordIds, setSelectedTriageWordIds] = useState<string[]>([]);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressActivatedRef = useRef(false);
  const { top, stash } = partitionPriorityBank(rows);

  useEffect(() => {
    setSelectedManageWordIds((current) =>
      current.filter((wordId) => rows.some((entry) => entry.word.id === wordId)),
    );
  }, [rows]);

  useEffect(() => {
    setSelectedTriageWordIds((current) =>
      current.filter((wordId) => triageRows.some((entry) => entry.word.id === wordId)),
    );
  }, [triageRows]);

  useEffect(() => {
    if (selectedTriageWordIds.length === 0 && bulkSelectActive && !bulkDismissSubmitting) {
      setBulkSelectActive(false);
    }
  }, [bulkDismissSubmitting, bulkSelectActive, selectedTriageWordIds.length]);

  function toggleTriageSelection(wordId: string) {
    setSelectedTriageWordIds((current) =>
      current.includes(wordId) ? current.filter((selectedId) => selectedId !== wordId) : [...current, wordId],
    );
  }

  function enterBulkSelectMode(wordId: string) {
    setBulkSelectActive(true);
    setSelectedTriageWordIds((current) => (current.includes(wordId) ? current : [...current, wordId]));
  }

  function handleTriagePointerDown(wordId: string) {
    clearLongPressTimer();
    longPressActivatedRef.current = false;
    longPressTimerRef.current = window.setTimeout(() => {
      longPressActivatedRef.current = true;
      enterBulkSelectMode(wordId);
    }, 520);
  }

  function handleTriagePointerEnd() {
    clearLongPressTimer();
  }

  function handleTriageRowClick(wordId: string) {
    if (longPressActivatedRef.current) {
      longPressActivatedRef.current = false;
      return;
    }

    if (bulkSelectActive) {
      toggleTriageSelection(wordId);
    }
  }

  function clearLongPressTimer() {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  function handleSingleDismiss(word: PriorityWord) {
    const confirmed = window.confirm(`Move ${word.word.hanzi} to the bottom of new-word priority?`);
    if (!confirmed) {
      return;
    }

    onDismissFromTriage(word.word.id);
  }

  function handleBulkDismiss() {
    onBulkDismissFromTriage(selectedTriageWordIds);
    setSelectedTriageWordIds([]);
    setBulkSelectActive(false);
  }

  async function handleSelectedManageAction(action: (wordIds: string[]) => Promise<void>, wordIds = selectedManageWordIds) {
    if (wordIds.length === 0) {
      return;
    }

    try {
      await action(wordIds);
    } catch {
      // The controller owns the visible error state; keep the selection intact.
    }
  }

  const selectedManageRows = rows.filter((entry) => selectedManageWordIds.includes(entry.word.id));
  const allSelectedRequired =
    selectedManageRows.length > 0 && selectedManageRows.every((entry) => entry.requiredForNextSession);
  const someSelectedNotTop = selectedManageRows.some((entry) => !entry.forceTop);
  const someSelectedTop = selectedManageRows.some((entry) => entry.forceTop);
  const manageSelectionActive = selectedManageWordIds.length > 0;

  return (
    <section className="priority-page">
      <nav className="priority-view-rail" aria-label="Priority views">
        <button
          type="button"
          className={activeSubtab === 'manage' ? 'priority-view-rail-tab active' : 'priority-view-rail-tab'}
          aria-current={activeSubtab === 'manage' ? 'page' : undefined}
          onClick={() => setActiveSubtab('manage')}
        >
          <span>Manage</span>
          <span className="priority-view-rail-count">{rows.length}</span>
        </button>
        <button
          type="button"
          className={activeSubtab === 'triage' ? 'priority-view-rail-tab active' : 'priority-view-rail-tab'}
          aria-current={activeSubtab === 'triage' ? 'page' : undefined}
          onClick={() => setActiveSubtab('triage')}
        >
          <span>Triage</span>
          <span className="priority-view-rail-count">{triageRows.length}</span>
        </button>
      </nav>

      <div className="priority-page-main">
        {activeSubtab === 'manage' ? (
          <>
            <PriorityWordBank
              rows={rows}
              selectedWordIds={selectedManageWordIds}
              highlightedWordIds={highlightedWordIds}
              submitting={priorityBatchSubmitting}
              onSelectedWordIdsChange={setSelectedManageWordIds}
              onMoveToTop={(wordIds) => handleSelectedManageAction(onMoveSelectedToTop, wordIds)}
              onMoveToStash={(wordIds) => handleSelectedManageAction(onMoveSelectedToStash, wordIds)}
              onRemove={(wordIds) => handleSelectedManageAction(onRemoveSelected, wordIds)}
              onHighlightsHandled={onHighlightsHandled}
            />
            <div className="priority-bottom-rail">
              <input
                ref={searchInputRef}
                type="text"
                value={searchHanzi}
                onChange={(event) => onSearchHanziChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    onSearchSubmit();
                  }
                }}
                placeholder={studyProfile.labels.addByTarget}
                aria-label={studyProfile.labels.addByTarget}
                disabled={searchSubmitting}
              />
              <label className="inline-checkbox">
                <input
                  type="checkbox"
                  checked={requireAddedMatches}
                  disabled={searchSubmitting}
                  onChange={(event) => onRequireAddedMatchesChange(event.target.checked)}
                />
                Require added
              </label>
              <button type="button" onClick={onSearchSubmit} disabled={searchSubmitting}>
                {searchSubmitting ? 'Adding...' : 'Add'}
              </button>
              {searchNotice ? <span className="priority-bottom-rail-notice">{searchNotice}</span> : null}
              {manageSelectionActive ? (
                <div className="priority-bottom-rail-selection" role="group" aria-label="Selected priority word actions">
                  <span className="priority-selection-count">{selectedManageWordIds.length}</span>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void handleSelectedManageAction(onMoveSelectedToTop)}
                    disabled={priorityBatchSubmitting || !someSelectedNotTop}
                  >
                    To top
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void handleSelectedManageAction(onMoveSelectedToStash)}
                    disabled={priorityBatchSubmitting || !someSelectedTop}
                  >
                    To stash
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() =>
                      void handleSelectedManageAction((wordIds) =>
                        onRequireForNextSession(wordIds, !allSelectedRequired),
                      )
                    }
                    disabled={priorityBatchSubmitting}
                  >
                    {allSelectedRequired ? 'Unrequire' : 'Require'}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void handleSelectedManageAction(onRemoveSelected)}
                    disabled={priorityBatchSubmitting}
                  >
                    Remove
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setSelectedManageWordIds([])}
                    disabled={priorityBatchSubmitting}
                  >
                    Clear
                  </button>
                </div>
              ) : (
                <span className="priority-bottom-rail-hint">
                  {top.length + stash.length === 0
                    ? null
                    : 'Click to select · drag between sections'}
                </span>
              )}
            </div>
          </>
        ) : (
          <div className="priority-triage-shell">
            <div className="priority-triage-toolbar">
              {!bulkSelectActive ? (
                <button
                  type="button"
                  onClick={onRunAdvisor}
                  disabled={advisorGenerating || analysisCandidateCount === 0}
                >
                  {advisorGenerating
                    ? 'Analyzing...'
                    : `Analyze ${analysisCandidateCount} new word${analysisCandidateCount === 1 ? '' : 's'}`}
                </button>
              ) : (
                <div className="pagination-actions">
                  <button type="button" className="secondary-button" onClick={() => setSelectedTriageWordIds([])}>
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={handleBulkDismiss}
                    disabled={selectedTriageWordIds.length === 0 || bulkDismissSubmitting}
                  >
                    {bulkDismissSubmitting ? 'Moving...' : `Move to bottom (${selectedTriageWordIds.length})`}
                  </button>
                </div>
              )}
              {advisorRunReceipt ? (
                <p
                  className="notes intake-advisor-run-receipt"
                  title={`Client request ${advisorRunReceipt.clientRequestId}${advisorRunReceipt.responseId ? ` · Provider response ${advisorRunReceipt.responseId}` : ''}`}
                >
                  Run {advisorRunReceipt.runId.slice(0, 8)} · analyzed {advisorRunReceipt.includedWordCount} · {formatEstimatedCost(advisorRunReceipt.estimatedCostUsd)}
                </p>
              ) : null}
            </div>
            {triageRows.length === 0 ? (
              <p className="notes">No top unstudied words are currently available.</p>
            ) : (
              <PriorityWordTable
                rows={triageRows}
                expandedDefinitionByWordId={expandedDefinitionByWordId}
                setExpandedDefinitionByWordId={setExpandedDefinitionByWordId}
                actionHeader={bulkSelectActive ? 'Select' : 'Priority'}
                advisorHeader="Advisor"
                extraHeader={bulkSelectActive ? <th aria-label="Selected" /> : null}
                renderExtraCell={(word) =>
                  bulkSelectActive ? (
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedTriageWordIds.includes(word.word.id)}
                        onClick={(event) => event.stopPropagation()}
                        onPointerDown={(event) => event.stopPropagation()}
                        onChange={() => toggleTriageSelection(word.word.id)}
                      />
                    </td>
                  ) : null
                }
                getRowClassName={(word) =>
                  selectedTriageWordIds.includes(word.word.id) ? 'priority-triage-row selected' : 'priority-triage-row'
                }
                getRowHandlers={(word) => ({
                  onPointerDown: () => handleTriagePointerDown(word.word.id),
                  onPointerUp: handleTriagePointerEnd,
                  onPointerCancel: handleTriagePointerEnd,
                  onPointerLeave: handleTriagePointerEnd,
                  onClick: () => handleTriageRowClick(word.word.id),
                })}
                renderActionCell={(word) => {
                  const rowUpdating = updatingWordId === word.word.id;
                  return (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleSingleDismiss(word);
                      }}
                      onPointerDown={(event) => event.stopPropagation()}
                      disabled={rowUpdating || bulkSelectActive}
                    >
                      {rowUpdating ? 'Moving...' : 'Move to bottom'}
                    </button>
                  );
                }}
                renderAdvisorCell={(word) => {
                  const row = triageRows.find((entry) => entry.word.id === word.word.id);
                  return row ? (
                    <IntakeAdvisorAnnotation
                      row={row}
                      updatingAssessmentId={advisorUpdatingAssessmentId}
                      onAccept={onAcceptAdvisorAssessment}
                      onDismiss={onDismissAdvisorAssessment}
                    />
                  ) : null;
                }}
              />
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function PriorityWordTable({
  rows,
  rowRefs,
  tableTopAnchorRef,
  expandedDefinitionByWordId,
  setExpandedDefinitionByWordId,
  actionHeader,
  advisorHeader,
  extraHeader = null,
  renderExtraCell,
  renderActionCell,
  renderAdvisorCell,
  getRowClassName,
  getRowHandlers,
}: {
  rows: PriorityWord[];
  rowRefs?: React.MutableRefObject<Record<string, HTMLTableRowElement | null>>;
  tableTopAnchorRef?: React.RefObject<HTMLDivElement>;
  expandedDefinitionByWordId: Record<string, boolean>;
  setExpandedDefinitionByWordId: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  actionHeader?: string;
  advisorHeader?: string;
  extraHeader?: React.ReactNode;
  renderExtraCell?: (word: PriorityWord) => React.ReactNode;
  renderActionCell?: (word: PriorityWord) => React.ReactNode;
  renderAdvisorCell?: (word: PriorityWord) => React.ReactNode;
  getRowClassName?: (word: PriorityWord) => string;
  getRowHandlers?: (word: PriorityWord) => React.HTMLAttributes<HTMLTableRowElement>;
}) {
  return (
    <div className="table-shell" ref={tableTopAnchorRef}>
      <table className="words-table">
        <thead>
          <tr>
            {extraHeader}
            <th>Word</th>
            <th>Definition</th>
            {renderAdvisorCell ? <th>{advisorHeader}</th> : null}
            {renderActionCell ? <th>{actionHeader}</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((word) => {
            const isDefinitionExpanded = expandedDefinitionByWordId[word.word.id] ?? false;
            const firstMeaning = word.word.meanings[0] ?? word.word.meaning;
            const hasAdditionalMeanings = word.word.meanings.length > 1;
            const definitionsToShow = isDefinitionExpanded ? word.word.meanings : [firstMeaning];
            const rowHandlers = getRowHandlers?.(word) ?? {};

            return (
              <tr
                key={word.word.id}
                className={getRowClassName?.(word)}
                ref={(element) => {
                  if (rowRefs) {
                    rowRefs.current[word.word.id] = element;
                  }
                }}
                {...rowHandlers}
              >
                {renderExtraCell?.(word)}
                <td>
                  <div className="table-word-cell">
                    <strong>{word.word.hanzi}</strong>
                    <span>{word.word.pinyin}</span>
                    {word.requiredForNextSession ? <span className="priority-required-pill">Required</span> : null}
                  </div>
                </td>
                <td>
                  <div className="stack">
                    <MeaningList meanings={definitionsToShow} />
                    {hasAdditionalMeanings ? (
                      <button
                        type="button"
                        className="secondary-button"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          setExpandedDefinitionByWordId((current) => ({
                            ...current,
                            [word.word.id]: !isDefinitionExpanded,
                          }));
                        }}
                      >
                        {isDefinitionExpanded ? 'Show less' : `Show all (${word.word.meanings.length})`}
                      </button>
                    ) : null}
                  </div>
                </td>
                {renderAdvisorCell ? <td>{renderAdvisorCell(word)}</td> : null}
                {renderActionCell ? <td>{renderActionCell(word)}</td> : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function IntakeAdvisorAnnotation({
  row,
  updatingAssessmentId,
  onAccept,
  onDismiss,
}: {
  row: IntakeTriagePriorityWord;
  updatingAssessmentId: string | null;
  onAccept: (assessmentId: string) => void;
  onDismiss: (assessmentId: string) => void;
}) {
  const annotation = row.intakeTriage;
  if (!annotation) return null;
  if (annotation.kind === 'production_suppressed') {
    return (
      <div className="intake-advisor-annotation accepted">
        <strong>Review production suppressed</strong>
        {annotation.rationale ? <span>{annotation.rationale}</span> : null}
      </div>
    );
  }

  const updating = updatingAssessmentId === annotation.assessmentId;
  const label = annotation.judgment === 'defer_active_study'
    ? 'Move down'
    : annotation.judgment === 'recognition_only'
      ? 'Recognition only?'
      : 'Unsure';
  return (
    <div className={`intake-advisor-annotation ${annotation.judgment}`}>
      <strong>{label}</strong>
      <span>{annotation.rationale}</span>
      <div className="intake-advisor-actions">
        {annotation.judgment === 'recognition_only' ? (
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); onAccept(annotation.assessmentId); }}
            disabled={updating}
          >
            {updating ? 'Saving...' : 'Accept'}
          </button>
        ) : null}
        <button
          type="button"
          className="secondary-button"
          onClick={(event) => { event.stopPropagation(); onDismiss(annotation.assessmentId); }}
          disabled={updating}
        >
          Dismiss suggestion
        </button>
      </div>
    </div>
  );
}

function formatEstimatedCost(estimatedCostUsd: number | null): string {
  return estimatedCostUsd === null
    ? 'cost unavailable'
    : `estimated $${estimatedCostUsd.toFixed(6)}`;
}
