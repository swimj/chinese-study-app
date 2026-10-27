// Standalone presentation lab. Grading and covering here are deterministic fixtures, not production policy.
// npm run dev:frontend; open /tests/browser/vocabulary-ui.html.
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { VocabularyAnswer, VocabularyRecognitionPrompt } from '../../src/features/vocabulary-study/VocabularyAnswer';
import type { VocabularyEncounterSnapshot } from '../../src/domain/vocabulary-session';
import { VocabularyWarmup } from '../../src/features/vocabulary-study/VocabularyWarmup';
import { VocabularyIntroduction } from '../../src/features/vocabulary-study/VocabularyIntroduction';
import { materializeTeachingPackage } from '../../src/domain/word-content/materialize';
import { wordContentFixtures } from '../fixtures/word-content';
import type { VocabularySessionJson } from '../../src/domain/vocabulary-session';
import { VocabularyHistoryTrial, type HistoryTrial } from './vocabulary-ui-history-trials';
import type { VocabularyCompletionView, VocabularyControl, VocabularyMode, VocabularySessionViewProps } from '../../src/features/vocabulary-ui/types';
import { advanceLabWord, bringBackLabWord, checkLabAnswer, currentLabWord, initialLabState, labWords, longSessionLabState, resetLabExercise, type LabState } from './vocabulary-ui-model';
import '../../src/styles.css';
import '../../src/features/session/session-desk.css';
import '../../src/features/introduction-lab/styles.css';
import '../../src/features/word-introduction/styles.css';
import './vocabulary-ui-preview.css';
import '../../src/features/vocabulary-study/vocabulary-ruby.css';

const warmupFixture = wordContentFixtures.find((entry) => entry.content.word.hanzi === '不堪')!;
const warmupSource = JSON.parse(JSON.stringify(warmupFixture.content)) as VocabularySessionJson;
const warmupWord = { ...warmupFixture.content.word, meaning: warmupFixture.content.uses.map((use) => use.label).join('; ') };
const recognitionUse = warmupFixture.content.uses[0]!;
const recognitionExample = warmupFixture.content.examples.find((entry) => entry.id === recognitionUse.exampleIds[0])!;
const recognitionSnapshot: VocabularyEncounterSnapshot = { kind: 'recognition', role: 'general', contentId: 'recognition-preview', contentVersion: 1,
  body: { prompt: warmupWord.hanzi, revealWords: [warmupWord], bootstrapReveal: { contentId: warmupFixture.content.id,
    useId: recognitionUse.id, exampleId: recognitionExample.id, englishFrame: recognitionUse.label,
    exampleSentence: recognitionExample.text, exampleTranslation: recognitionExample.translation ?? '' } }, assessment: null };
const teachingFixture = wordContentFixtures[0]!;
const teachingSnapshot = materializeTeachingPackage(teachingFixture.teaching, [teachingFixture.content]);
const teachingMaterial = JSON.parse(JSON.stringify({ beats: teachingSnapshot.beats })) as VocabularySessionJson;
const teachingSource = JSON.parse(JSON.stringify(teachingFixture.content)) as VocabularySessionJson;
const teachingWord = { ...teachingFixture.content.word, meaning: teachingFixture.content.uses[0]!.label };

const scenarios = ['Practice', 'Fresh session', 'Recognition', 'Answer rejected', 'Solidify warmup', 'Teaching', 'Finishing', 'Summary pending', 'Saved + feedback', 'Empty', 'Long content', 'Long session'] as const;
type Scenario = typeof scenarios[number];
const previewParams = new URLSearchParams(window.location.search);
const initialScenario = scenarios.find((entry) => entry === previewParams.get('state')) ?? 'Practice';
const historyPlacements = ['below', 'left', 'right', 'drawer'] as const;
const initialPlacement = historyPlacements.find((entry) => entry === previewParams.get('history')) ?? 'right';
function scenarioState(next: Scenario): LabState {
  const initial = next === 'Long session' ? longSessionLabState() : initialLabState();
  if (next === 'Fresh session') { initial.seen = []; initial.marks = { reluctant: 'open', maybe: 'open' }; }
  if (next === 'Answer rejected') Object.assign(initial, checkLabAnswer({ ...initial, value: '不想' }));
  if (next === 'Teaching') initial.modes.reluctant = 'unstudied';
  if (next === 'Solidify warmup') initial.modes.reluctant = 'solidify';
  if (next === 'Finishing') initial.phase = 'finishing';
  if (next === 'Summary pending' || next === 'Saved + feedback') {
    initial.phase = 'summary'; initial.marks.reluctant = 'covered'; initial.seen.push('reluctant');
  }
  return initial;
}
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
  const [scenario, setScenario] = useState<Scenario>(initialScenario);
  const [session, setSession] = useState(() => scenarioState(initialScenario));
  const [historyPlacement, setHistoryPlacement] = useState<HistoryTrial>(initialPlacement);
  const [busyArrival, setBusyArrival] = useState(previewParams.get('busy') === '1');
  const [arriving, setArriving] = useState(false);
  const arrivalTimer = useRef<ReturnType<typeof setTimeout>>();
  const previous = useRef<LabState | null>(null);
  const [reaction, setReaction] = useState<'helpful' | 'not-helpful' | null>(null);
  const [comment, setComment] = useState('');
  const [reactionStatus, setReactionStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [notice, setNotice] = useState('');
  const [largeText, setLargeText] = useState(previewParams.get('large') === '1');
  const [narrow, setNarrow] = useState(previewParams.get('narrow') === '1');
  const [dismissed, setDismissed] = useState<string[]>([]);
  useEffect(() => {
    document.documentElement.style.fontSize = largeText ? '125%' : '';
    return () => { document.documentElement.style.fontSize = ''; };
  }, [largeText]);
  useEffect(() => { setReaction(null); setComment(''); setReactionStatus('idle'); }, [session.activeWordId, session.promptIndex]);
  useEffect(() => () => clearTimeout(arrivalTimer.current), []);
  function update(next: LabState) {
    previous.current = session; setSession(next);
    if (busyArrival && (next.activeWordId !== session.activeWordId || next.promptIndex !== session.promptIndex)) {
      clearTimeout(arrivalTimer.current); setArriving(true);
      arrivalTimer.current = setTimeout(() => setArriving(false), 600);
    }
  }
  function chooseScenario(next: Scenario) {
    clearTimeout(arrivalTimer.current); setArriving(false);
    const initial = scenarioState(next);
    previous.current = null; setSession(initial); setScenario(next); setNotice(''); setDismissed([]);
  }
  const word = currentLabWord(session);
  const mode = session.modes[word.id];
  const teaching = scenario === 'Teaching';
  const warmup = scenario === 'Solidify warmup';
  const recognition = scenario === 'Recognition';
  const empty = scenario === 'Empty';
  const completing = session.phase === 'summary';
  const covered = Object.values(session.marks).filter((mark) => mark === 'covered').length;
  const encountered = new Set([...session.seen, session.activeWordId]).size;
  const completion: VocabularyCompletionView | null = completing ? {
    status: scenario === 'Saved + feedback' ? 'closed' : 'pending', remainingSeconds: 12,
    elapsedLabel: '4:38', encountered, covered,
    outcomes: labWords.filter((entry) => session.seen.includes(entry.id) && !dismissed.includes(entry.id)).map((entry) => ({
      word: entry, group: session.marks[entry.id] === 'covered' ? 'covered' as const : 'unfinished' as const,
      detail: session.marks[entry.id] === 'covered' ? '' : 'Left for today · remains due',
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
    ...(teaching ? { teachingContent: <VocabularyIntroduction key={scenario} material={teachingMaterial}
      teachingSource={teachingSource} word={teachingWord} busy={false}
      characterPresentation="simplified" sentenceCharacterPresentation="simplified"
      onContinue={() => { setScenario('Practice'); update(resetLabExercise(session)); }} /> } : {}),
    ...(warmup ? { teachingContent: <VocabularyWarmup material={undefined} teachingSource={warmupSource} word={warmupWord}
      busy={false} characterPresentation="simplified" sentenceCharacterPresentation="simplified"
      onContinue={() => { setScenario('Practice'); update(resetLabExercise(session)); }} /> } : {}),
    presentation: {
      key: `${word.id}-${scenario}-${session.promptIndex}`, kind: teaching ? 'introduction' : warmup ? 'warmup' : empty ? 'empty' : 'exercise',
      recognition,
      label: recognition ? 'Recognition' : teaching ? 'Word introduction' : warmup ? 'A quick refresher' : empty ? 'Ready when you are' : session.extra ? 'Extra practice' : 'Production',
      prompt: recognition ? <VocabularyRecognitionPrompt snapshot={recognitionSnapshot} word={warmupWord} revealed={session.revealed} sentenceCharacterPresentation="simplified" /> : teaching || warmup ? <><p>When something matters to you, <span lang="zh">舍不得</span> is the feeling of not wanting to part with it.</p><p lang="zh">假期结束了，我真舍不得离开。</p></> : empty ? 'You’ve worked through the exercises available here.' : scenario === 'Long content' ? 'You’re talking to someone about a book that has travelled with you for years. The cover is falling apart, you barely have space for it anymore, and you know you could find the same book anywhere — but you just can’t bring yourself to throw this particular copy away. How would you describe that feeling?' : word.prompts[session.promptIndex % word.prompts.length],
      supportingContent: teaching || warmup ? <p>The holiday is over. I really don’t want to leave.</p> : undefined,
    },
    response: {
      visible: !recognition && !teaching && !warmup && !empty, value: session.value, placeholder: 'What Chinese comes to mind?', disabled: arriving, revealed: session.revealed,
      assessment: session.assessment,
      answer: recognition ? <VocabularyAnswer snapshot={recognitionSnapshot} word={warmupWord} characterPresentation="simplified" sentenceCharacterPresentation="simplified" /> : <><div className="vocab-answer-word"><strong lang="zh">{word.hanzi}</strong><span>{word.pinyin}</span></div><p className="vocab-answer-meaning">{word.meaning}</p></>,
      message: recognition ? undefined : session.assessment === 'rejected' ? `Your answer: ${session.value.trim() || 'No answer'}.` : session.assessment === 'accepted' && !session.extra ? 'Covered for today.' : undefined,
      primaryPlacement: !recognition && !teaching && !warmup && (empty || session.revealed) ? 'footer' : 'response',
      primaryLabel: recognition ? session.revealed ? 'Continue' : 'Reveal answer' : teaching || warmup ? 'Continue' : empty ? 'Next word' : session.revealed ? session.assessment === 'accepted' && !session.extra ? 'Next word' : 'Continue' : session.value.trim() ? 'Check answer' : 'No clue',
      revealActions: recognition && session.revealed ? <div className="vocab-recognition-actions">
        <button type="button" className="vocab-primary" aria-keyshortcuts="2 Space" onClick={() => update(advanceLabWord(session, 'covered'))}>Correct</button>
        <button type="button" className="vocab-secondary" aria-keyshortcuts="1" onClick={() => update(resetLabExercise(session))}>Forgot</button>
      </div> : undefined,
      primaryEnabled: true,
      shortcuts: !session.revealed && !recognition && !teaching && !warmup && !empty ? session.value.trim() ? ['Enter'] : ['Shift+Enter'] : ['Space', 'Enter'],
    },
    history: [...session.seen].reverse().filter((id) => session.revealed || teaching || warmup || id !== word.id)
      .map((id) => ({ word: labWords.find((entry) => entry.id === id)!, status: session.marks[id], active: word.id === id, canResume: word.id !== id })),
    wordWork: { extraPractice: session.extra },
    progress: { encountered, covered, remaining: Object.values(session.marks).filter((mark) => mark === 'open').length, elapsedLabel: '4:38' },
    controls: {
      skip: teaching || warmup || empty || session.assessment === 'accepted' ? hidden : enabled,
      another: recognition || teaching || warmup || empty || session.revealed ? hidden : enabled,
      enough: teaching || (session.assessment === 'accepted' && !session.extra) ? hidden : enabled, more: empty || (session.assessment === 'accepted' && !session.extra) ? enabled : hidden, undo: previous.current ? enabled : hidden,
      finishForNow: session.phase === 'finishing' ? hidden : enabled,
      finishImmediately: session.phase === 'finishing' ? enabled : hidden, changeMode: hidden,
    },
    reactionInput: { visible: !empty, reaction, comment, status: reactionStatus }, completion, busy: arriving, error: null,
    onResponseChange: (value) => setSession((current) => ({ ...current, value })),
    onPrimary: () => {
      if (recognition && !session.revealed) update({ ...session, revealed: true, assessment: 'unassessed' });
      else if (teaching || warmup) { setScenario('Practice'); update(resetLabExercise(session)); }
      else if (empty) update(advanceLabWord(session, 'left'));
      else if (!session.revealed) update(checkLabAnswer(session));
      else if (session.assessment === 'accepted' && !session.extra) update(advanceLabWord(session, 'covered'));
      else update(resetLabExercise(session));
    },
    onAnother: () => { update(resetLabExercise(session)); setNotice('Another exercise for this word.'); },
    onSkip: () => { update(resetLabExercise(session)); setNotice('Exercise skipped; this word is still open.'); },
    stopWord: teaching ? enabled : hidden, onStopWord: () => { chooseScenario('Practice'); setNotice('Teaching left unfinished.'); },
    onEnough: () => { update(advanceLabWord(session, 'covered')); setScenario('Practice'); setNotice(session.extra && session.marks[word.id] === 'covered' ? 'Extra practice finished; earlier coverage kept.' : 'Covered by your choice; this does not claim a correct answer.'); },
    onMore: () => bringBack(word.id),
    onUndo: () => { if (previous.current) { setSession(previous.current); previous.current = null; setScenario('Practice'); setNotice('Last action undone.'); } },
    onFinishForNow: () => update({ ...session, phase: 'finishing' }),
    onFinishImmediately: () => update({ ...session, phase: 'summary', seen: [...new Set([...session.seen, word.id])] }),
    onModeChange: () => {},
    onWordModeChange: (wordId, next) => { update({ ...session, modes: { ...session.modes, [wordId]: next } }); setNotice(`${modeLabels[next]} selected for future practice.`); },
    onReaction: (next) => { setReaction(next); setReactionStatus('saved'); },
    onCommentChange: (next) => { setComment(next); setReactionStatus('idle'); }, onCommentSubmit: () => setReactionStatus('saved'),
    onCancelCompletion: () => { update({ ...session, phase: 'active' }); setScenario('Practice'); },
    onRetryCompletion: () => setScenario('Summary pending'),
    onReturnHome: () => setNotice('Preview: return to Home. This fixture stays open.'),
    onPractiseWord: bringBack, onDismissWord: (id) => setDismissed((items) => [...items, id]),
  };
  return <div className={`vocab-preview${largeText ? ' is-large-text' : ''}${narrow ? ' is-narrow' : ''}`}>
    <header className="vocab-preview-toolbar"><div><strong>Study UI</strong><span>Presentation preview · deterministic sample states</span></div>
      <label>View<select aria-label="Preview state" value={scenario} onChange={(event) => chooseScenario(event.target.value as Scenario)}>{scenarios.map((name) => <option key={name}>{name}</option>)}</select></label>
      <label>History<select aria-label="History placement" value={historyPlacement} onChange={(event) => setHistoryPlacement(event.target.value as HistoryTrial)}>
        <option value="below">Below</option><option value="left">Left rail</option><option value="right">Right rail</option><option value="drawer">Side drawer</option>
      </select></label>
      {scenario === 'Long session' && <button type="button" className="vocab-preview-activity" disabled={session.seen.includes('arrival')} onClick={() => {
        setSession((current) => ({ ...current, seen: [...current.seen, 'arrival'], marks: { ...current.marks, arrival: 'covered' }, modes: { ...current.modes, arrival: 'practice' } }));
        setNotice('A new covered word was added at the recent end.');
      }}>Simulate new activity</button>}
      <label className="vocab-preview-check"><input type="checkbox" checked={narrow} onChange={(event) => setNarrow(event.target.checked)} />Narrow panel</label>
      <label className="vocab-preview-check"><input type="checkbox" checked={largeText} onChange={(event) => setLargeText(event.target.checked)} />125% text</label>
      <label className="vocab-preview-check"><input type="checkbox" checked={busyArrival} onChange={(event) => setBusyArrival(event.target.checked)} />Busy arrival</label>
    </header>
    <main><VocabularyHistoryTrial placement={historyPlacement} props={props} /></main>
    <p className="vocab-preview-notice" role="status">{notice}</p>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App />);
