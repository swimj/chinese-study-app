export type ContentSharingKind = 'introduction' | 'rehearsal' | 'production_cue' | 'pure_cue';

export interface ContentSharingExample {
  contentKey: string;
  wordId: string | null;
  kind: ContentSharingKind;
  title: string;
  word: { hanzi: string; pinyin: string } | null;
  firstUsedAt: string;
  secondLearnerUsedAt: string;
  learnerCount: number;
  completedLearnerCount: number | null;
  generation: { bootstrapAttempts: number; teachingAttempts: number; bootstrapSuccessfulAttempts: number; teachingSuccessfulAttempts: number } | null;
}

export interface ContentSharingDigest {
  weekStart: string;
  weekEnd: string;
  currentWeekStart: string;
  isCurrentWeek: boolean;
  generatedAt: string;
  newlyReused: { introductions: number; rehearsals: number; reviewCues: number };
  reflectionCuesAttemptedByOthers: { productionCues: number; pureCues: number; total: number };
  overlap: { studiedWords: number; wordsStudiedByMultipleLearners: number };
  examples: ContentSharingExample[];
  coverageNotes: string[];
}
