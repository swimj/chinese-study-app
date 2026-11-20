import type {
  VocabularyIntakeCard,
  VocabularyIntakeCommandRequest,
  VocabularyIntakeHistory,
  VocabularyIntakeStreamEvent,
} from '../domain/vocabulary-intake';
import { readVocabularyIntakeStream } from './vocabulary-intake-stream';
import type { ServiceBannerRequest } from '../domain/service-banner';
import type { SenseContentReconciliationWorkspace, SenseContentReconciliationSave } from '../domain/sense-content-reconciliation';
import type { StudyIntroductionOrder } from '../domain/introduction-order';
import type { WhatsNewPost, WhatsNewWriteRequest } from '../domain/whats-new';
import type { WhatsNewAttention } from '../domain/whats-new-attention';
import type { ModelInvocationRow } from '../domain/model-invocations';
import type { SessionDebrief } from '../domain/session-debrief';
import type { ContentReactionInput, ContentReactionState, ContentReactionSummary, SavedCollection } from '../domain/content-reactions';
import type { PriorityWord, ReviewFailureRateDay, SessionActiveTimeMetrics, Word } from '../types';
import type { CharacterPresentation, SentenceCharacterPresentation } from '../domain/card-characters';
import type { MarkReflectionInboxSeenRequest } from '../domain/reflection';
import type {
  ContentDiagnosticKind,
  ContentDiagnosticsResponse,
} from '../domain/content-diagnostics';
import type { MyWordsView } from '../domain/my-words';
import type { ClientTransportIncidentContext } from './client-incident-diagnostics';
import type {
  IntroductionDraft,
  IntroductionLabStatus,
  IntroductionLexicalInput,
} from '../domain/word-content/lab';
import type { TeachingPackage, WordContentDocument } from '../domain/word-content/types';
import {
  captureClientTransportFailure,
  readBrowserStorage,
  readPendingClientTransportIncidents,
  removeUploadedClientTransportIncidents,
} from './client-incident-diagnostics';

const API_BASE = import.meta.env?.VITE_API_BASE ?? (import.meta.env?.DEV ? 'http://localhost:5174' : '');
const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'unknown';

type ApiAuthenticationTokenProvider = () => Promise<string | null>;

let apiAuthenticationTokenProvider: ApiAuthenticationTokenProvider | null = null;
let clientIncidentStorageScope: string | null = import.meta.env?.VITE_AUTH_MODE === 'clerk'
  ? null
  : 'trusted-local';
let clientIncidentUpload: Promise<void> | null = null;
let authenticationGeneration = 0;
const serviceAccessDeniedListeners = new Set<() => void>();

export function subscribeServiceAccessDenied(listener: () => void): () => void {
  serviceAccessDeniedListeners.add(listener);
  return () => { serviceAccessDeniedListeners.delete(listener); };
}

export async function fetchServiceAccess(signal?: AbortSignal): Promise<{ allowed: boolean }> {
  const response = await apiFetch(`${API_BASE}/api/service-access`, { signal });
  if (!response.ok) throw new Error('Could not check service availability.');
  const body: unknown = await response.json();
  if (!body || typeof body !== 'object' || !('allowed' in body) || typeof body.allowed !== 'boolean') {
    throw new Error('Invalid service availability response.');
  }
  return { allowed: body.allowed };
}

export function setApiAuthenticationTokenProvider(provider: ApiAuthenticationTokenProvider | null): void {
  apiAuthenticationTokenProvider = provider;
}

export function setClientIncidentStorageScope(scope: string | null): void {
  if (clientIncidentStorageScope !== scope) authenticationGeneration += 1;
  clientIncidentStorageScope = scope;
}

async function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  incidentContext?: ClientTransportIncidentContext,
): Promise<Response> {
  const startedAtMs = Date.now();
  const requestAuthenticationGeneration = authenticationGeneration;
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
    const response = await fetch(input, { ...init, headers });
    if (response.status === 503) {
      const body: unknown = await response.clone().json().catch(() => null);
      if (requestAuthenticationGeneration === authenticationGeneration
        && body && typeof body === 'object' && 'code' in body && body.code === 'OPERATOR_ONLY') {
        for (const listener of serviceAccessDeniedListeners) listener();
      }
    }
    return response;
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
  kickoffAt?: string;
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
  studyIntroductionOrder: StudyIntroductionOrder;
  studyIntroductionSpacing: number;
  /** The learner's rough sense of how much a day holds; read by timed sessions. */
  dailyStudyMinutes: import('../domain/timed-session').DailyStudyMinutes;
  /** New sessions use the timed daily paradigm. */
  timedSessions: boolean;
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
  practiceCompleted: number;
  reviewCorrect: number;
  reviewWrong: number;
  proposalsAccepted: number;
  meanStashSize: number | null;
  sessionActiveMs: number;
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

export async function fetchStatus(): Promise<BackendStatus> {
  const studyDayKey = getCurrentStudyDayKey();
  const response = await apiFetch(`${API_BASE}/api/status?studyDayKey=${encodeURIComponent(studyDayKey)}`);
  if (!response.ok) {
    throw new Error('Failed to load backend status');
  }
  return response.json();
}

export type OperatorTeachingSetRow = {
  wordId: string;
  hanzi: string;
  setKey: string;
  senseCount: number | null;
  packageCount: number;
  invocationCount: number;
  recordedCostUsd: number | null;
  unpricedInvocationCount: number;
};

export async function fetchOperatorTeachingSets(signal: AbortSignal): Promise<{ sets: OperatorTeachingSetRow[] }> {
  return apiRequest('/api/operator/teaching-sets', { signal });
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

export async function fetchContentSharingDigest(weekStart?: string): Promise<import('../domain/content-sharing').ContentSharingDigest> {
  const params = new URLSearchParams();
  if (weekStart !== undefined) params.set('weekStart', weekStart);
  const response = await apiFetch(`${API_BASE}/api/operator/content-sharing?${params}`);
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to load content sharing'));
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

export async function updateDailyStudyMinutes(dailyStudyMinutes: import('../domain/timed-session').DailyStudyMinutes): Promise<{ dailyStudyMinutes: import('../domain/timed-session').DailyStudyMinutes }> {
  const response = await apiFetch(`${API_BASE}/api/learner-settings/daily-study-minutes`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dailyStudyMinutes }),
  });
  if (!response.ok) throw new Error(await readApiErrorMessage(response, 'Failed to update daily study time'));
  return response.json();
}

export async function updateStudyIntroductionOrder(
  studyIntroductionOrder: StudyIntroductionOrder,
  studyIntroductionSpacing: number,
): Promise<{ studyIntroductionOrder: StudyIntroductionOrder; studyIntroductionSpacing: number }> {
  const response = await apiFetch(`${API_BASE}/api/learner-settings/study-introduction-order`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studyIntroductionOrder, studyIntroductionSpacing }),
  });
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to update introduction ordering'));
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
    throw new Error(await readApiErrorMessage(response, 'Failed to mark feedback inbox item seen'));
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
    throw new Error(await readApiErrorMessage(response, 'Failed to acknowledge failed feedback runs'));
  }
  return response.json();
}

export type AttentionBadgesDto = {
  reflectionGenerating: boolean;
  reflectionUnseenCount: number;
  failedReflectionRunIds: string[];
  failedReflectionRunsSeenThroughAt: string | null;
  whatsNewSeenThroughDate: string | null;
  whatsNewSeenThroughSequence: number | null;
};

export async function fetchUnstudiedPriorityWords(signal?: AbortSignal): Promise<PriorityWordsResponse> {
  const response = await apiFetch(`${API_BASE}/api/priority/unstudied`, { signal });
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

export async function fetchContentQualityRatingLedger(): Promise<import('../domain/content-quality').ContentQualityRatingLedger> {
  const response = await apiFetch(`${API_BASE}/api/operator/content-quality/ratings`);
  if (!response.ok) throw new Error(await readApiErrorMessage(response, 'Could not load content quality ratings'));
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

export async function fetchContentReactions(signal?: AbortSignal): Promise<ContentReactionState[]> {
  const response = await apiFetch(`${API_BASE}/api/content-reactions`, { signal });
  if (!response.ok) throw new Error(await readApiErrorMessage(response, 'Could not load saved items'));
  return (await response.json() as { reactions: ContentReactionState[] }).reactions;
}
/** Replace one subject's reaction; `reaction: null` clears it. */
export async function saveContentReaction(input: ContentReactionInput): Promise<ContentReactionState | null> {
  const response = await apiFetch(`${API_BASE}/api/content-reactions`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await readApiErrorMessage(response, 'Could not save'));
  return (await response.json() as { reaction: ContentReactionState | null }).reaction;
}
export async function fetchSavedCollection(signal?: AbortSignal): Promise<SavedCollection> {
  const response = await apiFetch(`${API_BASE}/api/saved-collection`, { signal });
  if (!response.ok) throw new Error(await readApiErrorMessage(response, 'Could not load saved items'));
  return response.json() as Promise<SavedCollection>;
}
export async function fetchOperatorContentReactions(): Promise<ContentReactionSummary> {
  const response = await apiFetch(`${API_BASE}/api/operator/content-reactions`);
  if (!response.ok) throw new Error(await readApiErrorMessage(response, 'Failed to load reactions'));
  return response.json() as Promise<ContentReactionSummary>;
}

export async function fetchWhatsNew(): Promise<{ posts: WhatsNewPost[] }> {
  const response = await apiFetch(`${API_BASE}/api/whats-new`);
  if (!response.ok) throw new Error(await readApiErrorMessage(response, 'Failed to load What’s new'));
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

export async function fetchOperatorServiceBanner(): Promise<{ serviceBanner: ServiceBanner | null }> {
  const response = await apiFetch(`${API_BASE}/api/operator/service-banner`);
  if (!response.ok) throw new Error(await readApiErrorMessage(response, 'Failed to load service banner'));
  return response.json();
}

export async function saveOperatorServiceBanner(request: ServiceBannerRequest): Promise<{ serviceBanner: ServiceBanner }> {
  const response = await apiFetch(`${API_BASE}/api/operator/service-banner`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error(await readApiErrorMessage(response, 'Failed to save service banner'));
  return response.json();
}

export async function clearOperatorServiceBanner(): Promise<{ status: 'cleared' | 'noop' }> {
  const response = await apiFetch(`${API_BASE}/api/operator/service-banner`, { method: 'DELETE' });
  if (!response.ok) throw new Error(await readApiErrorMessage(response, 'Failed to clear service banner'));
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

// Vocabulary commands ship incrementally; finalization freezes the acknowledged boundary.
async function vocabularyRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await apiFetch(`${API_BASE}/api/vocabulary${path}`, body === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await readApiErrorMessage(response, 'Could not save vocabulary work'));
  return response.json() as Promise<T>;
}
export const startVocabularySession = () => vocabularyRequest<import('../domain/vocabulary-study-api').VocabularyStudy>('/sessions', {timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'});
export const fetchVocabularyStudy = (id: string) => vocabularyRequest<import('../domain/vocabulary-study-api').VocabularyStudy>(`/sessions/${encodeURIComponent(id)}`);
export const nextVocabularyStudy = (id: string, clientActionId: string, options: {wordId?: string; another?: boolean; activeDurationMs?: number} = {}) =>
  vocabularyRequest<import('../domain/vocabulary-study-api').VocabularyStudy>(`/sessions/${encodeURIComponent(id)}/next`, {clientActionId,...options});
export const commandVocabularyStudy = (id: string, clientActionId: string, command: import('../domain/vocabulary-study-api').VocabularyStudyCommand) =>
  vocabularyRequest<import('../domain/vocabulary-study-api').VocabularyStudy>(`/sessions/${encodeURIComponent(id)}/commands`, {clientActionId,command});
export const stageVocabularyCompletion = (id: string, throughSequence: number, activeDurationMs?: number) => vocabularyRequest<import('../domain/vocabulary-session-api').VocabularySessionCompletion>(`/sessions/${encodeURIComponent(id)}/completion`, {throughSequence,...(activeDurationMs === undefined ? {} : {activeDurationMs})});
export const fetchVocabularyCompletion = (id: string) => vocabularyRequest<import('../domain/vocabulary-session-api').VocabularySessionCompletion | null>(`/sessions/${encodeURIComponent(id)}/completion`);
export const cancelVocabularyCompletion = (id: string, completionId: string) => vocabularyRequest<import('../domain/vocabulary-session-api').VocabularySessionCompletion>(`/sessions/${encodeURIComponent(id)}/completion/cancel`, {completionId});
export const closeVocabularyCompletion = (id: string, completionId: string) => vocabularyRequest<import('../domain/vocabulary-session-api').VocabularySessionCompletion>(`/sessions/${encodeURIComponent(id)}/completion/close`, {completionId});
export const fetchCurrentVocabularyCompletion = () => vocabularyRequest<import('../domain/vocabulary-study-api').VocabularyStudy | null>('/completion/current');
export const saveVocabularySessionNote = (id: string, note: string) => vocabularyRequest<{note: string | null}>(`/sessions/${encodeURIComponent(id)}/note`, {note});
export const dismissVocabularyWord = (id: string) => vocabularyRequest<unknown>(`/words/${encodeURIComponent(id)}/dismiss`, {});
export type VocabularyWordRow = import('../domain/vocabulary-study-api').VocabularyStudyWord & {mode: import('../domain/vocabulary-session').VocabularyWordMode; inStash: number; stateVersion: number; nextEligibleAt: string | null; refreshUntil: string | null};
export const fetchVocabularyWords = () => vocabularyRequest<{words:VocabularyWordRow[]}>('/words');
export const setVocabularyWordMode = (id: string, mode: import('../domain/vocabulary-session').VocabularyWordMode, expectedVersion: number) => vocabularyRequest<unknown>(`/words/${encodeURIComponent(id)}/mode`, {mode,expectedVersion});
export const refreshVocabularyWord = (id: string) => vocabularyRequest<unknown>(`/words/${encodeURIComponent(id)}/refresh`, {});

/** HTTP failure from the shared feature transport. */
export class ApiRequestError extends Error { constructor(message:string,readonly status:number){super(message);} }
/** Shared authenticated transport for feature-specific API contracts. */
export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(`${API_BASE}${path}`, init);
  if (!response.ok) throw new ApiRequestError(await readApiErrorMessage(response, 'The request could not be completed.'),response.status);
  return response.json() as Promise<T>;
}
const vocabularyIntakePath = '/api/vocabulary/intake';
const vocabularyIntakeCardPath = (id: string) => `${vocabularyIntakePath}/cards/${encodeURIComponent(id)}`;

export function fetchVocabularyIntakeHistory(before: string | null, signal: AbortSignal) {
  const query = before ? `?before=${encodeURIComponent(before)}` : '';
  return apiRequest<VocabularyIntakeHistory>(`${vocabularyIntakePath}${query}`, { signal });
}

export function fetchVocabularyIntakeCard(id: string, signal: AbortSignal) {
  return apiRequest<VocabularyIntakeCard>(vocabularyIntakeCardPath(id), { signal });
}

export function fetchOutstandingVocabularyIntakeCards(signal: AbortSignal) {
  return apiRequest<{ cards: VocabularyIntakeCard[] }>(`${vocabularyIntakePath}/cards?outstanding=true`, { signal });
}

export function fetchVocabularyIntakeAttention(signal: AbortSignal) {
  return apiRequest<{ count: number }>(`${vocabularyIntakePath}/attention`, { signal });
}

export function commandVocabularyIntakeCard(id: string, request: VocabularyIntakeCommandRequest, signal: AbortSignal) {
  return apiRequest<VocabularyIntakeCard>(`${vocabularyIntakeCardPath(id)}/commands`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal,
  });
}

export async function streamVocabularyIntakeTurn(
  request: { clientTurnId: string; text: string },
  onEvent: (event: VocabularyIntakeStreamEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await apiFetch(`${API_BASE}${vocabularyIntakePath}/turns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(request),
    signal,
  });
  if (!response.ok) {
    throw new ApiRequestError(await readApiErrorMessage(response, 'Could not send the message.'), response.status);
  }
  if (!response.body) throw new Error('The reply was interrupted. Try again.');
  await readVocabularyIntakeStream(response.body, onEvent);
}

export type VocabularyFeedbackMessage = {messageId:string; caseId:string; subjectLabel?:string; body: import('../domain/vocabulary-content').VocabularyJson; createdAt:string; seenAt:string|null; dismissedAt:string|null};
export type VocabularyFeedbackJob = {jobId:string; caseId:string; subjectLabel:string; status:'queued'|'running'|'failed'; createdAt:string; error:string|null};
export type VocabularyFeedbackInbox = {messages:VocabularyFeedbackMessage[]; failures:{jobId:string; error:string}[]; jobs?:VocabularyFeedbackJob[]};
export const fetchVocabularyFeedback = () => vocabularyRequest<VocabularyFeedbackInbox>('/feedback');
export const markVocabularyFeedbackSeen = (id:string) => vocabularyRequest<unknown>(`/feedback/${encodeURIComponent(id)}/seen`, {});
export const dismissVocabularyFeedback = (id:string) => vocabularyRequest<unknown>(`/feedback/${encodeURIComponent(id)}/dismiss`, {});
export const restoreVocabularyFeedback = (id:string) => vocabularyRequest<unknown>(`/feedback/${encodeURIComponent(id)}/restore`, {});
export const retryVocabularyFeedback = (id:string) => vocabularyRequest<unknown>(`/feedback/jobs/${encodeURIComponent(id)}/retry`, {});

export const fetchVocabularyAttention = () => vocabularyRequest<{unseenCount:number;hasFailure:boolean;generating:boolean}>('/feedback/attention');

export const fetchVocabularyProgress = () => vocabularyRequest<import('../domain/vocabulary-progress').VocabularyProgress>(`/progress?timeZone=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')}`);
export const fetchVocabularyStudyDays = () => vocabularyRequest<import('../domain/vocabulary-statistics').VocabularyStudyDays>(`/study-days?timeZone=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')}`);

export async function fetchVocabularyWordCollection(view: MyWordsView, query: string, offset=0, signal?:AbortSignal,
  modes:readonly import('../domain/vocabulary-session').VocabularyWordMode[]=[], recentLapses=false):Promise<import('../domain/vocabulary-words').VocabularyWordsCollection> {
  const params=new URLSearchParams({view,q:query,offset:String(offset),limit:'50',mode:modes.join(','),lapses:recentLapses?'1':'0'});
  return apiRequest(`/api/vocabulary/word-collection?${params}`,{signal});
}

export const enrollVocabularyWord = (id:string) => vocabularyRequest<unknown>(`/words/${encodeURIComponent(id)}`, {});

const reconciliationPath = (wordId: string) => `/api/operator/vocabulary/reconciliation/${encodeURIComponent(wordId)}`;
export const fetchSenseReconciliation = (wordId: string) => apiRequest<SenseContentReconciliationWorkspace>(reconciliationPath(wordId));
export const saveSenseReconciliation = (wordId: string, input: SenseContentReconciliationSave) =>
  apiRequest<SenseContentReconciliationWorkspace>(reconciliationPath(wordId), {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
export const applySenseReconciliation = (wordId: string, input: {expectedVersion:number;planFingerprint:string}) =>
  apiRequest<SenseContentReconciliationWorkspace>(`${reconciliationPath(wordId)}/apply`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
export const retrySenseReconciliation = (wordId: string) =>
  apiRequest<SenseContentReconciliationWorkspace>(`${reconciliationPath(wordId)}/retry`, {method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});

export async function fetchRepertoireQuality(input: {
  view: import('../domain/repertoire-quality').RepertoireQualityView;
  page: number;
  model?: import('../domain/repertoire-quality').RepertoireModel;
}, signal?: AbortSignal): Promise<import('../domain/repertoire-quality').RepertoireQualityPage> {
  const query = new URLSearchParams({ view: input.view, page: String(input.page) });
  if (input.model) query.set('model', input.model);
  const response = await apiFetch(`${API_BASE}/api/operator/repertoire-quality?${query}`, { signal });
  if (!response.ok) throw new Error('Could not load repertoire quality.');
  return response.json();
}

export async function fetchRepertoireQualityDetail(
  view: import('../domain/repertoire-quality').RepertoireQualityView, id: string, signal?: AbortSignal,
): Promise<import('../domain/repertoire-quality').RepertoireQualityDetail> {
  const query = new URLSearchParams({ view, id });
  const response = await apiFetch(`${API_BASE}/api/operator/repertoire-quality/detail?${query}`, { signal });
  if (!response.ok) throw new Error('Could not load cue history.');
  return response.json();
}
