import { getDb } from './connection.ts';
import { requireLearnerId } from './learner-context.ts';
import { nextReviewSchedule } from './review-policy.ts';

type RecognitionSchedule = {
  interval_hours: number; ease_factor: number; enabled: number;
  last_studied_at: string; next_due_at: string | null;
};

/** Called inside vocabulary finalization's transaction. Keeps recognition on its existing scheduler. */
export function applyVocabularyRecognition(wordId: string, rejectedCount: number, now: string): {
  before: RecognitionSchedule | null; after: RecognitionSchedule;
} {
  if (!getDb().isTransaction) throw new Error('Recognition outcome requires the session closure transaction');
  const learnerId = requireLearnerId();
  const before = getDb().prepare(`SELECT interval_hours,ease_factor,enabled,last_studied_at,next_due_at
    FROM learner_owned_word_skill_state WHERE learner_id = ? AND word_id = ? AND skill_id = 'recognition'`)
    .get(learnerId, wordId) as RecognitionSchedule | undefined;
  const previous = before ?? { interval_hours: 24, ease_factor: 2.5, enabled: 1, last_studied_at: now, next_due_at: null };
  const scheduled = nextReviewSchedule({ intervalHours: previous.interval_hours, easeFactor: previous.ease_factor },
    { failureCount: rejectedCount, successful: Boolean(before) });
  const interval = scheduled.intervalHours;
  const after: RecognitionSchedule = {
    ...previous, interval_hours: interval,
    ease_factor: scheduled.easeFactor,
    last_studied_at: now, next_due_at: new Date(Date.parse(now) + interval * 3_600_000).toISOString(),
  };
  getDb().prepare(`INSERT INTO learner_owned_word_skill_state
    (learner_id,word_id,skill_id,enabled,interval_hours,last_studied_at,next_due_at,ease_factor)
    VALUES (?,?,'recognition',?,?,?,?,?) ON CONFLICT(learner_id,word_id,skill_id) DO UPDATE SET
      interval_hours=excluded.interval_hours,last_studied_at=excluded.last_studied_at,
      next_due_at=excluded.next_due_at,ease_factor=excluded.ease_factor`)
    .run(learnerId,wordId,after.enabled,after.interval_hours,after.last_studied_at,after.next_due_at,after.ease_factor);
  return { before: before ? { ...before } : null, after };
}
