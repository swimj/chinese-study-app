import { useState } from 'react';
import type { AppPageKey } from '../../components/AppChrome';
import {
  addContrastClusterMember,
  createContrastCluster,
  fetchContrastIntakeWords,
  reportBadProductionPrompt,
  resolveContrastIntakeWord,
  suppressProductionForWord,
  type ContrastIntakeWord,
} from '../../services/api';

export type IntakePageControllerOptions = {
  currentPage: AppPageKey;
  setCurrentPage: (page: AppPageKey) => void;
  setError: (message: string | null) => void;
};

export type IntakePageController = {
  words: ContrastIntakeWord[];
  activeWordIndex: number;
  isLoading: boolean;
  isSaving: boolean;
  openPage: () => Promise<void>;
  selectWordIndex: (index: number) => void;
  resolveWord: (targetWordId: string) => Promise<void>;
  suppressProduction: (targetWordId: string) => Promise<void>;
  reportBadPrompt: (input: { targetWordId: string; note?: string }) => Promise<void>;
  createClusterForWord: (input: { targetWordId: string; title: string; note?: string }) => Promise<void>;
};

export function useIntakePageController({
  currentPage,
  setCurrentPage,
  setError,
}: IntakePageControllerOptions): IntakePageController {
  const [words, setWords] = useState<ContrastIntakeWord[]>([]);
  const [activeWordIndex, setActiveWordIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  async function openPage(): Promise<void> {
    if (currentPage === 'intake') {
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const response = await fetchContrastIntakeWords();
      setWords(response.words);
      setActiveWordIndex(0);
      setCurrentPage('intake');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to load contrast intake words');
    } finally {
      setIsLoading(false);
    }
  }

  async function refresh() {
    const response = await fetchContrastIntakeWords();
    setWords(response.words);
    setActiveWordIndex((current) => Math.min(current, Math.max(response.words.length - 1, 0)));
  }

  async function saveAndRefresh(operation: () => Promise<unknown>) {
    setIsSaving(true);
    setError(null);
    try {
      await operation();
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to update contrast intake');
      throw error;
    } finally {
      setIsSaving(false);
    }
  }

  return {
    words,
    activeWordIndex,
    isLoading,
    isSaving,
    openPage,
    selectWordIndex: (index) => setActiveWordIndex(clampIndex(index, words.length)),
    resolveWord: (targetWordId) => saveAndRefresh(() => resolveContrastIntakeWord(targetWordId)),
    suppressProduction: (targetWordId) => saveAndRefresh(() => suppressProductionForWord(targetWordId)),
    reportBadPrompt: (input) => saveAndRefresh(() => reportBadProductionPrompt(input)),
    createClusterForWord: (input) =>
      saveAndRefresh(async () => {
        const cluster = await createContrastCluster({ title: input.title, note: input.note ?? '' });
        await addContrastClusterMember({
          clusterId: cluster.id,
          wordId: input.targetWordId,
        });
      }),
  };
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(index, length - 1));
}
