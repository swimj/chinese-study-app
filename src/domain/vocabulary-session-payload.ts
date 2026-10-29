import type { VocabularyContent } from './vocabulary-content';
import type { VocabularyEncounterSnapshot, VocabularyTeachingRequirements } from './vocabulary-session';
import type { VocabularyStudyWord } from './vocabulary-study-api';

/** Admission-time material. Retained server-side; live responses contain only served encounters. */
export type VocabularySessionPayload = {
  version: 1;
  words: Record<string, {
    lexical: VocabularyStudyWord;
    teaching: { intro: VocabularyContent; exercises: VocabularyContent[]; requirements: VocabularyTeachingRequirements } | null;
    priming: VocabularyContent | null;
    general: Record<'solidify' | 'practice' | 'maintain', VocabularyContent[]>;
  }>;
  pureCues: VocabularyContent[];
  snapshots: Record<string, VocabularyEncounterSnapshot>;
};
