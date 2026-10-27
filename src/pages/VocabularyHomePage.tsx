import { SessionStartCard } from '../components/SessionStartCard';
import { fetchVocabularyStatistics, fetchVocabularySessionPreview } from '../services/api';
import { vocabularyActiveTimeMetrics, type VocabularyStatistics } from '../domain/vocabulary-statistics';
import { useEffect, useState, type ReactNode } from 'react';
import type { BackendStatus } from '../services/api';
import type { ComponentProps } from 'react';
import { HomeUpdates, HomeUpdatesCollapsedControl } from './HomeUpdates';
import { SessionSettingsPanel, ActiveTimeMetric } from './HomeOverviewPanel';
import type { WhatsNewCatalog } from '../features/attention/useWhatsNewCatalog';
import { useSessionDebrief } from '../features/session/useSessionDebrief';
import { HomeConnections } from '../features/session/HomeConnections';
import { useHomeConnectionsView } from '../features/session/useHomeConnectionsView';
import { ConnectionSignals } from '../features/session/ConnectionSignals';
import { createVocabularyHomePreviewLoader, INITIAL_VOCABULARY_HOME_PREVIEW, type VocabularyHomePreviewState } from '../features/vocabulary-study/home-preview';

export function VocabularyHomeOverview(props: {
  compact: boolean; busy: boolean; settings: boolean; saving: boolean; guideToSettings: boolean;
  statistics: VocabularyStatistics|null; onStart:()=>void; onToggleSettings:()=>void;
  preview?: VocabularyHomePreviewState;
}) {
  const today=props.statistics?.days.at(-1);
  const activeTime=vocabularyActiveTimeMetrics(props.statistics?.days??[]);
  const preview=props.preview??INITIAL_VOCABULARY_HOME_PREVIEW;
  const pending=preview.status==='loading';
  const count=preview.preview?.itemCount;
  return <section className={`panel home-overview${props.compact?' is-compact':''}`}>
    <SessionStartCard disabled={props.busy||props.settings||pending} onStart={props.onStart}
      settingsOpen={props.settings} settingsSaving={props.saving} guideToSettings={props.guideToSettings}
      onToggleSettings={props.onToggleSettings} helperTitle={preview.error??undefined}
      label={props.busy||pending?'Preparing session…':count===0?'Check again':'Start session'}
      helper={<>{count===undefined?preview.status==='error'?'Ready count unavailable':'… study items ready':`${count} study items ready`}
        {count===0&&preview.preview?.preparationPending?' · preparing introductions':''}</>} />
    {!props.compact&&today?<>
      <div className="vocabulary-home-stats" aria-label="Today’s study"><h2>Today</h2>
        <dl><div><dt>Sessions</dt><dd>{today.sessions}</dd></div><div><dt>Responses</dt><dd>{today.acceptedResponses+today.rejectedResponses}</dd></div></dl>
        <details><summary>Study details</summary><p>{today.acceptedResponses} accepted responses · {today.rejectedResponses} missed responses. A response is an exercise result, not a measure of mastery.</p>{activeTime.unknownDurationSessions?<p>Time is unavailable for {activeTime.unknownDurationSessions} session(s) in the last 7 days.</p>:null}<p>Today follows the UTC study day.</p></details>
      </div>
      <section className="failure-rate-section" aria-label="Active study time"><h3>Active study time</h3>
        <div className="failure-rate-list"><ActiveTimeMetric label="Today" value={activeTime.today} /><ActiveTimeMetric label="3-day average" value={activeTime.average3} /><ActiveTimeMetric label="7-day average" value={activeTime.average7} /></div>
      </section>
    </>:null}
  </section>;
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
  useEffect(()=>{if(props.active)setSettings(false);},[props.active]);
  const recent=useSessionDebrief(undefined,!props.active);
  const connections=useHomeConnectionsView(recent.debrief,!props.active&&!settings);
  const connectionsExpanded=!settings&&connections.expanded;
  if(props.active)return <div className="home-page home-session-active">{props.studySurface}</div>;
  return <div className={`home-page${connectionsExpanded?' home-connections-expanded':''}${props.updatesCollapsed?' home-updates-collapsed':''}`}>
    {connectionsExpanded?<ConnectionSignals />:null}
    {!connectionsExpanded&&!settings&&props.updatesCollapsed?<HomeUpdatesCollapsedControl unseenPostIds={props.unseenPostIds} onVisible={props.onUnseenBadgeVisible} onExpand={props.onToggleUpdatesCollapsed}/>:null}
    <div className={`grid home-grid${!connectionsExpanded&&!settings&&!props.updatesCollapsed?' home-with-updates':''}`}>
      <VocabularyHomeOverview compact={connectionsExpanded} busy={props.busy} settings={settings} saving={saving}
        guideToSettings={props.guideToSettings} statistics={statistics} preview={preview}
        onStart={()=>{if(preview.preview?.itemCount===0)setPreviewRevision((value)=>value+1);else props.onStart(preview.preview?.previewSeed);}}
        onToggleSettings={()=>{if(!saving){setSettings(!settings);if(!settings)props.onSettingsOpened();}}} />
      {settings?<SessionSettingsPanel backendStatus={props.backendStatus} onSaveSessionSettings={async(settings)=>{await props.onSaveSessionSettings(settings);setPreviewRevision((value)=>value+1);}} onSavingChange={setSaving} onClose={()=>setSettings(false)}/>:null}
      {!settings&&recent.debrief?<HomeConnections key={recent.debrief.sessionId} debrief={recent.debrief} expanded={connections.expanded} error={recent.error} retrying={recent.retrying} onToggle={connections.toggle} onRetry={recent.retry} onReload={recent.reload}/>:recent.error?
        <p className="notes" role="status">Couldn’t load the recent session. <button type="button" className="secondary-button" onClick={recent.reload}>Try again</button></p>:null}
      {!connectionsExpanded&&!settings&&!props.updatesCollapsed?<HomeUpdates catalog={props.updatesCatalog} unseenPostIds={props.unseenPostIds} onUnseenBadgeVisible={props.onUnseenBadgeVisible} onOpenPost={props.onOpenUpdate} onViewAll={props.onViewAllUpdates} onCollapse={props.onToggleUpdatesCollapsed}/>:null}
    </div>
  </div>;
}
