import type { VocabularyReflectionJob } from '../../src/domain/vocabulary-reflection.ts';
import { getDb } from '../db/connection.ts';

export type VocabularyResponseWord={wordId:string;hanzi:string;traditional:string|null;pinyin:string;meaning:string};

/** Exact written forms may identify no entry, one entry, or several homographs. */
export function exactVocabularyWordMatches(form:string):VocabularyResponseWord[] {
  return getDb().prepare('SELECT id AS wordId,hanzi,traditional,pinyin,meaning FROM lexical_words WHERE hanzi=? OR traditional=? ORDER BY id')
    .all(form,form) as VocabularyResponseWord[];
}

export function vocabularyResponseWordMatches(job:Pick<VocabularyReflectionJob,'evidence'>): {form:string;matches:VocabularyResponseWord[];word:VocabularyResponseWord|null}[] {
  const forms=[...new Set(job.evidence.evidence.flatMap(encounter=>encounter.responses.flatMap(response=>{
    const form=response.payload.response?.trim();
    return form?[form]:[];
  })))];
  return forms.map(form=>{
    const matches=exactVocabularyWordMatches(form);
    return {form,matches,word:matches.length===1?matches[0]!:null};
  });
}
