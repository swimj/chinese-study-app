import { forwardRef, useEffect, useRef, useState } from 'react';
import type { PriorityWord, Word } from '../types';
import { PriorityWordBank } from '../features/priority/PriorityWordBank';
import { partitionPriorityBank } from '../features/priority/priority-page-model';
import {
  digitKeyToMatchIndex,
  matchIndexShortcutLabel,
} from '../features/priority/priority-match-selection';
import type { PriorityMatchChoiceState } from '../features/priority/usePriorityPageController';
import { studyProfile } from '../study-profile';

export type PriorityPageProps = {
  rows: PriorityWord[];
  searchHanzi: string;
  searchNotice: string | null;
  searchSubmitting: boolean;
  matchChoices: PriorityMatchChoiceState | null;
  selectedMatchIds: string[];
  highlightedWordIds: string[];
  onSearchHanziChange: (value: string) => void;
  onSearchSubmit: () => void;
  onToggleMatchSelection: (wordId: string) => void;
  onConfirmMatchSelection: () => void;
  onCancelMatchSelection: () => void;
  onHighlightsHandled: () => void;
  priorityBatchSubmitting: boolean;
  onRequireForNextSession: (wordIds: string[], requiredForNextSession: boolean) => Promise<void>;
  onMoveSelectedToTop: (wordIds: string[]) => Promise<void>;
  onMoveSelectedToStash: (wordIds: string[]) => Promise<void>;
  onRemoveSelected: (wordIds: string[]) => Promise<void>;
};

export function PriorityPage({
  rows,
  searchHanzi,
  searchNotice,
  searchSubmitting,
  matchChoices,
  selectedMatchIds,
  highlightedWordIds,
  onSearchHanziChange,
  onSearchSubmit,
  onToggleMatchSelection,
  onConfirmMatchSelection,
  onCancelMatchSelection,
  onHighlightsHandled,
  priorityBatchSubmitting,
  onRequireForNextSession,
  onMoveSelectedToTop,
  onMoveSelectedToStash,
  onRemoveSelected,
}: PriorityPageProps) {
  const [selectedManageWordIds, setSelectedManageWordIds] = useState<string[]>([]);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const matchPickerRef = useRef<HTMLDivElement | null>(null);
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

  useEffect(() => {
    if (!matchChoices) {
      return;
    }

    searchInputRef.current?.focus();

    function handlePointerDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (matchPickerRef.current?.contains(target) || searchInputRef.current?.contains(target)) {
        return;
      }

      onCancelMatchSelection();
    }

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [matchChoices, onCancelMatchSelection]);

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
          submitting={priorityBatchSubmitting}
          onSelectedWordIdsChange={setSelectedManageWordIds}
          onMoveToTop={(wordIds) => handleSelectedManageAction(onMoveSelectedToTop, wordIds)}
          onMoveToStash={(wordIds) => handleSelectedManageAction(onMoveSelectedToStash, wordIds)}
          onRemove={(wordIds) => handleSelectedManageAction(onRemoveSelected, wordIds)}
          onHighlightsHandled={onHighlightsHandled}
        />
        <div className="priority-bottom-rail">
          <div className="priority-add-field">
            <input
              ref={searchInputRef}
              type="text"
              value={searchHanzi}
              onChange={(event) => onSearchHanziChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.keyCode === 229) {
                  return;
                }

                if (matchChoices) {
                  const matchIndex = digitKeyToMatchIndex(event.key);
                  if (matchIndex !== null) {
                    event.preventDefault();
                    const match = matchChoices.matches[matchIndex];
                    if (match) {
                      onToggleMatchSelection(match.id);
                    }
                    return;
                  }

                  if (event.key === 'Escape') {
                    event.preventDefault();
                    onCancelMatchSelection();
                    return;
                  }

                  if (event.key === 'Enter') {
                    event.preventDefault();
                    onConfirmMatchSelection();
                    searchInputRef.current?.focus();
                    return;
                  }

                  return;
                }

                if (event.key === 'Enter') {
                  event.preventDefault();
                  submitAndKeepFocus();
                }
              }}
              placeholder={studyProfile.labels.addByTarget}
              aria-label={studyProfile.labels.addByTarget}
              aria-expanded={matchChoices !== null}
              aria-controls={matchChoices ? 'priority-match-picker' : undefined}
            />
            {matchChoices ? (
              <PriorityMatchPickerWithRef
                ref={matchPickerRef}
                choices={matchChoices}
                selectedMatchIds={selectedMatchIds}
                submitting={searchSubmitting}
                onToggle={onToggleMatchSelection}
                onConfirm={() => {
                  onConfirmMatchSelection();
                  searchInputRef.current?.focus();
                }}
                onCancel={onCancelMatchSelection}
              />
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => {
              if (matchChoices) {
                onConfirmMatchSelection();
                searchInputRef.current?.focus();
                return;
              }
              submitAndKeepFocus();
            }}
            disabled={searchSubmitting}
          >
            {searchSubmitting ? 'Adding...' : matchChoices ? 'Add selected' : 'Add'}
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
      </div>
    </section>
  );
}

const PriorityMatchPickerWithRef = forwardRef<
  HTMLDivElement,
  {
    choices: PriorityMatchChoiceState;
    selectedMatchIds: string[];
    submitting: boolean;
    onToggle: (wordId: string) => void;
    onConfirm: () => void;
    onCancel: () => void;
  }
>(function PriorityMatchPicker(
  {
    choices,
    selectedMatchIds,
    submitting,
    onToggle,
    onConfirm,
    onCancel,
  },
  ref,
) {
  return (
    <div
      ref={ref}
      id="priority-match-picker"
      className="priority-match-picker"
      role="listbox"
      aria-label={`Matches for ${choices.query}`}
      aria-multiselectable="true"
    >
      <div className="priority-match-picker-head">
        <strong>{choices.matches.length} matches for “{choices.query}”</strong>
        <span>1–9 toggle · Enter adds · Esc cancels</span>
      </div>
      <ul className="priority-match-picker-list">
        {choices.matches.map((match, index) => (
          <PriorityMatchOption
            key={match.id}
            match={match}
            index={index}
            selected={selectedMatchIds.includes(match.id)}
            disabled={submitting}
            onToggle={onToggle}
          />
        ))}
      </ul>
      <div className="priority-match-picker-actions">
        <button type="button" className="secondary-button" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
        <button type="button" onClick={onConfirm} disabled={submitting || selectedMatchIds.length === 0}>
          Add selected ({selectedMatchIds.length})
        </button>
      </div>
    </div>
  );
});

function PriorityMatchOption({
  match,
  index,
  selected,
  disabled,
  onToggle,
}: {
  match: Word;
  index: number;
  selected: boolean;
  disabled: boolean;
  onToggle: (wordId: string) => void;
}) {
  const shortcut = matchIndexShortcutLabel(index);
  const meanings = match.meanings.length > 0 ? match.meanings : [match.meaning];

  return (
    <li>
      <button
        type="button"
        role="option"
        aria-selected={selected}
        className={`priority-match-option${selected ? ' is-selected' : ''}`}
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onToggle(match.id)}
      >
        <span className="priority-match-option-shortcut" aria-hidden="true">
          {shortcut ?? '·'}
        </span>
        <span className="priority-match-option-body">
          <span className="priority-match-option-title">
            <strong>{match.hanzi}</strong>
            <span>{match.pinyin}</span>
          </span>
          <span className="priority-match-option-meaning">{meanings.join(' · ')}</span>
        </span>
      </button>
    </li>
  );
}
