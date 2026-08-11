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
  unreadableArtifactIds: ReadonlySet<string>;
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
  const [unreadableArtifactIds, setUnreadableArtifactIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
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
    const orderedArtifacts = [
      ...nextRecentArtifacts,
      ...nextOpenArtifacts
        .filter((artifact) => !nextRecentArtifacts.some(
          (recentArtifact) => recentArtifact.artifactId === artifact.artifactId,
        )),
    ];
    const readableArtifactIds = orderedArtifacts
      .filter((artifact) => artifact.readState === 'available')
      .map((artifact) => artifact.artifactId);
    const nextUnreadableArtifactIds = new Set(
      orderedArtifacts
        .filter((artifact) => artifact.readState === 'unreadable')
        .map((artifact) => artifact.artifactId),
    );
    const detailByArtifactId = new Map(
      artifactDetails.map((detail) => [detail.artifactId, detail]),
    );
    for (const artifactId of nextUnreadableArtifactIds) {
      detailByArtifactId.delete(artifactId);
    }
    const artifactIdsToLoad = readableArtifactIds.filter((artifactId) => (
      !detailByArtifactId.has(artifactId) || forceArtifactIds.has(artifactId)
    ));
    const loadedDetails = await Promise.allSettled(
      artifactIdsToLoad.map((artifactId) => reviewApi.getArtifact(artifactId)),
    );
    for (const [index, result] of loadedDetails.entries()) {
      const artifactId = artifactIdsToLoad[index]!;
      if (result.status === 'fulfilled') {
        detailByArtifactId.set(artifactId, result.value);
      } else {
        detailByArtifactId.delete(artifactId);
        nextUnreadableArtifactIds.add(artifactId);
      }
    }
    const nextArtifactDetails = readableArtifactIds.flatMap((artifactId) => {
      const detail = detailByArtifactId.get(artifactId);
      return detail === undefined ? [] : [detail];
    });
    const nextArtifactId = preferredArtifactId !== null
      && detailByArtifactId.has(preferredArtifactId)
      ? preferredArtifactId
      : nextOpenArtifacts.find((artifact) => detailByArtifactId.has(artifact.artifactId))
          ?.artifactId
        ?? nextRecentArtifacts.find((artifact) => detailByArtifactId.has(artifact.artifactId))
          ?.artifactId
        ?? null;
    const nextSelectedArtifact = nextArtifactId === null
      ? null
      : detailByArtifactId.get(nextArtifactId) ?? null;

    setOpenArtifacts(nextOpenArtifacts);
    setRecentArtifacts(nextRecentArtifacts);
    setArtifactDetails(nextArtifactDetails);
    setUnreadableArtifactIds(nextUnreadableArtifactIds);
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
    if (artifactId === selectedArtifact?.artifactId || unreadableArtifactIds.has(artifactId)) {
      return;
    }
    const loadedDetail = artifactDetails.find((detail) => detail.artifactId === artifactId);
    if (loadedDetail !== undefined) {
      setSelectedArtifact(loadedDetail);
      return;
    }
    setIsLoading(true);
    try {
      setSelectedArtifact(await requireApi().getArtifact(artifactId));
    } catch {
      setUnreadableArtifactIds((current) => new Set(current).add(artifactId));
    } finally {
      setIsLoading(false);
    }
  }

  async function retryGenerationRun(runId: string): Promise<void> {
    await runGenerationAttempt(runId, () => requireApi().retryGenerationRun(runId));
  }

  async function runGenerationAttempt(
    runId: string,
    request: () => Promise<{ artifactId: string }>,
  ): Promise<void> {
    if (generationRetryStatus?.state === 'generating') return;
    setGenerationRetryStatus({ runId, state: 'generating' });
    setError(null);
    try {
      const result = await request();
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
    unreadableArtifactIds,
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
