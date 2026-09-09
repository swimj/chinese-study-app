import { useRef, useState } from 'react';
import type { AppPageKey } from '../../components/AppChrome';
import {
  addUnstudiedPriorityByHanzi,
  dismissWordFromStudy,
  fetchUnstudiedPriorityWords,
  updateWordUserPriority,
} from '../../services/api';
import { studyProfile } from '../../study-profile';
import type { PriorityWord } from '../../types';
import { applyPriorityPatch, sortStashManageWords } from './priority-page-model';

export type PriorityPageControllerOptions = {
  currentPage: AppPageKey;
  setCurrentPage: (page: AppPageKey) => void;
  setError: (message: string | null) => void;
};

export type PriorityPageController = {
  isLoading: boolean;
  rows: PriorityWord[];
  searchHanzi: string;
  requireAddedMatches: boolean;
  searchNotice: string | null;
  searchSubmitting: boolean;
  highlightedWordIds: string[];
  updatingWordId: string | null;
  sinkSubmitting: boolean;
  priorityBatchSubmitting: boolean;
  setSearchHanzi: (value: string) => void;
  setRequireAddedMatches: (value: boolean) => void;
  clearHighlights: () => void;
  openPage: () => Promise<void>;
  submitSearch: () => Promise<void>;
  moveToTop: (wordId: string) => Promise<void>;
  bumpAgain: (wordId: string) => Promise<void>;
  requireForNextSession: (wordIds: string[], requiredForNextSession: boolean) => Promise<void>;
  moveSelectedToTop: (wordIds: string[]) => Promise<void>;
  moveSelectedToStash: (wordIds: string[]) => Promise<void>;
  bumpSelectedAgain: (wordIds: string[]) => Promise<void>;
  removeSelected: (wordIds: string[]) => Promise<void>;
  remove: (wordId: string) => Promise<void>;
  sinkSelected: (wordIds: string[]) => Promise<void>;
};

export function usePriorityPageController({
  currentPage,
  setCurrentPage,
  setError,
}: PriorityPageControllerOptions): PriorityPageController {
  const [isLoading, setIsLoading] = useState(false);
  const [rows, setRows] = useState<PriorityWord[]>([]);
  const [searchHanzi, setSearchHanzi] = useState('');
  const [requireAddedMatches, setRequireAddedMatches] = useState(false);
  const [searchSubmitting, setSearchSubmitting] = useState(false);
  const [searchNotice, setSearchNotice] = useState<string | null>(null);
  const [highlightedWordIds, setHighlightedWordIds] = useState<string[]>([]);
  const [updatingWordId, setUpdatingWordId] = useState<string | null>(null);
  const [sinkSubmitting, setSinkSubmitting] = useState(false);
  const [priorityBatchSubmitting, setPriorityBatchSubmitting] = useState(false);
  const rowsRef = useRef<PriorityWord[]>([]);
  const batchSubmittingRef = useRef(false);
  const searchSubmittingRef = useRef(false);
  rowsRef.current = rows;

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

  async function submitSearch(): Promise<void> {
    if (searchSubmittingRef.current) {
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
      const response = await addUnstudiedPriorityByHanzi(normalizedHanzi, requireAddedMatches);
      setRows((current) => {
        const byId = new Map(current.map((entry) => [entry.word.id, entry]));
        for (const word of response.words) {
          byId.set(word.word.id, word);
        }

        return sortStashManageWords([...byId.values()]);
      });
      setHighlightedWordIds(response.words.map((word) => word.word.id));
      setSearchNotice(`Added ${response.addedCount} matching word${response.addedCount === 1 ? '' : 's'} for "${normalizedHanzi}".`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setSearchNotice(message);
      setHighlightedWordIds([]);
      setSearchHanzi((current) => (current.length === 0 ? normalizedHanzi : current));
    } finally {
      searchSubmittingRef.current = false;
      setSearchSubmitting(false);
    }
  }

  async function sinkSelected(wordIds: string[]): Promise<void> {
    const uniqueWordIds = [...new Set(wordIds)];
    if (uniqueWordIds.length === 0) {
      return;
    }

    setSinkSubmitting(true);
    setError(null);

    try {
      await Promise.all(uniqueWordIds.map((wordId) => dismissWordFromStudy(wordId)));
      const sunkIds = new Set(uniqueWordIds);
      setRows((current) => current.filter((entry) => !sunkIds.has(entry.word.id)));
      setSearchNotice(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      throw err;
    } finally {
      setSinkSubmitting(false);
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
    requireAddedMatches,
    searchNotice,
    searchSubmitting,
    highlightedWordIds,
    updatingWordId,
    sinkSubmitting,
    priorityBatchSubmitting,
    setSearchHanzi: (value: string) => setSearchHanzi(value),
    setRequireAddedMatches,
    clearHighlights: () => setHighlightedWordIds([]),
    openPage,
    submitSearch,
    moveToTop: (wordId: string) => updateWordPriority(wordId, { forceTop: true }),
    bumpAgain: (wordId: string) => updateWordPriority(wordId, { bumpDelta: 1 }),
    requireForNextSession: (wordIds: string[], requiredForNextSession: boolean) =>
      batchUpdateWordPriority(wordIds, { requiredForNextSession }),
    moveSelectedToTop: (wordIds: string[]) => batchUpdateWordPriority(wordIds, { forceTop: true }),
    moveSelectedToStash: (wordIds: string[]) => batchUpdateWordPriority(wordIds, { forceTop: false, bumpDelta: 1 }),
    bumpSelectedAgain: (wordIds: string[]) => batchUpdateWordPriority(wordIds, { bumpDelta: 1 }),
    removeSelected: (wordIds: string[]) => batchUpdateWordPriority(wordIds, { reset: true }),
    remove: (wordId: string) => updateWordPriority(wordId, { reset: true }),
    sinkSelected,
  };
}

function mergePriorityWord(rows: PriorityWord[], updatedWord: PriorityWord): PriorityWord[] {
  if (!rows.some((entry) => entry.word.id === updatedWord.word.id)) {
    throw new Error(`Invariant violated: updated priority word "${updatedWord.word.id}" is missing from the current rows.`);
  }

  return sortStashManageWords(rows.map((entry) => (entry.word.id === updatedWord.word.id ? updatedWord : entry)));
}
