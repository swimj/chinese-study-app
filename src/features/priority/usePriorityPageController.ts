import { useRef, useState } from 'react';
import type { AppPageKey } from '../../components/AppChrome';
import {
  addUnstudiedPriorityByHanzi,
  fetchUnstudiedPriorityWords,
  updateWordUserPriority,
} from '../../services/api';
import { studyProfile } from '../../study-profile';
import type { PriorityWord, Word } from '../../types';
import { applyPriorityPatch, sortStashManageWords } from './priority-page-model';
import { toggleSelectedMatchId } from './priority-match-selection';

export type PriorityMatchChoiceState = {
  query: string;
  matches: Word[];
};

export type PriorityPageControllerOptions = {
  currentPage: AppPageKey;
  setCurrentPage: (page: AppPageKey) => void;
  setError: (message: string | null) => void;
};

export type PriorityPageController = {
  isLoading: boolean;
  rows: PriorityWord[];
  searchHanzi: string;
  searchNotice: string | null;
  searchSubmitting: boolean;
  matchChoices: PriorityMatchChoiceState | null;
  selectedMatchIds: string[];
  highlightedWordIds: string[];
  updatingWordId: string | null;
  priorityBatchSubmitting: boolean;
  setSearchHanzi: (value: string) => void;
  clearHighlights: () => void;
  toggleMatchSelection: (wordId: string) => void;
  cancelMatchSelection: () => void;
  openPage: () => Promise<void>;
  submitSearch: () => Promise<void>;
  confirmMatchSelection: () => Promise<void>;
  moveToTop: (wordId: string) => Promise<void>;
  bumpAgain: (wordId: string) => Promise<void>;
  requireForNextSession: (wordIds: string[], requiredForNextSession: boolean) => Promise<void>;
  moveSelectedToTop: (wordIds: string[]) => Promise<void>;
  moveSelectedToStash: (wordIds: string[]) => Promise<void>;
  bumpSelectedAgain: (wordIds: string[]) => Promise<void>;
  removeSelected: (wordIds: string[]) => Promise<void>;
  remove: (wordId: string) => Promise<void>;
};

export function usePriorityPageController({
  currentPage,
  setCurrentPage,
  setError,
}: PriorityPageControllerOptions): PriorityPageController {
  const [isLoading, setIsLoading] = useState(false);
  const [rows, setRows] = useState<PriorityWord[]>([]);
  const [searchHanzi, setSearchHanzi] = useState('');
  const [searchSubmitting, setSearchSubmitting] = useState(false);
  const [searchNotice, setSearchNotice] = useState<string | null>(null);
  const [matchChoices, setMatchChoices] = useState<PriorityMatchChoiceState | null>(null);
  const [selectedMatchIds, setSelectedMatchIds] = useState<string[]>([]);
  const [highlightedWordIds, setHighlightedWordIds] = useState<string[]>([]);
  const [updatingWordId, setUpdatingWordId] = useState<string | null>(null);
  const [priorityBatchSubmitting, setPriorityBatchSubmitting] = useState(false);
  const rowsRef = useRef<PriorityWord[]>([]);
  const batchSubmittingRef = useRef(false);
  const searchSubmittingRef = useRef(false);
  const matchChoicesRef = useRef<PriorityMatchChoiceState | null>(null);
  const selectedMatchIdsRef = useRef<string[]>([]);
  rowsRef.current = rows;
  matchChoicesRef.current = matchChoices;
  selectedMatchIdsRef.current = selectedMatchIds;

  async function openPage(): Promise<void> {
    if (currentPage === 'priority') {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const priorityWordsResponse = await fetchUnstudiedPriorityWords();
      setRows(sortStashManageWords(priorityWordsResponse.words));
      setSearchNotice(null);
      setMatchChoices(null);
      setSelectedMatchIds([]);
      setHighlightedWordIds([]);
      setCurrentPage('priority');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }

  async function updateWordPriority(
    wordId: string,
    patch: {
      bumpDelta?: number;
      forceTop?: boolean;
      reset?: boolean;
      requiredForNextSession?: boolean;
    },
  ): Promise<void> {
    setUpdatingWordId(wordId);
    setError(null);

    try {
      const updatedWord = await updateWordUserPriority(wordId, patch);
      setRows((current) => {
        if (patch.reset) {
          return current.filter((entry) => entry.word.id !== updatedWord.word.id);
        }

        return mergePriorityWord(current, updatedWord);
      });
      setSearchNotice(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setUpdatingWordId(null);
    }
  }

  function applyAddedPriorityWords(words: PriorityWord[], query: string, addedCount: number): void {
    setRows((current) => {
      const byId = new Map(current.map((entry) => [entry.word.id, entry]));
      for (const word of words) {
        byId.set(word.word.id, word);
      }

      return sortStashManageWords([...byId.values()]);
    });
    setMatchChoices(null);
    setSelectedMatchIds([]);
    setHighlightedWordIds(words.map((word) => word.word.id));
    setSearchNotice(`Added ${addedCount} matching word${addedCount === 1 ? '' : 's'} for "${query}".`);
  }

  async function submitSearch(): Promise<void> {
    if (searchSubmittingRef.current) {
      return;
    }

    const activeChoices = matchChoicesRef.current;
    if (activeChoices) {
      await confirmMatchSelection();
      return;
    }

    const normalizedHanzi = searchHanzi.trim();
    if (normalizedHanzi.length === 0) {
      setSearchNotice(`${studyProfile.labels.targetSearchPlaceholder}.`);
      return;
    }

    searchSubmittingRef.current = true;
    setSearchSubmitting(true);
    setSearchHanzi('');
    setError(null);

    try {
      const response = await addUnstudiedPriorityByHanzi(normalizedHanzi);
      if (response.needsSelection) {
        setMatchChoices({ query: response.query, matches: response.matches });
        setSelectedMatchIds([]);
        setHighlightedWordIds([]);
        setSearchNotice(
          `${response.matches.length} matches for "${response.query}". Press 1–9 to select, then Enter.`,
        );
        return;
      }

      applyAddedPriorityWords(response.words, normalizedHanzi, response.addedCount);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setSearchNotice(message);
      setMatchChoices(null);
      setSelectedMatchIds([]);
      setHighlightedWordIds([]);
      setSearchHanzi((current) => (current.length === 0 ? normalizedHanzi : current));
    } finally {
      searchSubmittingRef.current = false;
      setSearchSubmitting(false);
    }
  }

  async function confirmMatchSelection(): Promise<void> {
    const activeChoices = matchChoicesRef.current;
    const selectedIds = selectedMatchIdsRef.current;
    if (!activeChoices || searchSubmittingRef.current) {
      return;
    }

    if (selectedIds.length === 0) {
      setSearchNotice(`Select at least one match for "${activeChoices.query}", then press Enter.`);
      return;
    }

    searchSubmittingRef.current = true;
    setSearchSubmitting(true);
    setError(null);

    try {
      const response = await addUnstudiedPriorityByHanzi(activeChoices.query, false, selectedIds);
      if (response.needsSelection) {
        throw new Error('Expected selected matches to add without another chooser round.');
      }

      applyAddedPriorityWords(response.words, activeChoices.query, response.addedCount);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setSearchNotice(message);
    } finally {
      searchSubmittingRef.current = false;
      setSearchSubmitting(false);
    }
  }

  async function batchUpdateWordPriority(
    wordIds: string[],
    patch: {
      bumpDelta?: number;
      forceTop?: boolean;
      reset?: boolean;
      requiredForNextSession?: boolean;
    },
  ): Promise<void> {
    const uniqueWordIds = [...new Set(wordIds)];
    if (uniqueWordIds.length === 0 || batchSubmittingRef.current) {
      return;
    }

    batchSubmittingRef.current = true;
    setPriorityBatchSubmitting(true);
    setError(null);
    const snapshot = rowsRef.current;
    const overlayUpdatedAt = new Date().toISOString();
    setRows((current) => {
      if (patch.reset) {
        return current.filter((entry) => !uniqueWordIds.includes(entry.word.id));
      }

      return sortStashManageWords(current.map((entry) => (
        uniqueWordIds.includes(entry.word.id)
          ? applyPriorityPatch(entry, patch, overlayUpdatedAt)
          : entry
      )));
    });

    try {
      const updatedWords = await Promise.all(uniqueWordIds.map((wordId) => updateWordUserPriority(wordId, patch)));
      const updatedById = new Map(updatedWords.map((word) => [word.word.id, word]));

      setRows((current) => {
        if (patch.reset) {
          return current.filter((entry) => !updatedById.has(entry.word.id));
        }

        return sortStashManageWords(current.map((entry) => updatedById.get(entry.word.id) ?? entry));
      });
      setSearchNotice(null);
    } catch (err) {
      setRows(snapshot);
      setError(err instanceof Error ? err.message : 'Unknown error');
      throw err;
    } finally {
      batchSubmittingRef.current = false;
      setPriorityBatchSubmitting(false);
    }
  }

  return {
    isLoading,
    rows,
    searchHanzi,
    searchNotice,
    searchSubmitting,
    matchChoices,
    selectedMatchIds,
    highlightedWordIds,
    updatingWordId,
    priorityBatchSubmitting,
    setSearchHanzi: (value: string) => {
      setSearchHanzi(value);
      if (matchChoicesRef.current) {
        setMatchChoices(null);
        setSelectedMatchIds([]);
        setSearchNotice(null);
      }
    },
    clearHighlights: () => setHighlightedWordIds([]),
    toggleMatchSelection: (wordId: string) => {
      setSelectedMatchIds((current) => toggleSelectedMatchId(current, wordId));
    },
    cancelMatchSelection: () => {
      setMatchChoices(null);
      setSelectedMatchIds([]);
      setSearchNotice(null);
    },
    openPage,
    submitSearch,
    confirmMatchSelection,
    moveToTop: (wordId: string) => updateWordPriority(wordId, { forceTop: true }),
    bumpAgain: (wordId: string) => updateWordPriority(wordId, { bumpDelta: 1 }),
    requireForNextSession: (wordIds: string[], requiredForNextSession: boolean) =>
      batchUpdateWordPriority(wordIds, { requiredForNextSession }),
    moveSelectedToTop: (wordIds: string[]) => batchUpdateWordPriority(wordIds, { forceTop: true }),
    moveSelectedToStash: (wordIds: string[]) => batchUpdateWordPriority(wordIds, { forceTop: false, bumpDelta: 1 }),
    bumpSelectedAgain: (wordIds: string[]) => batchUpdateWordPriority(wordIds, { bumpDelta: 1 }),
    removeSelected: (wordIds: string[]) => batchUpdateWordPriority(wordIds, { reset: true }),
    remove: (wordId: string) => updateWordPriority(wordId, { reset: true }),
  };
}

function mergePriorityWord(rows: PriorityWord[], updatedWord: PriorityWord): PriorityWord[] {
  if (!rows.some((entry) => entry.word.id === updatedWord.word.id)) {
    throw new Error(`Invariant violated: updated priority word "${updatedWord.word.id}" is missing from the current rows.`);
  }

  return sortStashManageWords(rows.map((entry) => (entry.word.id === updatedWord.word.id ? updatedWord : entry)));
}
