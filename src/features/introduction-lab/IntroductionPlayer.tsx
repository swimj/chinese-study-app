import { getRehearsalInstruction } from '../rehearsal-presentation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TeachingPackageSnapshot } from '../../domain/word-content';
import {
  type IntroductionPlayerAction,
  type IntroductionPlayerState,
} from './player';

import { teachingNavigationKeyAction } from './teaching-navigation';

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (
    target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A', 'SUMMARY'].includes(target.tagName)
  );
}

export function IntroductionPlayer({ snapshot, state, onAction, onRestart, onFinish, finishing, mode = 'full' }: {
  snapshot: TeachingPackageSnapshot;
  state: IntroductionPlayerState;
  onAction: (action: IntroductionPlayerAction) => void;
  onRestart: () => void;
  onFinish?: () => void;
  finishing?: boolean;
  mode?: 'full' | 'teaching-only';
}) {
  const [browsing, setBrowsing] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const programmaticScrollRef = useRef(false);
  const newestRef = useRef<HTMLElement>(null);
  const answerRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);
  const resultRef = useRef<HTMLDivElement>(null);

  function focusCurrent(smooth = true) {
    const viewport = viewportRef.current;
    const current = newestRef.current;
    if (!viewport || !current) return;
    setBrowsing(false);
    programmaticScrollRef.current = true;
    clearTimeout(scrollTimerRef.current);
    viewport.scrollTo({
      top: current.offsetTop - 24,
      behavior: smooth && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'instant',
    });
    current.focus({ preventScroll: true });
    scrollTimerRef.current = setTimeout(() => { programmaticScrollRef.current = false; }, 550);
  }

  function act(action: IntroductionPlayerAction) {
    if (action.type === 'continue') {
      if (!finishing) onFinish?.();
      return;
    }
    onAction(action);
  }

  useLayoutEffect(() => {
    if (state.phase === 'introduction') focusCurrent();
    else if (state.phase === 'rehearsal') answerRef.current?.focus();
    else if (state.phase === 'result') resultRef.current?.focus();
  }, [snapshot, state.phase, state.beatIndex, state.exerciseIndex]);

  useEffect(() => () => clearTimeout(scrollTimerRef.current), []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      const action = teachingNavigationKeyAction({
        key: event.key,
        repeat: event.repeat,
        composing: event.isComposing || event.keyCode === 229,
        editable: isInteractiveTarget(event.target),
        modified: event.metaKey || event.ctrlKey || event.altKey,
      }, state.phase, browsing);
      if (!action) {
        // A held Space must not fall through to native scrolling after returning.
        if (event.repeat && event.key === ' ' && state.phase === 'introduction'
          && !event.isComposing && !isInteractiveTarget(event.target)
          && !event.metaKey && !event.ctrlKey && !event.altKey) event.preventDefault();
        return;
      }
      event.preventDefault();
      if (action.type === 'focus-current') focusCurrent();
      else act(action);
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [snapshot, state.phase, onAction, browsing, finishing, onFinish]);

  const exercise = snapshot.rehearsals[state.exerciseIndex];
  const instruction = exercise ? getRehearsalInstruction(exercise) : '';
  return <div className="intro-lab-player">
    {state.phase === 'introduction' && <>
      <div className="intro-lab-progress"><span>Introduction</span><span>{state.beatIndex + 1} of {snapshot.beats.length}</span></div>
      <div className={`intro-teaching-viewport${browsing ? ' browsing' : ''}`}
        ref={viewportRef} role="region" aria-label="Teaching steps; scroll up to revisit"
        onWheel={() => { programmaticScrollRef.current = false; }}
        onTouchStart={() => { programmaticScrollRef.current = false; }}
        onScroll={() => {
          if (programmaticScrollRef.current || !viewportRef.current || !newestRef.current) return;
          setBrowsing(Math.abs(viewportRef.current.scrollTop - (newestRef.current.offsetTop - 24)) > 16);
        }}>
      <div className="intro-lab-beat-stack">
        {snapshot.beats.slice(0, state.beatIndex + 1).map((beat, index) => (
          <article key={beat.id} ref={index === state.beatIndex ? newestRef : undefined}
            tabIndex={index === state.beatIndex ? -1 : undefined}
            className={`intro-lab-beat${index === state.beatIndex ? ' newest' : ' past'}`}
            aria-label={`Beat ${index + 1}${index === state.beatIndex ? ', current' : ''}`}>
            <span className="intro-lab-beat-number">{String(index + 1).padStart(2, '0')}</span>
            <div className="intro-lab-beat-copy">
              {beat.parts.map((part, partIndex) => <p key={partIndex}
                lang={part.source.kind === 'example' && part.source.field === 'sentence' ? 'zh-Hans' : undefined}
                className={part.source.kind === 'example' ? `intro-lab-part-${part.source.field}` : undefined}>
                {part.text}
              </p>)}
            </div>
          </article>
        ))}
      </div>
      </div>
      <div className="intro-teaching-location" aria-live="polite">{state.beatIndex > 0 ? '↑ Earlier steps' : ''}</div>
      <div className="intro-lab-player-actions">
        <button type="button" className="intro-lab-button outline" disabled={state.beatIndex === 0} onClick={() => act({ type: 'back' })}>Back</button>
        <button type="button" className="intro-lab-button primary" onClick={() => browsing ? focusCurrent() : act({ type: 'advance' })}>
          {browsing ? 'Back to current step' : state.beatIndex === snapshot.beats.length - 1 ? mode === 'teaching-only' ? 'Finish walkthrough' : 'Try the expression' : 'Continue'} <kbd>Space</kbd>
        </button>
      </div>
    </>}
    {state.phase === 'rehearsal' && exercise && <>
      <div className="intro-lab-progress"><span>Target rehearsal</span><span>{state.exerciseIndex + 1} of {snapshot.rehearsals.length}</span></div>
      <div className="intro-lab-practice-card">
        {instruction && <h3>{instruction}</h3>}
        <p className="intro-lab-stimulus" lang={exercise.stimulus.source.kind === 'example_cloze' ? 'zh-Hans' : undefined}>{exercise.stimulus.text}</p>
        <form onSubmit={(event) => {
          event.preventDefault();
          if (!composingRef.current) act({ type: 'submit' });
        }}>
          <label htmlFor="intro-lab-answer">Your answer</label>
          <input id="intro-lab-answer" ref={answerRef} value={state.response} autoComplete="off"
            onCompositionStart={() => { composingRef.current = true; }}
            onCompositionEnd={() => { composingRef.current = false; }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229 || composingRef.current)) {
                event.preventDefault();
              }
            }}
            onChange={(event) => act({ type: 'edit', response: event.target.value })}
            placeholder="Type Chinese characters" />
          <div className="intro-lab-player-actions">
            <button type="button" className="intro-lab-button outline" onClick={() => act({ type: 'back' })}>Back to introduction</button>
            <button type="button" className="intro-lab-button subtle" onClick={() => act({ type: 'reveal' })}>Show taught answer</button>
            <button type="submit" className="intro-lab-button primary" disabled={!state.response.trim()}>Check answer</button>
          </div>
        </form>
      </div>
    </>}
    {state.phase === 'result' && exercise && <div ref={resultRef} tabIndex={-1} className="intro-lab-result">
      <p className="intro-lab-kicker">{state.result === 'accepted' ? 'That is the taught expression' : state.result === 'revealed' ? 'The taught expression' : 'Keep this expression in mind'}</p>
      <h3 lang="zh-Hans">{exercise.acceptedAnswers[0]?.hanzi}</h3>
      {exercise.acceptedAnswers[0]?.traditional && exercise.acceptedAnswers[0].traditional !== exercise.acceptedAnswers[0].hanzi &&
        <p>Traditional: {exercise.acceptedAnswers[0].traditional}</p>}
      {state.result === 'rejected' && <p>Your answer did not match this constrained rehearsal. Another expression may be natural in the sentence; this exercise asks for the one just taught.</p>}
      <div className="intro-lab-player-actions">
        <button type="button" className="intro-lab-button outline" onClick={() => act({ type: 'retry' })}>Try again</button>
        <button type="button" className="intro-lab-button primary" onClick={() => act({ type: 'next' })}>
          {state.exerciseIndex < snapshot.rehearsals.length - 1 ? 'Next rehearsal' : 'Finish introduction'} <kbd>Space</kbd>
        </button>
      </div>
    </div>}
    {state.phase === 'finished' && <div className="intro-lab-finished">
      <h3>Introduction complete</h3>
      <div className="intro-lab-player-actions">
        {onFinish && <button type="button" className="intro-lab-button primary" disabled={finishing}
          onClick={onFinish}>{finishing ? 'Saving…' : <>Continue <kbd>Enter</kbd></>}</button>}
        <button type="button" className={`intro-lab-button ${onFinish ? 'outline' : 'primary'}`} onClick={onRestart}>Start again</button>
      </div>
    </div>}
    {mode === 'full' && <p className="intro-lab-preview-note">No mastery grade is recorded here.</p>}
  </div>;
}
