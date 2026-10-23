import { useEffect, useRef, useState } from 'react';
import type { VocabularySessionViewProps, VocabularyControl, VocabularyModeChoice } from '../vocabulary-ui/types';
import { VocabularySessionView } from '../vocabulary-ui/VocabularySessionView';
import type { VocabularyStudyController } from './useVocabularyStudy';
import { vocabularySessionHistory } from './history';
import { renderVocabularyTeaching, renderVocabularyReveal, vocabularyTeachingBeats, vocabularyMaterialInstruction, vocabularyPresentationWord, renderVocabularyRecognitionAnswer } from './render-material';
import { formatCardCharacters, type CharacterPresentation, type SentenceCharacterPresentation } from '../../domain/card-characters';
import { convertSentenceCharacters } from '../../domain/sentence-characters';
import type { VocabularySessionJson } from '../../domain/vocabulary-session';

const modeChoices: VocabularyModeChoice[] = [
  { value: 'unstudied', label: 'Unstudied', description: 'Begin with an introduction and teaching exercises.', enabled: true },
  { value: 'solidify', label: 'Solidify', description: 'A familiar warmup and daily practice.', enabled: true },
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
  const [beat, setBeat] = useState(0);
  const surface = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const c = controller;
  const study = c.study;
  const encounter = study?.currentEncounter ?? null;
  const currentId = encounter?.encounterId;
  useEffect(() => { setBeat(0); }, [currentId]);
  useEffect(() => {
    if (!currentId) return;
    const target = surface.current?.querySelector<HTMLInputElement>('input');
    target?.focus();
  }, [currentId]);
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
  const beats = vocabularyTeachingBeats(material);
  const mode = wordProgress?.mode ?? null;
  const elapsed = elapsedLabel('1970-01-01T00:00:00.000Z',c.activeDurationMs);
  const completed = projection.phase === 'completed' || c.completion !== null;
  const canAct = !c.busy && c.error === null;
  const control = (visible: boolean, enabled = true, reason?: string): VocabularyControl => ({ visible, enabled: enabled && canAct, ...(reason ? { reason } : {}) });
  function primary() {
    if (composing.current || !canAct) return;
    if (encounter?.skipped || wordProgress?.workStatus === 'wrapped' || wordProgress?.workStatus === 'skipped') { void c.next(); }
    else if (intro) {
      if (beat + 1 < beats.length) setBeat((value) => value + 1);
      else void c.next();
    } else if (recognition && !c.revealed) c.revealRecognition();
    else if (c.revealed || encounter?.skipped) void c.next();
    else c.submitResponse(c.input.trim().length ? c.input : null);
  }
  const answerForms = word ? formatCardCharacters(word, characterPresentation) : encounter?.snapshot.assessment?.acceptedAnswers.join(' / ') ?? '';
  const assessment = c.assessment;
  const choices = materialObject(material).choices;
  const displayedChoices = Array.isArray(choices) ? choices.map((entry) => materialObject(entry)).filter((entry) => typeof entry.hanzi === 'string') : [];
  const props: VocabularySessionViewProps = {
    phase: completed ? 'completed' : projection.phase === 'finishing' ? 'finishing' : 'active',
    mode, modeLabel: modeChoices.find((choice) => choice.value === mode)?.label ?? 'Practice', modeChoices,
    visibleWord: word ? vocabularyPresentationWord({ id: word.wordId, hanzi: formatCardCharacters(word, characterPresentation), pinyin: word.pinyin, meaning: word.meaning },encounter?.snapshot.kind??'production',c.revealed) : null,
    presentation: { key: currentId ?? 'empty', kind: intro ? encounter?.snapshot.role === 'priming' ? 'warmup' : 'introduction' : encounter ? 'exercise' : 'empty',
      label: intro ? encounter?.snapshot.role === 'priming' ? 'Familiar warmup' : 'Introduction' : recognition ? 'Recognize the word' : encounter?.snapshot.role === 'teaching' ? 'Try the taught word' : 'Find the Mandarin expression',
      prompt: intro ? renderVocabularyTeaching(material, beat, sentenceCharacterPresentation)
        : convertSentenceCharacters(encounter?.snapshot.body.prompt ?? study.notice ?? 'Choose another exercise or finish for now.', sentenceCharacterPresentation),
      supportingContent: <>
        {intro && beats.length > 1 && <div><span>Step {Math.min(beat + 1, beats.length)} of {beats.length}</span>{beat > 0 && <button type="button" onClick={() => setBeat((value) => value - 1)}>Previous step</button>}</div>}
        {wordProgress?.mode === 'unstudied' && <button type="button" disabled={!canAct} onClick={() => { void c.send({ type: 'skip', scope: 'word' }).then(() => c.next()); }}>Stop work on this word</button>}
        {study.notice && !completed && <p role="status">{study.notice}</p>}
        {!intro && vocabularyMaterialInstruction(material) && <p>{vocabularyMaterialInstruction(material)}</p>}
        {contrast && !c.revealed && <div role="group" aria-label="Choose an answer">{displayedChoices.map((choice, index) => <button type="button" key={index} disabled={!canAct}
          onClick={() => c.submitResponse(String(choice.hanzi), undefined, typeof choice.wordId === 'string' ? choice.wordId : undefined)}>{characterPresentation === 'traditional' && typeof choice.traditional === 'string' ? choice.traditional : choice.hanzi as string}</button>)}</div>}
      </>,
    },
    response: { visible: !intro && !recognition && !contrast && !encounter?.skipped && wordProgress?.workStatus !== 'wrapped' && wordProgress?.workStatus !== 'skipped', value: c.input, placeholder: 'Type Chinese characters', disabled: !canAct,
      revealed: c.revealed, assessment,
      answer: <>
        {recognition ? renderVocabularyRecognitionAnswer(word?.pinyin??'',word?.meaning??encounter?.snapshot.body.answer??'') : <>
          <p lang="zh"><strong>{answerForms}</strong></p>{word&&<><p>{word.pinyin}</p><p>{word.meaning}</p></>}
        </>}
        {renderVocabularyReveal(material, sentenceCharacterPresentation)}
        {recognition && assessment === 'unassessed' && <div role="group" aria-label="How did you remember this word?">
          <button type="button" disabled={!canAct} onClick={() => c.submitResponse(null, 'accepted')}>Remembered</button>
          <button type="button" disabled={!canAct} onClick={() => c.submitResponse(null, 'rejected')}>Not remembered yet</button>
        </div>}
      </>,
      ...(encounter?.snapshot.role === 'teaching' && assessment === 'rejected' ? { message: 'This exercise asks for the word just taught. Your response and feedback are retained.' } : {}),
      primaryLabel: encounter?.skipped ? 'Next exercise' : wordProgress?.workStatus === 'wrapped' || wordProgress?.workStatus === 'skipped' ? 'Next word' : intro ? beat + 1 < beats.length ? 'Continue' : 'Try the expression'
        : recognition && !c.revealed ? 'Reveal answer' : c.revealed || encounter?.skipped ? 'Next exercise' : c.input.trim() ? 'Check answer' : 'No clue',
      primaryEnabled: canAct && Boolean(encounter) && !(recognition && c.revealed && assessment === 'unassessed') && !contrast,
    },
    history: completed ? [] : vocabularySessionHistory(study,c.revealed).map((entry)=>{
      const state=projection.words[entry.wordId];return {word:{id:entry.wordId,hanzi:formatCardCharacters(entry,characterPresentation),pinyin:entry.pinyin,meaning:entry.meaning},
        status:state.covered?'covered' as const:state.workStatus==='skipped'?'left' as const:'open' as const,active:entry.wordId===study.currentWordId,
        canResume:canAct&&entry.wordId!==study.currentWordId&&!state.teachingDeferred};
    }),
    wordWork: {extraPractice:c.extraPracticeWordId===study.currentWordId},
    leaveForToday:control(!completed&&wordProgress?.workStatus==='open'),
    progress: { encountered: Object.values(projection.words).filter((entry) => entry.admitted).length, covered: projection.coveredWordIds.length, elapsedLabel: elapsed },
    controls: {
      skip: control(study.controls.canSkip && !completed && !encounter?.skipped),
      another: control(!intro && study.controls.canNext && !completed),
      enough: control(study.controls.canEnough && !completed), more: control(study.controls.canMore && !completed),
      undo: control(study.controls.canUndo && !completed),
      finishForNow: control(study.controls.canFinishForNow && !completed), finishImmediately: control(study.controls.canFinishImmediately && !completed),
      changeMode: control(false),
    },
    feedback: { visible: encounter !== null && !completed, reaction: c.reaction, comment: c.comment, status: c.feedbackStatus },
    completion: completed ? {
      status: c.completion?.status === 'closed' ? 'closed' : c.completion?.status === 'failed' || c.error ? 'failed' : c.completion?.status === 'pending' ? 'pending' : 'saving',
      remainingSeconds: c.remainingSeconds, elapsedLabel: elapsed, covered: projection.coveredWordIds.length,
      encountered: Object.values(projection.words).filter((entry) => entry.admitted).length,
      outcomes: study.words.filter((entry) => projection.words[entry.wordId]?.admitted).map((entry) => {
        const outcome = projection.words[entry.wordId];
        return { word: { id: entry.wordId, hanzi: formatCardCharacters(entry, characterPresentation), pinyin: entry.pinyin, meaning: entry.meaning },
          detail: c.dismissedWordIds.includes(entry.wordId) ? 'Dismissed from study.' : outcome.teachingCompleted ? 'Introduction completed.' : outcome.covered ? outcome.successfulRecall ? 'Covered for today.' : 'Work covered; this does not claim successful recall.' : 'Unfinished; remains due for another session.',
          canPractise: c.completion?.status === 'pending' && c.completion.canUndo,
          mode:c.summaryModes[entry.wordId]??outcome.recommendedMode??outcome.mode, modeLabel:modeChoices.find((choice)=>choice.value===(c.summaryModes[entry.wordId]??outcome.recommendedMode??outcome.mode))?.label,
          modeChoices:modeChoices.map((choice)=>({...choice,enabled:canAct&&Boolean(c.completion&&(c.completion.status==='closed'||c.completion.canUndo))})),
          canDismiss: !outcome.covered && !c.dismissedWordIds.includes(entry.wordId) && Boolean(c.completion),
        };
      }),
      feedback: [], canCancel: c.completion?.status === 'pending' && c.completion.canUndo,
      canUndo: Boolean(c.completion?.canUndo && projection.latestUndoableActionId), canReturnHome: !c.saving && c.completion !== null,
    } : null,
    busy: c.busy, error: c.error,
    onResponseChange: c.setInput, onPrimary: primary,
    onSkip: () => { void c.send({ type: 'skip' }).then(() => c.next()); }, onAnother: () => { void c.next({ another: true }); },
    onEnough: () => { void c.endWord(true); }, onLeaveForToday:()=>{void c.endWord(false);},
    onMore: () => { if (word) void c.resume(word.wordId); },
    onUndo: () => { void c.undo(); }, onFinishForNow: () => { void c.finishForNow(); }, onFinishImmediately: () => { void c.finishImmediately(); },
    onModeChange: () => undefined, onWordModeChange:(wordId,nextMode)=>{void c.changeSummaryMode(wordId,nextMode);},
    onReaction: c.react, onCommentChange: c.setComment, onCommentSubmit: c.submitComment,
    onCancelCompletion: () => { void c.resume(); }, onRetryCompletion: () => { void c.retrySave(); }, onReturnHome: () => { void c.returnHome(); },
    onPractiseWord: (wordId) => { void c.resume(wordId); }, onDismissWord: (wordId) => { void c.dismissWord(wordId); },
  };
  if (contrast && c.revealed) props.response.primaryEnabled = canAct;
  return <div ref={surface} onCompositionStartCapture={() => { composing.current = true; }} onCompositionEndCapture={() => { composing.current = false; }}
    onKeyDownCapture={(event) => {
      if (event.key === 'Enter' && (composing.current || event.nativeEvent.isComposing || event.keyCode === 229)) { event.preventDefault(); event.stopPropagation(); return; }
      if (event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey || composing.current) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'SUMMARY', 'A'].includes(target.tagName))) return;
      if (!completed && (event.key === ' ' || event.key === 'Enter') && props.response.primaryEnabled) { event.preventDefault(); primary(); }
      else if (event.key.toLowerCase() === 'u' && (props.controls.undo.enabled || props.completion?.canUndo)) { event.preventDefault(); void c.undo(); }
    }}>
    <VocabularySessionView {...props} />
    {c.error && !completed && <p><button type="button" disabled={c.busy} onClick={() => { void c.retrySave(); }}>Retry saving</button></p>}
    {c.saving && !completed && <p role="status">Saving your response…</p>}
  </div>;
}
