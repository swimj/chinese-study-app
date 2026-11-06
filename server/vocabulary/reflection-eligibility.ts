import { isLearnerPronunciationRejection, type VocabularyEncounterEvidence } from '../../src/domain/vocabulary-session.ts';
import type { VocabularyReflectionJob } from '../../src/domain/vocabulary-reflection.ts';

/** Retained production evidence also supplies the internal scheduling-compensation guard. */
export function isGeneralProductionEncounter(encounter:VocabularyEncounterEvidence):boolean {
  return encounter.snapshot.role==='general'&&encounter.snapshot.kind==='production';
}
export function isVocabularyPronunciationEncounter(encounter:VocabularyEncounterEvidence):boolean {
  return encounter.effectiveResponses.some(response=>isLearnerPronunciationRejection(
    encounter.snapshot.kind,response.payload,encounter.snapshot.assessment?.acceptedAnswers??[]));
}
/** Exclude the whole pronunciation encounter, including its reactions, from model work. */
export function isVocabularyProviderEncounter(encounter:VocabularyEncounterEvidence):boolean {
  return isGeneralProductionEncounter(encounter)&&!isVocabularyPronunciationEncounter(encounter);
}
/** Also filters retained jobs created before eligibility narrowed, including mixed word lessons. */
export function eligibleVocabularyReflectionJob(job:VocabularyReflectionJob):VocabularyReflectionJob {
  return {...job,evidence:{...job.evidence,evidence:job.evidence.evidence.filter(isVocabularyProviderEncounter)}};
}
