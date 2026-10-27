import type { VocabularyEncounterEvidence } from '../../src/domain/vocabulary-session.ts';
import type { VocabularyReflectionJob } from '../../src/domain/vocabulary-reflection.ts';

/** Only general production has a provider-review contract. Other evidence stays in the session log. */
export function isVocabularyProviderEncounter(encounter:VocabularyEncounterEvidence):boolean {
  return encounter.snapshot.role==='general'&&encounter.snapshot.kind==='production';
}
/** Also filters retained jobs created before eligibility narrowed, including mixed word lessons. */
export function eligibleVocabularyReflectionJob(job:VocabularyReflectionJob):VocabularyReflectionJob {
  return {...job,evidence:{...job.evidence,evidence:job.evidence.evidence.filter(isVocabularyProviderEncounter)}};
}
