import { useEffect, useRef, useState } from 'react';
import type { PriorityWord } from '../types';
import { PriorityWordBank } from '../features/priority/PriorityWordBank';
import { partitionPriorityBank } from '../features/priority/priority-page-model';
import { studyProfile } from '../study-profile';

export function PriorityPage({
  rows,
  searchHanzi,
  requireAddedMatches,
  searchNotice,
  searchSubmitting,
  highlightedWordIds,
  onSearchHanziChange,
  onRequireAddedMatchesChange,
  onSearchSubmit,
  onHighlightsHandled,
  priorityBatchSubmitting,
  sinkSubmitting,
  onRequireForNextSession,
  onMoveSelectedToTop,
  onMoveSelectedToStash,
  onRemoveSelected,
  onSinkSelected,
}: {
  rows: PriorityWord[];
  searchHanzi: string;
  requireAddedMatches: boolean;
  searchNotice: string | null;
  searchSubmitting: boolean;
  highlightedWordIds: string[];
  onSearchHanziChange: (value: string) => void;
  onRequireAddedMatchesChange: (value: boolean) => void;
  onSearchSubmit: () => void;
  onHighlightsHandled: () => void;
  priorityBatchSubmitting: boolean;
  sinkSubmitting: boolean;
  onRequireForNextSession: (wordIds: string[], requiredForNextSession: boolean) => Promise<void>;
  onMoveSelectedToTop: (wordIds: string[]) => Promise<void>;
  onMoveSelectedToStash: (wordIds: string[]) => Promise<void>;
  onRemoveSelected: (wordIds: string[]) => Promise<void>;
  onSinkSelected: (wordIds: string[]) => Promise<void>;
}) {
  const [selectedManageWordIds, setSelectedManageWordIds] = useState<string[]>([]);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const { top, stash } = partitionPriorityBank(rows);

  useEffect(() => {
    setSelectedManageWordIds((current) =>
      current.filter((wordId) => rows.some((entry) => entry.word.id === wordId)),
    );
  }, [rows]);

  const wasSearchSubmittingRef = useRef(false);
  useEffect(() => {
    if (wasSearchSubmittingRef.current && !searchSubmitting) {
      searchInputRef.current?.focus();
    }
    wasSearchSubmittingRef.current = searchSubmitting;
  }, [searchSubmitting]);

  function handleSinkSelected() {
    if (selectedManageWordIds.length === 0) {
      return;
    }

    const confirmed = window.confirm(
      `Move ${selectedManageWordIds.length} selected word${selectedManageWordIds.length === 1 ? '' : 's'} to the bottom of new-word priority?`,
    );
    if (!confirmed) {
      return;
    }

    void handleSelectedManageAction(onSinkSelected);
  }

  function submitAndKeepFocus() {
    onSearchSubmit();
    searchInputRef.current?.focus();
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
      <div className="priority-page-main">
        <PriorityWordBank
          rows={rows}
          selectedWordIds={selectedManageWordIds}
          highlightedWordIds={highlightedWordIds}
          submitting={priorityBatchSubmitting || sinkSubmitting}
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
              if (event.nativeEvent.isComposing || event.keyCode === 229) {
                return;
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                submitAndKeepFocus();
              }
            }}
            placeholder={studyProfile.labels.addByTarget}
            aria-label={studyProfile.labels.addByTarget}
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
          <button type="button" onClick={submitAndKeepFocus} disabled={searchSubmitting}>
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
                onClick={handleSinkSelected}
                disabled={priorityBatchSubmitting || sinkSubmitting}
              >
                {sinkSubmitting ? 'Moving...' : 'To bottom'}
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
      </div>
    </section>
  );
}
