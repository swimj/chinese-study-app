// A practice session: a time budget the learner spends on cards, with cards
// prepared ahead in the background. Pure rules here; journal.ts applies them.
import { randomUUID } from 'node:crypto';

/**
 * Why a card was asked for, which steers its form. teach: a lesson card that teaches a
 * new word and asks nothing. settle: a typed recall of a word taught on a lesson card,
 * at the stage its lifecycle is in.
 */
export type Purpose = 'teach' | 'settle' | 'review' | 'weakness' | 'material';
/** first: the recall after a word's lesson; scheduled: a settling recall; checkup: the one after graduation. */
export type Stage = 'first' | 'scheduled' | 'checkup';

export type CardKind = 'choice' | 'open' | 'recall';
/**
 * The exercise forms a card may take, by why it was asked for. An expression being
 * settled, reviewed or repaired is tested by typed recall. A choice only shows
 * recognition, so it is offered only for a contrast the learner has demonstrably
 * confused (contrast), and never for a word settling after teaching, where only typed
 * recall counts. Open production is conversation drawn from material, not the test
 * of one expression. (Build vocabulary still teaches from material on an exercise
 * card, and asks for the teach forms.)
 */
export function formsFor(purpose: Purpose, contrast = false): CardKind[] {
  if (purpose === 'material') return ['recall', 'open'];
  return contrast && purpose !== 'teach' && purpose !== 'settle' ? ['recall', 'choice'] : ['recall'];
}

/** A session's default length, and how much Keep going adds. */
export const SESSION_SECONDS = 10 * 60;
export const CHUNK_SECONDS = 5 * 60;
/** Cards kept ready beyond the one in front of the learner. */
export const AHEAD = 2;
/** At most one new word is taught in any run of this many session cards. */
export const NEW_EVERY = 4;
/** Other cards between a lesson and the recall of its word. */
export const RECALL_GAP = 2;
/** No lesson starts with less than this many seconds left in the session's box. */
export const NO_NEW_WITHIN = 3 * 60;
/** Consecutive failed generations before the session stops asking. */
export const MAX_FAILURES = 2;
/** Generation attempts per session, so empty replies cannot loop forever. */
export const MAX_ATTEMPTS = 40;
/** An ended session left this long is put away; the next visit starts a fresh one. */
export const STALE_MS = 60 * 60_000;

export type Session = {
  id: string;
  startedAt: string;
  /** Seconds the session may take; Keep going extends it. */
  budget: number;
  /** Real seconds spent on finished cards, each capped so a walk away does not count. */
  spent: number;
  /** Estimated seconds of those same finished cards, to learn the learner's pace. */
  estimated: number;
  /** When the card in front of the learner appeared; null while waiting for one. */
  shownAt: string | null;
  lastAt: string;
  ended?: boolean;
  /** Set when no more cards can be prepared: the model failed, or nothing is left to ask about. */
  stopped?: 'failed' | 'exhausted';
  failures: number;
  /** Why recent card preparations failed, newest last, so a stopped session can be diagnosed. */
  errors?: { at: string; error: string }[];
  attempts: number;
  /** Generations in a row that offered nothing new; a few in a row end the search. */
  empties?: number;
  /** Sources that produced nothing this session. */
  skipped: string[];
  /** Cards generated per material source this session, so material rotates. */
  uses: Record<string, number>;
};

/** A lesson card teaches in beats and asks nothing; every other kind is an exercise. */
type CardLike = {
  kind: 'choice' | 'open' | 'recall' | 'lesson'; introduction?: string; teaching?: unknown[]; purpose?: Purpose; stage?: Stage; targets?: string[];
};
type PracticeLike<C extends CardLike> = { mode: string; cards: C[]; index: number; result: unknown; session?: Session };

export function newSession(now: Date, budget = SESSION_SECONDS): Session {
  const at = now.toISOString();
  return { id: randomUUID(), startedAt: at, budget, spent: 0, estimated: 0, shownAt: null, lastAt: at, failures: 0, attempts: 0, skipped: [], uses: {} };
}

/** Whether a card teaches its expression before the exercise. */
export function teaches(c: CardLike): boolean {
  return !!c.introduction || !!c.teaching?.length;
}

/** Expected seconds for a card: a choice is quick, open production slower, teaching is a read. */
export function cardSeconds(c: CardLike): number {
  if (c.kind === 'lesson') return 60;
  return (c.kind === 'choice' ? 20 : c.kind === 'recall' ? 25 : 90) + (teaches(c) ? 60 : 0);
}

/** Real seconds a finished card took, capped at three times its estimate. */
export function cardTime(c: CardLike, shownAt: string | null, now: Date): number {
  const estimate = cardSeconds(c);
  if (!shownAt) return estimate;
  const seconds = (now.getTime() - Date.parse(shownAt)) / 1000;
  return Math.min(3 * estimate, Math.max(0, seconds));
}

/** The learner's pace against the estimates, once two cards are finished. */
function pace(session: Session, finished: number): number {
  if (finished < 2 || !session.estimated) return 1;
  return Math.min(2, Math.max(0.5, session.spent / session.estimated));
}

/** Seconds the session will have taken once the cards already prepared are done. */
export function projectedSeconds<C extends CardLike>(p: PracticeLike<C>): number {
  const session = p.session;
  if (!session) return 0;
  const remaining = p.cards.slice(p.index).reduce((sum, c) => sum + cardSeconds(c), 0);
  return session.spent + pace(session, p.index) * remaining;
}

/**
 * Words taught on this session's lesson cards that have no recall card yet. ready: enough
 * other cards have come since the lesson for the recall to be asked for.
 */
export function pendingRecalls<C extends CardLike>(cards: C[]): { form: string; ready: boolean }[] {
  const pending: { form: string; ready: boolean }[] = [];
  cards.forEach((c, i) => {
    if (c.kind !== 'lesson') return;
    for (const form of c.targets ?? [])
      if (!cards.some((d) => d.purpose === 'settle' && d.targets?.includes(form)))
        pending.push({ form, ready: cards.length - 1 - i >= RECALL_GAP });
  });
  return pending;
}

/** The session's open work: words taught on finished lesson cards whose recall is not finished. */
export function openRecalls<C extends CardLike>(p: PracticeLike<C>): string[] {
  const done = p.cards.slice(0, p.index);
  return done
    .filter((c) => c.kind === 'lesson')
    .flatMap((c) => c.targets ?? [])
    .filter((form) => !done.some((d) => d.purpose === 'settle' && d.targets?.includes(form)));
}
/** Whether a card is the recall of one of these taught words. */
export const recallOf = (forms: string[], c: CardLike | undefined) =>
  !!c && c.purpose === 'settle' && !!c.targets?.some((form) => forms.includes(form));

/** The box is spent, but the session is finishing open work before it ends. */
export function wrappingUp<C extends CardLike>(p: PracticeLike<C>): boolean {
  const s = p.session;
  return !!s && !s.ended && s.spent >= s.budget && openRecalls(p).length > 0;
}

/**
 * The card in front of the learner. While wrapping up, only the recall of a taught
 * word is shown; other prepared cards wait for Keep going.
 */
export function currentCard<C extends CardLike>(p: PracticeLike<C>): C | undefined {
  if (p.session?.ended) return undefined;
  const card = p.cards[p.index];
  return wrappingUp(p) && !recallOf(openRecalls(p), card) ? undefined : card;
}

/** Whether the background worker should prepare another card now. */
export function needsCard<C extends CardLike>(p: PracticeLike<C>): boolean {
  const s = p.session;
  if (!s || s.ended || s.stopped || p.mode === 'Past mistakes') return false;
  // Past the box, only the recall that closes open work is still prepared.
  if (wrappingUp(p)) return !p.cards.slice(p.index).some((c) => recallOf(openRecalls(p), c));
  return p.cards.length - (p.index + 1) < AHEAD && projectedSeconds(p) < s.budget;
}

/**
 * Finishes the card in front of the learner and advances. When the box is spent the
 * session ends, unless a word taught this session still waits for its recall: then
 * that recall comes next, ahead of any other prepared card, and the session ends after it.
 */
export function finishCard<C extends CardLike>(p: PracticeLike<C>, now: Date): void {
  const session = p.session;
  if (!session) throw new Error('No practice session for this card');
  const card = p.cards[p.index];
  if (!card) throw new Error('No card to finish');
  session.spent += cardTime(card, session.shownAt, now);
  session.estimated += cardSeconds(card);
  session.lastAt = now.toISOString();
  p.index++;
  if (session.spent >= session.budget) {
    const open = openRecalls(p);
    if (!open.length) session.ended = true;
    else {
      const at = p.cards.findIndex((c, i) => i > p.index && recallOf(open, c));
      if (at > p.index) p.cards.splice(p.index, 0, ...p.cards.splice(at, 1));
    }
  }
  // An ended session shows its end, not the next prepared card; that card appears with Keep going.
  session.shownAt = currentCard(p) ? now.toISOString() : null;
}

/** Whether finishing the card in front of the learner ends the session. */
export function finishesSession<C extends CardLike>(p: PracticeLike<C>, now: Date): boolean {
  const s = p.session;
  const card = p.cards[p.index];
  if (!s || !card) return false;
  return s.spent + cardTime(card, s.shownAt, now) >= s.budget && !openRecalls({ ...p, index: p.index + 1 }).length;
}

/** Errors kept per session: enough to see why it stopped. */
const KEPT_ERRORS = 5;
/** Notes why a card preparation failed, trimmed so a long provider message stays readable. */
export function noteFailure(session: Session, error: unknown, now: Date): void {
  const text = error instanceof Error ? error.name + ': ' + error.message : String(error);
  (session.errors ??= []).push({ at: now.toISOString(), error: text.slice(0, 200) });
  session.errors.splice(0, session.errors.length - KEPT_ERRORS);
}

/** Try again after preparation failed: clears the stop and keeps the session's time. */
export function resume(session: Session, now: Date): void {
  if (session.stopped !== 'failed' || session.ended) throw new Error('Only a session paused by failed preparation resumes');
  session.stopped = undefined;
  session.failures = 0;
  session.lastAt = now.toISOString();
}

/** Keep going: another chunk of time, counted from what has been spent. */
export function extend(session: Session, now: Date): void {
  session.budget = Math.max(session.budget, session.spent) + CHUNK_SECONDS;
  session.ended = false;
  session.stopped = undefined;
  session.failures = 0;
  session.lastAt = now.toISOString();
}

/**
 * One new word per NEW_EVERY cards: none while a lesson is among the last few, and none
 * near the end of the box, where its recall would run the session over.
 */
export function freshAllowed<C extends CardLike>(p: PracticeLike<C>): number {
  if (p.session && p.session.budget - projectedSeconds(p) < NO_NEW_WITHIN) return 0;
  return p.cards.slice(-(NEW_EVERY - 1)).some((c) => c.purpose === 'teach') ? 0 : 1;
}

/** Scheduled recalls compete by priority, but a backlog never takes more than about half the session. */
export function dueAllowed<C extends CardLike>(cards: C[]): number {
  const scheduled = cards.filter((c) => c.purpose === 'settle' && c.stage !== 'first').length;
  return Math.max(0, 1 + Math.floor(cards.length / 2) - scheduled);
}

/** Whether an ended session is old enough that the next visit starts a fresh one. */
export function stale(session: Session, now: Date): boolean {
  return !!session.ended && now.getTime() - Date.parse(session.lastAt) > STALE_MS;
}
