import type {
  PriorityWord,
  ProductionMistakeCandidate,
  ReviewFailureRateDay,
  Word,
  WordMeaning,
  ReviewRating,
} from '../types';
import type {
  ContrastCluster,
  ContrastClusterMember,
  ContrastPrompt,
  SessionStudyItemBuckets,
  StudyAttemptEvent,
  StudyContentRef,
  StudyManagementActionKind,
  StudySkillId,
  StudyEvent,
} from '../domain/study-actions';

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
  dailyNewWordLimit: number;
  learningCoverageDate: string;
};

export type SessionPayload = {
  buckets: SessionStudyItemBuckets;
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
  members: Array<ContrastClusterMember & { word: Word }>;
  prompts: ContrastPrompt[];
};

type ContrastClustersResponse = {
  clusters: ContrastClusterContent[];
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

export async function fetchContrastClusters(): Promise<ContrastClustersResponse> {
  const response = await fetch(`${API_BASE}/api/contrast-clusters`);
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to load contrast clusters'));
  }

  return response.json();
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
}: {
  sessionId: string;
  completedAt: string;
  completedReviewActionCount: number;
  failedReviewActionCount: number;
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
    }),
  });

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to record review session summary'));
  }
}

export async function captureProductionMistakeCandidate(
  targetWordId: string,
  attemptedHanzi: string,
  note = '',
): Promise<ProductionMistakeCandidate> {
  const response = await fetch(`${API_BASE}/api/production-mistake-candidates`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ targetWordId, attemptedHanzi, note }),
  });

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to capture production mistake candidate'));
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
