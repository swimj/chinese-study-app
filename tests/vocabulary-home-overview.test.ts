import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'node:test';
import { HomeProgressArea, VocabularyHomeOverview } from '../src/pages/VocabularyHomePage.tsx';
import { formatStudyTime, HomeProgress, weekStudyTimeMs } from '../src/pages/HomeProgress.tsx';
import type { VocabularyProgress } from '../src/domain/vocabulary-progress.ts';
import { vocabularyStudyWeek, type VocabularyStatistics } from '../src/domain/vocabulary-statistics.ts';

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

test('collapsed Connections keeps the Start card and week, without the old Today and active-time blocks', () => {
  const html = render();
  assert.match(html, /class="panel home-overview"/);
  assert.doesNotMatch(html, /is-compact/);
  assert.match(html, /Start session/);
  assert.match(html, /study-week/);
  assert.doesNotMatch(html, /Today’s study|Study details|Responses|Active study time|3-day average/);
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

test('timed Home starts the day without presenting the due ledger, still naming an empty start',()=>{
  const ready=render({preview:{status:'ready',preview:{previewSeed:'seed',itemCount:25,preparationPending:false,timed:true},error:null}});
  assert.match(ready,/Start session/);assert.doesNotMatch(ready,/session-start-card-helper/);assert.doesNotMatch(ready,/study items ready/);
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

const rate=(success:number,failure:number,extra:Partial<VocabularyProgress['recognition']>={})=>({rate:success+failure<10?null:success/(success+failure),success,failure,void:0,pending:0,...extra});
// 2026-10-24 is a Saturday: the week began Monday 2026-10-19.
const progress:VocabularyProgress={today:'2026-10-24',
  days:Array.from({length:14},(_,index)=>{const day=new Date(Date.UTC(2026,9,11+index)).toISOString().slice(0,10);
    return {dayKey:day,wordItems:index===13?12:index===10?4:0,cueItems:index===13?3:0,activeDurationMs:day>='2026-10-19'?(index===13?3_600_000:index===10?2_400_000:0):9_000_000};}),
  activeVocabulary:{total:42,addedLast30Days:7},
  firstProductions:[{wordId:'w1',hanzi:'鼓舞',pinyin:'gǔwǔ',dayKey:'2026-10-23'},{wordId:'w2',hanzi:'阐述',pinyin:'chǎnshù',dayKey:'2026-10-20'}],
  recognition:rate(18,2),stickiness:{...rate(3,1,{void:1,pending:2}),wordAttempts:3,cueAttempts:1},transfer:rate(0,0),
  efficiency:[{month:'2026-09',medianSessions:3,settled:6,settling:2},{month:'2026-10',medianSessions:null,settled:1,settling:9}]};
const empty:VocabularyProgress={...progress,days:progress.days.map(day=>({...day,wordItems:0,cueItems:0,activeDurationMs:0})),
  activeVocabulary:{total:0,addedLast30Days:0},firstProductions:[],recognition:rate(0,0),stickiness:{...rate(0,0),wordAttempts:0,cueAttempts:0},transfer:rate(0,0),efficiency:[]};
const studied={...statistics,studyDays:{today:'2026-10-24',studied:['2026-10-21','2026-10-24']}};

test('the week shows its cumulative measured time beside the dots, and omits it without measured time or in the compact layout',()=>{
  assert.equal(weekStudyTimeMs(progress),6_000_000);
  assert.deepEqual([formatStudyTime(6_000_000),formatStudyTime(25*60_000),formatStudyTime(10_000),formatStudyTime(3_600_000)],['1h 40m','25m','1m','1h']);
  assert.match(render({statistics:studied,progress}),/class="study-week"[^>]*>.*<span class="study-week-time">1h 40m this week<\/span><\/div>/);
  assert.doesNotMatch(render({statistics:studied,progress:empty}),/this week</);
  assert.doesNotMatch(render({statistics:studied,progress:null}),/this week</);
  assert.doesNotMatch(render({statistics:studied,progress,compact:true}),/this week|study-week/);
});

test('progress shows the 7-day stacked bars, indicators, null rates, and one disclosure per indicator',()=>{
  const html=renderToStaticMarkup(createElement(HomeProgress,{progress}));
  assert.match(html,/<svg class="home-progress-bars"[^>]*role="img" aria-label="Items practised, last 7 days: Sunday 0 word skills, 0 shared cues; .*Wednesday 4 word skills, 0 shared cues; .*Saturday 12 word skills, 3 shared cues"/);
  assert.equal(html.match(/class="home-progress-bar-words"/g)?.length,2);
  assert.equal(html.match(/class="home-progress-bar-cues"/g)?.length,1);
  assert.equal(html.match(/class="home-progress-day"/g)?.length,7);
  assert.match(html,/Word skills.*Shared cues/);
  assert.match(html,/<strong>42<\/strong><span>\+7 in the last 30 days<\/span>/);
  assert.match(html,/鼓舞.*gǔwǔ.*Oct 23.*阐述/);
  assert.match(html,/<th scope="row">Recognition<\/th><td>90%<\/td><td>20<\/td>/);
  assert.match(html,/<th scope="row">Stickiness<\/th><td>Not enough yet<\/td><td>4<\/td>/);
  assert.match(html,/<th scope="row">Transfer<\/th><td>Not enough yet<\/td><td>0<\/td>/);
  assert.match(html,/About stickiness<\/summary>.*3 word-skill and 1 shared-cue attempts.*Not counted: 1 judged unfair, 2 awaiting judgment/);
  assert.match(html,/Sep 2026<\/th><td>3<\/td><td>6<\/td><td>2<\/td>.*Oct 2026<\/th><td>Not enough yet<\/td><td>1<\/td><td>9<\/td>/);
  assert.equal(html.match(/<details/g)?.length,6);
  // Units are items; only active vocabulary, first productions and per-word efficiency speak of words.
  const itemSections=html.slice(html.indexOf('home-progress-activity'),html.indexOf('home-progress-vocabulary'))+html.slice(html.indexOf('Exercise results'),html.indexOf('About recognition'));
  assert.doesNotMatch(itemSections.replace(/class="[^"]*"/g,'').replace(/word[ -]skills?/gi,''),/\bwords?\b/i);
});

test('an empty history draws the axis and day labels with no bars, and omits empty lists',()=>{
  const html=renderToStaticMarkup(createElement(HomeProgress,{progress:empty}));
  assert.match(html,/home-progress-axis/);
  assert.equal(html.match(/class="home-progress-day"/g)?.length,7);
  assert.doesNotMatch(html,/home-progress-bar-(words|cues)|First productions|Sessions to Practice/);
  assert.match(html,/<strong>0<\/strong>/);
  assert.doesNotMatch(html,/in the last 30 days/);
});

test('progress is absent while loading and shows one quiet retry line on failure',()=>{
  const area=(status:'idle'|'loading'|'ready'|'error',value:VocabularyProgress|null=null)=>renderToStaticMarkup(createElement(HomeProgressArea,{state:{status,value},onRetry:()=>{}}));
  assert.equal(area('idle'),'');assert.equal(area('loading'),'');
  assert.match(area('ready',progress),/class="home-progress"/);
  assert.match(area('error'),/<p class="notes" role="status">Couldn’t load progress\. <button[^>]*>Try again<\/button><\/p>/);
});
