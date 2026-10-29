import type { WordContentDocument, TeachingPackage } from './types';

/** Local authoring drafts, not published study content or learner progress. */
export type IntroductionDraft = {
  id: string;
  createdAt: string;
  origin: 'generated' | 'imported' | 'sample';
  content: WordContentDocument;
  teaching: TeachingPackage | null;
};

export type { WordBootstrapInput as IntroductionLexicalInput } from './application';

export type IntroductionLabStatus = {
  generationAvailable: boolean;
  model: string;
};
