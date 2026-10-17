import { useEffect, useState } from 'react';
import { fetchVocabularyWords, setVocabularyWordMode, refreshVocabularyWord, dismissVocabularyWord, type VocabularyWordRow } from '../services/api';
import type { VocabularyWordMode } from '../domain/vocabulary-session';
const modes:Record<VocabularyWordMode,string>={unstudied:'Unstudied',solidify:'Solidify',practice:'Practice',maintain:'Maintain'};
export function VocabularyWordsPage() {
  const [words,setWords]=useState<VocabularyWordRow[]>([]),[query,setQuery]=useState(''),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState<string|null>(null);
  async function reload(){setWords((await fetchVocabularyWords()).words);}
  useEffect(()=>{void reload().catch(e=>setError(String(e.message)));},[]);
  async function act(id:string,work:()=>Promise<unknown>){setBusy(id);setError(null);try{await work();await reload();}catch(e){setError(e instanceof Error?e.message:'Could not update this word.');}finally{setBusy(null);}}
  const filtered=words.filter(w=>`${w.hanzi} ${w.traditional??''} ${w.pinyin} ${w.meaning}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="panel vocabulary-word-list"><h1>My words</h1>
    <p>Choose how you want to work on each word. Refresh brings a maintained word back for a little more practice.</p>
    <label>Find a word <input value={query} onChange={e=>setQuery(e.target.value)}/></label>
    {error?<p role="alert">{error}</p>:null}
    {filtered.length===0?<p>No words to show.</p>:filtered.map(w=><article key={w.wordId} className="vocabulary-word-row">
      <div><strong lang="zh">{w.hanzi}</strong> <span>{w.pinyin}</span><p>{w.meaning}</p></div>
      <div className="vocabulary-word-actions"><label>Mode <select value={w.mode} disabled={busy!==null} onChange={e=>void act(w.wordId,()=>setVocabularyWordMode(w.wordId,e.target.value as VocabularyWordMode,w.stateVersion))}>
        {Object.entries(modes).map(([key,label])=><option key={key} value={key}>{label}</option>)}
      </select></label>
      {w.mode==='maintain'?<button type="button" disabled={busy!==null} onClick={()=>void act(w.wordId,()=>refreshVocabularyWord(w.wordId))}>Refresh</button>:null}
      <details><summary>Word options</summary><button type="button" disabled={busy!==null} onClick={()=>{if(window.confirm(`Remove ${w.hanzi} from study? Its history will be kept.`))void act(w.wordId,()=>dismissVocabularyWord(w.wordId));}}>Remove from study</button></details></div>
    </article>)}
  </section>;
}
