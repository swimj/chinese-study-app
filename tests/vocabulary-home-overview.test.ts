import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'node:test';
import { VocabularyHomeOverview } from '../src/pages/VocabularyHomePage.tsx';
import { vocabularyActiveTimeMetrics, vocabularyStudyWeek, type VocabularyStatistics } from '../src/domain/vocabulary-statistics.ts';

const statistics: VocabularyStatistics = { days: [{ dayKey: '2026-10-24', sessions: 2, coveredWords: 3,
  unknownCoverageSessions: 0, acceptedResponses: 12, rejectedResponses: 2, activeDurationMs: 180000, unknownDurationSessions: 0 }],
  modes: { unstudied: 2, solidify: 4, practice: 6, maintain: 0 }, studyDays: { today: '2026-10-24', studied: [] } };
function render(options: Partial<Parameters<typeof VocabularyHomeOverview>[0]> = {}) {
  return renderToStaticMarkup(createElement(VocabularyHomeOverview, { compact: false, busy: false, settings: false,
    saving: false, guideToSettings: false, statistics, onStart: () => {}, onToggleSettings: () => {},
    preview: {status:'ready',preview:{previewSeed:'00000000-0000-4000-8000-000000000001',itemCount:25,preparationPending:false,timed:false},error:null}, ...options }));
}

test('expanded or waiting Connections uses the established compact Start control without Home metrics', () => {
  const html = render({ compact: true });
  assert.match(html, /class="panel home-overview is-compact"/);
  assert.match(html, /class="session-start-card"/);
  assert.match(html, /Start session/);
  assert.match(html, /aria-label="Session settings"/);
  assert.match(html, /25 study items ready/);
  assert.doesNotMatch(html, /Today|Study details|Work on your words/);
  assert.doesNotMatch(html.match(/<button[^>]*class="session-start-card"[^>]*>/)?.[0] ?? '', /disabled/);
});

test('Home distinguishes count loading, empty ready work, and unavailable preview in either layout',()=>{
  for(const compact of [false,true]) {
    const loading=render({compact,preview:{status:'loading',preview:null,error:null}});
    assert.match(loading,/Preparing session/);
    assert.match(loading.match(/<button[^>]*class="session-start-card"[^>]*>/)?.[0]??'',/disabled/);
    const empty=render({compact,preview:{status:'ready',preview:{previewSeed:'seed',itemCount:0,preparationPending:true,timed:false},error:null}});
    assert.match(empty,/Check again/);assert.match(empty,/0 study items ready/);assert.match(empty,/preparing introductions/);
    const failed=render({compact,preview:{status:'error',preview:null,error:'Offline'}});
    assert.match(failed,/Start session/);assert.match(failed,/Ready count unavailable/);
    assert.doesNotMatch(failed.match(/<button[^>]*class="session-start-card"[^>]*>/)?.[0]??'',/disabled/);
  }
});

test('collapsed Connections retains the standard Start card and vocabulary statistics', () => {
  const html = render();
  assert.match(html, /class="panel home-overview"/);
  assert.doesNotMatch(html, /is-compact/);
  assert.match(html, /Start session|Today|Study details/);
  assert.match(html, /<dt>Responses<\/dt><dd>14<\/dd>/);
});

test('compact Start retains preparation and settings guards', () => {
  const preparing = render({ compact: true, busy: true });
  assert.match(preparing, /Preparing session/);
  assert.match(preparing.match(/<button[^>]*class="session-start-card"[^>]*>/)?.[0] ?? '', /disabled/);
  const settings = render({ compact: true, settings: true, saving: true });
  assert.match(settings, /session-start-shell is-settings-open/);
  assert.match(settings.match(/<button[^>]*class="session-start-card"[^>]*>/)?.[0] ?? '', /disabled/);
  const settingsButton = settings.match(/<button[^>]*class="session-settings-gear"[^>]*>/)?.[0] ?? '';
  assert.match(settingsButton, /disabled=""/);
  assert.match(settingsButton, /aria-expanded="true"/);
});

test('active-time trends include zero days and disclose missing measurements without estimating them',()=>{
  const days=Array.from({length:7},(_,index)=>({...statistics.days[0]!,dayKey:`2026-10-${18+index}`,
    activeDurationMs:index===6?180000:index===5?60000:0,unknownDurationSessions:index===5?1:0}));
  assert.deepEqual(vocabularyActiveTimeMetrics(days),{today:180000,average3:80000,average7:240000/7,unknownDurationSessions:1});
  const html=render({statistics:{...statistics,days}});
  assert.match(html,/<span>Today<\/span><strong>3:00<\/strong>/);
  assert.match(html,/<span>3-day average<\/span><strong>1:20<\/strong>/);
  assert.match(html,/<span>7-day average<\/span><strong>0:34<\/strong>/);
  assert.match(html,/Time is unavailable for 1 session\(s\) in the last 7 days/);
});

test('timed Home starts the day without presenting the due ledger, still naming an empty start',()=>{
  const ready=render({preview:{status:'ready',preview:{previewSeed:'seed',itemCount:25,preparationPending:false,timed:true},error:null}});
  assert.match(ready,/Start session/);assert.match(ready,/<span class="session-start-card-helper"><\/span>/);assert.doesNotMatch(ready,/study items ready/);
  const empty=render({preview:{status:'ready',preview:{previewSeed:'seed',itemCount:0,preparationPending:true,timed:true},error:null}});
  assert.match(empty,/Check again/);assert.match(empty,/Nothing ready yet · preparing introductions/);assert.doesNotMatch(empty,/0 study items/);
});

const timedReady={status:'ready' as const,preview:{previewSeed:'seed',itemCount:25,preparationPending:false,timed:true},error:null};
test('a studied day turns timed Start into studying a little more, and only in the timed paradigm',()=>{
  const studied={...statistics,studyDays:{today:'2026-10-24',studied:['2026-10-22','2026-10-24']}};
  assert.match(render({preview:timedReady}),/Start session/);
  assert.match(render({preview:timedReady,statistics:studied}),/Study a little more/);
  assert.doesNotMatch(render({preview:timedReady,statistics:studied}),/Start session/);
  assert.match(render({statistics:studied}),/Start session/);
  const empty=render({statistics:studied,preview:{...timedReady,preview:{...timedReady.preview,itemCount:0}}});
  assert.match(empty,/Check again/);
  assert.match(render({statistics:studied,preview:{status:'loading',preview:null,error:null}}),/Preparing session/);
});

test('the week runs Monday to Sunday with studied, open, and upcoming days and no counts',()=>{
  // 2026-10-24 is a Saturday.
  const week=vocabularyStudyWeek({today:'2026-10-24',studied:['2026-10-17','2026-10-19','2026-10-21','2026-10-24']});
  assert.deepEqual(week.map(day=>[day.dayKey,day.label,day.state]),[
    ['2026-10-19','M','studied'],['2026-10-20','T','open'],['2026-10-21','W','studied'],['2026-10-22','T','open'],
    ['2026-10-23','F','open'],['2026-10-24','S','studied'],['2026-10-25','S','upcoming']]);
  assert.equal(vocabularyStudyWeek({today:'2026-10-19',studied:[]})[0]!.dayKey,'2026-10-19');
  assert.equal(vocabularyStudyWeek({today:'2026-10-25',studied:[]}).at(-1)!.dayKey,'2026-10-25');
  const html=render({statistics:{...statistics,studyDays:{today:'2026-10-24',studied:['2026-10-19','2026-10-24']}}});
  assert.match(html,/role="img" aria-label="This week: studied Monday, Saturday"/);
  assert.match(html,/class="study-week-day is-studied is-today"/);
  assert.doesNotMatch(html,/streak/i);
  assert.match(render({statistics:{...statistics,studyDays:{today:'2026-10-24',studied:[]}}}),/aria-label="This week: no study yet"/);
  assert.doesNotMatch(render({compact:true}),/study-week/);
});
