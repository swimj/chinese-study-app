import { useState } from 'react';
import {
  addContrastClusterMember,
  createContrastCluster,
  createContrastPrompt,
  deleteContrastPrompt,
  fetchContrastClusters,
  fetchContrastIntakeWords,
  type ContrastIntakeWord,
  searchWords,
  updateContrastCluster,
  updateContrastClusterMember,
  removeContrastClusterMember,
  resolveContrastPromptBadFeedback,
  type ContrastClusterContent,
  type ContrastPromptContent,
  updateContrastPrompt,
} from '../../services/api';
import type { ContrastPrompt } from '../../domain/study-actions';
import type { Word } from '../../types';

export type ClusterPageControllerOptions = {
  setError: (message: string | null) => void;
};

export type ClusterPageController = {
  clusters: ContrastClusterContent[];
  intakeWords: ContrastIntakeWord[];
  wordSearchResults: Word[];
  selectedClusterId: string | null;
  isLoading: boolean;
  isSavingPrompt: boolean;
  loadData: () => Promise<void>;
  selectCluster: (clusterId: string) => void;
  searchWords: (query: string) => Promise<void>;
  createCluster: (input: { title: string; note?: string }) => Promise<void>;
  updateCluster: (input: { id: string; title: string; note: string }) => Promise<void>;
  addMember: (input: { clusterId: string; wordId: string; nuanceNote?: string }) => Promise<void>;
  updateMember: (input: { clusterId: string; wordId: string; nuanceNote?: string; displayOrder?: number | null }) => Promise<void>;
  removeMember: (input: { clusterId: string; wordId: string }) => Promise<void>;
  createPrompt: (input: {
    clusterId: string;
    targetWordId: string;
    promptText: string;
    explanation: string;
  }) => Promise<void>;
  updatePrompt: (input: {
    id: string;
    targetWordId: string;
    promptText: string;
    explanation: string;
  }) => Promise<void>;
  resolvePromptFeedback: (input: { id: string; note?: string }) => Promise<void>;
  deletePrompt: (id: string) => Promise<void>;
};

export function useClusterPageController({
  setError,
}: ClusterPageControllerOptions): ClusterPageController {
  const [clusters, setClusters] = useState<ContrastClusterContent[]>([]);
  const [intakeWords, setIntakeWords] = useState<ContrastIntakeWord[]>([]);
  const [wordSearchResults, setWordSearchResults] = useState<Word[]>([]);
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSavingPrompt, setIsSavingPrompt] = useState(false);

  async function refreshClustersAndIntake() {
    const [clusterResponse, intakeResponse] = await Promise.all([
      fetchContrastClusters(),
      fetchContrastIntakeWords(),
    ]);
    setClusters(clusterResponse.clusters);
    setIntakeWords(intakeResponse.words);
    setSelectedClusterId((current) => current ?? clusterResponse.clusters[0]?.id ?? null);
  }

  async function refreshClustersOnly() {
    const response = await fetchContrastClusters();
    setClusters(response.clusters);
    setSelectedClusterId((current) => current ?? response.clusters[0]?.id ?? null);
  }

  async function searchClusterWords(query: string): Promise<void> {
    if (query.trim().length === 0) {
      setWordSearchResults([]);
      return;
    }
    const response = await searchWords(query, 12);
    setWordSearchResults(response.words);
  }

  async function createClusterAndRefresh(input: { title: string; note?: string }) {
    setIsSavingPrompt(true);
    setError(null);
    try {
      const cluster = await createContrastCluster(input);
      await refreshClustersOnly();
      setSelectedClusterId(cluster.id);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to create contrast cluster');
      throw error;
    } finally {
      setIsSavingPrompt(false);
    }
  }

  async function updateClusterAndRefresh(input: { id: string; title: string; note: string }) {
    setIsSavingPrompt(true);
    setError(null);
    try {
      await updateContrastCluster(input);
      await refreshClustersOnly();
      setSelectedClusterId(input.id);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to update contrast cluster');
      throw error;
    } finally {
      setIsSavingPrompt(false);
    }
  }

  async function addMemberAndRefresh(input: { clusterId: string; wordId: string; nuanceNote?: string }) {
    setIsSavingPrompt(true);
    setError(null);
    try {
      await addContrastClusterMember(input);
      await refreshClustersOnly();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to add cluster member');
      throw error;
    } finally {
      setIsSavingPrompt(false);
    }
  }

  async function updateMemberAndRefresh(input: { clusterId: string; wordId: string; nuanceNote?: string; displayOrder?: number | null }) {
    setIsSavingPrompt(true);
    setError(null);
    try {
      await updateContrastClusterMember(input);
      await refreshClustersOnly();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to update cluster member');
      throw error;
    } finally {
      setIsSavingPrompt(false);
    }
  }

  async function removeMemberAndRefresh(input: { clusterId: string; wordId: string }) {
    setIsSavingPrompt(true);
    setError(null);
    try {
      await removeContrastClusterMember(input);
      await refreshClustersOnly();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to remove cluster member');
      throw error;
    } finally {
      setIsSavingPrompt(false);
    }
  }

  async function createPrompt(input: {
    clusterId: string;
    targetWordId: string;
    promptText: string;
    explanation: string;
  }): Promise<void> {
    await savePrompt(() => createContrastPrompt(input));
  }

  async function updatePrompt(input: {
    id: string;
    targetWordId: string;
    promptText: string;
    explanation: string;
  }): Promise<void> {
    await savePrompt(() => updateContrastPrompt(input));
  }

  async function resolvePromptFeedback(input: { id: string; note?: string }): Promise<void> {
    await savePrompt(() => resolveContrastPromptBadFeedback(input));
  }

  async function removePrompt(id: string): Promise<void> {
    setIsSavingPrompt(true);
    setError(null);
    try {
      await deleteContrastPrompt(id);
      setClusters((current) => current.map((cluster) => ({
        ...cluster,
        prompts: cluster.prompts.filter((prompt) => prompt.id !== id),
      })));
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to delete contrast prompt');
      throw error;
    } finally {
      setIsSavingPrompt(false);
    }
  }

  async function savePrompt(operation: () => Promise<ContrastPrompt>) {
    setIsSavingPrompt(true);
    setError(null);
    try {
      const prompt = await operation();
      setClusters((current) => upsertPrompt(current, prompt));
      setSelectedClusterId(prompt.clusterId);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to save contrast prompt');
      throw error;
    } finally {
      setIsSavingPrompt(false);
    }
  }

  return {
    clusters,
    intakeWords,
    wordSearchResults,
    selectedClusterId,
    isLoading,
    isSavingPrompt,
    loadData: refreshClustersAndIntake,
    selectCluster: setSelectedClusterId,
    searchWords: searchClusterWords,
    createCluster: createClusterAndRefresh,
    updateCluster: updateClusterAndRefresh,
    addMember: addMemberAndRefresh,
    updateMember: updateMemberAndRefresh,
    removeMember: removeMemberAndRefresh,
    createPrompt,
    updatePrompt,
    resolvePromptFeedback,
    deletePrompt: removePrompt,
  };
}

function upsertPrompt(clusters: ContrastClusterContent[], prompt: ContrastPrompt): ContrastClusterContent[] {
  return clusters.map((cluster) => {
    if (cluster.id !== prompt.clusterId) {
      return cluster;
    }

    const existingIndex = cluster.prompts.findIndex((current) => current.id === prompt.id);
    const existingFeedback = existingIndex === -1
      ? { flagged: false, badPromptCount: 0, latestBadPromptAt: null, notes: [] }
      : cluster.prompts[existingIndex].feedback;
    const promptWithFeedback: ContrastPromptContent = {
      ...prompt,
      feedback: existingFeedback,
    };
    const prompts = existingIndex === -1
      ? [...cluster.prompts, promptWithFeedback]
      : cluster.prompts.map((current) => (current.id === prompt.id ? promptWithFeedback : current));

    return {
      ...cluster,
      prompts: prompts.sort((left, right) => left.id.localeCompare(right.id)),
    };
  });
}
