import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import type { PriorityWord } from '../types';
import { MeaningList } from '../components/MeaningList';
import { studyProfile } from '../study-profile';

type PrioritySubtab = 'manage' | 'triage';

export function PriorityPage({
  rows,
  triageRows,
  unstudiedTotalCount,
  searchHanzi,
  requireAddedMatches,
  searchNotice,
  searchSubmitting,
  jumpRequestWordId,
  onSearchHanziChange,
  onRequireAddedMatchesChange,
  onSearchSubmit,
  onJumpHandled,
  updatingWordId,
  priorityBatchSubmitting,
  bulkDismissSubmitting,
  onRequireForNextSession,
  onMoveSelectedToTop,
  onBumpSelectedAgain,
  onRemoveSelected,
  onDismissFromTriage,
  onBulkDismissFromTriage,
}: {
  rows: PriorityWord[];
  triageRows: PriorityWord[];
  unstudiedTotalCount: number;
  searchHanzi: string;
  requireAddedMatches: boolean;
  searchNotice: string | null;
  searchSubmitting: boolean;
  jumpRequestWordId: string | null;
  onSearchHanziChange: (value: string) => void;
  onRequireAddedMatchesChange: (value: boolean) => void;
  onSearchSubmit: () => void;
  onJumpHandled: () => void;
  updatingWordId: string | null;
  priorityBatchSubmitting: boolean;
  bulkDismissSubmitting: boolean;
  onRequireForNextSession: (wordIds: string[], requiredForNextSession: boolean) => Promise<void>;
  onMoveSelectedToTop: (wordIds: string[]) => Promise<void>;
  onBumpSelectedAgain: (wordIds: string[]) => Promise<void>;
  onRemoveSelected: (wordIds: string[]) => Promise<void>;
  onDismissFromTriage: (wordId: string) => void;
  onBulkDismissFromTriage: (wordIds: string[]) => void;
}) {
  const [activeSubtab, setActiveSubtab] = useState<PrioritySubtab>('manage');
  const [expandedDefinitionByWordId, setExpandedDefinitionByWordId] = useState<Record<string, boolean>>({});
  const [showJumpToTopButton, setShowJumpToTopButton] = useState(false);
  const [selectedManageWordIds, setSelectedManageWordIds] = useState<string[]>([]);
  const [bulkSelectActive, setBulkSelectActive] = useState(false);
  const [selectedTriageWordIds, setSelectedTriageWordIds] = useState<string[]>([]);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const tableTopAnchorRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  const onJumpHandledRef = useRef(onJumpHandled);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressActivatedRef = useRef(false);
  const jumpTopButtonSawScrolledPageRef = useRef(false);

  useEffect(() => {
    onJumpHandledRef.current = onJumpHandled;
  }, [onJumpHandled]);

  // primarily for the case when a selected entry is removed, the update goes to the rows state,
  // and this effect is triggered to then clear the corresponding id from the selectedManageWordIds state.
  // when there's a new row, this update also runs, which is weird because the new row's wordId
  // cannot be in the current selectedManagerWordIds state, but that's ok...
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

  useEffect(() => {
    if (!jumpRequestWordId) {
      return;
    }

    jumpTopButtonSawScrolledPageRef.current = false;
    setShowJumpToTopButton(true);
    const targetRowElement = rowRefs.current[jumpRequestWordId];
    const tableTopAnchorElement = tableTopAnchorRef.current;

    if (!targetRowElement || !tableTopAnchorElement) {
      onJumpHandledRef.current();
      return;
    }

    const targetRowRect = targetRowElement.getBoundingClientRect();
    const tableTopRect = tableTopAnchorElement.getBoundingClientRect();
    const targetRowAbsoluteTop = targetRowRect.top + window.scrollY;
    const tableTopAbsoluteAtPageTop = tableTopRect.top + window.scrollY;
    const desiredScrollTop = Math.max(0, targetRowAbsoluteTop - tableTopAbsoluteAtPageTop);
    const shouldJump = targetRowRect.top > tableTopRect.top + 8;

    if (shouldJump) {
      window.scrollTo({ top: desiredScrollTop, behavior: 'smooth' });
      setShowJumpToTopButton(true);
    }

    onJumpHandledRef.current();
  }, [jumpRequestWordId]);

  useEffect(() => {
    if (!showJumpToTopButton) {
      return;
    }

    function handleScroll() {
      if (window.scrollY > 8) {
        jumpTopButtonSawScrolledPageRef.current = true;
        return;
      }

      if (jumpTopButtonSawScrolledPageRef.current) {
        setShowJumpToTopButton(false);
      }
    }

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [showJumpToTopButton]);

  function toggleManageSelection(wordId: string) {
    setSelectedManageWordIds((current) =>
      current.includes(wordId) ? current.filter((selectedId) => selectedId !== wordId) : [...current, wordId],
    );
  }

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
    const confirmed = window.confirm(`Dismiss ${word.word.hanzi} from new-word study?`);
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

  async function handleSelectedManageAction(action: (wordIds: string[]) => Promise<void>) {
    const selectedIds = selectedManageWordIds;
    if (selectedIds.length === 0) {
      return;
    }

    try {
      await action(selectedIds);
      setSelectedManageWordIds([]);
    } catch {
      // The controller owns the visible error state; keep the selection intact.
    }
  }

  const selectedManageRows = rows.filter((entry) => selectedManageWordIds.includes(entry.word.id));
  const allSelectedRequired =
    selectedManageRows.length > 0 && selectedManageRows.every((entry) => entry.requiredForNextSession);
  const manageSelectionActive = selectedManageWordIds.length > 0;
  const searchDisabled = searchSubmitting || manageSelectionActive;

  return (
    <section className="words-page">
      <header className="header">
        <div>
          <h1 className="title">Priority</h1>
          <p className="subtitle">{studyProfile.labels.targetSearchPrompt}</p>
        </div>
      </header>

      <div className="priority-subtabs" role="tablist" aria-label="Priority views">
        <button
          type="button"
          className={activeSubtab === 'manage' ? 'priority-subtab active' : 'priority-subtab'}
          onClick={() => setActiveSubtab('manage')}
        >
          Manage priority
        </button>
        <button
          type="button"
          className={activeSubtab === 'triage' ? 'priority-subtab active' : 'priority-subtab'}
          onClick={() => setActiveSubtab('triage')}
        >
          Triage top 50
        </button>
      </div>

      {activeSubtab === 'manage' ? (
        <>
          <div className="panel">
            <h2>{studyProfile.labels.addByTarget}</h2>
            <div className="pagination-actions">
              <input
                ref={searchInputRef}
                type="text"
                value={searchHanzi}
                onChange={(event) => onSearchHanziChange(event.target.value)}
                placeholder={studyProfile.labels.targetSearchPlaceholder}
                disabled={searchDisabled}
              />
              <label className="inline-checkbox">
                <input
                  type="checkbox"
                  checked={requireAddedMatches}
                  disabled={searchDisabled}
                  onChange={(event) => onRequireAddedMatchesChange(event.target.checked)}
                />
                Require added matches
              </label>
              <button type="button" onClick={onSearchSubmit} disabled={searchDisabled}>
                {searchSubmitting ? 'Adding...' : 'Add matches'}
              </button>
            </div>
            {searchNotice ? <p className="notes">{searchNotice}</p> : null}
          </div>

          <div className="panel">
            <h2>Prioritized list</h2>
            {rows.length === 0 ? (
              <p className="notes">No prioritized unstudied words yet.</p>
            ) : (
              <PriorityWordTable
                rows={rows}
                rowRefs={rowRefs}
                tableTopAnchorRef={tableTopAnchorRef}
                expandedDefinitionByWordId={expandedDefinitionByWordId}
                setExpandedDefinitionByWordId={setExpandedDefinitionByWordId}
                unstudiedTotalCount={unstudiedTotalCount}
                getRowClassName={(word) =>
                  selectedManageWordIds.includes(word.word.id) ? 'priority-manage-row selected' : 'priority-manage-row'
                }
                getRowHandlers={(word) => ({
                  onClick: () => toggleManageSelection(word.word.id),
                })}
              />
            )}
          </div>
        </>
      ) : (
        <div className="panel">
          <div className="priority-panel-header">
            <div>
              <h2>Top unstudied words</h2>
              <p className="notes">Long-press any row to select words for bulk dismiss.</p>
            </div>
            {bulkSelectActive ? (
              <div className="pagination-actions">
                <button type="button" className="secondary-button" onClick={() => setSelectedTriageWordIds([])}>
                  Clear
                </button>
                <button
                  type="button"
                  onClick={handleBulkDismiss}
                  disabled={selectedTriageWordIds.length === 0 || bulkDismissSubmitting}
                >
                  {bulkDismissSubmitting ? 'Dismissing...' : `Bulk dismiss (${selectedTriageWordIds.length})`}
                </button>
              </div>
            ) : null}
          </div>
          {triageRows.length === 0 ? (
            <p className="notes">No top unstudied words are currently available.</p>
          ) : (
            <PriorityWordTable
              rows={triageRows}
              expandedDefinitionByWordId={expandedDefinitionByWordId}
              setExpandedDefinitionByWordId={setExpandedDefinitionByWordId}
              unstudiedTotalCount={unstudiedTotalCount}
              actionHeader={bulkSelectActive ? 'Select' : 'Dismiss'}
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
                    {rowUpdating ? 'Dismissing...' : 'Dismiss'}
                  </button>
                );
              }}
            />
          )}
        </div>
      )}

      {showJumpToTopButton ? (
        <button
          type="button"
          className="priority-jump-top-button"
          onClick={() => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
            setShowJumpToTopButton(false);
            window.setTimeout(() => {
              searchInputRef.current?.focus();
              searchInputRef.current?.select();
            }, 250);
          }}
        >
          Jump to top
        </button>
      ) : null}

      {manageSelectionActive ? (
        <div className="priority-floating-actions" role="group" aria-label="Selected priority word actions">
          <span className="priority-selection-count">{selectedManageWordIds.length} selected</span>
          <button
            type="button"
            onClick={() => void handleSelectedManageAction(onBumpSelectedAgain)}
            disabled={priorityBatchSubmitting}
          >
            Bump
          </button>
          <button
            type="button"
            onClick={() => void handleSelectedManageAction(onMoveSelectedToTop)}
            disabled={priorityBatchSubmitting || selectedManageRows.every((entry) => entry.forceTop)}
          >
            Move to top
          </button>
          <button
            type="button"
            onClick={() =>
              void handleSelectedManageAction((wordIds) => onRequireForNextSession(wordIds, !allSelectedRequired))
            }
            disabled={priorityBatchSubmitting}
          >
            {allSelectedRequired ? 'Unrequire' : 'Require'}
          </button>
          <button
            type="button"
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
            Clear selected
          </button>
        </div>
      ) : null}
    </section>
  );
}

function PriorityWordTable({
  rows,
  rowRefs,
  tableTopAnchorRef,
  expandedDefinitionByWordId,
  setExpandedDefinitionByWordId,
  unstudiedTotalCount,
  actionHeader,
  extraHeader = null,
  renderExtraCell,
  renderActionCell,
  getRowClassName,
  getRowHandlers,
}: {
  rows: PriorityWord[];
  rowRefs?: React.MutableRefObject<Record<string, HTMLTableRowElement | null>>;
  tableTopAnchorRef?: React.RefObject<HTMLDivElement>;
  expandedDefinitionByWordId: Record<string, boolean>;
  setExpandedDefinitionByWordId: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  unstudiedTotalCount: number;
  actionHeader?: string;
  extraHeader?: React.ReactNode;
  renderExtraCell?: (word: PriorityWord) => React.ReactNode;
  renderActionCell?: (word: PriorityWord) => React.ReactNode;
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
            <th>Priority</th>
            <th>Bumps</th>
            {renderActionCell ? <th>{actionHeader}</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((word) => {
            const isDefinitionExpanded = expandedDefinitionByWordId[word.word.id] ?? false;
            const firstMeaning = word.word.meanings[0] ?? word.word.meaning;
            const hasAdditionalMeanings = word.word.meanings.length > 1;
            const definitionsToShow = isDefinitionExpanded ? word.word.meanings : [firstMeaning];
            const priorityPercentile = word.forceTop
              ? null
              : getPriorityPercentileText(word.effectiveRank, unstudiedTotalCount);
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
                <td>{priorityPercentile ?? <span className="notes">N/A</span>}</td>
                <td>{word.bumpCount}</td>
                {renderActionCell ? <td>{renderActionCell(word)}</td> : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function getPriorityPercentileText(effectiveRank: number | null, unstudiedTotalCount: number | null) {
  if (!effectiveRank || !unstudiedTotalCount || unstudiedTotalCount <= 0) {
    return 'N/A';
  }

  const higherThanPercent = Math.max(0, Math.round(((unstudiedTotalCount - effectiveRank) / unstudiedTotalCount) * 100));
  return `Higher than ${higherThanPercent}%`;
}
