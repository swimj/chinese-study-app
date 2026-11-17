import { createHash } from 'node:crypto';
import { selectPureCuesForSession } from '../../src/domain/pure-cues.ts';
import { isOverduePressing, timedTargetKey } from '../../src/domain/timed-session.ts';
import { requireLearnerId } from '../db/learner-context.ts';
import { composeVocabularyNewWords, readVocabularyLearningWordIds } from './composition.ts';
import { canUseVocabularyReviewObjective, readVocabularyDueReviewObjectives, type VocabularyDueReviewObjective,
  type VocabularyReviewSkill } from './review-selection.ts';
import { readVocabularyPureCueStreams, vocabularyPureCueRandom, vocabularyPureCueUsability, type VocabularyPureCueCandidate } from './pure-cue-serving.ts';

export type TimedReviewEntry = { kind: 'word' | 'pure_cue'; id: string };
export type TimedAdmission = {
  newWordIds: string[]; learningWordIds: string[];
  reviewWords: { wordId: string; mode: 'practice' | 'maintain'; selectedSkill: VocabularyReviewSkill }[];
  /** Due rechecks first, then admitted review words and cues in session order. */
  /** Session payload assembly loads each admitted cue's content once. */
  reviewOrder: TimedReviewEntry[];
  /** Admitted review words and fragile cues overdue by a full interval (timed-session keys). */
  pressingKeys: string[];
  preparationPending: boolean;
};
const splice = (seed: string, id: string, length: number) =>
  parseInt(createHash('sha256').update(`${seed}/${id}`).digest('hex').slice(0, 8), 16) % (length + 1);

/**
 * Timed Start admission. Each stream is capped on its own terms and no stream
 * takes capacity from another:
 * - new words: the day's remaining new-word quota;
 * - learning: the whole due Solidify set;
 * - review words and fragile cues together: `reviewBound` items in one urgency
 *   order (a word at its most urgent due objective, a cue by how far past its due
 *   date it is relative to its interval), so items overdue by a full interval lead;
 * - strong cues: today's roll, with slots scaled to the admitted review count;
 * - rechecks: every due recheck, ahead of the rest.
 * Review and cue candidates come from narrow reads; content checks run while a
 * stream is walked and stop once its cap is filled, so a candidate that fails a
 * check is passed over and the next in rank takes its place.
 */
export function admitTimedVocabularyStudy(input: {
  now: string; timeZone?: string; sessionSeed: string; reviewBound: number;
  teachingReady: (wordId: string) => boolean; isLearningContentUsable: (wordId: string) => boolean;
  isReviewContentUsable: (wordId: string, skillId: VocabularyReviewSkill) => boolean;
}): TimedAdmission {
  if (!Number.isSafeInteger(input.reviewBound) || input.reviewBound <= 0) throw new Error('Timed admission requires a positive review bound');
  const { now, sessionSeed } = input;
  const fresh = composeVocabularyNewWords({ now, timeZone: input.timeZone, teachingReady: input.teachingReady });
  const learningWordIds = readVocabularyLearningWordIds(now, input.isLearningContentUsable);

  // One ranking: each review word at its most urgent due objective, each fragile cue by its own urgency.
  const objectives = new Map<string, VocabularyDueReviewObjective[]>();
  for (const objective of readVocabularyDueReviewObjectives(now)) {
    const list = objectives.get(objective.wordId); if (list) list.push(objective); else objectives.set(objective.wordId, [objective]);
  }
  const streams = readVocabularyPureCueStreams(now);
  type Ranked = TimedReviewEntry & { urgency: number; pressing: boolean };
  const words: Ranked[] = [...objectives].map(([id, list]) => ({ kind: 'word', id, urgency: list[0]!.urgency,
    pressing: list.some((objective) => isOverduePressing(objective.urgency)) }));
  const cues: Ranked[] = streams.fragile.map((cue): Ranked => {
    const urgency = pureCueUrgency(cue, now);
    return { kind: 'pure_cue', id: cue.id, urgency, pressing: cue.lastStudiedAt !== null && isOverduePressing(urgency) };
  }).sort((a, b) => b.urgency - a.urgency || a.id.localeCompare(b.id));
  // Merge keeps the review ranking's own order (and its tie rules) among words; a cue goes ahead of less urgent words.
  const order: Ranked[] = [];
  for (let w = 0, c = 0; w < words.length || c < cues.length;) {
    order.push(c >= cues.length || (w < words.length && words[w]!.urgency >= cues[c]!.urgency) ? words[w++]! : cues[c++]!);
  }

  const cueUsable = vocabularyPureCueUsability();
  const admitted: TimedReviewEntry[] = []; const reviewWords: TimedAdmission['reviewWords'] = []; const pressingKeys: string[] = [];
  for (const entry of order) {
    if (admitted.length >= input.reviewBound) break;
    if (entry.kind === 'word') {
      const objective = objectives.get(entry.id)!.find((candidate) => canUseVocabularyReviewObjective(candidate, input.isReviewContentUsable));
      if (!objective) continue;
      reviewWords.push({ wordId: objective.wordId, mode: objective.mode, selectedSkill: objective.skillId });
    } else if (!cueUsable(entry.id)) continue;
    admitted.push({ kind: entry.kind, id: entry.id });
    if (entry.pressing) pressingKeys.push(timedTargetKey(entry.kind, entry.id));
  }
  const rechecks = streams.rechecks.filter((cue) => cueUsable(cue.id)).map((cue) => cue.id);
  const strong = selectPureCuesForSession({ learnerId: requireLearnerId(), cues: streams.strong.filter((cue) => cueUsable(cue.id)),
    ordinaryReviewCount: admitted.length, now, random: vocabularyPureCueRandom(sessionSeed) }).selected.map((cue) => cue.id);
  const sequence = [...admitted];
  for (const id of strong) sequence.splice(splice(sessionSeed, id, sequence.length), 0, { kind: 'pure_cue', id });
  return { newWordIds: fresh.newWordIds, learningWordIds, reviewWords,
    reviewOrder: [...rechecks.map((id) => ({ kind: 'pure_cue' as const, id })), ...sequence], pressingKeys,
    preparationPending: fresh.preparationPending };
}

/**
 * A due fragile cue's urgency on the word scale: how far past its due date it is,
 * in intervals, plus one. For a cue whose due date is last study plus interval
 * this equals time since study over the interval; a reset or compensation that
 * moved the due date later is respected.
 */
function pureCueUrgency(cue: VocabularyPureCueCandidate, now: string): number {
  if (!(cue.intervalHours > 0)) throw new Error('Pure cue urgency requires a positive interval');
  return (Date.parse(now) - Date.parse(cue.nextDueAt)) / 3_600_000 / cue.intervalHours + 1;
}
