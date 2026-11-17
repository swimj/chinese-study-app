import { createHash } from 'node:crypto';
import { selectPureCuesForSession } from '../../src/domain/pure-cues.ts';
import { PRESSING_SKIP_DAYS, timedTargetKey } from '../../src/domain/timed-session.ts';
import { requireLearnerId } from '../db/learner-context.ts';
import { composeVocabularyNewWords, readVocabularyLearningWordIds } from './composition.ts';
import { canUseVocabularyReviewObjective, readVocabularyDueReviewObjectives, type VocabularyDueReviewObjective,
  type VocabularyReviewSkill } from './review-selection.ts';
import { readVocabularyPureCueStreams, vocabularyPureCueRandom, vocabularyPureCueUsability } from './pure-cue-serving.ts';

export type TimedReviewEntry = { kind: 'word' | 'pure_cue'; id: string };
export type TimedAdmission = {
  newWordIds: string[]; learningWordIds: string[];
  reviewWords: { wordId: string; mode: 'practice' | 'maintain'; selectedSkill: VocabularyReviewSkill }[];
  /** Due rechecks first, then admitted review words and cues in session order. */
  /** Session payload assembly loads each admitted cue's content once. */
  reviewOrder: TimedReviewEntry[];
  preparationPending: boolean;
};
const splice = (seed: string, id: string, length: number) =>
  parseInt(createHash('sha256').update(`${seed}/${id}`).digest('hex').slice(0, 8), 16) % (length + 1);

/**
 * Timed Start admission. Each stream is capped on its own terms and no stream
 * takes capacity from another:
 * - new words: the day's remaining new-word quota;
 * - learning: the whole due Solidify set;
 * - review words and fragile cues together: `reviewBound` items, pressing items
 *   first, then urgency-ranked review with fragile cues interleaved;
 * - strong cues: today's roll, with slots scaled to the admitted review count;
 * - rechecks: every due recheck, ahead of the rest.
 * Review and cue candidates come from narrow reads; content checks run while a
 * stream is walked and stop once its cap is filled, so a candidate that fails a
 * check is passed over and the next in rank takes its place.
 */
export function admitTimedVocabularyStudy(input: {
  now: string; timeZone?: string; sessionSeed: string; reviewBound: number; skipDays: ReadonlyMap<string, number>;
  teachingReady: (wordId: string) => boolean; isLearningContentUsable: (wordId: string) => boolean;
  isReviewContentUsable: (wordId: string, skillId: VocabularyReviewSkill) => boolean;
}): TimedAdmission {
  if (!Number.isSafeInteger(input.reviewBound) || input.reviewBound <= 0) throw new Error('Timed admission requires a positive review bound');
  const { now, sessionSeed } = input;
  const fresh = composeVocabularyNewWords({ now, timeZone: input.timeZone, teachingReady: input.teachingReady });
  const learningWordIds = readVocabularyLearningWordIds(now, input.isLearningContentUsable);

  // Ranked candidates: each review word at the position of its most urgent due objective.
  const objectives = new Map<string, VocabularyDueReviewObjective[]>();
  for (const objective of readVocabularyDueReviewObjectives(now)) {
    const list = objectives.get(objective.wordId); if (list) list.push(objective); else objectives.set(objective.wordId, [objective]);
  }
  const streams = readVocabularyPureCueStreams(now);
  const ranked: TimedReviewEntry[] = [...objectives.keys()].map((id) => ({ kind: 'word', id }));
  for (const cue of streams.fragile) ranked.splice(splice(sessionSeed, cue.id, ranked.length), 0, { kind: 'pure_cue', id: cue.id });
  const pressing = (entry: TimedReviewEntry) => (input.skipDays.get(timedTargetKey(entry.kind, entry.id)) ?? 0) >= PRESSING_SKIP_DAYS;
  const order = [...ranked.filter(pressing), ...ranked.filter((entry) => !pressing(entry))];

  const cueUsable = vocabularyPureCueUsability();
  const admitted: TimedReviewEntry[] = []; const reviewWords: TimedAdmission['reviewWords'] = [];
  for (const entry of order) {
    if (admitted.length >= input.reviewBound) break;
    if (entry.kind === 'pure_cue') { if (cueUsable(entry.id)) admitted.push(entry); continue; }
    const objective = objectives.get(entry.id)!.find((candidate) => canUseVocabularyReviewObjective(candidate, input.isReviewContentUsable));
    if (!objective) continue;
    admitted.push(entry); reviewWords.push({ wordId: objective.wordId, mode: objective.mode, selectedSkill: objective.skillId });
  }
  const rechecks = streams.rechecks.filter((cue) => cueUsable(cue.id)).map((cue) => cue.id);
  const strong = selectPureCuesForSession({ learnerId: requireLearnerId(), cues: streams.strong.filter((cue) => cueUsable(cue.id)),
    ordinaryReviewCount: admitted.length, now, random: vocabularyPureCueRandom(sessionSeed) }).selected.map((cue) => cue.id);
  const sequence = [...admitted];
  for (const id of strong) sequence.splice(splice(sessionSeed, id, sequence.length), 0, { kind: 'pure_cue', id });
  return { newWordIds: fresh.newWordIds, learningWordIds, reviewWords,
    reviewOrder: [...rechecks.map((id) => ({ kind: 'pure_cue' as const, id })), ...sequence],
    preparationPending: fresh.preparationPending };
}
