import { useState } from 'react';
import type { AppPageKey } from '../../components/AppChrome';
import {
  acceptContrastIntakeGroup,
  addContrastIntakeToCluster,
  addContrastPromptFromIntake,
  createContrastClusterFromIntake,
  dismissContrastIntakeGroup,
  fetchContrastIntakeGroups,
  searchWords,
  type ContrastIntakeGroup,
} from '../../services/api';
import type { Word } from '../../types';

type IntakeGroupSelector = {
  targetWordId: string;
  candidateText?: string | null;
  matchedWordId?: string | null;
};

type IntakePromptInput = {
  targetWordId: string;
  promptText: string;
  explanation: string;
};

export type IntakePageControllerOptions = {
  currentPage: AppPageKey;
  setCurrentPage: (page: AppPageKey) => void;
  setError: (message: string | null) => void;
};

export type IntakePageController = {
  groups: ContrastIntakeGroup[];
  activeGroupIndex: number;
  isLoading: boolean;
  isSaving: boolean;
  wordSearchResults: Word[];
  wordSearchLoading: boolean;
  openPage: () => Promise<void>;
  selectGroupIndex: (index: number) => void;
  searchCandidateWords: (query: string) => Promise<void>;
  acceptGroup: (selector: IntakeGroupSelector) => Promise<void>;
  dismissGroup: (selector: IntakeGroupSelector) => Promise<void>;
  createCluster: (input: IntakeGroupSelector & {
    resolvedCandidateWordId: string;
    title: string;
    note: string;
    targetNuanceNote: string;
    candidateNuanceNote: string;
    prompt: IntakePromptInput;
  }) => Promise<void>;
  addToCluster: (input: IntakeGroupSelector & {
    clusterId: string;
    resolvedCandidateWordId: string;
    targetNuanceNote: string;
    candidateNuanceNote: string;
    prompt: IntakePromptInput;
  }) => Promise<void>;
  addPrompt: (input: IntakeGroupSelector & {
    clusterId: string;
    prompt: IntakePromptInput;
  }) => Promise<void>;
};

export function useIntakePageController({
  currentPage,
  setCurrentPage,
  setError,
}: IntakePageControllerOptions): IntakePageController {
  const [groups, setGroups] = useState<ContrastIntakeGroup[]>([]);
  const [activeGroupIndex, setActiveGroupIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [wordSearchResults, setWordSearchResults] = useState<Word[]>([]);
  const [wordSearchLoading, setWordSearchLoading] = useState(false);

  async function openPage(): Promise<void> {
    if (currentPage === 'intake') {
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const response = await fetchContrastIntakeGroups();
      setGroups(response.groups);
      setActiveGroupIndex(0);
      setCurrentPage('intake');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to load contrast intake groups');
    } finally {
      setIsLoading(false);
    }
  }

  async function searchCandidateWords(query: string): Promise<void> {
    if (query.trim().length === 0) {
      setWordSearchResults([]);
      return;
    }

    setWordSearchLoading(true);
    setError(null);
    try {
      const response = await searchWords(query, 12);
      setWordSearchResults(response.words);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to search words');
    } finally {
      setWordSearchLoading(false);
    }
  }

  async function saveAndRefresh(operation: () => Promise<unknown>) {
    setIsSaving(true);
    setError(null);
    try {
      await operation();
      const response = await fetchContrastIntakeGroups();
      setGroups(response.groups);
      setActiveGroupIndex((current) => Math.min(current, Math.max(response.groups.length - 1, 0)));
      setWordSearchResults([]);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to update contrast intake');
      throw error;
    } finally {
      setIsSaving(false);
    }
  }

  return {
    groups,
    activeGroupIndex,
    isLoading,
    isSaving,
    wordSearchResults,
    wordSearchLoading,
    openPage,
    selectGroupIndex: (index) => setActiveGroupIndex(clampIndex(index, groups.length)),
    searchCandidateWords,
    acceptGroup: (selector) => saveAndRefresh(() => acceptContrastIntakeGroup(selector)),
    dismissGroup: (selector) => saveAndRefresh(() => dismissContrastIntakeGroup(selector)),
    createCluster: (input) => saveAndRefresh(() => createContrastClusterFromIntake(input)),
    addToCluster: (input) => saveAndRefresh(() => addContrastIntakeToCluster(input)),
    addPrompt: (input) => saveAndRefresh(() => addContrastPromptFromIntake(input)),
  };
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(index, length - 1));
}
