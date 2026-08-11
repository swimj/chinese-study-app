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
import type {
  ContentDiagnosticKind,
  ContentDiagnosticsResponse,
} from '../domain/content-diagnostics';

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

export type ReflectionModelChoice = 'openai:gpt-5.6-luna-high' | 'zai:glm-5.2-high';

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
  sourceRunId: string | null;
  reflectionFlowVersion: string;
  generatedAt: string;
  provider: string;
  model: string;
  promptVersion: string;
  bundleSchemaVersion: string;
  resultSchemaVersion: string;
  proposalCount: number;
  openProposalCount: number;
} & (
  | { readState: 'available'; itemCount: number }
  | { readState: 'unreadable'; itemCount: null }
);

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

export type ReflectionArtifactDetailDto = {
  artifactId: string;
  sourceSessionId: string;
  sourceRunId: string | null;
  reflectionFlowVersion: string;
  generatedAt: string;
  provider: string;
  model: string;
  promptVersion: string;
  bundleSchemaVersion: SessionReflectionBundle['schemaVersion'];
  resultSchemaVersion: SessionReflectionResult['schemaVersion'];
  evidenceBundle: SessionReflectionBundle;
  result: SessionReflectionResult;
  proposals: ReflectionProposalDetailDto[];
};

export type ReflectionReviewApi = {
  listArtifacts: (review: 'open' | 'all') => Promise<ReflectionArtifactSummaryDto[]>;
  listGenerationRuns: () => Promise<ReflectionGenerationRunDto[]>;
  retryGenerationRun: (runId: string, model?: ReflectionModelChoice) => Promise<GenerateSessionReflectionResult>;
  getArtifact: (artifactId: string) => Promise<ReflectionArtifactDetailDto>;
  reviewProposal: (
    proposalId: string,
    request: ReviewProposalRequest,
  ) => Promise<unknown>;
  withdrawAuthorization: (invocationId: string) => Promise<unknown>;
};

export type { BackendStatus };

export async function fetchContentDiagnostics(
  kind: ContentDiagnosticKind,
  query: string,
): Promise<ContentDiagnosticsResponse> {
  const params = new URLSearchParams({ kind, q: query, limit: '50' });
  const response = await fetch(`${API_BASE}/api/content-diagnostics?${params.toString()}`);
  if (!response.ok) {
    throw new Error('Failed to load content diagnostics');
  }
  return response.json();
}

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

export async function fetchSessionPayload(): Promise<SessionPayload> {
  const studyDayKey = getCurrentStudyDayKey();
  const response = await fetch(`${API_BASE}/api/session-payload?studyDayKey=${encodeURIComponent(studyDayKey)}`);
  if (!response.ok) {
    throw new Error('Failed to load session payload');
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
}: {
  sessionId: string;
  sessionActionId: string;
  targetWordId: string;
  actionKind: 'production' | 'contrast_selection';
  sampledSkillIds: StudySkillId[];
  contentRef: StudyContentRef | null;
  managementAction: StudyManagementActionKind;
  note?: string;
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
  model?: ReflectionModelChoice,
): Promise<GenerateSessionReflectionResult> {
  const response = await fetch(
    `${API_BASE}/api/reflection-generation-runs/${encodeURIComponent(runId)}/retry`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: model === undefined ? undefined : JSON.stringify({ model }),
    },
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
