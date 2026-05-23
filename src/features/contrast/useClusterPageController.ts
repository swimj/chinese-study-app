import { useState } from 'react';
import type { AppPageKey } from '../../components/AppChrome';
import {
  createContrastPrompt,
  fetchContrastClusters,
  type ContrastClusterContent,
  updateContrastPrompt,
} from '../../services/api';
import type { ContrastPrompt } from '../../domain/study-actions';

export type ClusterPageControllerOptions = {
  currentPage: AppPageKey;
  setCurrentPage: (page: AppPageKey) => void;
  setError: (message: string | null) => void;
};

export type ClusterPageController = {
  clusters: ContrastClusterContent[];
  selectedClusterId: string | null;
  isLoading: boolean;
  isSavingPrompt: boolean;
  openPage: () => Promise<void>;
  selectCluster: (clusterId: string) => void;
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
};

export function useClusterPageController({
  currentPage,
  setCurrentPage,
  setError,
}: ClusterPageControllerOptions): ClusterPageController {
  const [clusters, setClusters] = useState<ContrastClusterContent[]>([]);
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSavingPrompt, setIsSavingPrompt] = useState(false);

  async function openPage(): Promise<void> {
    if (currentPage === 'clusters') {
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const response = await fetchContrastClusters();
      setClusters(response.clusters);
      setSelectedClusterId((current) => current ?? response.clusters[0]?.id ?? null);
      setCurrentPage('clusters');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to load contrast clusters');
    } finally {
      setIsLoading(false);
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
    selectedClusterId,
    isLoading,
    isSavingPrompt,
    openPage,
    selectCluster: setSelectedClusterId,
    createPrompt,
    updatePrompt,
  };
}

function upsertPrompt(clusters: ContrastClusterContent[], prompt: ContrastPrompt): ContrastClusterContent[] {
  return clusters.map((cluster) => {
    if (cluster.id !== prompt.clusterId) {
      return cluster;
    }

    const existingIndex = cluster.prompts.findIndex((current) => current.id === prompt.id);
    const prompts = existingIndex === -1
      ? [...cluster.prompts, prompt]
      : cluster.prompts.map((current) => (current.id === prompt.id ? prompt : current));

    return {
      ...cluster,
      prompts: prompts.sort((left, right) => left.id.localeCompare(right.id)),
    };
  });
}
