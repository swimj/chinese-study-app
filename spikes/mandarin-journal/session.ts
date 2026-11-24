// A practice session: a time budget the learner spends on cards, with cards
// prepared ahead in the background. Pure rules here; journal.ts applies them.
import { randomUUID } from 'node:crypto';

/** Why a card was asked for, which steers its form. */
export type Purpose = 'teach' | 'review' | 'weakness' | 'material';

export type CardKind = 'choice' | 'open' | 'recall';
/**
 * The exercise forms a card may take, by why it was asked for. An expression being
 * taught, reviewed or repaired is tested by typed recall. A choice only shows
 * recognition, so it is offered only for a contrast the learner has demonstrably
 * confused (contrast), and never right after teaching. Open production is
 * conversation drawn from material, not the test of one expression.
 */
export function formsFor(purpose: Purpose, contrast = false): CardKind[] {
  if (purpose === 'material') return ['recall', 'open'];
  return contrast && purpose !== 'teach' ? ['recall', 'choice'] : ['recall'];
}

/** A session's default length, and how much Keep going adds. */
export const SESSION_SECONDS = 10 * 60;
export const CHUNK_SECONDS = 5 * 60;
/** Cards kept ready beyond the one in front of the learner. */
export const AHEAD = 2;
/** At most one new word is taught in any run of this many session cards. */
export const NEW_EVERY = 4;
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

type CardLike = { kind: 'choice' | 'open' | 'recall'; introduction?: string; teaching?: unknown[]; purpose?: Purpose; targets?: string[] };
type PracticeLike<C extends CardLike> = { mode: string; cards: C[]; index: number; result: unknown; session?: Session };

export function newSession(now: Date, budget = SESSION_SECONDS): Session {
  const at = now.toISOString();
  return { id: randomUUID(), startedAt: at, budget, spent: 0, estimated: 0, shownAt: null, lastAt: at, failures: 0, attempts: 0, skipped: [], uses: {} };
}

/** Whether a card teaches its expression before the exercise. */
export function teaches(c: CardLike): boolean {
  return !!c.introduction || !!c.teaching?.length;
}

/** Expected seconds for a card: a choice is quick, open production slower, teaching adds a read. */
export function cardSeconds(c: CardLike): number {
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

/** Whether the background worker should prepare another card now. */
export function needsCard<C extends CardLike>(p: PracticeLike<C>): boolean {
  const s = p.session;
  if (!s || s.ended || s.stopped || p.mode === 'Past mistakes') return false;
  return p.cards.length - (p.index + 1) < AHEAD && projectedSeconds(p) < s.budget;
}

/** Finishes the card in front of the learner and advances; ends the session when its time is spent. */
export function finishCard<C extends CardLike>(p: PracticeLike<C>, now: Date): void {
  const session = p.session;
  if (!session) throw new Error('No practice session for this card');
  const card = p.cards[p.index];
  if (!card) throw new Error('No card to finish');
  session.spent += cardTime(card, session.shownAt, now);
  session.estimated += cardSeconds(card);
  session.lastAt = now.toISOString();
  p.index++;
  if (session.spent >= session.budget) session.ended = true;
  // An ended session shows its end, not the next prepared card; that card appears with Keep going.
  session.shownAt = !session.ended && p.index < p.cards.length ? now.toISOString() : null;
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

/** One new word per NEW_EVERY cards: none while a taught card is among the last few. */
export function freshAllowed<C extends CardLike>(cards: C[]): number {
  return cards.slice(-(NEW_EVERY - 1)).some((c) => c.purpose === 'teach') ? 0 : 1;
}

/** Whether an ended session is old enough that the next visit starts a fresh one. */
export function stale(session: Session, now: Date): boolean {
  return !!session.ended && now.getTime() - Date.parse(session.lastAt) > STALE_MS;
}
