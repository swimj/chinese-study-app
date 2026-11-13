import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppChrome, NestedNav } from '../../src/components/AppChrome';
import { SavedPage, type SavedPageApi } from '../../src/pages/SavedPage';
import { HomeConnections, type HomeConnectionReactions } from '../../src/features/session/HomeConnections';
import { useContentReactions } from '../../src/features/reactions/useContentReactions';
import type { SavedCollection } from '../../src/domain/content-reactions';
import type { SessionDebrief } from '../../src/domain/session-debrief';
import { createMemoryReactionsApi } from './memory-reactions';
import '../../src/styles.css';
import '../../src/features/session/home-connections.css';
import '../../src/features/reactions/reactions.css';
import './vocabulary-feedback.css';

// Illustrative fixture copy, not app-generated content.
const notes = [
  { text: '学问 and 问题 share 问: one is the accumulated asking that becomes knowledge, the other is the open asking that still needs an answer. 学而不问，问而不学 — neither half works alone.', refs: ['w1', 'w2'] },
  { text: '报备 keeps something on record; 申请 asks for permission. If your landlord only needs to know, 报备 is enough.', refs: ['w3'] },
  { text: 'A long note to exercise wrapping: '.repeat(1) + '当你把“局面”和“局势”放在一起看，会发现一个偏向已经形成、可以被打开或扭转的情况，另一个偏向更大的、仍在变化的形势。'.repeat(4), refs: ['w4'] },
];
const words = [{ word: '学问', pinyin: 'xué wèn' }, { word: '问题', pinyin: 'wèn tí' }, { word: '报备', pinyin: 'bào bèi' }, { word: '局面', pinyin: 'jú miàn' }];
const wordOf = (ref: string) => words[Number(ref.slice(1)) - 1];
const debrief: SessionDebrief = { sessionId: 'fixture-today', completedAt: '2026-11-12T03:00:00.000Z', status: 'ready', exerciseCount: 24,
  error: null, attemptCount: 1, notes: notes.map((note) => ({ ...note, followUp: null })) };
const older = { sessionId: 'fixture-older', completedAt: '2026-10-28T03:00:00.000Z', text: '馋 is wanting something tasty even when full; 饿 is actual hunger.', words: [{ word: '馋', pinyin: 'chán' }] };

const reactions = createMemoryReactionsApi([
  { subject: { kind: 'connection', sessionId: 'fixture-older', noteIndex: 0 }, reaction: 'saved', reasons: [], note: 'The sweet potato example made this stick.', updatedAt: '2026-10-28T04:00:00.000Z' },
  { subject: { kind: 'lesson', messageId: 'lesson-1' }, reaction: 'saved', reasons: [], note: null, updatedAt: '2026-11-01T04:00:00.000Z' },
  { subject: { kind: 'connection', sessionId: 'fixture-today', noteIndex: 1 }, reaction: 'not_for_me', reasons: ['already_knew'], note: null, updatedAt: '2026-11-12T04:00:00.000Z' },
]);

function collection(empty: boolean): SavedCollection {
  if (empty) return { connections: [], lessons: [] };
  const state = (sessionId: string, noteIndex: number) => [...reactions.states.values()].find((s) => s.subject.kind === 'connection'
    && s.subject.sessionId === sessionId && s.subject.noteIndex === noteIndex) ?? null;
  return {
    connections: [
      ...notes.map((note, noteIndex) => ({ sessionId: debrief.sessionId, noteIndex, completedAt: debrief.completedAt, text: note.text,
        words: note.refs.map(wordOf), reaction: state(debrief.sessionId, noteIndex) })),
      { ...older, noteIndex: 0, reaction: state(older.sessionId, 0) },
    ],
    lessons: [{ messageId: 'lesson-1', subjectLabel: '局面', createdAt: '2026-11-01T03:00:00.000Z',
      body: { title: '局面 and 局势', text: 'Your answer 局势 was reasonable. 局面 often describes how a situation has developed and what can be done about it.\n\n打开局面 — make a breakthrough' },
      reaction: [...reactions.states.values()].find((s) => s.subject.kind === 'lesson')! }],
  };
}

function HomeScenario() {
  const contentReactions = useContentReactions('home', reactions.api);
  const [expanded, setExpanded] = useState(true);
  const value = useMemo<HomeConnectionReactions>(() => ({
    stateFor: (noteIndex) => contentReactions.stateFor({ kind: 'connection', sessionId: debrief.sessionId, noteIndex }),
    onChange: (noteIndex, choice) => contentReactions.change({ kind: 'connection', sessionId: debrief.sessionId, noteIndex }, choice),
    error: contentReactions.error,
  }), [contentReactions.stateFor, contentReactions.change, contentReactions.error]);
  return <div className={`home-page${expanded ? ' home-connections-expanded' : ''}`}><div className="grid home-grid">
    <HomeConnections debrief={debrief} expanded={expanded} error={null} retrying={false} onToggle={() => setExpanded(!expanded)}
      onRetry={() => undefined} onReload={() => undefined} reactions={value} />
  </div></div>;
}

function Preview() {
  const params = new URLSearchParams(window.location.search);
  const [scenario, setScenario] = useState(params.get('scenario') ?? 'saved');
  const api = useMemo<SavedPageApi>(() => ({ fetchCollection: async () => collection(scenario === 'empty'), reactions: reactions.api }), [scenario]);
  return <>
    <aside className="feedback-example-controls">
      <strong>Saved items preview · illustrative copy</strong>
      <label>Scenario <select value={scenario} onChange={(event) => setScenario(event.target.value)}>
        <option value="saved">Saved page</option><option value="empty">Saved page, nothing yet</option><option value="home">Home connections</option>
      </select></label>
      <button type="button" onClick={() => { reactions.control.failNext = true; }}>Fail next save</button>
    </aside>
    <AppChrome currentPage={scenario === 'home' ? 'home' : 'reflections'} error={null} serviceBanner={null} sessionActive={false}
      priorityPageLoading={false} reflectionPageLoading={false} contentPageLoading={false}
      onOpenHomePage={() => setScenario('home')} onOpenReflectionsPage={() => setScenario('saved')}
      onOpenPriorityPage={() => undefined} onOpenContentPage={() => undefined} onOpenAboutPage={() => undefined}>
      {scenario === 'home' ? <HomeScenario /> : <>
        <NestedNav><nav className="reflection-view-rail" aria-label="Feedback views">
          <button type="button" className="reflection-view-rail-tab">Lessons</button>
          <button type="button" className="reflection-view-rail-tab active" aria-current="page">Saved</button>
        </nav></NestedNav>
        <SavedPage key={scenario} api={api} />
      </>}
    </AppChrome>
  </>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
