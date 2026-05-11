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
  searchNotice: string | null;
  searchSubmitting: boolean;
  jumpRequestWordId: string | null;
  updatingWordId: string | null;
  bulkDismissSubmitting: boolean;
  setSearchHanzi: (value: string) => void;
  clearJumpRequest: () => void;
  openPage: () => Promise<void>;
  submitSearch: () => Promise<void>;
  moveToTop: (wordId: string) => Promise<void>;
  bumpAgain: (wordId: string) => Promise<void>;
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
  const [searchSubmitting, setSearchSubmitting] = useState(false);
  const [searchNotice, setSearchNotice] = useState<string | null>(null);
  const [jumpRequestWordId, setJumpRequestWordId] = useState<string | null>(null);
  const [updatingWordId, setUpdatingWordId] = useState<string | null>(null);
  const [bulkDismissSubmitting, setBulkDismissSubmitting] = useState(false);

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

        const updated = current.some((entry) => entry.word.id === updatedWord.word.id)
          ? current.map((entry) => (entry.word.id === updatedWord.word.id ? updatedWord : entry))
          : [...current, updatedWord];
        return sortPriorityWords(updated);
      });
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
      const response = await addUnstudiedPriorityByHanzi(normalizedHanzi);
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

  return {
    isLoading,
    rows,
    triageRows,
    unstudiedTotalCount,
    searchHanzi,
    searchNotice,
    searchSubmitting,
    jumpRequestWordId,
    updatingWordId,
    bulkDismissSubmitting,
    setSearchHanzi: (value: string) => setSearchHanzi(value),
    clearJumpRequest: () => setJumpRequestWordId(null),
    openPage,
    submitSearch,
    moveToTop: (wordId: string) => updateWordPriority(wordId, { forceTop: true }),
    bumpAgain: (wordId: string) => updateWordPriority(wordId, { bumpDelta: 1 }),
    remove: (wordId: string) => updateWordPriority(wordId, { reset: true }),
    dismissFromTriage,
    bulkDismissFromTriage,
  };
}
