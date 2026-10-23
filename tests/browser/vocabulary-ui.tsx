// Standalone presentation lab. Grading and covering here are deterministic fixtures, not production policy.
// npm run dev:frontend; open /tests/browser/vocabulary-ui.html.
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { VocabularySessionView } from '../../src/features/vocabulary-ui/VocabularySessionView';
import type { VocabularyCompletionView, VocabularyControl, VocabularyMode, VocabularySessionViewProps } from '../../src/features/vocabulary-ui/types';
import { advanceLabWord, bringBackLabWord, checkLabAnswer, currentLabWord, initialLabState, labWords, longSessionLabState, resetLabExercise, type LabState } from './vocabulary-ui-model';
import '../../src/styles.css';
import './vocabulary-ui-preview.css';

const scenarios = ['Practice', 'Answer rejected', 'Solidify warmup', 'Teaching', 'Finishing', 'Summary pending', 'Saved + feedback', 'Empty', 'Long content', 'Long session'] as const;
type Scenario = typeof scenarios[number];
const enabled: VocabularyControl = { visible: true, enabled: true };
const hidden: VocabularyControl = { visible: false, enabled: false };
const modeLabels: Record<VocabularyMode, string> = { unstudied: 'Teach', solidify: 'Solidify', practice: 'Practice', maintain: 'Maintain' };
const choices: VocabularySessionViewProps['modeChoices'] = [
  { value: 'unstudied', label: 'Teach', description: 'Start with an introduction and guided recall.', enabled: true },
  { value: 'solidify', label: 'Solidify', description: 'Warm up, then explore a few exercises.', enabled: true },
  { value: 'practice', label: 'Practice', description: 'Practise recall without a refresher first.', enabled: true },
  { value: 'maintain', label: 'Maintain', description: 'Keep the word familiar with lighter practice.', enabled: true },
];
function App() {
  const [scenario, setScenario] = useState<Scenario>('Practice');
  const [session, setSession] = useState(initialLabState);
  const previous = useRef<LabState | null>(null);
  const [reaction, setReaction] = useState<'helpful' | 'not-helpful' | null>(null);
  const [comment, setComment] = useState('');
  const [feedbackStatus, setFeedbackStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [notice, setNotice] = useState('');
  const [largeText, setLargeText] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [dismissed, setDismissed] = useState<string[]>([]);
  useEffect(() => {
    document.documentElement.style.fontSize = largeText ? '125%' : '';
    return () => { document.documentElement.style.fontSize = ''; };
  }, [largeText]);
  useEffect(() => { setReaction(null); setComment(''); setFeedbackStatus('idle'); }, [session.activeWordId, session.promptIndex]);
  function update(next: LabState) { previous.current = session; setSession(next); }
  function chooseScenario(next: Scenario) {
    const initial = next === 'Long session' ? longSessionLabState() : initialLabState();
    if (next === 'Answer rejected') Object.assign(initial, checkLabAnswer({ ...initial, value: '不想' }));
    if (next === 'Teaching') initial.modes.reluctant = 'unstudied';
    if (next === 'Solidify warmup') initial.modes.reluctant = 'solidify';
    if (next === 'Finishing') initial.phase = 'finishing';
    if (next === 'Summary pending' || next === 'Saved + feedback') {
      initial.phase = 'summary'; initial.marks.reluctant = 'covered'; initial.seen.push('reluctant');
    }
    previous.current = null; setSession(initial); setScenario(next); setNotice(''); setDismissed([]);
  }
  const word = currentLabWord(session);
  const mode = session.modes[word.id];
  const teaching = scenario === 'Teaching';
  const warmup = scenario === 'Solidify warmup';
  const empty = scenario === 'Empty';
  const completing = session.phase === 'summary';
  const covered = Object.values(session.marks).filter((mark) => mark === 'covered').length;
  const encountered = new Set([...session.seen, session.activeWordId]).size;
  const completion: VocabularyCompletionView | null = completing ? {
    status: scenario === 'Saved + feedback' ? 'closed' : 'pending', remainingSeconds: 12,
    elapsedLabel: '4:38', encountered, covered,
    outcomes: labWords.filter((entry) => session.seen.includes(entry.id) && !dismissed.includes(entry.id)).map((entry) => ({
      word: entry, detail: session.marks[entry.id] === 'covered' ? 'Covered for today' : 'Left for today · remains due',
      canPractise: true, canDismiss: session.marks[entry.id] !== 'covered', mode: session.modes[entry.id],
      modeLabel: modeLabels[session.modes[entry.id]], modeChoices: choices,
    })),
    feedback: scenario === 'Saved + feedback' ? [{ id: 'note-reluctant', title: '舍不得 — reluctance, with a reason', body: <p>You used <span lang="zh">不想</span>, which expresses not wanting to. <span lang="zh">舍不得</span> adds the sense that something matters to you: you’re reluctant to part with it, leave it, or use it up.</p> }] : [],
    canCancel: scenario !== 'Saved + feedback', canUndo: previous.current !== null && scenario !== 'Saved + feedback', canReturnHome: true,
  } : null;
  const bringBack = (wordId: string) => {
    update(bringBackLabWord(session, wordId)); setScenario('Practice');
    setNotice('Extra practice. Your earlier coverage is kept; choose “I’m satisfied” when you’re done.');
  };
  const props: VocabularySessionViewProps = {
    phase: session.phase === 'summary' ? 'completed' : session.phase, mode, modeLabel: modeLabels[mode], modeChoices: choices,
    visibleWord: teaching || warmup ? word : null,
    presentation: {
      key: `${word.id}-${scenario}-${session.promptIndex}`, kind: teaching ? 'introduction' : warmup ? 'warmup' : empty ? 'empty' : 'exercise',
      label: teaching ? 'Word introduction' : warmup ? 'A quick refresher' : empty ? 'Ready when you are' : session.extra ? 'Extra practice' : 'Production',
      prompt: teaching || warmup ? <><p>When something matters to you, <span lang="zh">舍不得</span> is the feeling of not wanting to part with it.</p><p lang="zh">假期结束了，我真舍不得离开。</p></> : empty ? 'You’ve worked through the exercises available here.' : scenario === 'Long content' ? 'You’re talking to someone about a book that has travelled with you for years. The cover is falling apart, you barely have space for it anymore, and you know you could find the same book anywhere — but you just can’t bring yourself to throw this particular copy away. How would you describe that feeling?' : word.prompts[session.promptIndex % word.prompts.length],
      supportingContent: teaching || warmup ? <p>The holiday is over. I really don’t want to leave.</p> : undefined,
    },
    response: {
      visible: !teaching && !warmup && !empty, value: session.value, placeholder: 'Type in Chinese', disabled: false, revealed: session.revealed,
      assessment: session.assessment,
      answer: <><div className="vocab-answer-word"><strong lang="zh">{word.hanzi}</strong><span>{word.pinyin}</span></div><p className="vocab-answer-meaning">{word.meaning}</p></>,
      message: session.assessment === 'rejected' ? `Your answer: ${session.value.trim() || 'No answer'}.` : session.assessment === 'accepted' && !session.extra ? 'Covered for today.' : undefined,
      primaryLabel: teaching ? 'Begin recall' : warmup ? 'Start practice' : empty ? 'Next word' : session.revealed ? session.assessment === 'accepted' && !session.extra ? 'Next word' : 'Continue' : session.value.trim() ? 'Check answer' : 'No clue',
      primaryEnabled: true,
    },
    history: [...session.seen].reverse().map((id) => ({ word: labWords.find((entry) => entry.id === id)!, status: session.marks[id], active: word.id === id, canResume: word.id !== id })),
    wordWork: { extraPractice: session.extra }, leaveForToday: session.extra && session.marks[word.id] === 'covered' ? hidden : enabled,
    progress: { encountered, covered, elapsedLabel: '4:38' },
    controls: {
      skip: teaching || warmup || empty ? hidden : enabled, another: teaching || warmup || empty ? hidden : enabled,
      enough: enabled, more: empty ? enabled : hidden, undo: previous.current ? enabled : hidden,
      finishForNow: session.phase === 'finishing' ? hidden : enabled,
      finishImmediately: session.phase === 'finishing' ? enabled : hidden, changeMode: hidden,
    },
    feedback: { visible: !empty, reaction, comment, status: feedbackStatus }, completion, busy: false, error: null,
    onResponseChange: (value) => setSession((current) => ({ ...current, value })),
    onPrimary: () => {
      if (teaching || warmup) { setScenario('Practice'); update(resetLabExercise(session)); }
      else if (empty) update(advanceLabWord(session, 'left'));
      else if (!session.revealed) update(checkLabAnswer(session));
      else if (session.assessment === 'accepted' && !session.extra) update(advanceLabWord(session, 'covered'));
      else update(resetLabExercise(session));
    },
    onAnother: () => { update(resetLabExercise(session)); setNotice('Another exercise for this word.'); },
    onSkip: () => { update(resetLabExercise(session)); setNotice('Exercise skipped; this word is still open.'); },
    onEnough: () => { update(advanceLabWord(session, 'covered')); setScenario('Practice'); setNotice(session.extra && session.marks[word.id] === 'covered' ? 'Extra practice finished; earlier coverage kept.' : 'Covered by your choice; this does not claim a correct answer.'); },
    onLeaveForToday: () => { update(advanceLabWord(session, session.marks[word.id] === 'covered' ? 'covered' : 'left')); setScenario('Practice'); setNotice('Left for today. Uncovered words stay due.'); },
    onMore: () => bringBack(word.id),
    onUndo: () => { if (previous.current) { setSession(previous.current); previous.current = null; setScenario('Practice'); setNotice('Last action undone.'); } },
    onFinishForNow: () => update({ ...session, phase: 'finishing' }),
    onFinishImmediately: () => update({ ...session, phase: 'summary', seen: [...new Set([...session.seen, word.id])] }),
    onModeChange: () => {},
    onWordModeChange: (wordId, next) => { update({ ...session, modes: { ...session.modes, [wordId]: next } }); setNotice(`${modeLabels[next]} selected for future practice.`); },
    onReaction: (next) => { setReaction(next); setFeedbackStatus('saved'); },
    onCommentChange: (next) => { setComment(next); setFeedbackStatus('idle'); }, onCommentSubmit: () => setFeedbackStatus('saved'),
    onCancelCompletion: () => { update({ ...session, phase: 'active' }); setScenario('Practice'); },
    onRetryCompletion: () => setScenario('Summary pending'),
    onReturnHome: () => setNotice('Preview: return to Home. This fixture stays open.'),
    onPractiseWord: bringBack, onDismissWord: (id) => setDismissed((items) => [...items, id]),
  };
  return <div className={`vocab-preview${largeText ? ' is-large-text' : ''}${narrow ? ' is-narrow' : ''}`}>
    <header className="vocab-preview-toolbar"><div><strong>Study UI</strong><span>Presentation preview · one correct exercise covers a word</span></div>
      <label>View<select aria-label="Preview state" value={scenario} onChange={(event) => chooseScenario(event.target.value as Scenario)}>{scenarios.map((name) => <option key={name}>{name}</option>)}</select></label>
      {scenario === 'Long session' && <button type="button" className="vocab-preview-activity" disabled={session.seen.includes('arrival')} onClick={() => {
        setSession((current) => ({ ...current, seen: [...current.seen, 'arrival'], marks: { ...current.marks, arrival: 'covered' }, modes: { ...current.modes, arrival: 'practice' } }));
        setNotice('A new covered word was added at the recent end.');
      }}>Simulate new activity</button>}
      <label className="vocab-preview-check"><input type="checkbox" checked={narrow} onChange={(event) => setNarrow(event.target.checked)} />Narrow panel</label>
      <label className="vocab-preview-check"><input type="checkbox" checked={largeText} onChange={(event) => setLargeText(event.target.checked)} />125% text</label>
    </header>
    <main><VocabularySessionView {...props} /></main>
    <p className="vocab-preview-notice" role="status">{notice}</p>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App />);
