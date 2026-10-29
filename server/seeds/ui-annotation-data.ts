import fs from 'node:fs';
import type { SeedData } from '../db/types.ts';

/** Explicit identities keep fixture roles stable when the authoring samples grow. */
export const annotationWords = {
  introduction: ['word-tengjiao', 'word-paomo'],
  learning: ['word-bukan', 'word-shichen-dahai', 'word-weisuoyuwei'],
  review: 'word-baobei',
} as const;

export function buildUiAnnotationSeed(now: Date) {
  // Repository-owned JSON is normalized and validated by the standard seed reader.
  const seed = JSON.parse(fs.readFileSync(new URL('./mandarin-dev.json', import.meta.url), 'utf8')) as SeedData;
  const yesterday = new Date(now.getTime() - 86_400_000).toISOString();
  const previousStudy = new Date(now.getTime() - 2 * 86_400_000).toISOString();
  for (const wordId of [...annotationWords.introduction, ...annotationWords.learning, annotationWords.review]) {
    const word = seed.words.find(word => word.id === wordId);
    if (!word) throw new Error(`Missing standard annotation word: ${wordId}`);
    const learningIndex = annotationWords.learning.findIndex(id => id === wordId);
    word.status = wordId === annotationWords.review ? 'review' : learningIndex >= 0 ? 'learning' : 'unstudied';
    word.learningStreak = word.status === 'review' ? 3 : Math.max(0, learningIndex);
    const lastPracticeDay = (word.status === 'review' ? previousStudy : yesterday).slice(0, 10);
    word.lastLearningSuccessOn = word.learningStreak > 0 ? lastPracticeDay : null;
    word.lastLearningCoveredOn = word.status === 'unstudied' ? null : lastPracticeDay;
    seed.wordStudyAdmissionStates = seed.wordStudyAdmissionStates.filter(state => state.wordId !== wordId);
    seed.wordSkillStates = seed.wordSkillStates.filter(state => state.wordId !== wordId);
    if (word.status === 'review') {
      seed.wordStudyAdmissionStates.push({ wordId, studyPhase: 'review', earliestNextStudyAt: yesterday });
      for (const skillId of ['recognition', 'production'] as const) {
        seed.wordSkillStates.push({ wordId, skillId, enabled: true, intervalHours: 24,
          lastStudiedAt: previousStudy, nextDueAt: yesterday, easeFactor: 2.5 });
      }
    }
  }
  return seed;
}
