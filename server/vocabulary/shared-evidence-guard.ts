import type { VocabularyContent } from '../../src/domain/vocabulary-content.ts';
import type { VocabularyReflectionJob } from '../../src/domain/vocabulary-reflection.ts';
import { getVocabularyEncounterReactions } from '../../src/domain/vocabulary-session.ts';

/** Detect copied encounter prose while allowing short ordinary answer forms. */
export function copiesPrivateVocabularyEvidence(job:Pick<VocabularyReflectionJob,'evidence'>,accessScope:VocabularyContent['accessScope'],authoredText:readonly string[]):boolean {
  if(accessScope!=='shared')return false;
  const fragments=job.evidence.evidence.flatMap(encounter=>[
    ...getVocabularyEncounterReactions(encounter).map(reaction=>reaction.payload.comment??''),
    ...encounter.responses.flatMap(response=>{
      const text=response.payload.response;
      return text&&text.length>=12?[text]:[];
    }),
  ]).map(text=>text.trim()).filter(text=>text.length>=4);
  return fragments.some(fragment=>authoredText.some(text=>text.includes(fragment)));
}
