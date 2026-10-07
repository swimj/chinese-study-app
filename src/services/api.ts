import type { WhatsNewPost, WhatsNewWriteRequest } from '../domain/whats-new';
import type { WhatsNewAttention } from '../domain/whats-new-attention';
import type { ModelInvocationRow } from '../domain/model-invocations';
import type { SessionDebrief, SessionDebriefInventoryItem } from '../domain/session-debrief';
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
  StudyAttemptEvent,
  StudyContentRef,
  StudyManagementActionKind,
  StudySkillId,
  StudyEvent,
} from '../domain/study-actions';
import type { PureCueAssessmentEvent } from '../domain/pure-cues';
import type { CharacterPresentation, SentenceCharacterPresentation } from '../domain/card-characters';
import type { RecoveryHighlight } from '../domain/recovery-highlights';
import type {
  OperationApplicationStatus,
  OperationInvocation,
  ProposalReviewStatus,
  ReflectionProposalV1,
  ReflectionQualityItemTags,
  ReflectionHelpInboxEntry,
  ReflectionQualityTag,
  ReviewProposalRequest,
  SessionReflectionBundle,
  SessionReflectionResult,
  UpsertReflectionQualityRequest,
  ClearReflectionQualityRequest,
  MarkReflectionHelpInboxDoneRequest,
  MarkReflectionInboxSeenRequest,
  AuthorizeManualReflectionOperationRequest,
} from '../domain/reflection';
import type {
  ContentDiagnosticKind,
  ContentDiagnosticsResponse,
} from '../domain/content-diagnostics';
import type { MyWordsResponse, MyWordsStatus, MyWordsView } from '../domain/my-words';
import { ALL_MY_WORDS_STATUSES } from '../domain/my-words';
import type { ClientTransportIncidentContext } from './client-incident-diagnostics';
import type {
  IntroductionDraft,
  IntroductionLabStatus,
  IntroductionLexicalInput,
} from '../domain/word-content/lab';
import type { TeachingPackage, WordContentDocument } from '../domain/word-content/types';
import type { WordIntroductionResponse } from '../domain/word-content/application';
import {
  captureClientTransportFailure,
  readBrowserStorage,
  readPendingClientTransportIncidents,
  removeUploadedClientTransportIncidents,
} from './client-incident-diagnostics';

export async function fetchSessionRecoveryHighlights(
  sessionId: string,
  signal?: AbortSignal,
): Promise<RecoveryHighlight[]> {
  const response = await apiFetch(
    `${API_BASE}/api/study-sessions/${encodeURIComponent(sessionId)}/recovery-highlights`,
    { signal },
  );
  if (!response.ok) throw new Error('Could not load session recovery highlights.');
  const result: { highlights: RecoveryHighlight[] } = await response.json();
  return result.highlights;
}

export async function fetchMyWords(
  view: MyWordsView,
  query: string,
  offset = 0,
  signal?: AbortSignal,
  statuses: readonly MyWordsStatus[] = ALL_MY_WORDS_STATUSES,
  recentLapses = false,
): Promise<MyWordsResponse> {
  const params = new URLSearchParams({ view, q: query });
  if (view !== 'deck') { params.set('offset', String(offset)); params.set('limit', '50'); }
  if (statuses.length > 0 && statuses.length < ALL_MY_WORDS_STATUSES.length) {
    params.set('status', statuses.join(','));
  }
  if (recentLapses) params.set('lapses', '1');
  const response = await apiFetch(`${API_BASE}/api/my-words?${params}`, { signal });
  if (!response.ok) throw new Error('Could not load your words. Please try again.');
  return response.json();
}

const API_BASE = import.meta.env?.VITE_API_BASE ?? (import.meta.env?.DEV ? 'http://localhost:5174' : '');
const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'unknown';

type ApiAuthenticationTokenProvider = () => Promise<string | null>;

let apiAuthenticationTokenProvider: ApiAuthenticationTokenProvider | null = null;
let clientIncidentStorageScope: string | null = import.meta.env?.VITE_AUTH_MODE === 'clerk'
  ? null
  : 'trusted-local';
let clientIncidentUpload: Promise<void> | null = null;

export function setApiAuthenticationTokenProvider(provider: ApiAuthenticationTokenProvider | null): void {
  apiAuthenticationTokenProvider = provider;
}

export function setClientIncidentStorageScope(scope: string | null): void {
  clientIncidentStorageScope = scope;
}

async function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  incidentContext?: ClientTransportIncidentContext,
): Promise<Response> {
  const startedAtMs = Date.now();
  let token: string | null;
  try {
    token = await apiAuthenticationTokenProvider?.() ?? null;
  } catch (error) {
    if (!incidentContext) throw error;
    throw captureClientTransportFailure({
      error,
      phase: 'authentication',
      context: incidentContext,
      storageScope: clientIncidentStorageScope,
      appVersion: APP_VERSION,
      startedAtMs,
    });
  }

  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  try {
    return await fetch(input, { ...init, headers });
  } catch (error) {
    if (!incidentContext) throw error;
    throw captureClientTransportFailure({
      error,
      phase: 'fetch',
      context: incidentContext,
      storageScope: clientIncidentStorageScope,
      appVersion: APP_VERSION,
      startedAtMs,
    });
  }
}

async function introductionLabRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(`${API_BASE}/api/intro-lab${path}`, init);
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message = body && typeof body === 'object' && 'error' in body
      && typeof body.error === 'string' ? body.error : `Introduction lab request failed (${response.status}).`;
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export function fetchIntroductionLabStatus(): Promise<IntroductionLabStatus> {
  return introductionLabRequest('/status');
}

export function fetchIntroductionDrafts(): Promise<IntroductionDraft[]> {
  return introductionLabRequest('/drafts');
}

export function bootstrapIntroduction(input: IntroductionLexicalInput): Promise<IntroductionDraft> {
  return introductionLabRequest('/bootstrap', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
}

export function generateIntroductionTeaching(draftId: string): Promise<IntroductionDraft> {
  return introductionLabRequest(`/drafts/${encodeURIComponent(draftId)}/teaching`, { method: 'POST' });
}

export function importIntroductionDraft(input: {
  content: WordContentDocument;
  teaching?: TeachingPackage | null;
  origin?: 'sample' | 'imported';
}): Promise<IntroductionDraft> {
  return introductionLabRequest('/import', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
}

async function wordIntroductionRequest(
  wordId: string,
  path: string,
  init?: RequestInit,
): Promise<WordIntroductionResponse> {
  const response = await apiFetch(`${API_BASE}/api/words/${encodeURIComponent(wordId)}/introduction${path}`, init);
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
      ? body.error : `Could not load the introduction (${response.status}).`;
    throw new Error(message);
  }
  return response.json() as Promise<WordIntroductionResponse>;
}

export function openWordIntroduction(wordId: string, packageId: string): Promise<WordIntroductionResponse> {
  return wordIntroductionRequest(wordId, '/open', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ packageId }),
  });
}

export function completeWordIntroduction(wordId: string, packageId: string): Promise<WordIntroductionResponse> {
  return wordIntroductionRequest(wordId, '/complete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ packageId }),
  });
}

export async function flushPendingClientTransportIncidents(): Promise<void> {
  if (clientIncidentUpload) return clientIncidentUpload;
  const storageScope = clientIncidentStorageScope;
  const storage = readBrowserStorage();
  if (storageScope === null || storage === null) return;
  const incidents = readPendingClientTransportIncidents(storage, storageScope);
  if (incidents.length === 0) return;

  clientIncidentUpload = (async () => {
    const response = await apiFetch(`${API_BASE}/api/client-incidents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ incidents }),
    });
    if (!response.ok) return;
    removeUploadedClientTransportIncidents(
      storage,
      storageScope,
      incidents.map((incident) => incident.diagnosticId),
    );
  })().finally(() => {
    clientIncidentUpload = null;
  });
  return clientIncidentUpload;
}

type ServiceBanner = {
  message: string;
  postedAt: string;
  expiresAt: string;
};

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
  unstudiedAdmissionSource: UnstudiedAdmissionSource;
  characterPresentation: CharacterPresentation;
  sentenceCharacterPresentation: SentenceCharacterPresentation;
  studyNewWordsFirst: boolean;
  debriefInterests: string;
  learningCoverageDate: string;
  /** True when deck-based diet admission is active (Mandarin profile with a manifest). */
  dietDecksActive: boolean;
  serviceBanner: ServiceBanner | null;
};

export type UnstudiedAdmissionSource = 'mixed' | 'stash_only';

export type UsageDailySnapshot = {
  dayKey: string;
  capturedAt: string;
  dau: number;
  sessionsCompleted: number;
  newWords: number;
  modelSpendUsd: number;
  medianStashSize: number | null;
  medianSessionActiveMs: number | null;
  learnersInactive7d: number;
  sessionsAbandoned: number;
  learnersSpendWithoutAccepts: number;
  studyCommitFailures: number;
};

export type UsagePulsePayload = {
  generatedAt: string;
  today: UsageDailySnapshot;
  days: UsageDailySnapshot[];
};

type LearningPolicyResponse = {
  dailyNewWordLimit: number;
  unstudiedAdmissionSource: UnstudiedAdmissionSource;
};

export type SessionPayload = {
  buckets: SessionStudyItemBuckets;
  preparation?: { pending: boolean };
};

export type GenerateSessionReflectionResult = {
  additionalArtifactIds?: string[];
  partialFailure?: string;
  artifactId: string;
  proposalCount: number;
  status: 'created' | 'existing';
};

export type ReflectionModelChoice =
  | 'openai:gpt-5.6-luna-high'
  | 'zai:glm-5.3-flash-max'
  | 'zai:glm-5.3-flash-high'
  | 'openrouter:gemini-3.6-flash'
  | 'openai:gpt-5.6-terra-high'
  | 'openai:gpt-6-sol-high';

export type ReflectionSpendCapDto = {
  lunaOnly: boolean;
  spentUsd: number;
  capUsd: number;
  dayKey: string;
  resetsAt: string;
};

export type ReflectionGenerationRunsResponse = {
  runs: ReflectionGenerationRunDto[];
  spendCap: ReflectionSpendCapDto;
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
  sourceSessionId: string | null;
  reflectionFlowVersion: string;
  startedAt: string;
  completedAt: string | null;
  provider: string;
  model: string;
  providerModel: string;
  promptVersion: string;
  responseId: string | null;
  clientRequestId: string | null;
  finishReason: string | null;
  bundleSchemaVersion: string | null;
  resultSchemaVersion: string | null;
  state: 'in_flight' | 'succeeded' | 'failed';
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
  sourceSessionId: string | null;
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
  sourceSessionId: string | null;
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
  qualityItemTags: ReflectionQualityItemTags[];
  helpInbox: ReflectionHelpInboxEntry[];
  deferredHelpInbox: ReflectionHelpInboxEntry[];
};

export type ReflectionQualityArmStatsDto = {
  modelArm: string;
  promptVersion: string;
  terminalReviewCount: number;
  exactAcceptCount: number;
  revisedAcceptCount: number;
  userReplaceCount: number;
  dismissCount: number;
  taggedItemCount: number;
  tagCounts: Record<ReflectionQualityTag, number>;
  failedRunCount: number;
  totalCostUsd: number | null;
  avgCostPerExactAcceptUsd: number | null;
};

export type ReflectionQualityStatsDto = {
  arms: ReflectionQualityArmStatsDto[];
};

export type ReflectionReviewApi = {
  listArtifacts: (review: 'open' | 'all') => Promise<ReflectionArtifactSummaryDto[]>;
  listGenerationRuns: () => Promise<ReflectionGenerationRunsResponse>;
  retryGenerationRun: (runId: string, model?: ReflectionModelChoice) => Promise<GenerateSessionReflectionResult>;
  generateDeferredSecondOpinion: (
    proposalIds: string[],
    model: ReflectionModelChoice,
    helpInboxIds?: string[],
  ) => Promise<GenerateSessionReflectionResult>;
  getArtifact: (artifactId: string) => Promise<ReflectionArtifactDetailDto>;
  reviewProposal: (
    proposalId: string,
    request: ReviewProposalRequest,
  ) => Promise<unknown>;
  withdrawAuthorization: (invocationId: string) => Promise<unknown>;
  upsertQuality: (request: UpsertReflectionQualityRequest) => Promise<ReflectionQualityItemTags>;
  clearQuality: (request: ClearReflectionQualityRequest) => Promise<{ cleared: boolean }>;
  getQualityStats: () => Promise<ReflectionQualityStatsDto>;
  listHelpInbox: () => Promise<{ entries: ReflectionHelpInboxEntry[] }>;
  markHelpInboxDone: (
    request: MarkReflectionHelpInboxDoneRequest,
  ) => Promise<{ done: boolean }>;
  deferHelpInboxItem: (
    request: MarkReflectionHelpInboxDoneRequest,
  ) => Promise<{ deferred: boolean }>;
  authorizeManualOperation: (
    request: AuthorizeManualReflectionOperationRequest,
  ) => Promise<unknown>;
};

export type { BackendStatus, ServiceBanner };

export async function fetchContentDiagnostics(
  kind: ContentDiagnosticKind,
  query: string,
): Promise<ContentDiagnosticsResponse> {
  const params = new URLSearchParams({ kind, q: query, limit: '50' });
  const response = await apiFetch(`${API_BASE}/api/content-diagnostics?${params.toString()}`);
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

type AddPriorityByHanziResponse =
  | {
      addedCount: number;
      words: PriorityWord[];
      needsSelection?: false;
    }
  | {
      needsSelection: true;
      query: string;
      matches: Word[];
    };

type PriorityWordsResponse = {
  words: PriorityWord[];
};

export async function fetchSessionPayload(): Promise<SessionPayload> {
  const studyDayKey = getCurrentStudyDayKey();
  const response = await apiFetch(`${API_BASE}/api/session-payload`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studyDayKey }),
  });
  if (!response.ok) {
    throw new Error('Failed to load session payload');
  }

  return response.json();
}

export async function fetchStatus(): Promise<BackendStatus> {
  const studyDayKey = getCurrentStudyDayKey();
  const response = await apiFetch(`${API_BASE}/api/status?studyDayKey=${encodeURIComponent(studyDayKey)}`);
  if (!response.ok) {
    throw new Error('Failed to load backend status');
  }
  return response.json();
}

export async function fetchModelInvocations(from?: string, to?: string): Promise<{ rows: ModelInvocationRow[] }> {
  const params = new URLSearchParams();
  if (from !== undefined) params.set('from', from);
  if (to !== undefined) params.set('to', to);
  const response = await apiFetch(`${API_BASE}/api/operator/model-invocations?${params}`);
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to load model invocations'));
  }
  return response.json();
}

export async function fetchOperatorUsagePulse(): Promise<UsagePulsePayload> {
  const response = await apiFetch(`${API_BASE}/api/operator/usage-pulse`);
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to load operator usage pulse'));
  }
  return response.json();
}

export async function updateDailyNewWordLimit(dailyNewWordLimit: number): Promise<LearningPolicyResponse> {
  const response = await apiFetch(`${API_BASE}/api/learning-policy/daily-new-word-limit`, {
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

export async function updateUnstudiedAdmissionSource(
  unstudiedAdmissionSource: UnstudiedAdmissionSource,
): Promise<LearningPolicyResponse> {
  const response = await apiFetch(`${API_BASE}/api/learning-policy/unstudied-admission-source`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ unstudiedAdmissionSource }),
  });
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to update unstudied admission source'));
  }

  return response.json();
}

export async function updateCharacterPresentation(
  characterPresentation: CharacterPresentation,
): Promise<{ characterPresentation: CharacterPresentation }> {
  const response = await apiFetch(`${API_BASE}/api/learner-settings/character-presentation`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ characterPresentation }),
  });
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to update character presentation'));
  }

  return response.json();
}

export async function updateStudyNewWordsFirst(
  studyNewWordsFirst: boolean,
): Promise<{ studyNewWordsFirst: boolean }> {
  const response = await apiFetch(`${API_BASE}/api/learner-settings/study-new-words-first`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studyNewWordsFirst }),
  });
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to update new-word ordering'));
  }
  return response.json();
}

export async function updateSentenceCharacterPresentation(
  sentenceCharacterPresentation: SentenceCharacterPresentation,
): Promise<{ sentenceCharacterPresentation: SentenceCharacterPresentation }> {
  const response = await apiFetch(`${API_BASE}/api/learner-settings/sentence-character-presentation`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sentenceCharacterPresentation }),
  });
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to update sentence character presentation'));
  }
  return response.json();
}

// --- Diet profile (SPECS/diet-deck-distribution.md) --------------------------

export async function nudgeDiet(direction: 'easier' | 'harder'): Promise<{ changed: boolean }> {
  const response = await apiFetch(`${API_BASE}/api/diet/nudge`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ direction }),
  });
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to nudge the diet'));
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
    reinforcementSkipped?: boolean;
    sessionActionId: string;
    targetWordId: string;
    actionKind: 'recognition' | 'production';
    sampledSkillIds: Array<'recognition' | 'production'>;
    failureCount: number;
    terminalRating: 'hard' | 'good' | 'easy' | null;
  };
}): Promise<void> {
  const response = await apiFetch(`${API_BASE}/api/study-sessions/${encodeURIComponent(sessionId)}/accepted-review-attempt-batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ events, commitIntent }),
  }, {
    route: '/api/study-sessions/:sessionId/accepted-review-attempt-batch',
    sessionId,
    sessionActionId: commitIntent.sessionActionId,
    eventIds: events.map((event) => event.id),
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
  const response = await apiFetch(`${API_BASE}/api/study-sessions/${encodeURIComponent(sessionId)}/accepted-contrast-selection-attempt`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ event, commitIntent }),
  }, {
    route: '/api/study-sessions/:sessionId/accepted-contrast-selection-attempt',
    sessionId,
    sessionActionId: commitIntent.sessionActionId,
    eventIds: [event.id],
  });

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to record accepted contrast selection attempt'));
  }
}

export async function recordPureCueAssessment({
  sessionId,
  attemptId,
  snapshotId,
  sessionActionId,
  events,
  reinforcementSkipped,
}: {
  sessionId: string;
  attemptId: string;
  snapshotId: string;
  sessionActionId: string;
  events: PureCueAssessmentEvent[];
  reinforcementSkipped?: boolean;
}): Promise<void> {
  const response = await apiFetch(`${API_BASE}/api/study-sessions/${encodeURIComponent(sessionId)}/pure-cue-assessments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attemptId, snapshotId, sessionActionId, events, reinforcementSkipped }),
  }, {
    route: '/api/study-sessions/:sessionId/pure-cue-assessments',
    sessionId,
    sessionActionId,
    eventIds: events.map((event) => event.eventId),
  });
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to record pure cue assessment'));
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
}: {
  sessionId: string;
  sessionActionId: string;
  targetWordId: string;
  actionKind: 'production';
  sampledSkillIds: StudySkillId[];
  contentRef: StudyContentRef | null;
  managementAction: StudyManagementActionKind;
}): Promise<StudyEvent> {
  const response = await apiFetch(`${API_BASE}/api/study-sessions/${encodeURIComponent(sessionId)}/manage-study-action`, {
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
    }),
  });

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to record study management action'));
  }

  return response.json();
}

export type SharedContentReport = {
  reportId: string;
  publicationId: string;
  category: 'incorrect' | 'misleading' | 'unsafe' | 'other';
  note: string | null;
  createdAt: string;
  resolution: 'open' | 'quarantined' | 'dismissed';
  resolvedAt: string | null;
};

export async function reportSharedProductionCue({
  cueId,
  category,
  note = null,
}: {
  cueId: string;
  category: SharedContentReport['category'];
  note?: string | null;
}): Promise<SharedContentReport> {
  const response = await apiFetch(
    `${API_BASE}/api/shared-content/production-cues/${encodeURIComponent(cueId)}/reports`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, note }),
    },
  );
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to report shared content'));
  }
  return response.json();
}

export async function recordReviewSessionSummary({
  sessionId,
  completedAt,
  completedReviewActionCount,
  failedReviewActionCount,
  activeDurationMs,
  debriefInventory,
}: {
  sessionId: string;
  completedAt: string;
  completedReviewActionCount: number;
  failedReviewActionCount: number;
  activeDurationMs: number;
  debriefInventory?: SessionDebriefInventoryItem[];
}): Promise<void> {
  const response = await apiFetch(`${API_BASE}/api/review-session-summaries`, {
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
      ...(debriefInventory === undefined ? {} : { debriefInventory }),
    }),
  });

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to record review session summary'));
  }
}

export class NoQualifyingReflectionEvidenceError extends Error {}

export async function generateSessionReflection({
  sessionId,
  evidence,
}: {
  sessionId: string;
  evidence: unknown;
}): Promise<GenerateSessionReflectionResult> {
  const response = await apiFetch(
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
    const payload = await response.clone().json().catch(() => null) as { code?: string } | null;
    if (payload?.code === 'no_qualifying_evidence') throw new NoQualifyingReflectionEvidenceError('No qualifying reflection evidence.');
    throw new Error(await readApiErrorMessage(response, 'Failed to generate session reflection'));
  }

  return response.json();
}

export async function fetchReflectionArtifacts(
  review: 'open' | 'all',
): Promise<ReflectionArtifactSummaryDto[]> {
  const response = await apiFetch(
    `${API_BASE}/api/reflection-artifacts?review=${encodeURIComponent(review)}`,
  );
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to load reflection artifacts'));
  }

  const payload = await response.json() as { artifacts: ReflectionArtifactSummaryDto[] };
  return payload.artifacts;
}

export async function fetchReflectionGenerationRuns(): Promise<ReflectionGenerationRunsResponse> {
  const response = await apiFetch(`${API_BASE}/api/reflection-generation-runs`);
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to load reflection generation runs'));
  }
  const payload = await response.json() as ReflectionGenerationRunsResponse;
  return payload;
}

export async function retryReflectionGenerationRun(
  runId: string,
  model?: ReflectionModelChoice,
): Promise<GenerateSessionReflectionResult> {
  const response = await apiFetch(
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

export async function generateDeferredReflectionSecondOpinion(
  proposalIds: string[],
  model: ReflectionModelChoice,
  helpInboxIds: string[] = [],
): Promise<GenerateSessionReflectionResult> {
  const response = await apiFetch(`${API_BASE}/api/deferred-reflection-second-opinions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ proposalIds, helpInboxIds, model }),
  });
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to generate a second opinion'));
  }
  return response.json();
}

export async function fetchReflectionArtifactDetail(
  artifactId: string,
): Promise<ReflectionArtifactDetailDto> {
  const response = await apiFetch(
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
  const response = await apiFetch(
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
  const response = await apiFetch(
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

export async function upsertReflectionQuality(
  request: UpsertReflectionQualityRequest,
): Promise<ReflectionQualityItemTags> {
  const response = await apiFetch(`${API_BASE}/api/reflection-quality`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to save reflection quality'));
  }
  return response.json();
}

export async function clearReflectionQuality(
  request: ClearReflectionQualityRequest,
): Promise<{ cleared: boolean }> {
  const response = await apiFetch(`${API_BASE}/api/reflection-quality`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to clear reflection quality'));
  }
  return response.json();
}

export async function fetchReflectionQualityStats(): Promise<ReflectionQualityStatsDto> {
  const response = await apiFetch(`${API_BASE}/api/reflection-quality-stats`);
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to load reflection quality stats'));
  }
  return response.json();
}

export async function fetchAttentionBadges(): Promise<AttentionBadgesDto> {
  const response = await apiFetch(`${API_BASE}/api/attention-badges`);
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to load attention badges'));
  }
  return response.json();
}

export async function markReflectionInboxSeen(
  request: MarkReflectionInboxSeenRequest,
): Promise<{ marked: boolean; reflectionUnseenCount: number }> {
  const response = await apiFetch(`${API_BASE}/api/reflection-inbox-seen`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to mark reflection inbox item seen'));
  }
  return response.json();
}

export async function markWhatsNewSeen(request: {
  throughDate: string;
  mode: 'ensure' | 'seen';
}): Promise<{ whatsNewSeenThroughDate: string }> {
  const response = await apiFetch(`${API_BASE}/api/whats-new-seen`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to update whats-new seen date'));
  }
  return response.json();
}

export async function markFailedReflectionRunsSeen(request: {
  seenThroughAt?: string;
} = {}): Promise<{
  failedReflectionRunIds: string[];
  failedReflectionRunsSeenThroughAt: string;
}> {
  const response = await apiFetch(`${API_BASE}/api/failed-reflection-runs-seen`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to acknowledge failed reflection runs'));
  }
  return response.json();
}

export type AttentionBadgesDto = {
  reflectionUnseenCount: number;
  failedReflectionRunIds: string[];
  failedReflectionRunsSeenThroughAt: string | null;
  whatsNewSeenThroughDate: string | null;
  whatsNewSeenThroughSequence: number | null;
};

export async function fetchReflectionHelpInbox(): Promise<{ entries: ReflectionHelpInboxEntry[] }> {
  const response = await apiFetch(`${API_BASE}/api/reflection-help-inbox`);
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to load reflection help inbox'));
  }
  return response.json();
}

export async function markReflectionHelpInboxDone(
  request: MarkReflectionHelpInboxDoneRequest,
): Promise<{ done: boolean }> {
  const response = await apiFetch(`${API_BASE}/api/reflection-help-inbox`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to mark reflection help inbox item done'));
  }
  return response.json();
}

export async function deferReflectionHelpInboxItem(
  request: MarkReflectionHelpInboxDoneRequest,
): Promise<{ deferred: boolean }> {
  const response = await apiFetch(`${API_BASE}/api/reflection-help-inbox/defer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to defer reflection help item'));
  }
  return response.json();
}

export async function authorizeManualReflectionOperation(
  request: AuthorizeManualReflectionOperationRequest,
): Promise<unknown> {
  const response = await fetch(
    `${API_BASE}/api/reflection-artifacts/${encodeURIComponent(request.artifactId)}/items/${encodeURIComponent(request.itemId)}/manual-invocations`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation: request.operation }),
    },
  );
  if (!response.ok) {
    throw new Error(
      await readApiErrorMessage(response, 'Failed to authorize manual reflection operation'),
    );
  }
  return response.json();
}

export async function completeLearningSession(wordId: string, success: boolean): Promise<Word> {
  const response = await apiFetch(`${API_BASE}/api/words/${wordId}/complete-learning-session`, {
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
  const response = await apiFetch(`${API_BASE}/api/words/${wordId}/complete-unstudied-session`, {
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
  const response = await apiFetch(`${API_BASE}/api/words/${wordId}/dismiss`, {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to dismiss word from study'));
  }
}

export async function updateWordPersonalNotes(wordId: string, personalNotes: string): Promise<Word> {
  const response = await apiFetch(`${API_BASE}/api/words/${wordId}/personal-notes`, {
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
  const response = await apiFetch(`${API_BASE}/api/priority/unstudied`);
  if (!response.ok) {
    throw new Error('Failed to load unstudied priority words');
  }
  return response.json();
}

/** Add-time requiring stays in the API; the add-box checkbox is currently hidden. */
export async function addUnstudiedPriorityByHanzi(
  hanzi: string,
  requiredForNextSession = false,
  wordIds?: string[],
): Promise<AddPriorityByHanziResponse> {
  const response = await apiFetch(`${API_BASE}/api/priority/unstudied/add-by-hanzi`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      hanzi,
      requiredForNextSession,
      ...(wordIds === undefined ? {} : { wordIds }),
    }),
  });

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to add priority words'));
  }

  return response.json();
}

export async function updateWordUserPriority(wordId: string, patch: UserPriorityPatch): Promise<PriorityWord> {
  const response = await apiFetch(`${API_BASE}/api/words/${wordId}/user-priority`, {
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
  const response = await apiFetch(`${API_BASE}/api/words/${wordId}/meanings`);
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
  const response = await apiFetch(`${API_BASE}/api/words/${wordId}/meanings/${meaningId}`, {
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
    const payload = (await response.json()) as { error?: unknown; diagnosticId?: unknown };
    if (typeof payload.error === 'string' && payload.error.length > 0) {
      return typeof payload.diagnosticId === 'string' && payload.diagnosticId.length > 0
        ? `${payload.error} Diagnostic ID: ${payload.diagnosticId}`
        : payload.error;
    }
  } catch {
    // no-op: fallback below
  }

  return fallbackMessage;
}

export function getSessionPayloadCacheKey(): string {
  return JSON.stringify([getCurrentStudyDayKey(), clientIncidentStorageScope]);
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


export type PreparationFailure = {
  workId: string; wordId: string; hanzi: string; stage: 'bootstrap' | 'teaching' | 'review';
  status: 'queued' | 'running' | 'ready' | 'paused'; attemptCount: number;
  nextAttemptAt: string; lastError: string | null;
  attempts: Array<{ attemptId: string; startedAt: string; finishedAt: string | null;
    outcome: 'ready' | 'failed' | 'interrupted' | null; diagnostic: string | null }>;
};
export async function fetchPreparationFailures(): Promise<PreparationFailure[]> {
  const response = await apiFetch(`${API_BASE}/api/operator/word-preparation/failures`);
  if (!response.ok) throw new Error('Failed to load word preparation failures');
  return (await response.json() as { failures: PreparationFailure[] }).failures;
}
export async function retryPreparationWork(workId: string): Promise<void> {
  const response = await apiFetch(`${API_BASE}/api/operator/word-preparation/${encodeURIComponent(workId)}/retry`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  if (!response.ok) throw new Error('Failed to retry word preparation');
}

export async function recordContentQualityEncounter(
  target: import('../domain/content-quality').ContentQualityTarget,
  encounterId: string,
): Promise<import('../domain/content-quality').ContentQualityState> {
  const response = await apiFetch(`${API_BASE}/api/content-quality/encounters`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target, encounterId }),
  });
  if (!response.ok) throw new Error(await readApiErrorMessage(response, 'Could not load content feedback'));
  return response.json();
}

export async function saveContentQualityRating(
  contentKey: string,
  rating: import('../domain/content-quality').ContentQualityRating,
): Promise<import('../domain/content-quality').ContentQualityState> {
  const response = await apiFetch(`${API_BASE}/api/content-quality/ratings`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentKey, rating }),
  });
  if (!response.ok) throw new Error(await readApiErrorMessage(response, 'Could not save content feedback'));
  return response.json();
}

export async function fetchContentQualityStats(
  filters: import('../domain/content-quality').ContentQualityFilters = {},
): Promise<import('../domain/content-quality').ContentQualityAnalytics> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const response = await apiFetch(`${API_BASE}/api/operator/content-quality?${params}`);
  if (!response.ok) throw new Error(await readApiErrorMessage(response, 'Could not load content quality'));
  return response.json();
}

export async function updateDebriefInterests(debriefInterests: string): Promise<{ debriefInterests: string }> {
  const response = await apiFetch(`${API_BASE}/api/learner-settings/debrief-interests`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ debriefInterests }),
  });
  if (!response.ok) throw new Error(await readApiErrorMessage(response, 'Could not save interests'));
  return response.json();
}
export async function fetchLatestSessionDebrief(signal?: AbortSignal): Promise<SessionDebrief | null> {
  const response = await apiFetch(`${API_BASE}/api/session-debriefs/latest`, { signal });
  if (!response.ok) throw new Error(await readApiErrorMessage(response, 'Could not load session debrief'));
  return (await response.json() as { debrief: SessionDebrief | null }).debrief;
}
export async function fetchSessionDebrief(sessionId: string, signal?: AbortSignal): Promise<SessionDebrief | null> {
  const response = await apiFetch(`${API_BASE}/api/session-debriefs/${encodeURIComponent(sessionId)}`, { signal });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(await readApiErrorMessage(response, 'Could not load session debrief'));
  return (await response.json() as { debrief: SessionDebrief }).debrief;
}
export async function retrySessionDebrief(sessionId: string, signal?: AbortSignal): Promise<SessionDebrief> {
  const response = await apiFetch(`${API_BASE}/api/session-debriefs/${encodeURIComponent(sessionId)}/retry`, { method: 'POST', signal });
  if (!response.ok) throw new Error(await readApiErrorMessage(response, 'Could not retry session debrief'));
  return (await response.json() as { debrief: SessionDebrief }).debrief;
}

export async function fetchWhatsNew(): Promise<{ posts: WhatsNewPost[] }> {
  const response = await apiFetch(`${API_BASE}/api/whats-new`);
  if (!response.ok) throw new Error(await readApiErrorMessage(response, "Failed to load What's New"));
  return response.json();
}

export async function fetchWhatsNewAttention(): Promise<WhatsNewAttention> {
  const response = await apiFetch(`${API_BASE}/api/whats-new-attention`);
  if (!response.ok) throw new Error(await readApiErrorMessage(response, 'Failed to load update notifications'));
  return response.json();
}

export async function updateWhatsNewAttention(request: {
  postIds: string[]; kind: 'badge-seen' | 'read';
}): Promise<WhatsNewAttention> {
  const response = await apiFetch(`${API_BASE}/api/whats-new-attention`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error(await readApiErrorMessage(response, 'Failed to acknowledge updates'));
  return response.json();
}

export async function fetchOperatorWhatsNew(): Promise<{ posts: WhatsNewPost[] }> {
  const response = await apiFetch(`${API_BASE}/api/operator/whats-new`);
  if (!response.ok) throw new Error(await readApiErrorMessage(response, "Failed to load blog posts"));
  return response.json();
}

export async function saveOperatorWhatsNew(request: WhatsNewWriteRequest): Promise<WhatsNewPost> {
  const response = await apiFetch(`${API_BASE}/api/operator/whats-new`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error(await readApiErrorMessage(response,
    response.status === 409 ? 'This post changed elsewhere. Copy your edits, then reload the post before saving.' : 'Failed to save blog post'));
  return response.json();
}

export async function markWhatsNewSeenSequence(request: {
  throughSequence: number; mode: 'ensure' | 'seen';
}): Promise<{ whatsNewSeenThroughSequence: number }> {
  const response = await apiFetch(`${API_BASE}/api/whats-new-seen-sequence`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error(await readApiErrorMessage(response, 'Failed to acknowledge blog posts'));
  return response.json();
}
