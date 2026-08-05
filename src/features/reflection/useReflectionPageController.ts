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
  artifactDetails: ReflectionArtifactDetailDto[];
  generationRuns: ReflectionGenerationRunDto[];
  selectedArtifact: ReflectionArtifactDetailDto | null;
  selectedArtifactId: string | null;
  submittingProposalId: string | null;
  withdrawingInvocationId: string | null;
  generationRetryStatus: {
    runId: string;
    state: 'generating' | 'succeeded' | 'failed';
  } | null;
  openPage: () => Promise<void>;
  refresh: () => Promise<void>;
  selectArtifact: (artifactId: string) => Promise<void>;
  retryGenerationRun: (runId: string) => Promise<void>;
  deferProposal: (proposalId: string) => Promise<void>;
  dismissProposal: (proposalId: string, reason: string | null) => Promise<void>;
  acceptProposal: (proposalId: string, operation: ReflectionOperation) => Promise<void>;
  withdrawAuthorization: (invocationId: string) => Promise<void>;
};

export function useReflectionPageController({
  currentPage,
  setCurrentPage,
  setError,
  onAcceptedProposal,
  api,
}: {
  currentPage: AppPageKey;
  setCurrentPage: (page: AppPageKey) => void;
  setError: (message: string | null) => void;
  onAcceptedProposal?: () => Promise<void> | void;
  api?: ReflectionReviewApi;
}): ReflectionPageController {
  const [isLoading, setIsLoading] = useState(false);
  const [openArtifacts, setOpenArtifacts] = useState<ReflectionArtifactSummaryDto[]>([]);
  const [recentArtifacts, setRecentArtifacts] = useState<ReflectionArtifactSummaryDto[]>([]);
  const [artifactDetails, setArtifactDetails] = useState<ReflectionArtifactDetailDto[]>([]);
  const [generationRuns, setGenerationRuns] = useState<ReflectionGenerationRunDto[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<ReflectionArtifactDetailDto | null>(null);
  const [submittingProposalId, setSubmittingProposalId] = useState<string | null>(null);
  const [withdrawingInvocationId, setWithdrawingInvocationId] = useState<string | null>(null);
  const [generationRetryStatus, setGenerationRetryStatus] = useState<
    ReflectionPageController['generationRetryStatus']
  >(null);

  function requireApi(): ReflectionReviewApi {
    if (api === undefined) {
      throw new Error('Reflection review API is not available.');
    }
    return api;
  }

  async function loadListsAndDetail(
    preferredArtifactId: string | null,
    forceArtifactIds: ReadonlySet<string> = new Set(),
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
    const orderedArtifactIds = [
      ...nextRecentArtifacts.map((artifact) => artifact.artifactId),
      ...nextOpenArtifacts
        .map((artifact) => artifact.artifactId)
        .filter((artifactId) => !nextRecentArtifacts.some(
          (artifact) => artifact.artifactId === artifactId,
        )),
    ];
    const detailByArtifactId = new Map(
      artifactDetails.map((detail) => [detail.artifactId, detail]),
    );
    const artifactIdsToLoad = orderedArtifactIds.filter((artifactId) => (
      !detailByArtifactId.has(artifactId) || forceArtifactIds.has(artifactId)
    ));
    const loadedDetails = await Promise.all(
      artifactIdsToLoad.map((artifactId) => reviewApi.getArtifact(artifactId)),
    );
    for (const detail of loadedDetails) {
      detailByArtifactId.set(detail.artifactId, detail);
    }
    const nextArtifactDetails = orderedArtifactIds.map((artifactId) => {
      const detail = detailByArtifactId.get(artifactId);
      if (detail === undefined) {
        throw new Error(`Reflection artifact ${artifactId} detail was not loaded.`);
      }
      return detail;
    });
    const nextArtifactId = preferredArtifactId !== null
      && availableArtifactIds.has(preferredArtifactId)
      ? preferredArtifactId
      : nextOpenArtifacts[0]?.artifactId ?? nextRecentArtifacts[0]?.artifactId ?? null;
    const nextSelectedArtifact = nextArtifactId === null
      ? null
      : detailByArtifactId.get(nextArtifactId) ?? await reviewApi.getArtifact(nextArtifactId);

    setOpenArtifacts(nextOpenArtifacts);
    setRecentArtifacts(nextRecentArtifacts);
    setArtifactDetails(nextArtifactDetails);
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
        const loadedDetail = artifactDetails.find((detail) => detail.artifactId === artifactId);
        setSelectedArtifact(loadedDetail ?? await requireApi().getArtifact(artifactId));
      });
    } catch {
      // Preserve the previous selection on failure.
    }
  }

  async function retryGenerationRun(runId: string): Promise<void> {
    if (generationRetryStatus?.state === 'generating') return;
    setGenerationRetryStatus({ runId, state: 'generating' });
    setError(null);
    try {
      const result = await requireApi().retryGenerationRun(runId);
      await loadListsAndDetail(result.artifactId);
      setGenerationRetryStatus({ runId, state: 'succeeded' });
    } catch (error) {
      setGenerationRetryStatus({ runId, state: 'failed' });
      setError(error instanceof Error ? error.message : 'Failed to retry reflection generation');
      try {
        setGenerationRuns(await requireApi().listGenerationRuns());
      } catch {
        // Preserve the retry failure as the actionable error.
      }
    }
  }

  async function reviewProposal(
    proposalId: string,
    request: ReviewProposalRequest,
  ): Promise<void> {
    const artifactId = artifactDetails.find((detail) => (
      detail.proposals.some((proposal) => proposal.review.proposalId === proposalId)
    ))?.artifactId;
    if (artifactId === undefined) {
      throw new Error(`Reflection proposal ${proposalId} is not loaded.`);
    }
    setSubmittingProposalId(proposalId);
    setError(null);
    try {
      await requireApi().reviewProposal(proposalId, request);
      if (request.action === 'accept') {
        try {
          void Promise.resolve(onAcceptedProposal?.()).catch(() => undefined);
        } catch {
          // The proposal is already applied. Cache refresh failure must not make it retryable.
        }
      }
      await loadListsAndDetail(
        selectedArtifact?.artifactId ?? null,
        new Set([artifactId]),
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to review reflection proposal');
      throw error;
    } finally {
      setSubmittingProposalId(null);
    }
  }

  async function withdrawAuthorization(invocationId: string): Promise<void> {
    const artifactId = artifactDetails.find((detail) => (
      detail.proposals.some((proposal) => (
        proposal.invocation?.invocation.invocationId === invocationId
      ))
    ))?.artifactId;
    if (artifactId === undefined) {
      throw new Error(`Reflection invocation ${invocationId} is not loaded.`);
    }
    setWithdrawingInvocationId(invocationId);
    setError(null);
    try {
      await requireApi().withdrawAuthorization(invocationId);
      await loadListsAndDetail(
        selectedArtifact?.artifactId ?? null,
        new Set([artifactId]),
      );
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
    artifactDetails,
    generationRuns,
    selectedArtifact,
    selectedArtifactId: selectedArtifact?.artifactId ?? null,
    submittingProposalId,
    withdrawingInvocationId,
    generationRetryStatus,
    openPage,
    refresh,
    selectArtifact,
    retryGenerationRun,
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
