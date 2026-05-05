import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PriorityWord } from '../types';
import { MeaningList } from '../components/MeaningList';

export function PriorityPage({
  rows,
  unstudiedTotalCount,
  searchHanzi,
  searchNotice,
  searchSubmitting,
  dailyNewWordLimit,
  jumpRequestWordId,
  onSearchHanziChange,
  onSearchSubmit,
  onJumpHandled,
  updatingWordId,
  onMoveToTop,
  onBumpAgain,
  onRemove,
}: {
  rows: PriorityWord[];
  unstudiedTotalCount: number;
  searchHanzi: string;
  searchNotice: string | null;
  searchSubmitting: boolean;
  dailyNewWordLimit: number;
  jumpRequestWordId: string | null;
  onSearchHanziChange: (value: string) => void;
  onSearchSubmit: () => void;
  onJumpHandled: () => void;
  updatingWordId: string | null;
  onMoveToTop: (wordId: string) => void;
  onBumpAgain: (wordId: string) => void;
  onRemove: (wordId: string) => void;
}) {
  const [expandedDefinitionByWordId, setExpandedDefinitionByWordId] = useState<Record<string, boolean>>({});
  const [showJumpToTopButton, setShowJumpToTopButton] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const tableTopAnchorRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  const pendingMoveToTopAnchorRef = useRef<{ wordId: string; top: number } | null>(null);
  const onJumpHandledRef = useRef(onJumpHandled);

  useEffect(() => {
    onJumpHandledRef.current = onJumpHandled;
  }, [onJumpHandled]);

  useEffect(() => {
    if (!jumpRequestWordId) {
      return;
    }
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
      if (window.scrollY <= 8) {
        setShowJumpToTopButton(false);
      }
    }

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [showJumpToTopButton]);

  useLayoutEffect(() => {
    const pendingAnchor = pendingMoveToTopAnchorRef.current;
    if (!pendingAnchor) {
      return;
    }

    const anchorRowElement = rowRefs.current[pendingAnchor.wordId];
    if (!anchorRowElement) {
      pendingMoveToTopAnchorRef.current = null;
      return;
    }

    const nextTop = anchorRowElement.getBoundingClientRect().top;
    const delta = nextTop - pendingAnchor.top;
    if (Math.abs(delta) > 0.5) {
      window.scrollBy({ top: delta, behavior: 'auto' });
    }

    pendingMoveToTopAnchorRef.current = null;
  }, [rows]);

  function handleMoveToTopWithScrollLock(wordId: string) {
    const clickedIndex = rows.findIndex((entry) => entry.word.id === wordId);
    const anchorCandidate = clickedIndex > 0 ? rows[clickedIndex - 1] : null;
    if (anchorCandidate) {
      const anchorRowElement = rowRefs.current[anchorCandidate.word.id];
      if (anchorRowElement) {
        pendingMoveToTopAnchorRef.current = {
          wordId: anchorCandidate.word.id,
          top: anchorRowElement.getBoundingClientRect().top,
        };
      }
    }

    onMoveToTop(wordId);
  }

  return (
    <section className="words-page">
      <header className="header">
        <div>
          <h1 className="title">Priority</h1>
          <p className="subtitle">Search by hanzi to add matching unstudied words to the priority list.</p>
        </div>
      </header>

      <div className="panel">
        <h2>Add by hanzi</h2>
        <div className="pagination-actions">
          <input
            ref={searchInputRef}
            type="text"
            value={searchHanzi}
            onChange={(event) => onSearchHanziChange(event.target.value)}
            placeholder="Enter hanzi and submit"
            disabled={searchSubmitting}
          />
          <button type="button" onClick={onSearchSubmit} disabled={searchSubmitting}>
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
          <div className="table-shell" ref={tableTopAnchorRef}>
            <table className="words-table">
              <thead>
                <tr>
                  <th>Word</th>
                  <th>Definition</th>
                  <th>Priority</th>
                  <th>Approx days</th>
                  <th>Bumps</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((word) => {
                  const rowUpdating = updatingWordId === word.word.id;
                  const isDefinitionExpanded = expandedDefinitionByWordId[word.word.id] ?? false;
                  const firstMeaning = word.word.meanings[0] ?? word.word.meaning;
                  const hasAdditionalMeanings = word.word.meanings.length > 1;
                  const definitionsToShow = isDefinitionExpanded ? word.word.meanings : [firstMeaning];
                  const priorityPercentile = word.forceTop
                    ? null
                    : getPriorityPercentileText(word.effectiveRank, unstudiedTotalCount);
                  const approxDaysToStudy = getApproxDaysToStudyText(
                    word.effectiveRank,
                    dailyNewWordLimit,
                  );

                  return (
                    <tr
                      key={word.word.id}
                      ref={(element) => {
                        rowRefs.current[word.word.id] = element;
                      }}
                    >
                      <td>
                        <div className="table-word-cell">
                          <strong>{word.word.hanzi}</strong>
                          <span>{word.word.pinyin}</span>
                        </div>
                      </td>
                      <td>
                        <div className="stack">
                          <MeaningList meanings={definitionsToShow} />
                          {hasAdditionalMeanings ? (
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() =>
                                setExpandedDefinitionByWordId((current) => ({
                                  ...current,
                                  [word.word.id]: !isDefinitionExpanded,
                                }))
                              }
                            >
                              {isDefinitionExpanded ? 'Show less' : `Show all (${word.word.meanings.length})`}
                            </button>
                          ) : null}
                        </div>
                      </td>
                      <td>{priorityPercentile ?? <span className="notes">N/A</span>}</td>
                      <td>{approxDaysToStudy}</td>
                      <td>{word.bumpCount}</td>
                      <td>
                        <div className="pagination-actions">
                          <button
                            type="button"
                            onClick={() => handleMoveToTopWithScrollLock(word.word.id)}
                            disabled={rowUpdating || word.forceTop}
                          >
                            {word.forceTop ? 'At top' : 'Move to top'}
                          </button>
                          <button type="button" onClick={() => onBumpAgain(word.word.id)} disabled={rowUpdating}>
                            Bump again
                          </button>
                          <button type="button" onClick={() => onRemove(word.word.id)} disabled={rowUpdating}>
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
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
    </section>
  );
}

function getPriorityPercentileText(effectiveRank: number | null, unstudiedTotalCount: number | null) {
  if (!effectiveRank || !unstudiedTotalCount || unstudiedTotalCount <= 0) {
    return 'N/A';
  }

  const higherThanPercent = Math.max(0, Math.round(((unstudiedTotalCount - effectiveRank) / unstudiedTotalCount) * 100));
  return `Higher than ${higherThanPercent}%`;
}

function getApproxDaysToStudyText(effectiveRank: number | null, dailyNewWordLimit: number) {
  if (!effectiveRank || dailyNewWordLimit <= 0) {
    return 'N/A';
  }

  return (effectiveRank / dailyNewWordLimit).toFixed(1);
}
