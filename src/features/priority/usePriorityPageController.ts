import { useState } from 'react';
import type { AppPageKey } from '../../components/AppChrome';
import {
  addUnstudiedPriorityByHanzi,
  dismissWordFromStudy,
  fetchTopUnstudiedPriorityWords,
  fetchUnstudiedPriorityWords,
  updateWordUserPriority,
} from '../../services/api';
import type { PriorityWord } from '../../types';
import { sortPriorityWords } from './priority-page-model';

export type PriorityPageControllerOptions = {
  currentPage: AppPageKey;
  setCurrentPage: (page: AppPageKey) => void;
  setError: (message: string | null) => void;
};

export type PriorityPageController = {
  isLoading: boolean;
  rows: PriorityWord[];
  triageRows: PriorityWord[];
  unstudiedTotalCount: number;
  searchHanzi: string;
  requireAddedMatches: boolean;
  searchNotice: string | null;
  searchSubmitting: boolean;
  jumpRequestWordId: string | null;
  updatingWordId: string | null;
  bulkDismissSubmitting: boolean;
  priorityBatchSubmitting: boolean;
  setSearchHanzi: (value: string) => void;
  setRequireAddedMatches: (value: boolean) => void;
  clearJumpRequest: () => void;
  openPage: () => Promise<void>;
  submitSearch: () => Promise<void>;
  moveToTop: (wordId: string) => Promise<void>;
  bumpAgain: (wordId: string) => Promise<void>;
  requireForNextSession: (wordIds: string[], requiredForNextSession: boolean) => Promise<void>;
  moveSelectedToTop: (wordIds: string[]) => Promise<void>;
  bumpSelectedAgain: (wordIds: string[]) => Promise<void>;
  removeSelected: (wordIds: string[]) => Promise<void>;
  remove: (wordId: string) => Promise<void>;
  dismissFromTriage: (wordId: string) => Promise<void>;
  bulkDismissFromTriage: (wordIds: string[]) => Promise<void>;
};

export function usePriorityPageController({
  currentPage,
  setCurrentPage,
  setError,
}: PriorityPageControllerOptions): PriorityPageController {
  const [isLoading, setIsLoading] = useState(false);
  const [rows, setRows] = useState<PriorityWord[]>([]);
  const [triageRows, setTriageRows] = useState<PriorityWord[]>([]);
  const [unstudiedTotalCount, setUnstudiedTotalCount] = useState(0);
  const [searchHanzi, setSearchHanzi] = useState('');
  const [requireAddedMatches, setRequireAddedMatches] = useState(false);
  const [searchSubmitting, setSearchSubmitting] = useState(false);
  const [searchNotice, setSearchNotice] = useState<string | null>(null);
  const [jumpRequestWordId, setJumpRequestWordId] = useState<string | null>(null);
  const [updatingWordId, setUpdatingWordId] = useState<string | null>(null);
  const [bulkDismissSubmitting, setBulkDismissSubmitting] = useState(false);
  const [priorityBatchSubmitting, setPriorityBatchSubmitting] = useState(false);

  async function openPage(): Promise<void> {
    if (currentPage === 'priority') {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const [priorityWordsResponse, triageWordsResponse] = await Promise.all([
        fetchUnstudiedPriorityWords(),
        fetchTopUnstudiedPriorityWords(50),
      ]);
      setRows(sortPriorityWords(priorityWordsResponse.words));
      setTriageRows(sortPriorityWords(triageWordsResponse.words));
      setUnstudiedTotalCount(priorityWordsResponse.unstudiedTotalCount);
      setSearchNotice(null);
      setJumpRequestWordId(null);
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
      setTriageRows((current) => mergePriorityWordIfPresent(current, updatedWord));
      setSearchNotice(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setUpdatingWordId(null);
    }
  }

  async function submitSearch(): Promise<void> {
    const normalizedHanzi = searchHanzi.trim();
    if (normalizedHanzi.length === 0) {
      setSearchNotice('Enter hanzi before submitting.');
      return;
    }

    setSearchSubmitting(true);
    setError(null);

    try {
      const response = await addUnstudiedPriorityByHanzi(normalizedHanzi, requireAddedMatches);
      setRows((current) => {
        const byId = new Map(current.map((entry) => [entry.word.id, entry]));
        for (const word of response.words) {
          byId.set(word.word.id, word);
        }

        return sortPriorityWords([...byId.values()]);
      });
      const prioritizedAddedWord = sortPriorityWords(response.words)[0];
      setJumpRequestWordId(prioritizedAddedWord?.word.id ?? null);
      setUnstudiedTotalCount(response.unstudiedTotalCount);
      setSearchNotice(`Added ${response.addedCount} matching word${response.addedCount === 1 ? '' : 's'} for "${normalizedHanzi}".`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setSearchNotice(message);
      setJumpRequestWordId(null);
    } finally {
      setSearchSubmitting(false);
    }
  }

  async function dismissFromTriage(wordId: string): Promise<void> {
    setUpdatingWordId(wordId);
    setError(null);

    try {
      await dismissWordFromStudy(wordId);
      setRows((current) => current.filter((entry) => entry.word.id !== wordId));
      setTriageRows((current) => current.filter((entry) => entry.word.id !== wordId));
      setSearchNotice(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setUpdatingWordId(null);
    }
  }

  async function bulkDismissFromTriage(wordIds: string[]): Promise<void> {
    const uniqueWordIds = [...new Set(wordIds)];
    if (uniqueWordIds.length === 0) {
      return;
    }

    setBulkDismissSubmitting(true);
    setError(null);

    try {
      await Promise.all(uniqueWordIds.map((wordId) => dismissWordFromStudy(wordId)));
      const dismissedIds = new Set(uniqueWordIds);
      setRows((current) => current.filter((entry) => !dismissedIds.has(entry.word.id)));
      setTriageRows((current) => current.filter((entry) => !dismissedIds.has(entry.word.id)));
      setSearchNotice(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBulkDismissSubmitting(false);
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
    if (uniqueWordIds.length === 0) {
      return;
    }

    setPriorityBatchSubmitting(true);
    setError(null);

    try {
      const updatedWords = await Promise.all(uniqueWordIds.map((wordId) => updateWordUserPriority(wordId, patch)));
      const updatedById = new Map(updatedWords.map((word) => [word.word.id, word]));

      setRows((current) => {
        if (patch.reset) {
          return current.filter((entry) => !updatedById.has(entry.word.id));
        }

        return sortPriorityWords(current.map((entry) => updatedById.get(entry.word.id) ?? entry));
      });
      setTriageRows((current) => {
        const next = current.map((entry) => updatedById.get(entry.word.id) ?? entry);
        return sortPriorityWords(next);
      });
      setSearchNotice(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      throw err;
    } finally {
      setPriorityBatchSubmitting(false);
    }
  }

  return {
    isLoading,
    rows,
    triageRows,
    unstudiedTotalCount,
    searchHanzi,
    requireAddedMatches,
    searchNotice,
    searchSubmitting,
    jumpRequestWordId,
    updatingWordId,
    bulkDismissSubmitting,
    priorityBatchSubmitting,
    setSearchHanzi: (value: string) => setSearchHanzi(value),
    setRequireAddedMatches,
    clearJumpRequest: () => setJumpRequestWordId(null),
    openPage,
    submitSearch,
    moveToTop: (wordId: string) => updateWordPriority(wordId, { forceTop: true }),
    bumpAgain: (wordId: string) => updateWordPriority(wordId, { bumpDelta: 1 }),
    requireForNextSession: (wordIds: string[], requiredForNextSession: boolean) =>
      batchUpdateWordPriority(wordIds, { requiredForNextSession }),
    moveSelectedToTop: (wordIds: string[]) => batchUpdateWordPriority(wordIds, { forceTop: true }),
    bumpSelectedAgain: (wordIds: string[]) => batchUpdateWordPriority(wordIds, { bumpDelta: 1 }),
    removeSelected: (wordIds: string[]) => batchUpdateWordPriority(wordIds, { reset: true }),
    remove: (wordId: string) => updateWordPriority(wordId, { reset: true }),
    dismissFromTriage,
    bulkDismissFromTriage,
  };
}

function mergePriorityWord(rows: PriorityWord[], updatedWord: PriorityWord): PriorityWord[] {
  if (!rows.some((entry) => entry.word.id === updatedWord.word.id)) {
    throw new Error(`Invariant violated: updated priority word "${updatedWord.word.id}" is missing from the current rows.`);
  }

  return sortPriorityWords(rows.map((entry) => (entry.word.id === updatedWord.word.id ? updatedWord : entry)));
}

function mergePriorityWordIfPresent(rows: PriorityWord[], updatedWord: PriorityWord): PriorityWord[] {
  if (!rows.some((entry) => entry.word.id === updatedWord.word.id)) {
    return rows;
  }

  return sortPriorityWords(rows.map((entry) => (entry.word.id === updatedWord.word.id ? updatedWord : entry)));
}
