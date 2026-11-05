import { vocabularyRemainingItemCount } from './remaining-items';
import './vocabulary-ruby.css';
import { useEffect, useRef, useState } from 'react';
import type { VocabularySessionViewProps, VocabularyControl, VocabularyModeChoice } from '../vocabulary-ui/types';
import { VocabularySessionView } from '../vocabulary-ui/VocabularySessionView';
import type { VocabularyStudyController } from './useVocabularyStudy';
import { vocabularySessionHistory } from './history';
import { vocabularyMaterialInstruction, vocabularyPresentationWord } from './render-material';
import { VocabularyAnswer, VocabularyContrastAnswer, VocabularyRecognitionPrompt } from './VocabularyAnswer';
import { VocabularyPersonalNotes } from './VocabularyPersonalNotes';
import { vocabularyCompletionOutcomeGroup } from './completion-outcome';
import { ClozePrompt } from '../session/ClozePrompt';
import { getVocabularyRecallProgress, getVocabularyCardOutcome, useVocabularyCardMotion } from './session-presentation';
import { formatCardCharacters, type CharacterPresentation, type SentenceCharacterPresentation } from '../../domain/card-characters';
import { convertSentenceCharacters, formatSentenceAnswer } from '../../domain/sentence-characters';
import { VocabularyIntroduction } from './VocabularyIntroduction';
import { ShortcutHint } from '../../components/ShortcutHint';
import { VocabularyShortcutGuide } from './VocabularyShortcutGuide';
import { resolveVocabularyKey, vocabularyChoiceShortcuts, type VocabularyShortcutCommand } from './keyboard';
import type { VocabularySessionJson } from '../../domain/vocabulary-session';

const modeChoices: VocabularyModeChoice[] = [
  { value: 'unstudied', label: 'Unstudied', description: 'Begin with an introduction and teaching exercises.', enabled: true },
  { value: 'solidify', label: 'Solidify', description: 'Daily warmup and practice until you choose to move on.', enabled: true },
  { value: 'practice', label: 'Practice', description: 'Retrieval practice spaced over time.', enabled: true },
  { value: 'maintain', label: 'Maintain', description: 'Lighter upkeep with approachable exercises.', enabled: true },
];
function materialObject(value: VocabularySessionJson | undefined) { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function elapsedLabel(first: string | undefined, now: number): string {
  const seconds = first ? Math.max(0, Math.floor((now - Date.parse(first)) / 1000)) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
export type VocabularyStudyProps = {
  controller: VocabularyStudyController;
  hideStartButton?: boolean;
  characterPresentation?: CharacterPresentation;
  sentenceCharacterPresentation?: SentenceCharacterPresentation;
};
export function VocabularyStudy({ controller, hideStartButton = false, characterPresentation = 'simplified', sentenceCharacterPresentation = 'simplified' }: VocabularyStudyProps) {
  const [reactionOpen, setReactionOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [confirmingRating, setConfirmingRating] = useState<'accepted' | 'rejected' | null>(null);
  const ratingTimer = useRef<ReturnType<typeof setTimeout>>();
  const keyboardHandler = useRef<(event: KeyboardEvent) => void>(() => {});
  const surface = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const c = controller;
  const study = c.study;
  const encounter = study?.currentEncounter ?? null;
  const currentId = encounter?.encounterId;
  const motion = useVocabularyCardMotion(currentId);
  useEffect(() => {
    setSelectedChoice(null); setConfirmingRating(null); setReactionOpen(false);
    clearTimeout(ratingTimer.current); ratingTimer.current = undefined;
    return () => { clearTimeout(ratingTimer.current); ratingTimer.current = undefined; };
  }, [currentId]);
  useEffect(() => {
    if (!study) return;
    const listener = (event: KeyboardEvent) => keyboardHandler.current(event);
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, [Boolean(study)]);
  if (!study) return hideStartButton ? c.error ? <p role="alert">{c.error}</p> : null : <section aria-label="Vocabulary study">
    {c.error && <p role="alert">{c.error}</p>}
    <button type="button" disabled={c.busy} onClick={() => { void c.start(); }}>{c.busy ? 'Preparing…' : 'Start session'}</button>
  </section>;
  const projection = study.session.projection;
  const word = study.words.find((entry) => entry.wordId === encounter?.wordId);
  const wordProgress = word ? projection.words[word.wordId] : null;
  const material = encounter?.snapshot.body.material;
  const intro = encounter?.snapshot.kind === 'introduction';
  const recognition = encounter?.snapshot.kind === 'recognition';
  const contrast = encounter?.snapshot.kind === 'contrast';
  const mode = wordProgress?.mode ?? null;
  const elapsed = elapsedLabel('1970-01-01T00:00:00.000Z',c.activeDurationMs);
  const completed = projection.phase === 'completed' || c.completion !== null;
  const completionUndoOpen = Boolean(c.completion?.status === 'pending' && c.completion.canUndo && c.remainingSeconds !== null && c.remainingSeconds > 0);
  const canAct = !c.busy && !c.saving && !confirmingRating && !motion.motionBusy && c.error === null;
  const control = (visible: boolean, enabled = true, reason?: string): VocabularyControl => ({ visible, enabled: enabled && canAct, ...(reason ? { reason } : {}) });
  function performPrimary() {
    if (composing.current || !canAct) return;
    if (encounter?.skipped || wordProgress?.workStatus === 'wrapped' || wordProgress?.workStatus === 'skipped') { return c.next(); }
    else if (intro) { return c.next(); }
    else if (contrast && !c.revealed) {
      const choice = selectedChoice === null ? undefined : displayedChoices[selectedChoice];
      if (choice) c.submitResponse(String(choice.hanzi), undefined, typeof choice.wordId === 'string' ? choice.wordId : undefined);
    } else if (recognition && !c.revealed) c.revealRecognition();
    else if (c.revealed || encounter?.skipped) return c.next();
    else c.submitResponse(c.input.trim().length ? c.input : null);
  }
  function primary(fromKeyboard = false) {
    if (!canAct || composing.current) return;
    void motion.runPrimary(performPrimary, {fromKeyboard: fromKeyboard && c.revealed, depart: c.revealed && !(recognition && c.assessment === 'unassessed'), outcome: getVocabularyCardOutcome(study!)});
  }
  function rateRecognition(value: 'accepted' | 'rejected', fromKeyboard = false) {
    if (!canAct || ratingTimer.current) return;
    const submit = () => c.submitResponse(null, value, undefined, async (savedStudy, advance) => {
      // Let the acknowledged recall chips render before cloning the outgoing card.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await motion.runPrimary(advance, { depart: true, outcome: getVocabularyCardOutcome(savedStudy) });
    });
    if (!fromKeyboard) { submit(); return; }
    setConfirmingRating(value);
    ratingTimer.current = setTimeout(() => {
      ratingTimer.current = undefined;
      submit();
      setConfirmingRating(null);
    }, 180);
  }
  const frozenWord = encounter?.snapshot.body.revealWords?.find((entry) => entry.wordId === word?.wordId) ?? word;
  const expectedAnswer = frozenWord ? formatSentenceAnswer(frozenWord, sentenceCharacterPresentation) : encounter?.snapshot.assessment?.acceptedAnswers[0] ?? '';
  const assessment = c.assessment;
  const submitted = encounter?.effectiveResponses.at(-1)?.payload;
  // A pure cue has no preferred member. Keep the learner's accepted input both
  // during optimistic reveal and when replaying the persisted response.
  const answerForms = encounter?.snapshot.schedulingScope === 'pure_cue' && assessment === 'accepted'
    ? (submitted?.response ?? c.input).trim() || expectedAnswer : expectedAnswer;
  const criteria = materialObject(encounter?.snapshot.assessment?.criteria);
  const choices = materialObject(material).choices;
  const displayedChoices = Array.isArray(choices) ? choices.map((entry) => materialObject(entry)).filter((entry) => typeof entry.hanzi === 'string') : [];
  const choiceShortcuts = vocabularyChoiceShortcuts(displayedChoices.length);
  const props: VocabularySessionViewProps = {
    recallProgress: intro ? [] : getVocabularyRecallProgress(study).filter((row) => row.total > 1),
    cardMotion: {ref:motion.deskRef,confirmingPrimary:motion.confirmingPrimary},
    phase: completed ? 'completed' : projection.phase === 'finishing' ? 'finishing' : 'active',
    mode, modeLabel: modeChoices.find((choice) => choice.value === mode)?.label ?? 'Practice', modeChoices,
    visibleWord: word ? vocabularyPresentationWord({ id: word.wordId, hanzi: formatCardCharacters(word, characterPresentation), pinyin: word.pinyin, meaning: word.meaning },encounter?.snapshot.kind??'production',c.revealed) : null,
    ...(intro && word ? { teachingContent: <VocabularyIntroduction key={currentId} material={material}
      teachingSource={encounter.snapshot.body.teachingSource} word={word} onContinue={() => { if (canAct) void c.next(); }}
      busy={!canAct} characterPresentation={characterPresentation} sentenceCharacterPresentation={sentenceCharacterPresentation}
      warmup={encounter.snapshot.role === 'priming'} /> } : {}),
    stopWord: control(mode === 'unstudied' && !completed && wordProgress?.workStatus !== 'skipped'),
    onStopWord: () => { void c.send({ type: 'skip', scope: 'word' }).then(() => c.next()); },
    presentation: { key: currentId ?? 'empty', kind: intro ? encounter?.snapshot.role === 'priming' ? 'warmup' : 'introduction' : encounter ? 'exercise' : 'empty',
      label: intro ? encounter?.snapshot.role === 'priming' ? 'Familiar warmup' : 'Introduction' : recognition ? 'Recognition' : contrast ? 'Choose the expression' : encounter?.snapshot.role === 'teaching' ? 'Try the taught word' : 'Produce Expression',
      recognition,
      prompt: recognition && encounter ? <VocabularyRecognitionPrompt snapshot={encounter.snapshot} word={word} revealed={c.revealed} sentenceCharacterPresentation={sentenceCharacterPresentation} /> : encounter?.snapshot.kind === 'production' ? <ClozePrompt text={encounter.snapshot.body.prompt} answer={c.revealed ? answerForms : null} contextAnswer={answerForms} sentenceCharacterPresentation={sentenceCharacterPresentation} /> : convertSentenceCharacters(encounter?.snapshot.body.prompt ?? study.notice ?? 'Choose another exercise or finish for now.', sentenceCharacterPresentation),
      supportingContent: <>
        {study.notice && !completed && <p role="status">{study.notice}</p>}
        {!intro && vocabularyMaterialInstruction(material) && <p>{vocabularyMaterialInstruction(material)}</p>}
        {contrast && !c.revealed && <div role="group" aria-label="Choose an answer">{displayedChoices.map((choice, index) => <button type="button" key={index} disabled={!canAct} aria-pressed={selectedChoice === index} aria-keyshortcuts={choiceShortcuts[index]?.key}
          className={`vocab-secondary${selectedChoice === index ? ' is-selected-choice' : ''}`} onClick={() => c.submitResponse(String(choice.hanzi), undefined, typeof choice.wordId === 'string' ? choice.wordId : undefined)}>{characterPresentation === 'traditional' && typeof choice.traditional === 'string' ? choice.traditional : choice.hanzi as string}<ShortcutHint shortcut={choiceShortcuts[index]?.key} /></button>)}</div>}
      </>,
    },
    response: { visible: !intro && !recognition && !contrast && !encounter?.skipped && wordProgress?.workStatus !== 'wrapped' && wordProgress?.workStatus !== 'skipped', value: c.input, placeholder: 'What Chinese comes to mind?', disabled: !canAct,
      revealed: c.revealed, assessment,
      answer: <>
        {assessment === 'rejected' && !recognition && !contrast && <p className="vocab-submitted-answer">{submitted?.response || c.input ? <>Your answer: <span lang="zh">{submitted?.response ?? c.input}</span></> : 'No answer entered.'}</p>}
        {encounter && <VocabularyAnswer snapshot={encounter.snapshot} word={word} characterPresentation={characterPresentation} sentenceCharacterPresentation={sentenceCharacterPresentation} />}
        {contrast && <VocabularyContrastAnswer material={material} selectedWordId={submitted?.selectedWordId ?? (selectedChoice === null ? undefined : String(displayedChoices[selectedChoice]?.wordId))} correctWordId={typeof criteria.correctWordId === 'string' ? criteria.correctWordId : undefined} sentenceCharacterPresentation={sentenceCharacterPresentation} />}
        {word && <VocabularyPersonalNotes word={word} />}

      </>,
      revealActions: c.revealed && recognition && assessment === 'unassessed' && <div className="vocab-recognition-actions" role="group" aria-label="How did you remember this word?">
          <button type="button" aria-keyshortcuts="2 Space" className={`vocab-primary${confirmingRating === 'accepted' ? ' is-confirming-action' : ''}`} disabled={!canAct} onClick={() => rateRecognition('accepted')}>Correct<ShortcutHint shortcuts={['2', 'Space']} /></button>
          <button type="button" aria-keyshortcuts="1" className={`vocab-secondary${confirmingRating === 'rejected' ? ' is-confirming-action' : ''}`} disabled={!canAct} onClick={() => rateRecognition('rejected')}>Forgot<ShortcutHint shortcut="1" /></button>
        </div>,
      shortcuts: !c.revealed && !recognition && !contrast ? c.input.trim() ? ['Enter'] : ['Shift+Enter'] : ['Space', 'Enter'],
      primaryPlacement: !intro && (c.revealed || encounter?.skipped || wordProgress?.workStatus === 'wrapped' || wordProgress?.workStatus === 'skipped') ? 'footer' : 'response',
      primaryLabel: contrast && !c.revealed ? selectedChoice === null ? 'Choose an answer' : 'Confirm selection' : encounter?.skipped ? 'Next exercise' : wordProgress?.workStatus === 'wrapped' || wordProgress?.workStatus === 'skipped' ? 'Next word' : intro ? 'Continue'
        : recognition && !c.revealed ? 'Reveal answer' : c.revealed || encounter?.skipped ? 'Next exercise' : c.input.trim() ? 'Check answer' : 'No clue',
      primaryEnabled: canAct && Boolean(encounter) && !(recognition && c.revealed && assessment === 'unassessed') && (!contrast || selectedChoice !== null),
    },
    history: completed ? [] : vocabularySessionHistory(study,c.revealed).map((entry)=>{
      const state=projection.words[entry.wordId];return {word:{id:entry.wordId,hanzi:formatCardCharacters(entry,characterPresentation),pinyin:entry.pinyin,meaning:entry.meaning},
        status:'covered' as const,active:entry.wordId===study.currentWordId,queued:state.workStatus==='open'&&entry.wordId!==study.currentWordId,
        canResume:canAct&&!state.teachingDeferred&&(state.workStatus==='wrapped'||state.workStatus==='skipped')};
    }),
    wordWork: {extraPractice:c.extraPracticeWordId===study.currentWordId},
    progress: { remaining: vocabularyRemainingItemCount(study.session.context, projection), encountered: Object.values(projection.words).filter((entry) => entry.admitted).length, covered: projection.coveredWordIds.length, elapsedLabel: elapsed },
    controls: {
      skip: control(!intro && encounter?.snapshot.role !== 'teaching' && assessment !== 'accepted' && study.controls.canSkip && !completed && !encounter?.skipped && wordProgress?.workStatus !== 'wrapped'),
      another: control(!c.revealed && !encounter?.skipped && wordProgress?.workStatus !== 'wrapped' && !intro && !recognition && encounter?.snapshot.role !== 'teaching' && study.controls.canNext && !completed),
      enough: control(study.controls.canEnough && !completed), more: control(study.controls.canMore && !completed),
      undo: control(study.controls.canUndo && !completed),
      finishForNow: control(study.controls.canFinishForNow && !completed), finishImmediately: control(study.controls.canFinishImmediately && !completed),
      changeMode: control(false),
    },
    reactionInput: { open: reactionOpen, visible: encounter !== null && !completed, reaction: c.reaction, comment: c.comment, status: c.reactionStatus },
    completion: completed ? {
      status: c.completion?.status === 'closed' ? 'closed' : c.completion?.status === 'failed' || c.error ? 'failed' : c.completion?.status === 'pending' ? 'pending' : 'saving',
      keepOpen: c.keepSummaryOpen,
      remainingSeconds: c.remainingSeconds, elapsedLabel: elapsed, covered: projection.coveredWordIds.length,
      encountered: Object.values(projection.words).filter((entry) => entry.admitted).length,
      outcomes: study.words.filter((entry) => projection.words[entry.wordId]?.admitted).map((entry) => {
        const outcome = projection.words[entry.wordId];
        return { word: { id: entry.wordId, hanzi: formatCardCharacters(entry, characterPresentation), pinyin: entry.pinyin, meaning: entry.meaning },
          group: vocabularyCompletionOutcomeGroup(outcome,c.summaryModes[entry.wordId]??outcome.recommendedMode??outcome.mode,c.dismissedWordIds.includes(entry.wordId)),
          detail: c.dismissedWordIds.includes(entry.wordId) ? 'Dismissed from study.' : outcome.teachingCompleted ? '' : outcome.covered ? outcome.successfulRecall ? '' : 'Work covered; this does not claim successful recall.' : 'Unfinished; remains due for another session.',
          canPractise: completionUndoOpen,
          mode:c.summaryModes[entry.wordId]??outcome.recommendedMode??outcome.mode, modeLabel:modeChoices.find((choice)=>choice.value===(c.summaryModes[entry.wordId]??outcome.recommendedMode??outcome.mode))?.label,
          modeChoices:modeChoices.map((choice)=>({...choice,enabled:canAct&&Boolean(c.completion&&(c.completion.status==='closed'||completionUndoOpen))})),
          canDismiss: !outcome.covered && !c.dismissedWordIds.includes(entry.wordId) && Boolean(c.completion),
        };
      }),
      feedback: [], canCancel: completionUndoOpen,
      canUndo: Boolean(completionUndoOpen && projection.latestUndoableActionId), canReturnHome: !c.saving && c.completion !== null,
    } : null,
    busy: c.busy, saving: c.saving, error: c.error,
    onResponseChange: c.setInput, onPrimary: primary,
    onSkip: () => { void c.send({ type: 'skip' }).then(() => c.next()); }, onAnother: () => { if (canAct) void motion.runPrimary(() => c.next({ another: true }), { depart: true, shuffle: true }); },
    onEnough: () => { void c.endWord(true); },
    onMore: () => { if (word) void c.resume(word.wordId); },
    onUndo: () => { void c.undo(); }, onFinishForNow: () => { void c.finishForNow(); }, onFinishImmediately: () => { void c.finishImmediately(); },
    onModeChange: () => undefined, onWordModeChange:(wordId,nextMode)=>{void c.changeSummaryMode(wordId,nextMode);},
    onShowShortcuts: () => setGuideOpen(true), onReactionOpenChange: setReactionOpen,
    onReaction: c.react, onCommentChange: c.setComment, onCommentSubmit: c.submitComment,
    onCancelCompletion: () => { void c.resume(); }, onRetryCompletion: () => { void c.retrySave(); }, onReturnHome: () => { void c.returnHome(); },
    onKeepSummaryOpen: c.keepSummaryOpenNow,
    onPractiseWord: (wordId, source) => { if (!canAct) return; if(projection.words[wordId]?.covered)void motion.runPrimary(() => c.requeue(wordId), { source });else void c.resume(wordId); }, onDismissWord: (wordId) => { void c.dismissWord(wordId); },
  };
  if (contrast && c.revealed) props.response.primaryEnabled = canAct;
  const available = new Set<VocabularyShortcutCommand>(['guide']);
  const actions: Partial<Record<VocabularyShortcutCommand, () => void>> = {
    primary: () => primary(true), noClue: () => c.submitResponse(null),
    focusInput: () => {
      const input = surface.current?.querySelector<HTMLInputElement>('.vocab-input-wrap input');
      if (input === document.activeElement) surface.current?.focus(); else input?.focus();
    },
    focusReaction: () => {
      const input = surface.current?.querySelector<HTMLTextAreaElement>('.vocab-reaction-drawer.is-open textarea:not(:disabled)');
      if (input === document.activeElement) surface.current?.focus(); else input?.focus();
    },
    forgot: () => rateRecognition('rejected', true), correct: () => rateRecognition('accepted', true),
    undo: props.onUndo, another: props.onAnother, skip: props.onSkip, enough: props.onEnough,
    more: props.onMore, finish: props.onFinishForNow, reactions: () => setReactionOpen((value) => !value),
    helpful: () => { setReactionOpen(true); c.react(c.reaction === 'helpful' ? null : 'helpful'); },
    notHelpful: () => { setReactionOpen(true); c.react(c.reaction === 'not-helpful' ? null : 'not-helpful'); },
    guide: () => setGuideOpen(true), home: props.onReturnHome,
  };
  for (const { command, index } of choiceShortcuts) actions[command] = () => setSelectedChoice(index);
  if (props.reactionInput.visible && reactionOpen && props.reactionInput.status !== 'saving') available.add('focusReaction');
  const controlKeys = { undo: 'U', another: 'A', skip: 'S', enough: 'D', more: 'M', finishForNow: 'F' } as const;
  for (const [name, key] of Object.entries(controlKeys)) {
    const item = props.controls[name as keyof typeof controlKeys];
    item.shortcut = key;
    if (item.visible && item.enabled) available.add(name === 'finishForNow' ? 'finish' : name as VocabularyShortcutCommand);
  }
  if (canAct) {
    if (completed) {
      if (props.completion?.canReturnHome) available.add('home');
      if (props.completion?.canUndo) available.add('undo');
    } else {
      if (!intro && props.response.primaryEnabled) available.add('primary');
      if (props.response.visible && !c.revealed) { available.add('noClue'); available.add('focusInput'); }
      if (recognition && c.revealed && assessment === 'unassessed') { available.add('correct'); available.add('forgot'); }
      if (contrast && !c.revealed) {
        for (const { command } of choiceShortcuts) available.add(command);
      }
      if (props.reactionInput.visible) {
        available.add('reactions');
        if (c.reactionStatus !== 'saving') { available.add('helpful'); available.add('notHelpful'); }
      }
    }
  }
  keyboardHandler.current = (event) => {
    const element = event.target instanceof HTMLElement ? event.target : null;
    const editable = element?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
    const target = editable ? editable.matches('.vocab-input-wrap input') ? 'answer'
      : editable.matches('.vocab-reaction-drawer textarea') ? 'reaction' : 'editable'
      : element?.closest('button, a, summary') ? 'native' : 'surface';
    // Do not turn Space into "No clue" or submit a partially typed answer while blurred.
    const candidates = new Set(available);
    if (props.response.visible && !c.revealed && (event.key === ' ' || !c.input.trim())) candidates.delete('primary');
    const command = resolveVocabularyKey({ ...event, key: event.key, code: event.code, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey,
      metaKey: event.metaKey, altKey: event.altKey, repeat: event.repeat, defaultPrevented: event.defaultPrevented,
      isComposing: composing.current || event.isComposing, keyCode: event.keyCode }, {
      available: candidates, target,
      modalOpen: guideOpen || Boolean(document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')),
    });
    if (command) { event.preventDefault(); actions[command]?.(); }
    else if (event.key === 'Enter' && !event.shiftKey && target === 'answer' && !c.input.trim() && !c.revealed) {
      // Prevent the form's implicit submit from treating empty Enter as No clue.
      event.preventDefault();
    }
  };
  return <div className="vocab-study-surface" ref={surface} tabIndex={-1} onCompositionStartCapture={() => { composing.current = true; }} onCompositionEndCapture={() => { composing.current = false; }}
    onKeyDownCapture={(event) => {
      if (event.key === 'Enter' && (composing.current || event.nativeEvent.isComposing || event.keyCode === 229)) { event.preventDefault(); event.stopPropagation(); }
    }}>
    <VocabularyShortcutGuide open={guideOpen} onClose={() => setGuideOpen(false)} />
    <VocabularySessionView {...props} />
    {c.error && !completed && <p><button type="button" disabled={c.busy} onClick={() => { void c.retrySave(); }}>Retry saving</button></p>}
  </div>;
}
