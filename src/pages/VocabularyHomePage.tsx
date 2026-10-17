import { fetchVocabularyStatistics } from '../services/api';
import type { VocabularyStatistics } from '../domain/vocabulary-statistics';
import { useEffect, useState, type ReactNode } from 'react';
import type { BackendStatus } from '../services/api';
import type { ComponentProps } from 'react';
import { HomeUpdates, HomeUpdatesCollapsedControl } from './HomeUpdates';
import { SessionSettingsPanel } from './HomeOverviewPanel';
import type { WhatsNewCatalog } from '../features/attention/useWhatsNewCatalog';
import { useSessionDebrief } from '../features/session/useSessionDebrief';
import { HomeConnections } from '../features/session/HomeConnections';
import { useHomeConnectionsView } from '../features/session/useHomeConnectionsView';

export function VocabularyHomePage(props: {
  backendStatus: BackendStatus|null; active:boolean; busy:boolean; studySurface:ReactNode; onStart:()=>void;
  guideToSettings:boolean; onSettingsOpened:()=>void;
  onSaveSessionSettings:ComponentProps<typeof SessionSettingsPanel>['onSaveSessionSettings'];
  updatesCatalog:WhatsNewCatalog; unseenPostIds:readonly string[];
  onUnseenBadgeVisible:(ids:string[])=>Promise<void>; updatesCollapsed:boolean; onToggleUpdatesCollapsed:()=>void;
  onOpenUpdate:(id:string)=>void; onViewAllUpdates:()=>void;
}) {
  const [settings,setSettings]=useState(false),[saving,setSaving]=useState(false);
  const [statistics,setStatistics]=useState<VocabularyStatistics|null>(null);
  useEffect(()=>{if(!props.active)void fetchVocabularyStatistics().then(setStatistics).catch(()=>setStatistics(null));},[props.active]);
  const today=statistics?.days.at(-1);
  const recent=useSessionDebrief(undefined,!props.active);
  const connections=useHomeConnectionsView(recent.debrief,!props.active&&!settings);
  if(props.active)return <div className="home-page home-session-active">{props.studySurface}</div>;
  return <div className="home-page">
    {props.updatesCollapsed?<HomeUpdatesCollapsedControl unseenPostIds={props.unseenPostIds} onVisible={props.onUnseenBadgeVisible} onExpand={props.onToggleUpdatesCollapsed}/>:null}
    <div className="grid home-grid home-with-updates">
      <section className="panel home-overview">
        <button className="session-start-card" type="button" disabled={props.busy||settings} onClick={props.onStart}>
          <span className="session-start-card-label">{props.busy?'Preparing session…':'Start session'}</span>
          <span className="session-start-card-helper">Work on your words, with room to try another way.</span>
        </button>
        <button type="button" className={`secondary-button${props.guideToSettings?' getting-started-attention':''}`} disabled={saving} aria-expanded={settings}
          onClick={()=>{setSettings(!settings);if(!settings)props.onSettingsOpened();}}>Session settings</button>
        {today?<div className="vocabulary-home-stats" aria-label="Today’s study"><h2>Today</h2>
          <dl><div><dt>Sessions</dt><dd>{today.sessions}</dd></div><div><dt>Responses</dt><dd>{today.acceptedResponses+today.rejectedResponses}</dd></div><div><dt>Active time</dt><dd>{Math.round(today.activeDurationMs/60000)} min</dd></div></dl>
          <details><summary>Study details</summary><p>{today.acceptedResponses} accepted responses · {today.rejectedResponses} missed responses. A response is an exercise result, not a measure of mastery.</p>{today.unknownDurationSessions?<p>Time is unavailable for {today.unknownDurationSessions} session(s).</p>:null}<p>Today follows the UTC study day.</p></details>
        </div>:null}
      </section>
      {settings?<SessionSettingsPanel backendStatus={props.backendStatus} onSaveSessionSettings={props.onSaveSessionSettings} onSavingChange={setSaving} onClose={()=>setSettings(false)}/>:null}
      {!settings&&recent.debrief?<HomeConnections key={recent.debrief.sessionId} debrief={recent.debrief} expanded={connections.expanded} error={recent.error} retrying={recent.retrying} onToggle={connections.toggle} onRetry={recent.retry} onReload={recent.reload}/>:null}
      {!settings&&!props.updatesCollapsed?<HomeUpdates catalog={props.updatesCatalog} unseenPostIds={props.unseenPostIds} onUnseenBadgeVisible={props.onUnseenBadgeVisible} onOpenPost={props.onOpenUpdate} onViewAll={props.onViewAllUpdates} onCollapse={props.onToggleUpdatesCollapsed}/>:null}
    </div>
  </div>;
}
