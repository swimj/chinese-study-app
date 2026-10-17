import { config,getDb } from './connection.ts';
import { addUnstudiedUserPriorityByHanzi,updateWordUserPriority } from './persistence.ts';
import { addVocabularyWord,getVocabularyLearnerWord,setVocabularyStashMembership } from './vocabulary-learners.ts';
import type { PriorityWord,UserWordPriorityPatch } from './types.ts';
let sequence=0;
function atomic<T>(work:()=>T):T {
  const name=`vocabulary_stash_${++sequence}`;
  getDb().exec(`SAVEPOINT ${name}`);
  try{const result=work();getDb().exec(`RELEASE ${name}`);return result;}
  catch(error){getDb().exec(`ROLLBACK TO ${name}`);getDb().exec(`RELEASE ${name}`);throw error;}
}
/** Existing intake priority and new membership commit together, preserving mode/history. */
export function addVocabularyStashByHanzi(hanzi:string,requiredForNextSession=false,wordIds?:string[]):PriorityWord[] {
  if(config.studyProfile!=='mandarin')return addUnstudiedUserPriorityByHanzi(hanzi,requiredForNextSession,wordIds);
  return atomic(()=>{
    const words=addUnstudiedUserPriorityByHanzi(hanzi,requiredForNextSession,wordIds);
    for(const word of words)addVocabularyWord(word.word.id);
    return words;
  });
}
/** Priority reset removes membership, not learning mode. Explicit dismissal is its own command. */
export function updateVocabularyStashPriority(wordId:string,patch:UserWordPriorityPatch):PriorityWord {
  if(config.studyProfile!=='mandarin')return updateWordUserPriority(wordId,patch);
  return atomic(()=>{
    const word=updateWordUserPriority(wordId,patch);
    if(patch.reset){if(getVocabularyLearnerWord(wordId))setVocabularyStashMembership(wordId,false);}
    else addVocabularyWord(wordId);
    return word;
  });
}
