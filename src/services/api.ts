import type { Word, ReviewItem } from '../types';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:5174';

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

export async function fetchStatus(): Promise<{ status: string; time: string }> {
  const response = await fetch(`${API_BASE}/api/status`);
  if (!response.ok) {
    throw new Error('Failed to load backend status');
  }
  return response.json();
}
