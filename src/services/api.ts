import type { Word, ReviewItem, ReviewRating } from '../types';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:5174';

type BackendStatus = {
  status: string;
  time: string;
  mode: 'dev' | 'study';
  dataDir: string;
  dbPath: string;
  wordStatusCounts: Record<Word['status'], number>;
  dueReviewItemCount: number;
  pendingLearningWordCount: number;
  newWordIntroCount: number;
  hasSessionWork: boolean;
  learningCoverageDate: string;
};

export type SessionPayload = {
  items: ReviewItem[];
  words: Word[];
};

export type { BackendStatus };

export async function fetchWords(): Promise<Word[]> {
  const response = await fetch(`${API_BASE}/api/words`);
  if (!response.ok) {
    throw new Error('Failed to load words');
  }
  return response.json();
}

export async function fetchReviewItems(): Promise<ReviewItem[]> {
  const response = await fetch(`${API_BASE}/api/review-items`);
  if (!response.ok) {
    throw new Error('Failed to load review items');
  }
  return response.json();
}

export async function fetchSessionItems(): Promise<ReviewItem[]> {
  const response = await fetch(`${API_BASE}/api/session-items`);
  if (!response.ok) {
    throw new Error('Failed to load session items');
  }
  return response.json();
}

export async function fetchSessionPayload(): Promise<SessionPayload> {
  const response = await fetch(`${API_BASE}/api/session-payload`);
  if (!response.ok) {
    throw new Error('Failed to load session payload');
  }

  return response.json();
}

export async function fetchStatus(): Promise<BackendStatus> {
  const response = await fetch(`${API_BASE}/api/status`);
  if (!response.ok) {
    throw new Error('Failed to load backend status');
  }
  return response.json();
}

export async function completeReviewSession(
  reviewItemId: string,
  failureCount: number,
  terminalRating: 'hard' | 'good' | 'easy' | null,
): Promise<ReviewItem> {
  const response = await fetch(`${API_BASE}/api/review-items/${reviewItemId}/complete-session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ failureCount, terminalRating }),
  });

  if (!response.ok) {
    throw new Error('Failed to complete review session');
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
  const response = await fetch(`${API_BASE}/api/words/${wordId}/complete-unstudied-session`, {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error('Failed to complete unstudied session');
  }

  return response.json();
}
