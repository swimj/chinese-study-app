/** Compatibility entry point for the standalone lab. */
export {
  WORD_INTRODUCTION_MODEL as INTRO_LAB_MODEL,
  createWordIntroductionProvider as createIntroductionLabProvider,
  type WordIntroductionProvider as IntroductionLabProvider,
} from '../word-content/provider.ts';
