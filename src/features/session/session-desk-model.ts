import type { ReviewRating } from '../../types';
import type { BucketSessionCommitIntent, BucketSessionState } from '../../lib/session-state';
import { getBucketSchedulerCandidateWordIds } from '../../lib/session-scheduler';

export type SessionDeskOutcome = 'done' | 'ongoing' | 'wrong' | 'contrast-miss';

/** Motion follows the existing covering decision, never a second learning policy. */
export function getSessionDeskOutcome(rating: ReviewRating, commit: BucketSessionCommitIntent): SessionDeskOutcome {
  if (rating === 'forgot') return commit.type === 'commit-contrast-selection-action-session' ? 'contrast-miss' : 'wrong';
  return commit.type === 'none' ? 'ongoing' : 'done';
}

export function getSessionDeskUnitKey(bucket: 'review' | 'learning' | 'unstudied', actionId: string, wordId?: string): string {
  if (bucket === 'review') return `review:${actionId}`;
  if (!wordId) throw new Error('Session desk invariant violated: word unit has no word id.');
  return `${bucket}:${wordId}`;
}

/** Repeated failures are one pending unit; ongoing successes retain their place. */
export function updateSessionDeskAgainKeys(keys: readonly string[], key: string, outcome: SessionDeskOutcome): string[] {
  if (outcome === 'wrong') return [...new Set([...keys, key])];
  if (outcome === 'done' || outcome === 'contrast-miss') return keys.filter((value) => value !== key);
  return [...keys];
}

/** Dismissal, drain, and management may remove units without a card rating. */
export function retainSessionDeskAgainKeys(keys: readonly string[], state: BucketSessionState): string[] {
  const remaining = new Set([
    ...state.scheduler.reviewQueue.map((item) => getSessionDeskUnitKey('review', item.sessionActionId)),
    ...getBucketSchedulerCandidateWordIds(state.scheduler, 'learning', state.progress).map((id) => getSessionDeskUnitKey('learning', '', id)),
    ...getBucketSchedulerCandidateWordIds(state.scheduler, 'unstudied', state.progress).map((id) => getSessionDeskUnitKey('unstudied', '', id)),
  ]);
  return keys.filter((key) => remaining.has(key));
}
