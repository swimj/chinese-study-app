import type { Word, ReviewItem, ReviewRating } from '../types';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:5174';

type BackendStatus = {
  status: string;
  time: string;
  mode: 'dev' | 'study';
  dataDir: string;
  dbPath: string;
};

export type { BackendStatus };

export async function fetchWords(): Promise<Word[]> {
  const response = await fetch(`${API_BASE}/api/words`);
  if (!response.ok) {
    throw new Error('Failed to load words');
  }
  return response.json();
}

export async function fetchReviewItems(dueOnly = false): Promise<ReviewItem[]> {
  const query = dueOnly ? '?due=true' : '';
  const response = await fetch(`${API_BASE}/api/review-items${query}`);
  if (!response.ok) {
    throw new Error('Failed to load review items');
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

export async function submitReviewAnswer(reviewItemId: string, rating: ReviewRating): Promise<ReviewItem> {
  const response = await fetch(`${API_BASE}/api/review-items/${reviewItemId}/answer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ rating }),
  });

  if (!response.ok) {
    throw new Error('Failed to submit review answer');
  }

  return response.json();
}
