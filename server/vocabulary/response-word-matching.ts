import { isVocabularyProviderEncounter } from './reflection-eligibility.ts';
import type { VocabularyReflectionJob } from '../../src/domain/vocabulary-reflection.ts';
import { getDb } from '../db/connection.ts';
import { isDeepStrictEqual } from 'node:util';
import { VocabularyReflectionConflict } from '../db/vocabulary-case-reviews.ts';

export type VocabularyResponseWord={wordId:string;hanzi:string;traditional:string|null;pinyin:string;meaning:string};

/** Exact written forms may identify no entry, one entry, or several homographs. */
export function exactVocabularyWordMatches(form:string):VocabularyResponseWord[] {
  const rows=getDb().prepare('SELECT id AS wordId,hanzi,traditional,pinyin,meaning FROM lexical_words WHERE hanzi=? OR traditional=? ORDER BY id')
    .all(form,form) as VocabularyResponseWord[];
  return rows.map(row=>({...row}));
}

export function vocabularyResponseWordMatches(job:Pick<VocabularyReflectionJob,'evidence'|'responseIdentitySelection'>): {form:string;matches:VocabularyResponseWord[];word:VocabularyResponseWord|null}[] {
  const forms=[...new Set(job.evidence.evidence.filter(isVocabularyProviderEncounter).flatMap(encounter=>encounter.responses.flatMap(response=>{
    const form=response.payload.response?.trim();
    return form?[form]:[];
  })))];
  const result = forms.map(form=>{
    const matches=exactVocabularyWordMatches(form);
    const chosen=job.responseIdentitySelection?.selections[form];
    return {form,matches,word:chosen?matches.find(match=>match.wordId===chosen)??null:matches.length===1?matches[0]!:null};
  });
  if(job.responseIdentitySelection){
    const current=job.responseIdentitySelection.options.map(option=>({form:option.form,choices:result.find(entry=>entry.form===option.form)?.matches??[]}));
    if(!isDeepStrictEqual(current,job.responseIdentitySelection.options)||job.responseIdentitySelection.options.some(option=>!option.choices.some(word=>word.wordId===job.responseIdentitySelection!.selections[option.form])))
      throw new VocabularyReflectionConflict('Response dictionary identities changed; review the candidates again');
  }
  return result;
}

export function ambiguousVocabularyResponses(job:Pick<VocabularyReflectionJob,'evidence'|'responseIdentitySelection'>):{form:string;choices:VocabularyResponseWord[]}[] {
  const target=getDb().prepare('SELECT hanzi,traditional FROM lexical_words WHERE id=?').get(job.evidence.wordId) as {hanzi:string;traditional:string|null}|undefined;
  if(!target)throw new Error('Improvement target is unavailable');
  return vocabularyResponseWordMatches(job).filter(({form,matches})=>form!==target.hanzi&&form!==target.traditional&&matches.length>1)
    .map(({form,matches})=>({form,choices:matches}));
}
