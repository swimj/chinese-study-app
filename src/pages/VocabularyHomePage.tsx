import { SessionStartCard } from '../components/SessionStartCard';
import { fetchVocabularyProgress, fetchVocabularyStatistics, fetchVocabularySessionPreview } from '../services/api';
import { studiedToday, vocabularyStudyWeek, type VocabularyStatistics, type VocabularyStudyDays } from '../domain/vocabulary-statistics';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BackendStatus } from '../services/api';
import type { ComponentProps } from 'react';
import { HomeUpdates, HomeUpdatesCollapsedControl } from './HomeUpdates';
import { SessionSettingsPanel } from './HomeOverviewPanel';
import { HomeProgress, WeekStudyTime } from './HomeProgress';
import type { VocabularyProgress } from '../domain/vocabulary-progress';
import type { WhatsNewCatalog } from '../features/attention/useWhatsNewCatalog';
import { useSessionDebrief } from '../features/session/useSessionDebrief';
import { HomeConnections, type HomeConnectionReactions } from '../features/session/HomeConnections';
import { useContentReactions } from '../features/reactions/useContentReactions';
import { useHomeConnectionsView } from '../features/session/useHomeConnectionsView';
import { ConnectionSignals } from '../features/session/ConnectionSignals';
import { createVocabularyHomePreviewLoader, INITIAL_VOCABULARY_HOME_PREVIEW, type VocabularyHomePreviewState } from '../features/vocabulary-study/home-preview';

export function VocabularyHomeOverview(props: {
  compact: boolean; busy: boolean; settings: boolean; saving: boolean; guideToSettings: boolean;
  statistics: VocabularyStatistics|null; onStart:()=>void; onToggleSettings:()=>void;
  preview?: VocabularyHomePreviewState;
  /** Loaded separately after the Start card; absent while loading. */
  progress?: VocabularyProgress|null;
}) {
  const preview=props.preview??INITIAL_VOCABULARY_HOME_PREVIEW;
  const pending=preview.status==='loading';
  const count=preview.preview?.itemCount;
  // In the timed paradigm a fresh Start into a studied day runs a few more minutes.
  const returning=preview.preview?.timed===true&&studiedToday(props.statistics?.studyDays);
  return <section className={`panel home-overview${props.compact?' is-compact':''}`}>
    <SessionStartCard disabled={props.busy||props.settings||pending} onStart={props.onStart}
      settingsOpen={props.settings} settingsSaving={props.saving} guideToSettings={props.guideToSettings}
      onToggleSettings={props.onToggleSettings} helperTitle={preview.error??undefined}
      label={props.busy||pending?'Preparing session…':count===0?'Check again':returning?'Study a little more':'Start session'}
      helper={preview.preview?.timed
        // The timed paradigm keeps the due ledger off Home; only an empty start needs saying.
        ?count===0?<>Nothing ready yet{preview.preview.preparationPending?' · preparing introductions':''}</>:preview.status==='error'?'Could not check study material':null
        :<>{count===undefined?preview.status==='error'?'Ready count unavailable':'… study items ready':`${count} study items ready`}
        {count===0&&preview.preview?.preparationPending?' · preparing introductions':''}</>} />
    {!props.compact&&props.statistics?<StudyWeek studyDays={props.statistics.studyDays} progress={props.progress??null} />:null}
  </section>;
}

function StudyWeek({studyDays,progress}:{studyDays:VocabularyStudyDays;progress:VocabularyProgress|null}) {
  const week=vocabularyStudyWeek(studyDays);
  const studied=week.filter(day=>day.state==='studied').map(day=>day.name);
  return <div className="study-week" role="img" aria-label={`This week: ${studied.length?`studied ${studied.join(', ')}`:'no study yet'}`}>
    {week.map(day=><span key={day.dayKey} className={`study-week-day is-${day.state}${day.dayKey===studyDays.today?' is-today':''}`}>
      <span className="study-week-dot" />{day.label}
    </span>)}
    <WeekStudyTime progress={progress} />
  </div>;
}

export function VocabularyHomePage(props: {
  backendStatus: BackendStatus|null; active:boolean; busy:boolean; studySurface:ReactNode; onStart:(previewSeed?:string)=>void;
  guideToSettings:boolean; onSettingsOpened:()=>void;
  onSaveSessionSettings:ComponentProps<typeof SessionSettingsPanel>['onSaveSessionSettings'];
  updatesCatalog:WhatsNewCatalog; unseenPostIds:readonly string[];
  onUnseenBadgeVisible:(ids:string[])=>Promise<void>; updatesCollapsed:boolean; onToggleUpdatesCollapsed:()=>void;
  onOpenUpdate:(id:string)=>void; onViewAllUpdates:()=>void;
}) {
  const [settings,setSettings]=useState(false),[saving,setSaving]=useState(false);
  const [statistics,setStatistics]=useState<VocabularyStatistics|null>(null);
  const [previewRevision,setPreviewRevision]=useState(0);
  const previewKey=JSON.stringify([props.active,props.backendStatus?.dailyNewWordLimit,props.backendStatus?.unstudiedAdmissionSource,
    props.backendStatus?.studyIntroductionOrder,props.backendStatus?.studyIntroductionSpacing,previewRevision]);
  const [previewEntry,setPreviewEntry]=useState({key:previewKey,state:INITIAL_VOCABULARY_HOME_PREVIEW});
  const preview=previewEntry.key===previewKey?previewEntry.state:INITIAL_VOCABULARY_HOME_PREVIEW;
  useEffect(()=>{
    if(props.active)return;
    const loader=createVocabularyHomePreviewLoader(fetchVocabularySessionPreview,(state)=>setPreviewEntry({key:previewKey,state}));
    let timer:ReturnType<typeof setTimeout>|undefined;
    let disposed=false;
    async function load(background=false) {
      const result=await loader.reload({background});
      if(!disposed&&result?.preparationPending)timer=setTimeout(()=>{void load(true);},5000);
    }
    void load();
    const refresh=()=>{clearTimeout(timer);void load(true);};
    window.addEventListener('focus',refresh);
    return()=>{disposed=true;clearTimeout(timer);loader.dispose();window.removeEventListener('focus',refresh);};
  },[previewKey]);
  useEffect(()=>{if(!props.active)void fetchVocabularyStatistics().then(setStatistics).catch(()=>setStatistics(null));},[props.active]);
  // Progress reads the whole study history, so it waits until the Start card has its preview.
  const [progress,setProgress]=useState<HomeProgressState>({status:'idle',value:null});
  const [progressRevision,setProgressRevision]=useState(0);
  // Each Home visit requests once; a generation discards a response that outlived its visit.
  const progressGeneration=useRef(0),progressRequested=useRef(false);
  const previewSettled=preview.status!=='loading';
  useEffect(()=>{if(props.active){progressGeneration.current++;progressRequested.current=false;setProgress({status:'idle',value:null});}},[props.active]);
  useEffect(()=>()=>{progressGeneration.current++;progressRequested.current=false;},[]);
  useEffect(()=>{
    if(props.active||!previewSettled||progressRequested.current)return;
    progressRequested.current=true;
    const generation=++progressGeneration.current;
    setProgress({status:'loading',value:null});
    fetchVocabularyProgress().then(value=>{if(generation===progressGeneration.current)setProgress({status:'ready',value});},
      ()=>{if(generation===progressGeneration.current)setProgress({status:'error',value:null});});
  },[props.active,previewSettled,progressRevision]);
  useEffect(()=>{if(props.active)setSettings(false);},[props.active]);
  const recent=useSessionDebrief(undefined,!props.active);
  const connections=useHomeConnectionsView(recent.debrief,!props.active&&!settings);
  const contentReactions=useContentReactions('home');
  const debriefSessionId=recent.debrief?.sessionId??null;
  const connectionReactions=useMemo<HomeConnectionReactions|undefined>(()=>debriefSessionId===null?undefined:{
    stateFor:(noteIndex)=>contentReactions.stateFor({kind:'connection',sessionId:debriefSessionId,noteIndex}),
    onChange:(noteIndex,choice)=>contentReactions.change({kind:'connection',sessionId:debriefSessionId,noteIndex},choice),
    error:contentReactions.error,
  },[debriefSessionId,contentReactions.stateFor,contentReactions.change,contentReactions.error]);
  const connectionsExpanded=!settings&&connections.expanded;
  if(props.active)return <div className="home-page home-session-active">{props.studySurface}</div>;
  return <div className={`home-page${connectionsExpanded?' home-connections-expanded':''}${props.updatesCollapsed?' home-updates-collapsed':''}`}>
    {connectionsExpanded?<ConnectionSignals />:null}
    {!connectionsExpanded&&!settings&&props.updatesCollapsed?<HomeUpdatesCollapsedControl unseenPostIds={props.unseenPostIds} onVisible={props.onUnseenBadgeVisible} onExpand={props.onToggleUpdatesCollapsed}/>:null}
    <div className={`grid home-grid${!connectionsExpanded&&!settings&&!props.updatesCollapsed?' home-with-updates':''}`}>
      <VocabularyHomeOverview compact={connectionsExpanded} busy={props.busy} settings={settings} saving={saving}
        guideToSettings={props.guideToSettings} statistics={statistics} preview={preview} progress={progress.value}
        onStart={()=>{if(preview.preview?.itemCount===0)setPreviewRevision((value)=>value+1);else props.onStart(preview.preview?.previewSeed);}}
        onToggleSettings={()=>{if(!saving){setSettings(!settings);if(!settings)props.onSettingsOpened();}}} />
      {settings?<SessionSettingsPanel backendStatus={props.backendStatus} onSaveSessionSettings={async(settings)=>{await props.onSaveSessionSettings(settings);setPreviewRevision((value)=>value+1);}} onSavingChange={setSaving} onClose={()=>setSettings(false)}/>:null}
      {!settings&&recent.debrief?<HomeConnections key={recent.debrief.sessionId} debrief={recent.debrief} expanded={connections.expanded} error={recent.error} retrying={recent.retrying} onToggle={connections.toggle} onRetry={recent.retry} onReload={recent.reload} reactions={connectionReactions}/>:recent.error?
        <p className="notes" role="status">Couldn’t load the recent session. <button type="button" className="secondary-button" onClick={recent.reload}>Try again</button></p>:null}
      {!connectionsExpanded&&!settings&&!props.updatesCollapsed?<HomeUpdates catalog={props.updatesCatalog} unseenPostIds={props.unseenPostIds} onUnseenBadgeVisible={props.onUnseenBadgeVisible} onOpenPost={props.onOpenUpdate} onViewAll={props.onViewAllUpdates} onCollapse={props.onToggleUpdatesCollapsed}/>:null}
      {!connectionsExpanded&&!settings?<HomeProgressArea state={progress} onRetry={()=>{progressRequested.current=false;setProgressRevision(value=>value+1);}} />:null}
    </div>
  </div>;
}

type HomeProgressState={status:'idle'|'loading'|'ready'|'error';value:VocabularyProgress|null};
export function HomeProgressArea({state,onRetry}:{state:HomeProgressState;onRetry:()=>void}) {
  if(state.status==='error')return <p className="notes" role="status">Couldn’t load progress. <button type="button" className="secondary-button" onClick={onRetry}>Try again</button></p>;
  return state.value?<HomeProgress progress={state.value} />:null;
}
