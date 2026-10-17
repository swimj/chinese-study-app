import { useEffect, useRef, useState } from 'react';
import type { VocabularyStudy, VocabularyStudyCommand } from '../../domain/vocabulary-study-api';
import type { VocabularyWordMode } from '../../domain/vocabulary-session';
import type { VocabularySessionCompletion } from '../../domain/vocabulary-session-api';
import { createActiveSessionClock, finishActiveSessionClock, getActiveSessionDurationMs, updateActiveSessionClockForVisibility, type ActiveSessionClock } from '../session/active-session-time';
import { normalizeProductionAnswerForProfile } from '../../study-profile';
import { startVocabularySession, nextVocabularyStudy, commandVocabularyStudy, stageVocabularyCompletion,
  fetchVocabularyCompletion, cancelVocabularyCompletion, closeVocabularyCompletion, fetchCurrentVocabularyCompletion,
  fetchVocabularyStudy, dismissVocabularyWord, fetchVocabularyWords, setVocabularyWordMode } from '../../services/api';

/** Volatile ordered transport only. Failed work retains its original command identity for Retry. */
export function createVocabularyCommandQueue(onChange: () => void = () => undefined) {
  type Entry = { id: string; run: (id: string) => Promise<unknown>; resolve: (value: unknown) => void; reject: (error: unknown) => void };
  const entries: Entry[] = [];
  let running: Promise<void> | null = null;
  let failure: unknown = null;
  function pump(): Promise<void> {
    if (running) return running;
    if (failure) return Promise.reject(failure);
    const task = (async () => {
      while (entries.length) {
        const entry = entries[0];
        try { const value = await entry.run(entry.id); entries.shift(); entry.resolve(value); onChange(); }
        catch (error) { failure = error; entry.reject(error); onChange(); throw error; }
      }
    })();
    running = task;
    void task.finally(() => { if (running === task) running = null; onChange(); if (entries.length && !failure) void pump().catch(() => undefined); }).catch(() => undefined);
    return task;
  }
  return {
    enqueue<T>(id: string, run: (id: string) => Promise<T>): Promise<T> {
      const result = new Promise<T>((resolve, reject) => entries.push({ id, run, resolve: (value) => resolve(value as T), reject }));
      onChange(); if (!failure) void pump().catch(() => undefined); return result;
    },
    async flush(): Promise<void> { if (failure) throw failure; while (entries.length) await pump(); },
    async retry(): Promise<void> { if (running) await running.catch(() => undefined); failure = null; await pump(); },
    get pending() { return entries.length > 0; },
    get error() { return failure; },
  };
}
function message(reason: unknown): string { return reason instanceof Error ? reason.message : 'Your study work could not be saved.'; }
export function vocabularyCompletionDeadline(completion: VocabularySessionCompletion, receivedAt = Date.now()): number {
  return receivedAt + Math.max(0, Date.parse(completion.closeAt) - Date.parse(completion.serverNow));
}
export function assessVocabularyResponse(acceptedAnswers: readonly string[], response: string | null): 'accepted' | 'rejected' {
  if (response === null) return 'rejected';
  const normalized = normalizeProductionAnswerForProfile(response, 'mandarin');
  return normalized.length > 0 && acceptedAnswers.some((answer) => normalizeProductionAnswerForProfile(answer, 'mandarin') === normalized) ? 'accepted' : 'rejected';
}
export type VocabularyStudyOptions = { onSessionEnded?: () => void | Promise<void>; onActiveChange?: (active: boolean) => void };
export function useVocabularyStudy(options: VocabularyStudyOptions = {}) {
  const latestOptions = useRef(options); latestOptions.current = options;
  const [study, setStudy] = useState<VocabularyStudy | null>(null);
  const studyRef = useRef<VocabularyStudy | null>(null);
  const [completion, setCompletion] = useState<VocabularySessionCompletion | null>(null);
  const completionRef = useRef<VocabularySessionCompletion | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [localResponse, setLocalResponse] = useState<{ encounterId: string; outcome: 'accepted' | 'rejected' | 'unassessed' } | null>(null);
  const responseLock = useRef<string | null>(null);
  const activeClock = useRef<ActiveSessionClock | null>(null);
  const stagedDuration = useRef<{sessionId:string;throughSequence:number;value:number}|null>(null);
  const [comment, setComment] = useState('');
  const [feedbackStatus, setFeedbackStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [reaction, setReaction] = useState<'helpful' | 'not-helpful' | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [clock, setClock] = useState(Date.now());
  const deadline = useRef<number | null>(null);
  const attemptedDeadline = useRef<string | null>(null);
  const interruptedWordIds = useRef<string[]>([]);
  const [extraPracticeWordId, setExtraPracticeWordId] = useState<string | null>(null);
  const summaryModeEpoch=useRef(0);
  const [summaryModes, setSummaryModes] = useState<Record<string,VocabularyWordMode>>({});
  const [dismissedWordIds, setDismissedWordIds] = useState<string[]>([]);
  const mounted = useRef(true);
  const operation = useRef(false);
  // Cancellation and its following resume/Undo form one boundary transition.
  const suppressStage = useRef(false);
  const stageRun = useRef<Promise<void> | null>(null);
  const [, redraw] = useState(0);
  const queue = useRef<ReturnType<typeof createVocabularyCommandQueue> | null>(null);
  queue.current ??= createVocabularyCommandQueue(() => { if (mounted.current) redraw((value) => value + 1); });

  function receiveCompletion(value: VocabularySessionCompletion | null) {
    completionRef.current = value; deadline.current = value ? vocabularyCompletionDeadline(value) : null;
    if (mounted.current) { setCompletion(value); setRemainingSeconds(value?.status === 'pending' && deadline.current !== null ? Math.ceil(Math.max(0, deadline.current - Date.now()) / 1000) : null); }
  }
  function receive(value: VocabularyStudy) {
    const clockNow=Date.now();
    const visibility=typeof document==='undefined'||(document.visibilityState==='visible'&&document.hasFocus())?'visible':'hidden';
    if(studyRef.current?.session.sessionId!==value.session.sessionId) {
      activeClock.current=createActiveSessionClock({nowMs:clockNow,visibilityState:visibility,supportsVisibilityApi:typeof document!=='undefined'});
      activeClock.current.accumulatedMs=value.session.completion?.metadata?.activeDurationMs??0;
      stagedDuration.current=null;
    }
    if(activeClock.current) {
      if(value.session.projection.phase==='completed')activeClock.current=finishActiveSessionClock(activeClock.current,clockNow);
      else if(studyRef.current?.session.projection.phase==='completed')activeClock.current=updateActiveSessionClockForVisibility({clock:activeClock.current,nowMs:clockNow,visibilityState:visibility});
    }
    const previous = studyRef.current?.currentEncounter?.encounterId;
    studyRef.current = value;
    if (!mounted.current) return;
    setStudy(value);
    if (previous !== value.currentEncounter?.encounterId) {
      setInput(''); setLocalResponse(null); setComment(''); setReaction(null); setFeedbackStatus('idle'); responseLock.current = null;
    }
    receiveCompletion(value.session.completion?.status === 'cancelled' ? null : value.session.completion);
  }
  async function exclusive(work: () => Promise<void>) {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError(null);
    try { await work(); } catch (reason) { if (mounted.current) setError(message(reason)); }
    finally { operation.current = false; if (mounted.current) setBusy(false); }
  }
  function enqueue(command: VocabularyStudyCommand): Promise<VocabularyStudy> {
    const current = studyRef.current;
    if (!current) return Promise.reject(new Error('No active study session.'));
    const id = current.session.sessionId;
    return queue.current!.enqueue(crypto.randomUUID(), async (clientId) => {
      const result = await commandVocabularyStudy(id, clientId, command);
      if (studyRef.current?.session.sessionId === id) { receive(result); if (command.type === 'feedback' && mounted.current) setFeedbackStatus('saved'); }
      return result;
    });
  }
  async function stage() {
    if (stageRun.current) return stageRun.current;
    const run = (async () => {
      if (suppressStage.current) return;
      await queue.current!.flush();
      const current = studyRef.current;
      if (suppressStage.current || !current || current.session.projection.phase !== 'completed' || completionRef.current) return;
      const throughSequence=current.session.actions.length;
      if(stagedDuration.current?.sessionId!==current.session.sessionId||stagedDuration.current.throughSequence!==throughSequence) {
        stagedDuration.current={sessionId:current.session.sessionId,throughSequence,value:activeClock.current?Math.floor(getActiveSessionDurationMs(activeClock.current,Date.now())):0};
      }
      const result = await stageVocabularyCompletion(current.session.sessionId, throughSequence, stagedDuration.current.value);
      if (studyRef.current?.session.sessionId === result.sessionId) receiveCompletion(result);
    })();
    stageRun.current = run;
    try { await run; } finally { if (stageRun.current === run) stageRun.current = null; }
  }
  async function close() {
    await queue.current!.flush(); await stage();
    const current = completionRef.current;
    if (!current) throw new Error('The session is not ready to close.');
    if (current.status === 'closed') return;
    try { receiveCompletion(await closeVocabularyCompletion(current.sessionId, current.completionId)); }
    catch (reason) {
      const reconciled = await fetchVocabularyCompletion(current.sessionId).catch(() => null);
      if (reconciled) receiveCompletion(reconciled);
      if (reconciled?.status !== 'closed') throw reason;
    }
  }
  async function cancel() {
    const current = completionRef.current;
    if (current && current.status !== 'cancelled') {
      let result: VocabularySessionCompletion;
      try { result = await cancelVocabularyCompletion(current.sessionId, current.completionId); }
      catch (reason) {
        const reconciled = await fetchVocabularyCompletion(current.sessionId).catch(() => null);
        if (reconciled) receiveCompletion(reconciled);
        if (reconciled?.status !== 'cancelled') throw reason;
        result = reconciled;
      }
      if (result.status !== 'cancelled') throw new Error('The Undo window has closed.');
      receiveCompletion(null);
      receive(await fetchVocabularyStudy(current.sessionId));
    }
  }
  function reset() {
    if (queue.current!.pending) throw new Error('Finish saving your study work before leaving.');
    studyRef.current = null; completionRef.current = null; deadline.current = null; activeClock.current=null; stagedDuration.current=null;
    setStudy(null); setCompletion(null); setError(null); setInput(''); setLocalResponse(null); responseLock.current = null;
    setComment(''); setReaction(null); setFeedbackStatus('idle'); setDismissedWordIds([]);
    interruptedWordIds.current=[];setExtraPracticeWordId(null);setSummaryModes({});
  }
  const start = () => exclusive(async () => {
    await queue.current!.flush();
    const pending = await fetchCurrentVocabularyCompletion();
    if (pending?.session.completion) {
      receive(pending);
      const result = await closeVocabularyCompletion(pending.session.sessionId, pending.session.completion.completionId);
      if (result.status !== 'closed') throw new Error('Finish saving your previous session first.');
    }
    receive(await startVocabularySession());
  });
  const next = (options: { wordId?: string; another?: boolean } = {}) => exclusive(async () => {
    await queue.current!.flush();
    const current = studyRef.current; if (!current) return;
    const id = current.session.sessionId;
    const currentWord=current.currentWordId?current.session.projection.words[current.currentWordId]:null;
    const interrupted=!options.wordId&&currentWord&&currentWord.workStatus!=='open'?interruptedWordIds.current.pop():undefined;
    if(interrupted)setExtraPracticeWordId(null);
    await queue.current!.enqueue(crypto.randomUUID(), async (clientId) => {
      const result = await nextVocabularyStudy(id, clientId, interrupted?{...options,wordId:interrupted}:options); receive(result); return result;
    });
  });
  const send = (command: VocabularyStudyCommand) => exclusive(async () => { await queue.current!.flush(); await enqueue(command); });
  function submitResponse(response: string | null = input, selfAssessment?: 'accepted' | 'rejected', selectedWordId?: string) {
    const encounter = studyRef.current?.currentEncounter;
    if (!encounter || responseLock.current === encounter.encounterId || encounter.effectiveResponses.length || encounter.skipped || queue.current!.error) return;
    responseLock.current = encounter.encounterId;
    const criteria = encounter.snapshot.assessment?.criteria;
    const correctWordId = criteria !== null && typeof criteria === 'object' && !Array.isArray(criteria) ? criteria.correctWordId : null;
    const outcome = selectedWordId ? selectedWordId === correctWordId ? 'accepted' : 'rejected' : selfAssessment ?? assessVocabularyResponse(encounter.snapshot.assessment?.acceptedAnswers ?? [], response);
    setLocalResponse({ encounterId: encounter.encounterId, outcome }); setError(null);
    void enqueue({ type: 'response', response, ...(selfAssessment ? { selfAssessment } : {}), ...(selectedWordId ? { selectedWordId } : {}) })
      .catch((reason) => { if (mounted.current) setError(`${message(reason)} Your answer is still waiting to be saved. Retry before continuing.`); });
  }
  function revealRecognition() {
    const encounter = studyRef.current?.currentEncounter;
    if (encounter) setLocalResponse({ encounterId: encounter.encounterId, outcome: 'unassessed' });
  }
  async function returnHome() { await close(); reset(); await latestOptions.current.onSessionEnded?.(); }
  const retrySave = () => exclusive(async () => {
    await queue.current!.retry();
    if (studyRef.current?.session.projection.phase === 'completed') await stage();
    if (completionRef.current?.status === 'failed' || completionRef.current?.status === 'pending') await close();
  });
  async function resumeBoundary(work: () => Promise<void>) {
    suppressStage.current = true;
    try {
      if (stageRun.current) await stageRun.current;
      await queue.current!.flush(); await cancel(); await work();
    } finally { suppressStage.current = false; }
  }
  const undo = () => exclusive(() => resumeBoundary(async () => {
    await enqueue({ type: 'undo' }); setLocalResponse(null); responseLock.current = null;
  }));
  const resume = (wordId?: string) => exclusive(() => resumeBoundary(async () => {
    if (studyRef.current?.session.projection.phase === 'completed') await enqueue({ type: 'resume' });
    if (wordId) {
      const prior=studyRef.current;const interrupted=prior?.currentWordId;
      interruptedWordIds.current=interruptedWordIds.current.filter((id)=>id!==wordId);
      if(interrupted&&interrupted!==wordId&&prior?.session.projection.words[interrupted]?.workStatus==='open'&&!interruptedWordIds.current.includes(interrupted))interruptedWordIds.current.push(interrupted);
      setExtraPracticeWordId(wordId);
      const word = studyRef.current?.session.projection.words[wordId];
      if (word?.workStatus === 'wrapped' || word?.workStatus === 'skipped') await enqueue({ type: 'more', wordId });
      const current = studyRef.current; if (current) {
        await queue.current!.enqueue(crypto.randomUUID(), async (clientId) => {
          const result = await nextVocabularyStudy(current.session.sessionId, clientId, { wordId }); receive(result); return result;
        });
      }
    }
  }));
  const endWord = (covered: boolean) => exclusive(async () => {
    await queue.current!.flush();
    await enqueue(covered ? {type:'enough'} : {type:'skip',scope:'word'});
    setExtraPracticeWordId(null);
    const interrupted=interruptedWordIds.current.pop();
    const current=studyRef.current;if(!current)return;
    await queue.current!.enqueue(crypto.randomUUID(),async(clientId)=>{
      const result=await nextVocabularyStudy(current.session.sessionId,clientId,interrupted?{wordId:interrupted}:{});receive(result);return result;
    });
  });
  const changeSummaryMode = (wordId:string,mode:VocabularyWordMode) => exclusive(async()=>{
    summaryModeEpoch.current++;
    if(completionRef.current?.status==='closed') {
      const row=(await fetchVocabularyWords()).words.find((entry)=>entry.wordId===wordId);
      if(!row)throw new Error('This word is no longer available.');
      if(row.mode!==mode)await setVocabularyWordMode(wordId,mode,row.stateVersion);
      setSummaryModes((modes)=>({...modes,[wordId]:mode}));return;
    }
    await resumeBoundary(async()=>{
      if(studyRef.current?.session.projection.phase==='completed')await enqueue({type:'resume'});
      await enqueue({type:'mode',wordId,mode});
      await enqueue({type:'finishForNow'});
      if(studyRef.current?.session.projection.phase==='finishing')await enqueue({type:'finishImmediately'});
    });
    await stage();
  });
  function feedback(feedback: 'positive' | 'negative' | 'comment' | 'withdrawn', note?: string) {
    if (queue.current!.error) return;
    setFeedbackStatus('saving');
    void enqueue({ type: 'feedback', feedback, ...(note ? { comment: note } : {}) })
      .then(() => { if (mounted.current) setFeedbackStatus('saved'); })
      .catch((reason) => { if (mounted.current) { setFeedbackStatus('idle'); setError(message(reason)); } });
  }

  useEffect(() => {
    mounted.current = true;
    void fetchCurrentVocabularyCompletion().then((pending) => { if (mounted.current && pending && !studyRef.current) receive(pending); })
      .catch((reason) => { if (mounted.current) setError(message(reason)); });
    return () => { mounted.current = false; };
  }, []);
  useEffect(()=>{
    if(completion?.status!=='closed')return;
    let current=true;const epoch=summaryModeEpoch.current;const completionId=completion.completionId;
    void fetchVocabularyWords().then(({words})=>{
      if(current&&mounted.current&&summaryModeEpoch.current===epoch&&completionRef.current?.completionId===completionId)setSummaryModes(Object.fromEntries(words.map((word)=>[word.wordId,word.mode])));
    }).catch(()=>undefined);
    return ()=>{current=false;};
  },[completion?.completionId,completion?.status]);
  useEffect(() => {
    if (study?.session.projection.phase === 'completed' && !completion && !queue.current!.error && !suppressStage.current) {
      void stage().catch((reason) => { if (mounted.current) setError(message(reason)); });
    }
  }, [study, completion]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setClock(Date.now());
      const current = completionRef.current;
      if (current?.status !== 'pending' || deadline.current === null) return;
      const remaining = Math.max(0, deadline.current - Date.now()); setRemainingSeconds(Math.ceil(remaining / 1000));
      if (remaining === 0 && !operation.current && attemptedDeadline.current !== current.completionId) {
        attemptedDeadline.current = current.completionId; void exclusive(close);
      }
    }, 500);
    const reconcile = () => {
      if (document.visibilityState !== 'visible' || !completionRef.current || operation.current) return;
      const id = completionRef.current.sessionId;
      void fetchVocabularyCompletion(id).then((value) => { if (mounted.current && completionRef.current?.sessionId === id && value) receiveCompletion(value); }).catch(() => undefined);
    };
    const visibility = () => {
      if(activeClock.current&&studyRef.current?.session.projection.phase!=='completed')activeClock.current=updateActiveSessionClockForVisibility({clock:activeClock.current,nowMs:Date.now(),
        visibilityState:document.visibilityState==='visible'&&document.hasFocus()?'visible':'hidden'});
      reconcile();
    };
    document.addEventListener('visibilitychange', visibility);window.addEventListener('focus',visibility);window.addEventListener('blur',visibility);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', visibility);window.removeEventListener('focus',visibility);window.removeEventListener('blur',visibility); };
  }, []);
  const active = study !== null;
  useEffect(() => { latestOptions.current.onActiveChange?.(active); }, [active]);
  const encounter = study?.currentEncounter;
  const assessed = encounter?.effectiveResponses.at(-1)?.payload.outcome;
  const local = localResponse?.encounterId === encounter?.encounterId ? localResponse : null;
  return { study, completion, active, busy, saving: queue.current.pending, error, input, setInput, comment, setComment, reaction,
    feedbackStatus, remainingSeconds, clock, activeDurationMs:activeClock.current?Math.floor(getActiveSessionDurationMs(activeClock.current,clock)):0, dismissedWordIds, revealed: Boolean(assessed || local), assessment: assessed ?? local?.outcome ?? 'unassessed' as const,
    start, reset, next, send, submitResponse, revealRecognition, retrySave, undo, endWord, changeSummaryMode, summaryModes, extraPracticeWordId,
    finishForNow: () => send({ type: 'finishForNow' }), finishImmediately: () => send({ type: 'finishImmediately' }),
    resume, returnHome: () => exclusive(returnHome),
    react: (value: 'helpful' | 'not-helpful' | null) => { setReaction(value); if (value) feedback(value === 'helpful' ? 'positive' : 'negative'); else feedback('withdrawn'); },
    submitComment: () => { if (comment.trim()) feedback('comment', comment); },
    dismissWord: (wordId: string) => exclusive(async () => { await queue.current!.flush(); if (completionRef.current && completionRef.current.status !== 'closed') await close(); await dismissVocabularyWord(wordId); setDismissedWordIds((ids) => [...ids, wordId]); }),
  };
}
export type VocabularyStudyController = ReturnType<typeof useVocabularyStudy>;
