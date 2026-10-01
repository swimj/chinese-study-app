import type { TeachingPackage, WordContentDocument } from './types';

/** Shared eligible teaching content with a private learner pin/completion marker. */
export type SavedWordContent = {
  createdAt: string;
  content: WordContentDocument;
};
export type SavedTeachingPackage = {
  createdAt: string;
  teaching: TeachingPackage;
};
export type WordIntroductionLibrary = {
  wordId: string;
  contents: SavedWordContent[];
  packages: SavedTeachingPackage[];
  selectedPackageId: string | null;
  completed: boolean;
};
export type WordIntroductionResponse = WordIntroductionLibrary & {
  generationAvailable: boolean;
  model: string;
  /** A prepared source has been withdrawn; ordinary cards remain available. */
  preparationUnavailable?: boolean;
  /** Non-blocking failure: teaching remains available and a later prepare retries review. */
  reviewPreparationError?: string;
};

/** Lexical input only; never learner notes, attempts, or profile data. */
export type WordBootstrapInput = {
  hanzi: string;
  traditional: string | null;
  pinyin: string;
  guidance: string;
};
