import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { MeaningList } from '../../components/MeaningList';
import type { PriorityWord } from '../../types';
import {
  nextChipSelection,
  partitionPriorityBank,
  type PriorityBankSection,
} from './priority-page-model';

const PRIORITY_CHIP_DRAG_MIME = 'application/x-priority-word-ids';

export function PriorityWordBank({
  rows,
  selectedWordIds,
  highlightedWordIds,
  submitting,
  onSelectedWordIdsChange,
  onMoveToTop,
  onMoveToStash,
  onRemove,
  onHighlightsHandled,
}: {
  rows: PriorityWord[];
  selectedWordIds: string[];
  highlightedWordIds: string[];
  submitting: boolean;
  onSelectedWordIdsChange: (wordIds: string[]) => void;
  onMoveToTop: (wordIds: string[]) => Promise<void>;
  onMoveToStash: (wordIds: string[]) => Promise<void>;
  onRemove: (wordIds: string[]) => Promise<void>;
  onHighlightsHandled: () => void;
}) {
  const { top, stash } = partitionPriorityBank(rows);
  const [rangeAnchorId, setRangeAnchorId] = useState<string | null>(null);
  const [draggingWordIds, setDraggingWordIds] = useState<string[]>([]);
  const [dropSection, setDropSection] = useState<PriorityBankSection | null>(null);
  const [hoveredWordId, setHoveredWordId] = useState<string | null>(null);
  const [popoverPosition, setPopoverPosition] = useState<{ top: number; left: number } | null>(null);
  const chipRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const didDragRef = useRef(false);
  const hoverTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const onHighlightsHandledRef = useRef(onHighlightsHandled);
  onHighlightsHandledRef.current = onHighlightsHandled;
  const selectedWordIdsRef = useRef(selectedWordIds);
  selectedWordIdsRef.current = selectedWordIds;

  useEffect(() => {
    if (highlightedWordIds.length === 0) {
      return;
    }

    const firstId = highlightedWordIds[0];
    const target = firstId ? chipRefs.current[firstId] : null;
    target?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    const timeoutId = window.setTimeout(() => {
      onHighlightsHandledRef.current();
    }, 2400);
    return () => window.clearTimeout(timeoutId);
  }, [highlightedWordIds]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onSelectedWordIdsChange([]);
        setRangeAnchorId(null);
        hidePopover();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a' && !isTypingTarget(event.target)) {
        event.preventDefault();
        onSelectedWordIdsChange(rows.map((entry) => entry.word.id));
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onSelectedWordIdsChange, rows]);

  useEffect(() => {
    return () => {
      clearHoverTimer();
      clearHideTimer();
    };
  }, []);

  function applySelection(next: { selectedIds: string[]; rangeAnchorId: string }) {
    onSelectedWordIdsChange(next.selectedIds);
    setRangeAnchorId(next.rangeAnchorId);
  }

  function handleChipMouseDown(
    event: React.MouseEvent<HTMLButtonElement>,
    wordId: string,
    sectionIds: string[],
  ) {
    if (event.button !== 0) {
      return;
    }

    const mode = event.shiftKey ? 'range' : event.metaKey || event.ctrlKey ? 'toggle' : 'replace';
    if (mode !== 'replace' || !selectedWordIds.includes(wordId)) {
      applySelection(nextChipSelection({
        selectedIds: selectedWordIds,
        orderedIds: sectionIds,
        targetId: wordId,
        mode,
        rangeAnchorId,
      }));
    }
  }

  function handleChipClick(
    event: React.MouseEvent<HTMLButtonElement>,
    wordId: string,
    sectionIds: string[],
  ) {
    if (didDragRef.current || event.shiftKey || event.metaKey || event.ctrlKey) {
      return;
    }

    applySelection(nextChipSelection({
      selectedIds: selectedWordIds,
      orderedIds: sectionIds,
      targetId: wordId,
      mode: 'replace',
      rangeAnchorId,
    }));
  }

  function handleSectionMouseDown(event: React.MouseEvent<HTMLElement>) {
    if (event.target !== event.currentTarget) {
      return;
    }

    onSelectedWordIdsChange([]);
    setRangeAnchorId(null);
  }

  function handleDragStart(event: React.DragEvent<HTMLButtonElement>, wordId: string) {
    didDragRef.current = true;
    hidePopover();
    const movingIds = selectedWordIdsRef.current.includes(wordId)
      ? selectedWordIdsRef.current
      : [wordId];
    setDraggingWordIds(movingIds);
    const payload = JSON.stringify(movingIds);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(PRIORITY_CHIP_DRAG_MIME, payload);
    event.dataTransfer.setData('text/plain', payload);
    const dragImage = createDragImage(movingIds.length, event.currentTarget);
    event.dataTransfer.setDragImage(dragImage.element, 16, 16);
    window.setTimeout(() => dragImage.cleanup(), 0);
  }

  function handleDragEnd() {
    finishDrag();
  }

  function finishDrag() {
    setDraggingWordIds([]);
    setDropSection(null);
    didDragRef.current = false;
  }

  async function handleDrop(section: PriorityBankSection, event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    // Moving between sections updates rows optimistically, which can unmount
    // the drag source before its dragend handler runs. Clear this state here
    // as well so the moved chip can show its hover popover in the new section.
    finishDrag();
    const raw = event.dataTransfer.getData(PRIORITY_CHIP_DRAG_MIME)
      || event.dataTransfer.getData('text/plain');
    if (!raw) {
      return;
    }

    let wordIds: string[] = [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      wordIds = Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === 'string')
        : [];
    } catch {
      return;
    }

    const neededIds = wordIds.filter((wordId) => {
      const entry = rows.find((row) => row.word.id === wordId);
      if (!entry) {
        return false;
      }

      return section === 'top' ? !entry.forceTop : entry.forceTop;
    });
    if (neededIds.length === 0 || submitting) {
      return;
    }

    try {
      await (section === 'top' ? onMoveToTop(neededIds) : onMoveToStash(neededIds));
    } catch {
      // Controller owns visible error state.
    }
  }

  function schedulePopover(wordId: string, target: HTMLElement) {
    clearHideTimer();
    clearHoverTimer();
    hoverTimerRef.current = window.setTimeout(() => {
      if (didDragRef.current) {
        return;
      }

      setHoveredWordId(wordId);
      setPopoverPosition(placePopover(target.getBoundingClientRect()));
    }, 180);
  }

  function scheduleHidePopover() {
    clearHoverTimer();
    clearHideTimer();
    hideTimerRef.current = window.setTimeout(() => {
      hidePopover();
    }, 120);
  }

  function hidePopover() {
    clearHoverTimer();
    clearHideTimer();
    setHoveredWordId(null);
    setPopoverPosition(null);
  }

  function clearHoverTimer() {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }

  function clearHideTimer() {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }

  const hoveredWord = hoveredWordId
    ? rows.find((entry) => entry.word.id === hoveredWordId) ?? null
    : null;

  return (
    <div className="priority-word-bank">
      <PriorityBankSection
        section="top"
        label="Top"
        rows={top}
        selectedWordIds={selectedWordIds}
        highlightedWordIds={highlightedWordIds}
        draggingWordIds={draggingWordIds}
        dropActive={dropSection === 'top'}
        submitting={submitting}
        emptyCopy="Drag chips here to move them to top."
        chipRefs={chipRefs}
        onSectionMouseDown={handleSectionMouseDown}
        onChipMouseDown={handleChipMouseDown}
        onChipClick={handleChipClick}
        onChipMouseEnter={schedulePopover}
        onChipMouseLeave={scheduleHidePopover}
        onScroll={hidePopover}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragEnter={() => setDropSection('top')}
        onDragLeave={() => setDropSection((current) => (current === 'top' ? null : current))}
        onDrop={(event) => void handleDrop('top', event)}
      />
      <PriorityBankSection
        section="stash"
        label="Stash"
        rows={stash}
        selectedWordIds={selectedWordIds}
        highlightedWordIds={highlightedWordIds}
        draggingWordIds={draggingWordIds}
        dropActive={dropSection === 'stash'}
        submitting={submitting}
        emptyCopy="Add matches below, or drag chips here from top."
        chipRefs={chipRefs}
        onSectionMouseDown={handleSectionMouseDown}
        onChipMouseDown={handleChipMouseDown}
        onChipClick={handleChipClick}
        onChipMouseEnter={schedulePopover}
        onChipMouseLeave={scheduleHidePopover}
        onScroll={hidePopover}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragEnter={() => setDropSection('stash')}
        onDragLeave={() => setDropSection((current) => (current === 'stash' ? null : current))}
        onDrop={(event) => void handleDrop('stash', event)}
      />
      {hoveredWord && popoverPosition ? (
        <PriorityChipPopover
          word={hoveredWord}
          position={popoverPosition}
          submitting={submitting}
          onMouseEnter={() => {
            clearHideTimer();
          }}
          onMouseLeave={scheduleHidePopover}
          onRemove={() => {
            hidePopover();
            void onRemove([hoveredWord.word.id]);
          }}
        />
      ) : null}
    </div>
  );
}

function PriorityBankSection({
  section,
  label,
  rows,
  selectedWordIds,
  highlightedWordIds,
  draggingWordIds,
  dropActive,
  submitting,
  emptyCopy,
  chipRefs,
  onSectionMouseDown,
  onChipMouseDown,
  onChipClick,
  onChipMouseEnter,
  onChipMouseLeave,
  onScroll,
  onDragStart,
  onDragEnd,
  onDragEnter,
  onDragLeave,
  onDrop,
}: {
  section: PriorityBankSection;
  label: string;
  rows: PriorityWord[];
  selectedWordIds: string[];
  highlightedWordIds: string[];
  draggingWordIds: string[];
  dropActive: boolean;
  submitting: boolean;
  emptyCopy: string;
  chipRefs: React.MutableRefObject<Record<string, HTMLButtonElement | null>>;
  onSectionMouseDown: (event: React.MouseEvent<HTMLElement>) => void;
  onChipMouseDown: (
    event: React.MouseEvent<HTMLButtonElement>,
    wordId: string,
    sectionIds: string[],
  ) => void;
  onChipClick: (
    event: React.MouseEvent<HTMLButtonElement>,
    wordId: string,
    sectionIds: string[],
  ) => void;
  onChipMouseEnter: (wordId: string, target: HTMLElement) => void;
  onChipMouseLeave: () => void;
  onScroll: () => void;
  onDragStart: (event: React.DragEvent<HTMLButtonElement>, wordId: string) => void;
  onDragEnd: () => void;
  onDragEnter: () => void;
  onDragLeave: () => void;
  onDrop: (event: React.DragEvent<HTMLElement>) => void;
}) {
  const dragDepthRef = useRef(0);
  const sectionIds = rows.map((entry) => entry.word.id);
  const className = [
    'priority-bank-section',
    `is-${section}`,
    dropActive ? 'is-drop-target' : '',
  ].filter(Boolean).join(' ');

  return (
    <section
      className={className}
      aria-label={label}
      onMouseDown={onSectionMouseDown}
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepthRef.current += 1;
        onDragEnter();
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = submitting ? 'none' : 'move';
      }}
      onDragLeave={() => {
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) {
          onDragLeave();
        }
      }}
      onDrop={(event) => {
        dragDepthRef.current = 0;
        onDrop(event);
      }}
    >
      <header className="priority-bank-section-header">
        <span>{label}</span>
        <span className="priority-bank-section-count">{rows.length}</span>
      </header>
      {rows.length === 0 ? (
        <p className="notes priority-bank-empty">{emptyCopy}</p>
      ) : (
        <div
          className="priority-chip-flow"
          role="listbox"
          aria-label={`${label} words`}
          aria-multiselectable="true"
          onScroll={onScroll}
        >
          {rows.map((entry) => {
            const wordId = entry.word.id;
            const selected = selectedWordIds.includes(wordId);
            const chipClassName = [
              'priority-word-chip',
              selected ? 'is-selected' : '',
              entry.requiredForNextSession ? 'is-required' : '',
              highlightedWordIds.includes(wordId) ? 'is-highlighted' : '',
              draggingWordIds.includes(wordId) ? 'is-dragging' : '',
            ].filter(Boolean).join(' ');

            return (
              <button
                key={wordId}
                type="button"
                role="option"
                aria-selected={selected}
                draggable={!submitting}
                className={chipClassName}
                ref={(element) => {
                  chipRefs.current[wordId] = element;
                }}
                onMouseDown={(event) => onChipMouseDown(event, wordId, sectionIds)}
                onClick={(event) => onChipClick(event, wordId, sectionIds)}
                onMouseEnter={(event) => onChipMouseEnter(wordId, event.currentTarget)}
                onMouseLeave={onChipMouseLeave}
                onDragStart={(event) => onDragStart(event, wordId)}
                onDragEnd={onDragEnd}
              >
                <span className="priority-word-chip-hanzi">{entry.word.hanzi}</span>
                <span className="priority-word-chip-sep">·</span>
                <span className="priority-word-chip-pinyin">{entry.word.pinyin}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function PriorityChipPopover({
  word,
  position,
  submitting,
  onMouseEnter,
  onMouseLeave,
  onRemove,
}: {
  word: PriorityWord;
  position: { top: number; left: number };
  submitting: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      className="priority-chip-popover"
      style={{ top: position.top, left: position.left }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="priority-chip-popover-head">
        <div className="priority-chip-popover-title">
          <strong>{word.word.hanzi}</strong>
          <span>{word.word.pinyin}</span>
        </div>
        <button
          type="button"
          className="priority-chip-remove"
          aria-label={`Remove ${word.word.hanzi}`}
          disabled={submitting}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onRemove();
          }}
        >
          ×
        </button>
      </div>
      {word.requiredForNextSession ? <span className="priority-required-pill">Required</span> : null}
      <MeaningList meanings={word.word.meanings.length > 0 ? word.word.meanings : [word.word.meaning]} />
    </div>
  );
}

function placePopover(anchor: DOMRect): { top: number; left: number } {
  const width = 280;
  const estimatedHeight = 180;
  let left = anchor.left;
  let top = anchor.bottom + 8;
  left = Math.min(left, window.innerWidth - width - 12);
  left = Math.max(12, left);
  if (top + estimatedHeight > window.innerHeight - 12) {
    top = Math.max(12, anchor.top - estimatedHeight - 8);
  }
  return { top, left };
}

function createDragImage(count: number, source: HTMLElement): { element: HTMLElement; cleanup: () => void } {
  const element = source.cloneNode(true) as HTMLElement;
  element.style.position = 'absolute';
  element.style.top = '-1000px';
  element.style.left = '-1000px';
  element.style.pointerEvents = 'none';
  if (count > 1) {
    element.style.boxShadow = '4px 4px 0 rgba(37, 99, 235, 0.35)';
    const badge = document.createElement('span');
    badge.textContent = String(count);
    badge.style.marginLeft = '0.4rem';
    badge.style.fontWeight = '800';
    element.append(badge);
  }
  document.body.append(element);
  return {
    element,
    cleanup: () => {
      element.remove();
    },
  };
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}
