import type { VocabularyWordMode } from './vocabulary-session';
import type { WordBrowserEntry } from './my-words';
export const VOCABULARY_WORD_STAGES: ReadonlyArray<{status: VocabularyWordMode; label: string}> = [
  {status:'unstudied',label:'Not yet studied'}, {status:'solidify',label:'Solidify'},
  {status:'practice',label:'Practice'}, {status:'maintain',label:'Maintain'},
];
export const VOCABULARY_WORD_MODES = VOCABULARY_WORD_STAGES.map(({status}) => status);
export type VocabularyCollectionWord = WordBrowserEntry<VocabularyWordMode> & {
  stateVersion: number | null; nextEligibleAt: string | null; refreshUntil: string | null;
};
export type VocabularyWordsCollection = {
  words: VocabularyCollectionWord[]; total: number; hasMore: boolean; currentDeck: {label: string} | null;
};
