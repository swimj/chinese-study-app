import type {
  PriorityWord,
  ReviewFailureRateDay,
  SessionActiveTimeMetrics,
  Word,
  WordMeaning,
  ReviewRating,
} from '../types';
import type {
  ContrastSelectionCommitIntent,
  ContrastCluster,
  ContrastClusterMember,
  ContrastPrompt,
  SessionStudyItemBuckets,
  ProductionAnswerWord,
  StudyAttemptEvent,
  StudyContentRef,
  StudyManagementActionKind,
  StudySkillId,
  StudyEvent,
} from '../domain/study-actions';
import type { SessionReflectionEvidenceSupplementV1 } from '../domain/reflection-evidence';
import type {
  OperationApplicationStatus,
  OperationInvocation,
  ProposalReviewStatus,
  ReflectionProposalV1,
  ReviewProposalRequest,
  SessionReflectionBundle,
  SessionReflectionResult,
} from '../domain/reflection';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:5174';

type BackendStatus = {
  status: string;
  time: string;
  mode: 'dev' | 'study';
  studyProfile: 'mandarin' | 'french';
  dataDir: string;
  dbPath: string;
  wordStatusCounts: Record<Word['status'], number>;
  reviewFailureRateDays: ReviewFailureRateDay[];
  sessionActiveTimeMetrics: SessionActiveTimeMetrics;
  dailyNewWordLimit: number;
  learningCoverageDate: string;
};

type LearningPolicyResponse = {
  dailyNewWordLimit: number;
};

export type SessionPayload = {
  buckets: SessionStudyItemBuckets;
  productionAnswerWords: ProductionAnswerWord[];
};

export type GenerateSessionReflectionResult = {
  artifactId: string;
  proposalCount: number;
  status: 'created' | 'existing';
};

export type ReflectionTokenUsageDto = {
  inputTokens: number | null;
  cachedInputTokens: number | null;
  cacheWriteInputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
};

export type ReflectionGenerationRunDto = {
  runId: string;
  sourceSessionId: string;
  reflectionFlowVersion: string;
  startedAt: string;
  completedAt: string;
  provider: string;
  model: string;
  providerModel: string;
  promptVersion: string;
  responseId: string | null;
  clientRequestId: string | null;
  finishReason: string | null;
  bundleSchemaVersion: string | null;
  resultSchemaVersion: string | null;
  state: 'succeeded' | 'failed';
  failureCode: string | null;
  eligibleItemCount: number;
  includedItemCount: number;
  usage: ReflectionTokenUsageDto;
  pricingSnapshotId: string | null;
  pricingAsOf: string | null;
  pricingBasis: unknown | null;
  estimatedCostUsd: number | null;
  diagnostic: {
    schemaVersion: 'reflection_generation_diagnostic.v1';
    phase: 'provider_transport' | 'truncation' | 'json_parse' | 'structural_schema' | 'domain_validation';
    issues: Array<{ path: string; code: string; message: string; valueType: string | null }>;
    rejectedOutput: string | null;
  } | null;
  retryable: boolean;
};

export type ReflectionArtifactSummaryDto = {
  artifactId: string;
  sourceSessionId: string;
  reflectionFlowVersion: string;
  generatedAt: string;
  provider: string;
  model: string;
  promptVersion: string;
  bundleSchemaVersion: SessionReflectionBundle['schemaVersion'];
  resultSchemaVersion: SessionReflectionResult['schemaVersion'];
  itemCount: number;
  proposalCount: number;
  openProposalCount: number;
};

export type OperationInvocationStatusDto = {
  invocation: OperationInvocation;
  application: OperationApplicationStatus;
};

export type ReflectionProposalDetailDto = {
  itemId: string;
  proposalIndex: number;
  proposal: ReflectionProposalV1;
  review: ProposalReviewStatus;
  invocation: OperationInvocationStatusDto | null;
};

export type ReflectionArtifactDetailDto = Omit<
  ReflectionArtifactSummaryDto,
  'itemCount' | 'proposalCount' | 'openProposalCount'
> & {
  evidenceBundle: SessionReflectionBundle;
  result: SessionReflectionResult;
  proposals: ReflectionProposalDetailDto[];
};

export type ReflectionReviewApi = {
  listArtifacts: (review: 'open' | 'all') => Promise<ReflectionArtifactSummaryDto[]>;
  listGenerationRuns: () => Promise<ReflectionGenerationRunDto[]>;
  retryGenerationRun: (runId: string) => Promise<GenerateSessionReflectionResult>;
  getArtifact: (artifactId: string) => Promise<ReflectionArtifactDetailDto>;
  reviewProposal: (
    proposalId: string,
    request: ReviewProposalRequest,
  ) => Promise<unknown>;
  withdrawAuthorization: (invocationId: string) => Promise<unknown>;
};

export type { BackendStatus };

type UserPriorityPatch = {
  bumpDelta?: number;
  forceTop?: boolean;
  reset?: boolean;
  requiredForNextSession?: boolean;
};

type AddPriorityByHanziResponse = {
  addedCount: number;
  unstudiedTotalCount: number;
  words: PriorityWord[];
};

type PriorityWordsResponse = {
  unstudiedTotalCount: number;
  words: PriorityWord[];
};

export type ContrastClusterContent = ContrastCluster & {
  members: Array<ContrastClusterMember & {
    word: Word;
    productionSuppressed: boolean;
    badProductionPromptReported: boolean;
  }>;
  prompts: ContrastPromptContent[];
};

export type ContrastPromptContent = ContrastPrompt & {
  feedback: {
    flagged: boolean;
    badPromptCount: number;
    latestBadPromptAt: string | null;
    notes: string[];
  };
};

export type ContrastIntakeCoverage = {
  hasSharedCluster: boolean;
  sharedClusterIds: string[];
  promptCountForTarget: number;
  promptCountForCandidate: number;
  usablePromptCount: number;
};

export type ContrastCandidateIntakeSource = {
  id: string;
  createdAt: string;
  targetWordId: string;
  sourceEventId: string | null;
  sourceActionKind: 'recognition' | 'production' | 'contrast_selection' | null;
  sourceContentRef: StudyContentRef | null;
  candidateText: string | null;
  matchedWordId: string | null;
  note: string;
  status: 'open' | 'accepted' | 'dismissed' | 'resolved';
};

export type ContrastIntakeGroup = {
  groupKey: string;
  targetWordId: string;
  candidateText: string | null;
  matchedWordId: string | null;
  targetWord: Word;
  matchedWord: Word | null;
  count: number;
  firstCreatedAt: string;
  latestCreatedAt: string;
  notes: string[];
  sources: ContrastCandidateIntakeSource[];
  relevantClusters: ContrastClusterContent[];
  coverage: ContrastIntakeCoverage;
};

export type ContrastIntakeMatchedWord = {
  wordId: string;
  word: Word;
  coverage: ContrastIntakeCoverage;
  productionSuppressed: boolean;
  badProductionPromptReported: boolean;
  unaddressed: boolean;
};

export type ContrastIntakeCandidateSummary = {
  key: string;
  candidateText: string | null;
  matchedWordId: string | null;
  matchedWord: Word | null;
  count: number;
  firstCreatedAt: string;
  latestCreatedAt: string;
  notes: string[];
  sources: ContrastCandidateIntakeSource[];
  relevantClusters: ContrastClusterContent[];
  coverage: ContrastIntakeCoverage;
  matchedWords: ContrastIntakeMatchedWord[];
  unaddressed: boolean;
};

export type ContrastClusterCompletenessFlags = {
  hasAtLeastTwoMembers: boolean;
  hasUsablePrompts: boolean;
  incomplete: boolean;
};

export type ContrastSuggestedCluster = ContrastClusterContent & {
  completeness: ContrastClusterCompletenessFlags;
};

export type ContrastIntakeWord = {
  targetWordId: string;
  targetWord: Word;
  openRowCount: number;
  firstCreatedAt: string;
  latestCreatedAt: string;
  notes: string[];
  sources: ContrastCandidateIntakeSource[];
  candidates: ContrastIntakeCandidateSummary[];
  resolvedCandidateWordIds: string[];
  suggestedClusters: ContrastSuggestedCluster[];
  productionSuppressed: boolean;
  badProductionPromptReported: boolean;
};

type ContrastClustersResponse = {
  clusters: ContrastClusterContent[];
};

type ContrastIntakeGroupsResponse = {
  groups: ContrastIntakeGroup[];
};

type ContrastIntakeWordsResponse = {
  words: ContrastIntakeWord[];
};

type WordSearchResponse = {
  words: Word[];
};

type ContrastIntakeGroupSelector = {
  targetWordId: string;
  candidateText?: string | null;
  matchedWordId?: string | null;
};

type ContrastIntakePromptInput = {
  targetWordId: string;
  promptText: string;
  explanation: string;
};

export async function fetchSessionPayload(): Promise<SessionPayload> {
  const studyDayKey = getCurrentStudyDayKey();
  const response = await fetch(`${API_BASE}/api/session-payload?studyDayKey=${encodeURIComponent(studyDayKey)}`);
  if (!response.ok) {
    throw new Error('Failed to load session payload');
  }

  return response.json();
}

export async function searchWords(query: string, limit = 20): Promise<WordSearchResponse> {
  const response = await fetch(`${API_BASE}/api/words/search?q=${encodeURIComponent(query)}&limit=${encodeURIComponent(limit)}`);
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to search words'));
  }

  return response.json();
}

export async function fetchContrastIntakeGroups(): Promise<ContrastIntakeGroupsResponse> {
  const response = await fetch(`${API_BASE}/api/contrast-intake/groups`);
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to load contrast intake groups'));
  }

  return response.json();
}

export async function fetchContrastIntakeWords(): Promise<ContrastIntakeWordsResponse> {
  const response = await fetch(`${API_BASE}/api/contrast-intake/words`, {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to load contrast intake words'));
  }

  return response.json();
}

export async function resolveContrastIntakeWord(targetWordId: string): Promise<ContrastIntakeWordsResponse> {
  const response = await fetch(`${API_BASE}/api/contrast-intake/words/${encodeURIComponent(targetWordId)}/resolve`, {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to resolve contrast intake word'));
  }

  return response.json();
}

export async function mergeSuggestedContrastClusters(input: {
  targetWordId: string;
  destinationClusterId: string;
}): Promise<ContrastClusterContent> {
  const response = await fetch(
    `${API_BASE}/api/contrast-intake/words/${encodeURIComponent(input.targetWordId)}/merge-suggested-clusters`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        destinationClusterId: input.destinationClusterId,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to merge suggested contrast clusters'));
  }

  return response.json();
}

export async function acceptContrastIntakeGroup(selector: ContrastIntakeGroupSelector): Promise<ContrastIntakeGroupsResponse> {
  const response = await fetch(`${API_BASE}/api/contrast-intake/groups/accept`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(selector),
  });

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to accept contrast intake group'));
  }

  return response.json();
}

export async function dismissContrastIntakeGroup(selector: ContrastIntakeGroupSelector): Promise<ContrastIntakeGroupsResponse> {
  const response = await fetch(`${API_BASE}/api/contrast-intake/groups/dismiss`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(selector),
  });

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to dismiss contrast intake group'));
  }

  return response.json();
}

export async function createContrastClusterFromIntake(input: ContrastIntakeGroupSelector & {
  resolvedCandidateWordId: string;
  extraMemberWordIds?: string[];
  title: string;
  note: string;
  targetNuanceNote: string;
  candidateNuanceNote: string;
  prompt: ContrastIntakePromptInput;
}): Promise<ContrastClusterContent> {
  const response = await fetch(`${API_BASE}/api/contrast-intake/groups/create-cluster`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to create contrast cluster from intake'));
  }

  return response.json();
}

export async function addContrastIntakeToCluster(input: ContrastIntakeGroupSelector & {
  clusterId: string;
  resolvedCandidateWordId: string;
  extraMemberWordIds?: string[];
  targetNuanceNote: string;
  candidateNuanceNote: string;
  prompt: ContrastIntakePromptInput;
}): Promise<ContrastClusterContent> {
  const response = await fetch(`${API_BASE}/api/contrast-intake/groups/add-to-cluster`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to add contrast intake to cluster'));
  }

  return response.json();
}

export async function addContrastPromptFromIntake(input: ContrastIntakeGroupSelector & {
  clusterId: string;
  prompt: ContrastIntakePromptInput;
}): Promise<ContrastClusterContent> {
  const response = await fetch(`${API_BASE}/api/contrast-intake/groups/add-prompt`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to add contrast prompt from intake'));
  }

  return response.json();
}

export async function fetchStatus(): Promise<BackendStatus> {
  const studyDayKey = getCurrentStudyDayKey();
  const response = await fetch(`${API_BASE}/api/status?studyDayKey=${encodeURIComponent(studyDayKey)}`);
  if (!response.ok) {
    throw new Error('Failed to load backend status');
  }
  return response.json();
}

export async function updateDailyNewWordLimit(dailyNewWordLimit: number): Promise<LearningPolicyResponse> {
  const response = await fetch(`${API_BASE}/api/learning-policy/daily-new-word-limit`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ dailyNewWordLimit }),
  });
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to update daily new-word limit'));
  }

  return response.json();
}

export async function fetchContrastClusters(): Promise<ContrastClustersResponse> {
  const response = await fetch(`${API_BASE}/api/contrast-clusters`, {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to load contrast clusters'));
  }

  return response.json();
}

export async function createContrastCluster(input: {
  title: string;
  note?: string;
}): Promise<ContrastCluster> {
  const response = await fetch(`${API_BASE}/api/contrast-clusters`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to create contrast cluster'));
  }
  return response.json();
}

export async function updateContrastCluster(input: {
  id: string;
  title: string;
  note: string;
}): Promise<ContrastCluster> {
  const response = await fetch(`${API_BASE}/api/contrast-clusters/${encodeURIComponent(input.id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: input.title,
      note: input.note,
    }),
  });
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to update contrast cluster'));
  }
  return response.json();
}

export async function updateContrastClusterMember(input: {
  clusterId: string;
  wordId: string;
  nuanceNote?: string;
  displayOrder?: number | null;
}): Promise<ContrastClusterMember> {
  const response = await fetch(
    `${API_BASE}/api/contrast-clusters/${encodeURIComponent(input.clusterId)}/members/${encodeURIComponent(input.wordId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nuanceNote: input.nuanceNote,
        displayOrder: input.displayOrder,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to update contrast cluster member'));
  }
  return response.json();
}

export async function addContrastClusterMember(input: {
  clusterId: string;
  wordId: string;
  nuanceNote?: string;
  displayOrder?: number | null;
}): Promise<ContrastClusterMember> {
  const response = await fetch(
    `${API_BASE}/api/contrast-clusters/${encodeURIComponent(input.clusterId)}/members`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wordId: input.wordId,
        nuanceNote: input.nuanceNote,
        displayOrder: input.displayOrder,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to add contrast cluster member'));
  }
  return response.json();
}

export async function removeContrastClusterMember(input: {
  clusterId: string;
  wordId: string;
}): Promise<ContrastClusterContent> {
  const response = await fetch(
    `${API_BASE}/api/contrast-clusters/${encodeURIComponent(input.clusterId)}/members/${encodeURIComponent(input.wordId)}`,
    { method: 'DELETE' },
  );
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to remove contrast cluster member'));
  }
  return response.json();
}

export async function suppressProductionForWord(targetWordId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/study-management/production/suppress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetWordId }),
  });
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to suppress production for word'));
  }
}

export async function reportBadProductionPrompt(input: { targetWordId: string; note?: string }): Promise<void> {
  const response = await fetch(`${API_BASE}/api/study-management/production/bad-prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to report bad production prompt'));
  }
}

export async function createContrastPrompt({
  clusterId,
  targetWordId,
  promptText,
  explanation,
}: {
  clusterId: string;
  targetWordId: string;
  promptText: string;
  explanation: string;
}): Promise<ContrastPrompt> {
  const response = await fetch(`${API_BASE}/api/contrast-clusters/${encodeURIComponent(clusterId)}/prompts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ targetWordId, promptText, explanation }),
  });

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to create contrast prompt'));
  }

  return response.json();
}

export async function updateContrastPrompt({
  id,
  targetWordId,
  promptText,
  explanation,
}: {
  id: string;
  targetWordId: string;
  promptText: string;
  explanation: string;
}): Promise<ContrastPrompt> {
  const response = await fetch(`${API_BASE}/api/contrast-prompts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ targetWordId, promptText, explanation }),
  });

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to update contrast prompt'));
  }

  return response.json();
}

export async function resolveContrastPromptBadFeedback({
  id,
  note = '',
}: {
  id: string;
  note?: string;
}): Promise<ContrastPromptContent> {
  const response = await fetch(`${API_BASE}/api/contrast-prompts/${encodeURIComponent(id)}/resolve-bad-feedback`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ note }),
  });

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to resolve contrast prompt feedback'));
  }

  return response.json();
}

export async function deleteContrastPrompt(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/contrast-prompts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to delete contrast prompt'));
  }
}

export async function recordAcceptedReviewAttemptBatch({
  sessionId,
  events,
  commitIntent,
}: {
  sessionId: string;
  events: StudyAttemptEvent[];
  commitIntent: {
    type: 'commit-review-action-session';
    sessionActionId: string;
    targetWordId: string;
    actionKind: 'recognition' | 'production';
    sampledSkillIds: Array<'recognition' | 'production'>;
    failureCount: number;
    terminalRating: 'hard' | 'good' | 'easy' | null;
  };
}): Promise<void> {
  const response = await fetch(`${API_BASE}/api/study-sessions/${encodeURIComponent(sessionId)}/accepted-review-attempt-batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ events, commitIntent }),
  });

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to record accepted review attempt batch'));
  }
}

export async function recordAcceptedContrastSelectionAttempt({
  sessionId,
  event,
  commitIntent,
}: {
  sessionId: string;
  event: StudyAttemptEvent;
  commitIntent: ContrastSelectionCommitIntent;
}): Promise<void> {
  const response = await fetch(`${API_BASE}/api/study-sessions/${encodeURIComponent(sessionId)}/accepted-contrast-selection-attempt`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ event, commitIntent }),
  });

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to record accepted contrast selection attempt'));
  }
}

export async function recordStudyManagementAction({
  sessionId,
  sessionActionId,
  targetWordId,
  actionKind,
  sampledSkillIds,
  contentRef,
  managementAction,
  note = '',
  candidateText = null,
}: {
  sessionId: string;
  sessionActionId: string;
  targetWordId: string;
  actionKind: 'production' | 'contrast_selection';
  sampledSkillIds: StudySkillId[];
  contentRef: StudyContentRef | null;
  managementAction: StudyManagementActionKind;
  note?: string;
  candidateText?: string | null;
}): Promise<StudyEvent> {
  const response = await fetch(`${API_BASE}/api/study-sessions/${encodeURIComponent(sessionId)}/manage-study-action`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sessionActionId,
      targetWordId,
      actionKind,
      sampledSkillIds,
      contentRef,
      managementAction,
      note,
      candidateText,
    }),
  });

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to record study management action'));
  }

  return response.json();
}

export async function recordReviewSessionSummary({
  sessionId,
  completedAt,
  completedReviewActionCount,
  failedReviewActionCount,
  activeDurationMs,
}: {
  sessionId: string;
  completedAt: string;
  completedReviewActionCount: number;
  failedReviewActionCount: number;
  activeDurationMs: number;
}): Promise<void> {
  const response = await fetch(`${API_BASE}/api/review-session-summaries`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sessionId,
      completedAt,
      completedReviewActionCount,
      failedReviewActionCount,
      activeDurationMs,
    }),
  });

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to record review session summary'));
  }
}

export async function generateSessionReflection({
  sessionId,
  evidence,
}: {
  sessionId: string;
  evidence: SessionReflectionEvidenceSupplementV1;
}): Promise<GenerateSessionReflectionResult> {
  const response = await fetch(
    `${API_BASE}/api/study-sessions/${encodeURIComponent(sessionId)}/reflections`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(evidence),
    },
  );

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to generate session reflection'));
  }

  return response.json();
}

export async function fetchReflectionArtifacts(
  review: 'open' | 'all',
): Promise<ReflectionArtifactSummaryDto[]> {
  const response = await fetch(
    `${API_BASE}/api/reflection-artifacts?review=${encodeURIComponent(review)}`,
  );
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to load reflection artifacts'));
  }

  const payload = await response.json() as { artifacts: ReflectionArtifactSummaryDto[] };
  return payload.artifacts;
}

export async function fetchReflectionGenerationRuns(): Promise<ReflectionGenerationRunDto[]> {
  const response = await fetch(`${API_BASE}/api/reflection-generation-runs`);
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to load reflection generation runs'));
  }
  const payload = await response.json() as { runs: ReflectionGenerationRunDto[] };
  return payload.runs;
}

export async function retryReflectionGenerationRun(
  runId: string,
): Promise<GenerateSessionReflectionResult> {
  const response = await fetch(
    `${API_BASE}/api/reflection-generation-runs/${encodeURIComponent(runId)}/retry`,
    { method: 'POST' },
  );
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to retry reflection generation'));
  }
  return response.json();
}

export async function fetchReflectionArtifactDetail(
  artifactId: string,
): Promise<ReflectionArtifactDetailDto> {
  const response = await fetch(
    `${API_BASE}/api/reflection-artifacts/${encodeURIComponent(artifactId)}`,
  );
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to load reflection artifact'));
  }

  return response.json();
}

export async function reviewReflectionProposal(
  proposalId: string,
  request: ReviewProposalRequest,
): Promise<unknown> {
  const response = await fetch(
    `${API_BASE}/api/reflection-proposals/${encodeURIComponent(proposalId)}/review`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    },
  );
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to review reflection proposal'));
  }

  return response.json();
}

export async function withdrawReflectionAuthorization(
  invocationId: string,
): Promise<unknown> {
  const response = await fetch(
    `${API_BASE}/api/reflection-invocations/${encodeURIComponent(invocationId)}/withdraw-authorization`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    },
  );
  if (!response.ok) {
    throw new Error(
      await readApiErrorMessage(response, 'Failed to withdraw reflection authorization'),
    );
  }

  return response.json();
}

export async function completeLearningSession(wordId: string, success: boolean): Promise<Word> {
  const response = await fetch(`${API_BASE}/api/words/${wordId}/complete-learning-session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ success }),
  });

  if (!response.ok) {
    throw new Error('Failed to complete learning session');
  }

  return response.json();
}

export async function completeUnstudiedSession(wordId: string): Promise<Word> {
  const studyDayKey = getCurrentStudyDayKey();
  const response = await fetch(`${API_BASE}/api/words/${wordId}/complete-unstudied-session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ studyDayKey }),
  });

  if (!response.ok) {
    throw new Error('Failed to complete unstudied session');
  }

  return response.json();
}

export async function dismissWordFromStudy(wordId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/words/${wordId}/dismiss`, {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to dismiss word from study'));
  }
}

export async function updateWordPersonalNotes(wordId: string, personalNotes: string): Promise<Word> {
  const response = await fetch(`${API_BASE}/api/words/${wordId}/personal-notes`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ personalNotes }),
  });

  if (!response.ok) {
    throw new Error('Failed to update word personal notes');
  }

  return response.json();
}

export async function fetchUnstudiedPriorityWords(): Promise<PriorityWordsResponse> {
  const response = await fetch(`${API_BASE}/api/priority/unstudied`);
  if (!response.ok) {
    throw new Error('Failed to load unstudied priority words');
  }
  return response.json();
}

export async function fetchTopUnstudiedPriorityWords(limit = 50): Promise<PriorityWordsResponse> {
  const response = await fetch(`${API_BASE}/api/priority/unstudied/top?limit=${encodeURIComponent(limit)}`);
  if (!response.ok) {
    throw new Error('Failed to load top unstudied priority words');
  }
  return response.json();
}

export async function addUnstudiedPriorityByHanzi(
  hanzi: string,
  requiredForNextSession = false,
): Promise<AddPriorityByHanziResponse> {
  const response = await fetch(`${API_BASE}/api/priority/unstudied/add-by-hanzi`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ hanzi, requiredForNextSession }),
  });

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to add priority words'));
  }

  return response.json();
}

export async function updateWordUserPriority(wordId: string, patch: UserPriorityPatch): Promise<PriorityWord> {
  const response = await fetch(`${API_BASE}/api/words/${wordId}/user-priority`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(patch),
  });

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to update user priority'));
  }

  return response.json();
}

export async function fetchWordMeanings(wordId: string): Promise<WordMeaning[]> {
  const response = await fetch(`${API_BASE}/api/words/${wordId}/meanings`);
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to load word meanings'));
  }

  return response.json();
}

export async function updateWordMeaningVisibility(
  wordId: string,
  meaningId: string,
  showOnProductionPrompt: boolean,
): Promise<WordMeaning[]> {
  const response = await fetch(`${API_BASE}/api/words/${wordId}/meanings/${meaningId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ showOnProductionPrompt }),
  });

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to update word meaning visibility'));
  }

  return response.json();
}

async function readApiErrorMessage(response: Response, fallbackMessage: string) {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload.error === 'string' && payload.error.length > 0) {
      return payload.error;
    }
  } catch {
    // no-op: fallback below
  }

  return fallbackMessage;
}

function getCurrentStudyDayKey(): string {
  const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  const now = new Date();
  // A study day starts at 04:00 local time. Shift the instant back by 4h first,
  // then derive the local calendar date in the user's configured time zone.
  const shiftedInstant = new Date(now.getTime() - 4 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: userTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(shiftedInstant);

  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  if (!year || !month || !day) {
    throw new Error('Failed to derive study day key');
  }

  return `${year}-${month}-${day}`;
}
