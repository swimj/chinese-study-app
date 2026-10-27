import { useState } from 'react';
import { WordBrowserPage } from './MyWordsPage';
import { useWordBrowserController } from '../features/words/useMyWordsController';
import { fetchVocabularyWordCollection, setVocabularyWordMode, refreshVocabularyWord, dismissVocabularyWord, enrollVocabularyWord } from '../services/api';
import type { VocabularyWordMode } from '../domain/vocabulary-session';
import { VOCABULARY_WORD_MODES, VOCABULARY_WORD_STAGES, type VocabularyCollectionWord } from '../domain/vocabulary-words';

export function VocabularyWordsPage() {
  const controller=useWordBrowserController<VocabularyWordMode,VocabularyCollectionWord>(true,fetchVocabularyWordCollection,VOCABULARY_WORD_MODES);
  const [error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false);
  async function act(work:()=>Promise<unknown>){setBusy(true);setError(null);try{await work();controller.reload();}catch(e){setError(e instanceof Error?e.message:'Could not update this word.');}finally{setBusy(false);}}
  return <WordBrowserPage {...controller} error={error??controller.error} stages={VOCABULARY_WORD_STAGES}
    renderWordActions={entry=>entry.stateVersion===null
      ? <button type="button" disabled={busy} onClick={()=>void act(()=>enrollVocabularyWord(entry.word.id))}>Add to study</button>
      : <div className="vocabulary-word-actions">
        <label>Mode <select value={entry.word.status} disabled={busy} onChange={event=>void act(()=>setVocabularyWordMode(entry.word.id,event.target.value as VocabularyWordMode,entry.stateVersion!))}>
          {VOCABULARY_WORD_STAGES.map(({status,label})=><option key={status} value={status}>{label}</option>)}
        </select></label>
        {entry.word.status==='maintain'?<button type="button" disabled={busy} onClick={()=>void act(()=>refreshVocabularyWord(entry.word.id))}>Refresh</button>:null}
        <details><summary>Word options</summary><button type="button" disabled={busy} onClick={()=>{
          if(window.confirm(`Remove ${entry.word.hanzi} from study? Its history will be kept.`)) void act(()=>dismissVocabularyWord(entry.word.id));
        }}>Remove from study</button></details>
      </div>}/>;
}
