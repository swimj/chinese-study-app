import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {WordBrowserPage} from '../../src/pages/MyWordsPage';
import {VOCABULARY_WORD_STAGES,type VocabularyCollectionWord} from '../../src/domain/vocabulary-words';
import type {VocabularyWordMode} from '../../src/domain/vocabulary-session';
import type {MyWordsView} from '../../src/domain/my-words';
import '../../src/styles.css';
import '../../src/features/vocabulary-study/pages.css';
const rows:VocabularyCollectionWord[]=[
  {word:{id:'1',hanzi:'部署',traditional:null,pinyin:'bù shǔ',meaning:'to arrange; to deploy',meanings:['to arrange; to deploy','to make arrangements for a task'],personalNotes:'From this week’s reading.',status:'solidify'},lastStudiedAt:'2026-10-27',personalUpdatedAt:null,stateVersion:1,nextEligibleAt:null,refreshUntil:null},
  {word:{id:'2',hanzi:'報備',traditional:'報備',pinyin:'bào bèi',meaning:'to notify the responsible people so there is a record',meanings:['to notify the responsible people so there is a record'],personalNotes:'',status:'practice'},lastStudiedAt:'2026-10-26',personalUpdatedAt:null,stateVersion:1,nextEligibleAt:null,refreshUntil:null},
  {word:{id:'3',hanzi:'百分点',traditional:'百分點',pinyin:'bǎi fēn diǎn',meaning:'percentage point',meanings:['percentage point'],personalNotes:'',status:'maintain'},lastStudiedAt:null,personalUpdatedAt:null,stateVersion:1,nextEligibleAt:null,refreshUntil:null},
];
function Preview(){
  const [view,setView]=useState<MyWordsView>('recent'),[query,setQuery]=useState(''),[statuses,setStatuses]=useState<VocabularyWordMode[]>([]),[selected,setSelected]=useState<string|null>('1'),[lapses,setLapses]=useState(false);
  const filtered=rows.filter(({word})=>(!statuses.length||statuses.includes(word.status))&&`${word.hanzi} ${word.pinyin} ${word.meaning}`.toLowerCase().includes(query.toLowerCase()));
  return <main className="page-shell" style={{maxWidth:window.location.search.includes('narrow')?600:1100,margin:'2rem auto',padding:'0 1rem'}}><WordBrowserPage view={view} query={query} statuses={statuses} recentLapses={lapses}
    words={filtered} stages={VOCABULARY_WORD_STAGES} currentDeck={{label:'HSK 1'}} selectedId={selected} loading={false} error={null} hasMore={false} total={filtered.length} scrollTop={0}
    onViewChange={setView} onQueryChange={setQuery} onToggleStatus={status=>setStatuses(current=>current.includes(status)?current.filter(item=>item!==status):[...current,status])}
    onToggleRecentLapses={()=>setLapses(value=>!value)} onSelect={setSelected} onLoadMore={()=>{}} onRetry={()=>{}} onScroll={()=>{}}
    renderWordActions={entry=><label>Mode <select value={entry.word.status} disabled>{VOCABULARY_WORD_STAGES.map(stage=><option key={stage.status} value={stage.status}>{stage.label}</option>)}</select></label>}/></main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
