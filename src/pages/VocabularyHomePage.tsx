import { SessionStartCard } from '../components/SessionStartCard';
import { fetchVocabularyProgress, fetchVocabularyStudyDays } from '../services/api';
import { studiedToday, vocabularyStudyWeek, type VocabularyStudyDays } from '../domain/vocabulary-statistics';
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
import type { ContentReactions } from '../features/reactions/useContentReactions';
import { useHomeConnectionsView } from '../features/session/useHomeConnectionsView';
import { ConnectionSignals } from '../features/session/ConnectionSignals';

export function VocabularyHomeOverview(props: {
  compact: boolean; busy: boolean; settings: boolean; saving: boolean; guideToSettings: boolean;
  studyDays: VocabularyStudyDays|null; onStart:()=>void; onToggleSettings:()=>void;
  timed: boolean;
  /** Loaded separately after the Start card; absent while loading. */
  progress?: VocabularyProgress|null;
}) {
  // Start composes the session itself; an empty start reports its reason through the app error.
  // In the timed paradigm a fresh Start into a studied day runs a few more minutes.
  const returning=props.timed&&studiedToday(props.studyDays ?? undefined);
  return <section className={`panel home-overview${props.compact?' is-compact':''}`}>
    <SessionStartCard disabled={props.busy||props.settings} onStart={props.onStart}
      settingsOpen={props.settings} settingsSaving={props.saving} guideToSettings={props.guideToSettings}
      onToggleSettings={props.onToggleSettings}
      label={props.busy?'Preparing session…':returning?'Study a little more':'Start session'}
      helper={null} />
    {!props.compact&&props.studyDays?<StudyWeek studyDays={props.studyDays} progress={props.progress??null} />:null}
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
  visible: boolean; contentReactions: ContentReactions;
  backendStatus: BackendStatus|null; active:boolean; busy:boolean; studySurface:ReactNode; onStart:()=>void;
  guideToSettings:boolean; onSettingsOpened:()=>void;
  onSaveSessionSettings:ComponentProps<typeof SessionSettingsPanel>['onSaveSessionSettings'];
  updatesCatalog:WhatsNewCatalog; unseenPostIds:readonly string[];
  onUnseenBadgeVisible:(ids:string[])=>Promise<void>; updatesCollapsed:boolean; onToggleUpdatesCollapsed:()=>void;
  onOpenUpdate:(id:string)=>void; onViewAllUpdates:()=>void;
}) {
  const [settings,setSettings]=useState(false),[saving,setSaving]=useState(false);
  const [studyDays,setStudyDays]=useState<VocabularyStudyDays|null>(null);
  const [progress,setProgress]=useState<HomeProgressState>({status:'idle',value:null});
  const [progressRevision,setProgressRevision]=useState(0);
  const generation=useRef(0), studyDaysRequested=useRef(false), progressRequested=useRef(false);
  useEffect(()=>{
    if(props.active) {
      setProgress({status:'idle',value:null});
      setStudyDays(null);
    }
    return ()=>{
      generation.current++;
      studyDaysRequested.current=false;
      progressRequested.current=false;
    };
  },[props.active]);
  useEffect(()=>{
    if(props.active||!props.visible)return;
    const request=generation.current;
    if(!studyDaysRequested.current) {
      studyDaysRequested.current=true;
      fetchVocabularyStudyDays().then(value=>{if(request===generation.current)setStudyDays(value);},
        ()=>{if(request===generation.current)setStudyDays(null);});
    }
    if(progressRequested.current)return;
    progressRequested.current=true;
    setProgress({status:'loading',value:null});
    fetchVocabularyProgress().then(value=>{if(request===generation.current)setProgress({status:'ready',value});},
      ()=>{if(request===generation.current)setProgress({status:'error',value:null});});
  },[props.active,props.visible,progressRevision]);
  useEffect(()=>{if(props.active)setSettings(false);},[props.active]);
  const recent=useSessionDebrief(undefined,!props.active);
  const connections=useHomeConnectionsView(recent.debrief,props.visible&&!props.active&&!settings);
  const { stateFor, change, errors } = props.contentReactions;
  const reactionError = errors.home;
  const debriefSessionId=recent.debrief?.sessionId??null;
  const connectionReactions=useMemo<HomeConnectionReactions|undefined>(()=>debriefSessionId===null?undefined:{
    stateFor:(noteIndex)=>stateFor({kind:'connection',sessionId:debriefSessionId,noteIndex}),
    onChange:(noteIndex,choice)=>change('home',{kind:'connection',sessionId:debriefSessionId,noteIndex},choice),
    error:reactionError,
  },[debriefSessionId,stateFor,change,reactionError]);
  const connectionsExpanded=!settings&&connections.expanded;
  if(props.active)return props.visible?<div className="home-page home-session-active">{props.studySurface}</div>:null;
  return <div hidden={!props.visible} className={`home-page${connectionsExpanded?' home-connections-expanded':''}${props.updatesCollapsed?' home-updates-collapsed':''}`}>
    {connectionsExpanded?<ConnectionSignals />:null}
    {!connectionsExpanded&&!settings&&props.updatesCollapsed?<HomeUpdatesCollapsedControl unseenPostIds={props.unseenPostIds} onVisible={props.onUnseenBadgeVisible} onExpand={props.onToggleUpdatesCollapsed}/>:null}
    <div className={`grid home-grid${!connectionsExpanded&&!settings&&!props.updatesCollapsed?' home-with-updates':''}`}>
      <VocabularyHomeOverview compact={connectionsExpanded} busy={props.busy} settings={settings} saving={saving}
        guideToSettings={props.guideToSettings} studyDays={studyDays} timed={props.backendStatus?.timedSessions===true} progress={progress.value}
        onStart={props.onStart}
        onToggleSettings={()=>{if(!saving){setSettings(!settings);if(!settings)props.onSettingsOpened();}}} />
      {settings?<SessionSettingsPanel visible={props.visible} backendStatus={props.backendStatus} onSaveSessionSettings={props.onSaveSessionSettings} onSavingChange={setSaving} onClose={()=>setSettings(false)}/>:null}
      {!settings&&recent.debrief?<HomeConnections visible={props.visible} key={recent.debrief.sessionId} debrief={recent.debrief} expanded={connections.expanded} error={recent.error} retrying={recent.retrying} onToggle={connections.toggle} onRetry={recent.retry} onReload={recent.reload} reactions={connectionReactions}/>:recent.error?
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
