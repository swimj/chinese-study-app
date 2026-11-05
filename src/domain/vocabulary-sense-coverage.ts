import type { VocabularySense } from './vocabulary-content.ts';
export type VocabularyWordSenseCoverage = {wordId:string;version:number;excludedSenseIds:string[];defaultUsefulSenseIds:string[]|null};
export type VocabularyCaseSenseCoverage = {caseId:string;wordId:string;version:number;includedSenseIds:string[]|null};
export type VocabularyEffectiveSenseCoverage = {
  word:VocabularyWordSenseCoverage; review:VocabularyCaseSenseCoverage|null;
  includedSenseIds:string[]; selectionEstablished:boolean; fingerprint:string;
};
export type VocabularySenseCoverageWorkspace = VocabularyEffectiveSenseCoverage & {senses:VocabularySense[];productionExerciseCounts?:Record<string,number>};

export type VocabularyDefaultSelectionFinding={status:'needs_operator';reason:string;invocationId:string|null;recommendedSenseIds:string[]};
export type VocabularyDefaultSelectionAttention=VocabularyDefaultSelectionFinding&{wordId:string;hanzi:string;caseId:string|null};
