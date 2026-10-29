import { useEffect, useRef, useState } from 'react';
import type { VocabularyStudy } from '../../domain/vocabulary-study-api';
import type { VocabularySkill } from '../../domain/vocabulary-session';
import type { SessionDeskHandle } from '../session/SessionDesk';
import type { SessionDeskOutcome } from '../session/session-desk-model';

export type VocabularyRecallProgress = { key: string; label: string; count: number; total: number };
const skillLabels: Record<VocabularySkill, string> = {
  recognition: 'Recognition', production: 'Production', contextual_selection: 'Contextual choice',
};

/** Read the effective projection, including the final answer and reversals by Undo. */
export function getVocabularyRecallProgress(study: VocabularyStudy): VocabularyRecallProgress[] {
  const encounter = study.currentEncounter;
  if (!encounter) return [];
  const projection = study.session.projection;
  if (encounter.wordId === null) {
    const cue = projection.pureCueOutcomes.find((entry) => entry.contentId === encounter.snapshot.contentId
      && entry.contentVersion === encounter.snapshot.contentVersion);
    const total = cue && cue.rejectedResponses > 0 ? 3 : 1;
    return [{ key: 'pure-cue', label: total === 3 ? 'Reinforcement' : 'Recall', count: Math.min(total, cue?.consecutiveAccepted ?? 0), total }];
  }
  const word = projection.words[encounter.wordId];
  if (!word) throw new Error('Vocabulary presentation invariant violated: current word has no projection');
  // Completion promotes the word before its last teaching card leaves the screen.
  const teaching = encounter.mode === 'unstudied' && encounter.snapshot.role === 'teaching';
  const skills: readonly VocabularySkill[] = teaching ? ['recognition', 'production']
    : word.mode === 'solidify' ? word.solidifySkills : [word.selectedSkill];
  return skills.map((skill) => {
    const progress = word.skillProgress[skill];
    const total = teaching || (word.mode !== 'solidify' && progress.rejectedResponses > 0) ? 3 : 1;
    const count = !teaching && word.mode === 'solidify' ? progress.acceptedResponses : progress.consecutiveAccepted;
    return { key: skill, label: `${skillLabels[skill]}${total === 3 && !teaching ? ' reinforcement' : ''}`, count: Math.min(total, count), total };
  });
}

export function getVocabularyCardOutcome(study: VocabularyStudy): SessionDeskOutcome {
  const encounter = study.currentEncounter;
  if (!encounter) return 'ongoing';
  if (encounter.effectiveResponses.at(-1)?.payload.outcome === 'rejected') return 'wrong';
  if (encounter.wordId !== null) return study.session.projection.words[encounter.wordId]?.workStatus === 'wrapped' ? 'done' : 'ongoing';
  return study.session.projection.pureCueOutcomes.some((entry) => entry.contentId === encounter.snapshot.contentId
    && entry.contentVersion === encounter.snapshot.contentVersion && entry.covered) ? 'done' : 'ongoing';
}

type MotionOptions = { fromKeyboard?: boolean; depart?: boolean; outcome?: SessionDeskOutcome; shuffle?: boolean; source?: HTMLElement };

/** UI confirmation and card motion only; the supplied callback owns every learning transition. */
export function useVocabularyCardMotion(presentationKey: string | undefined) {
  const deskRef = useRef<SessionDeskHandle>(null);
  const mounted = useRef(true);
  const locked = useRef(false);
  const key = useRef(presentationKey);
  key.current = presentationKey;
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const releaseTimer = useRef<(() => void) | null>(null);
  const [confirmingPrimary, setConfirmingPrimary] = useState(false);
  const [motionBusy, setMotionBusy] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; clearTimeout(timer.current); releaseTimer.current?.(); };
  }, []);
  useEffect(() => {
    clearTimeout(timer.current);
    releaseTimer.current?.();
    setConfirmingPrimary(false);
  }, [presentationKey]);

  async function runPrimary(action: () => void | Promise<void>, options: MotionOptions = {}): Promise<void> {
    if (locked.current) return;
    locked.current = true;
    setMotionBusy(true);
    const actionKey = key.current;
    try {
      if (options.fromKeyboard && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setConfirmingPrimary(true);
        await new Promise<void>((resolve) => {
          releaseTimer.current = resolve;
          timer.current = setTimeout(resolve, 180);
        });
        releaseTimer.current = null;
        timer.current = undefined;
      }
      if (!mounted.current || key.current !== actionKey) return;
      setConfirmingPrimary(false);
      let transition: void | Promise<void> = undefined;
      if (options.source && deskRef.current) {
        const returning = deskRef.current.tuckFrom(options.source);
        await Promise.all([returning, action()]);
      } else if (options.depart && deskRef.current) {
        const departure = deskRef.current.depart(options.outcome ?? 'ongoing', () => { transition = action(); }, { projectedRecall: true, shuffle: options.shuffle });
        await Promise.all([departure, transition]);
      } else await action();
    } finally {
      locked.current = false;
      if (mounted.current) { setConfirmingPrimary(false); setMotionBusy(false); }
    }
  }
  return { deskRef, confirmingPrimary, motionBusy, runPrimary };
}
