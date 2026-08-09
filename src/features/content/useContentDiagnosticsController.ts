import { useState } from 'react';
import type { AppPageKey } from '../../components/AppChrome';
import type {
  ContentDiagnosticKind,
  ContentDiagnosticsResponse,
} from '../../domain/content-diagnostics';
import { fetchContentDiagnostics } from '../../services/api';

export function useContentDiagnosticsController({
  currentPage,
  setCurrentPage,
  setError,
}: {
  currentPage: AppPageKey;
  setCurrentPage: (page: AppPageKey) => void;
  setError: (message: string | null) => void;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [kind, setKind] = useState<ContentDiagnosticKind>('word');
  const [query, setQuery] = useState('');
  const [data, setData] = useState<ContentDiagnosticsResponse | null>(null);

  async function load(nextKind = kind, nextQuery = query): Promise<void> {
    const normalizedQuery = nextQuery.trim();
    if (normalizedQuery.length === 0) {
      setData(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    setData(null);
    try {
      const response = await fetchContentDiagnostics(nextKind, normalizedQuery);
      setData(response);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }

  async function openPage(): Promise<void> {
    if (currentPage === 'content') return;
    setError(null);
    setCurrentPage('content');
  }

  function updateQuery(nextQuery: string): void {
    setQuery(nextQuery);
    setData(null);
  }

  function selectKind(nextKind: ContentDiagnosticKind): void {
    setKind(nextKind);
    setData(null);
  }

  return {
    isLoading,
    kind,
    query,
    data,
    setQuery: updateQuery,
    openPage,
    selectKind,
    submitSearch: () => load(kind, query),
  };
}
