import { useEffect, useMemo, useState } from 'react';
import {
  fetchReviewItems,
  fetchWords,
} from '../../services/api';
import type { AppPageKey } from '../../components/AppChrome';
import { buildInspectableRows } from './words-page-model';

const WORDS_PAGE_SIZE = 20;

export function useWordsPageController({
  currentPage,
  setCurrentPage,
  setError,
}: {
  currentPage: AppPageKey;
  setCurrentPage: (page: AppPageKey) => void;
  setError: (message: string | null) => void;
}) {
  const [words, setWords] = useState<Awaited<ReturnType<typeof fetchWords>>>([]);
  const [reviewItems, setReviewItems] = useState<Awaited<ReturnType<typeof fetchReviewItems>>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [pageNumber, setPageNumber] = useState(0);

  const inspectableRows = useMemo(() => {
    if (currentPage !== 'words') {
      return [];
    }

    return buildInspectableRows({ words, reviewItems });
  }, [currentPage, reviewItems, words]);

  const totalPages = Math.max(1, Math.ceil(inspectableRows.length / WORDS_PAGE_SIZE));
  const pagedRows = inspectableRows.slice(
    pageNumber * WORDS_PAGE_SIZE,
    pageNumber * WORDS_PAGE_SIZE + WORDS_PAGE_SIZE,
  );

  useEffect(() => {
    setPageNumber((current) => Math.min(current, totalPages - 1));
  }, [totalPages]);

  async function openPage() {
    if (currentPage === 'words') {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const [wordsResponse, reviewItemsResponse] = await Promise.all([
        fetchWords(),
        fetchReviewItems(),
      ]);

      setWords(wordsResponse);
      setReviewItems(reviewItemsResponse);
      setCurrentPage('words');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }

  return {
    isLoading,
    rows: pagedRows,
    pageNumber,
    totalPages,
    totalItems: inspectableRows.length,
    pageSize: WORDS_PAGE_SIZE,
    openPage,
    previousPage: () => setPageNumber((current) => Math.max(0, current - 1)),
    nextPage: () => setPageNumber((current) => Math.min(totalPages - 1, current + 1)),
  };
}
