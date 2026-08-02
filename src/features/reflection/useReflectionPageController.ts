import { useState } from 'react';
import type { AppPageKey } from '../../components/AppChrome';
import type { ReflectionOperation, ReviewProposalRequest } from '../../domain/reflection';
import type {
  ReflectionArtifactDetailDto,
  ReflectionArtifactSummaryDto,
  ReflectionGenerationRunDto,
  ReflectionReviewApi,
} from './reflection-page-model';

export type ReflectionPageController = {
  isLoading: boolean;
  openArtifacts: ReflectionArtifactSummaryDto[];
  recentArtifacts: ReflectionArtifactSummaryDto[];
  generationRuns: ReflectionGenerationRunDto[];
  selectedArtifact: ReflectionArtifactDetailDto | null;
  selectedArtifactId: string | null;
  submittingProposalId: string | null;
  withdrawingInvocationId: string | null;
  openPage: () => Promise<void>;
  refresh: () => Promise<void>;
  selectArtifact: (artifactId: string) => Promise<void>;
  deferProposal: (proposalId: string) => Promise<void>;
  dismissProposal: (proposalId: string, reason: string | null) => Promise<void>;
  acceptProposal: (proposalId: string, operation: ReflectionOperation) => Promise<void>;
  withdrawAuthorization: (invocationId: string) => Promise<void>;
};

export function useReflectionPageController({
  currentPage,
  setCurrentPage,
  setError,
  api,
}: {
  currentPage: AppPageKey;
  setCurrentPage: (page: AppPageKey) => void;
  setError: (message: string | null) => void;
  api?: ReflectionReviewApi;
}): ReflectionPageController {
  const [isLoading, setIsLoading] = useState(false);
  const [openArtifacts, setOpenArtifacts] = useState<ReflectionArtifactSummaryDto[]>([]);
  const [recentArtifacts, setRecentArtifacts] = useState<ReflectionArtifactSummaryDto[]>([]);
  const [generationRuns, setGenerationRuns] = useState<ReflectionGenerationRunDto[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<ReflectionArtifactDetailDto | null>(null);
  const [submittingProposalId, setSubmittingProposalId] = useState<string | null>(null);
  const [withdrawingInvocationId, setWithdrawingInvocationId] = useState<string | null>(null);

  function requireApi(): ReflectionReviewApi {
    if (api === undefined) {
      throw new Error('Reflection review API is not available.');
    }
    return api;
  }

  async function loadListsAndDetail(
    preferredArtifactId: string | null,
  ): Promise<void> {
    const reviewApi = requireApi();
    const [nextOpenArtifacts, nextRecentArtifacts, nextGenerationRuns] = await Promise.all([
      reviewApi.listArtifacts('open'),
      reviewApi.listArtifacts('all'),
      reviewApi.listGenerationRuns(),
    ]);
    const availableArtifactIds = new Set([
      ...nextOpenArtifacts.map((artifact) => artifact.artifactId),
      ...nextRecentArtifacts.map((artifact) => artifact.artifactId),
    ]);
    const nextArtifactId = preferredArtifactId !== null
      && availableArtifactIds.has(preferredArtifactId)
      ? preferredArtifactId
      : nextOpenArtifacts[0]?.artifactId ?? nextRecentArtifacts[0]?.artifactId ?? null;
    const nextSelectedArtifact = nextArtifactId === null
      ? null
      : await reviewApi.getArtifact(nextArtifactId);

    setOpenArtifacts(nextOpenArtifacts);
    setRecentArtifacts(nextRecentArtifacts);
    setGenerationRuns(nextGenerationRuns);
    setSelectedArtifact(nextSelectedArtifact);
  }

  async function runLoading(task: () => Promise<void>): Promise<void> {
    setIsLoading(true);
    setError(null);
    try {
      await task();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unknown reflection review error');
      throw error;
    } finally {
      setIsLoading(false);
    }
  }

  async function openPage(): Promise<void> {
    if (currentPage === 'reflections') {
      return;
    }
    try {
      await runLoading(() => loadListsAndDetail(selectedArtifact?.artifactId ?? null));
      setCurrentPage('reflections');
    } catch {
      // The shared app error panel owns the visible failure.
    }
  }

  async function refresh(): Promise<void> {
    try {
      await runLoading(() => loadListsAndDetail(selectedArtifact?.artifactId ?? null));
    } catch {
      // The shared app error panel owns the visible failure.
    }
  }

  async function selectArtifact(artifactId: string): Promise<void> {
    if (artifactId === selectedArtifact?.artifactId) {
      return;
    }
    try {
      await runLoading(async () => {
        setSelectedArtifact(await requireApi().getArtifact(artifactId));
      });
    } catch {
      // Preserve the previous selection on failure.
    }
  }

  async function reviewProposal(
    proposalId: string,
    request: ReviewProposalRequest,
  ): Promise<void> {
    setSubmittingProposalId(proposalId);
    setError(null);
    try {
      await requireApi().reviewProposal(proposalId, request);
      await loadListsAndDetail(selectedArtifact?.artifactId ?? null);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to review reflection proposal');
      throw error;
    } finally {
      setSubmittingProposalId(null);
    }
  }

  async function withdrawAuthorization(invocationId: string): Promise<void> {
    setWithdrawingInvocationId(invocationId);
    setError(null);
    try {
      await requireApi().withdrawAuthorization(invocationId);
      await loadListsAndDetail(selectedArtifact?.artifactId ?? null);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to withdraw authorization');
      throw error;
    } finally {
      setWithdrawingInvocationId(null);
    }
  }

  return {
    isLoading,
    openArtifacts,
    recentArtifacts,
    generationRuns,
    selectedArtifact,
    selectedArtifactId: selectedArtifact?.artifactId ?? null,
    submittingProposalId,
    withdrawingInvocationId,
    openPage,
    refresh,
    selectArtifact,
    deferProposal: (proposalId) => reviewProposal(proposalId, { action: 'defer' }),
    dismissProposal: (proposalId, reason) => reviewProposal(proposalId, {
      action: 'dismiss',
      reason,
    }),
    acceptProposal: (proposalId, operation) => reviewProposal(proposalId, {
      action: 'accept',
      operation,
    }),
    withdrawAuthorization,
  };
}
