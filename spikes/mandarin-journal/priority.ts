// Priority, version 0: what is worth practicing next. Derived entirely from the
// record, so it can be recomputed whenever the policy or the judgments change.
// New signals from the learner's journal dominate; the hosted app's SRS state
// is a weaker input. A weakness gets a small, bounded repetition budget and
// then graduates; nothing is maintained on a schedule forever.
//
// What counts toward graduation: a correct typed recall, and natural use in the
// learner's own language outside practice. A correct choice is recognition, not
// recall, so it is recorded but counts for nothing; a wrong one is still a miss.
// Target use in an open-production answer is an optional signal: a flawed use
// raises priority, but a natural use never counts as clean, because the card
// itself steered the learner toward the expression.
//
// A word taught on a lesson card follows its own bounded lifecycle (lifecycle.ts):
// only typed recall counts toward its graduation, due recalls rank high, and a word
// whose first recall has not happened yet is first in line. An exercise the learner
// flagged as bad counts for nothing either way.
import { isDue, lifecycle, type Assignment, type Lifecycle } from './lifecycle.ts';
import type { Notice } from './situations/notice.ts';
import type { JudgmentRecord, RecordedEvent, Target } from './record.ts';

export const POLICY = 'priority-v0';
const DAY = 86_400_000;
/** New signals lose half their weight every two weeks. */
const HALF_LIFE_DAYS = 14;
/** Converted history that kept no time counts as this old. */
const UNKNOWN_AGE_DAYS = 14;
/** Clean uses on distinct days, after the latest weakness, that retire it. */
const GRADUATE_AFTER = 2;
/** The hosted SRS contributes at most this much, against about 3 for one fresh need. */
const HOSTED_WEIGHT = 0.3;
/** A taught word waiting for its first recall: ahead of everything else. */
const FIRST_RECALL = 10;
/** A due settling recall or check-up: above a fresh need (about 3), so it competes high. */
const DUE_RECALL = 3.5;
/** New words taught per UTC day, as the hosted app's default new-word limit. */
export const NEW_PER_DAY = 5;
/** With this many weaknesses and newly taught words still open, nothing new is taught. */
export const PRESSING_LIMIT = 8;

/**
 * correct: a correct typed recall. recognized: a correct choice, which shows
 * recognition only. avoided: an open answer that did without an intended form,
 * which is not a weakness: an open card requires no word.
 */
export type Role = 'needed' | 'flawed' | 'missed' | 'avoided' | 'used' | 'correct' | 'recognized' | 'taught';
// A newly taught word settles like a weakness: it stays pressing until two clean
// days after teaching, the journal's version of the hosted app's Solidify.
const weakness: Partial<Record<Role, number>> = { needed: 3, flawed: 2, missed: 2, taught: 2 };
/** Evidence that a weakness has resolved: recall from memory, or the learner's own natural use outside practice. */
const clean = (s: Signal) => s.role === 'correct' || (s.role === 'used' && !s.practice);
/**
 * practice marks signals from an exercise answer, as opposed to the learner's own use elsewhere.
 * exercise: the bounded form a rule-judged signal came from. A taught signal from a lesson
 * carries the graduation policy assigned then and the sentences it was taught with.
 */
export type Signal = {
  form: string; role: Role; at: string | null; eventId: string; evidence?: string; practice?: boolean;
  exercise?: 'recall' | 'choice'; graduation?: Assignment; sentences?: string[];
};

/** A choice or typed recall answer's outcome, judged by rule with no model call. */
export type ChoiceJudgment = { correct: boolean; targets: string[] };

/** Flattens judgments into per-form signals. Each judgment dates from its event. */
export function signalsFrom(judgmentList: JudgmentRecord[], eventsById: Map<string, RecordedEvent>): Signal[] {
  const out: Signal[] = [];
  // An exercise the learner flagged as bad never counts for or against them.
  const flagged = new Set([...eventsById.values()].filter((e) => e.kind === 'flag' && e.ref).map((e) => e.ref!));
  // Judgments can be rerun: only the newest model reading of each event counts.
  const latest = new Map<string, JudgmentRecord>();
  for (const j of judgmentList) {
    if (j.source.startsWith('rule:') || (j.body as { failed?: string }).failed) continue;
    const seen = latest.get(j.eventId);
    if (!seen || seen.at <= j.at) latest.set(j.eventId, j);
  }
  for (const j of judgmentList) {
    if (!j.source.startsWith('rule:') && latest.get(j.eventId) !== j) continue;
    const event = eventsById.get(j.eventId);
    if (!event || flagged.has(event.id)) continue;
    const at = event.at;
    const practice = event.kind === 'answer';
    const push = (form: string, role: Role, evidence?: string) => out.push({ form, role, at, eventId: event.id, evidence, practice });
    if (j.source.startsWith('rule:')) {
      const body = j.body as ChoiceJudgment;
      const exercise = j.source.startsWith('rule:choice') ? 'choice' : 'recall';
      const right: Role = exercise === 'choice' ? 'recognized' : 'correct';
      for (const form of body.targets) out.push({ form, role: body.correct ? right : 'missed', at, eventId: event.id, evidence: event.text, practice, exercise });
      continue;
    }
    const n = j.body as Notice;
    for (const use of n.uses) push(use.form, use.quality === 'natural' ? 'used' : 'flawed', event.text);
    for (const need of n.needs) push(need.form, 'needed', need.evidence);
    for (const x of n.intended) push(x.form, x.outcome === 'natural' ? 'used' : x.outcome === 'flawed' ? 'flawed' : 'avoided', event.text);
  }
  for (const event of eventsById.values()) {
    // Before lesson cards, teaching rode on the exercise card that checked it.
    if (event.kind === 'answer' && event.context.taught && !flagged.has(event.id))
      for (const form of event.targets) out.push({ form, role: 'taught', at: event.at, eventId: event.id, practice: true });
    if (event.kind === 'lesson') {
      const graduation = event.context.graduation as Assignment | undefined;
      const sentences = event.context.sentences as string[] | undefined;
      for (const form of event.targets) out.push({ form, role: 'taught', at: event.at, eventId: event.id, practice: true, graduation, sentences });
    }
  }
  return out;
}

/**
 * pressing: an open weakness or a word still settling. fresh: chosen and never taught.
 * purpose: what a card on this target is for. A new word is taught; a word taught on a
 * lesson card is settled by recall (stage: its first recall, a scheduled one, or the
 * check-up); a flaw or need in the learner's own Chinese is a weakness; anything else (a
 * miss, a word taught before lesson cards, the hosted app's due words) is a review. All
 * are tested by typed recall (session.ts formsFor).
 * life: the lifecycle of a word taught on a lesson card, under its assigned policy.
 * contrast: the learner has demonstrably confused this target with another form: a
 * miss on it twice, or a slip in their own Chinese followed by a bounded exercise on
 * it. Only then may a card be a choice.
 */
export type Ranked = {
  target: Target; score: number; reasons: string[]; signals: number; pressing?: boolean; fresh?: boolean;
  purpose: 'teach' | 'review' | 'weakness' | 'settle'; contrast?: boolean;
  stage?: 'first' | 'scheduled' | 'checkup'; life?: Lifecycle; taughtWith?: string[];
};
const production = new Set<Role>(['needed', 'flawed']);
/** Signals from a rule-judged (bounded) exercise. */
const bounded = new Set<Role>(['correct', 'recognized', 'missed']);

const day = (at: string) => at.slice(0, 10);
const ageDays = (at: string | null, now: number) => (at ? Math.max(0, (now - Date.parse(at)) / DAY) : UNKNOWN_AGE_DAYS);
const decay = (age: number, halfLife = HALF_LIFE_DAYS) => Math.pow(0.5, age / halfLife);

function hostedScore(t: Target, now: number): { score: number; reason?: string } {
  const h = t.hosted;
  if (!h || !h.dueAt || Date.parse(h.dueAt) > now) return { score: 0 };
  const interval = Math.max(24, h.intervalHours ?? 24) * 3_600_000;
  const due = Math.min(1, 0.5 + (now - Date.parse(h.dueAt)) / interval / 2);
  const missRate = h.incorrect / Math.max(1, h.attempts);
  const lastMiss = h.lastIncorrectAt ? decay((now - Date.parse(h.lastIncorrectAt)) / DAY, 30) : 0;
  const mistakes = Math.min(1, 0.6 * Math.min(1, missRate * 3) + 0.4 * lastMiss);
  const score = HOSTED_WEIGHT * due * (0.25 + 0.75 * mistakes);
  return {
    score,
    reason: 'due in the old app' + (h.incorrect ? ` · ${h.incorrect} of ${h.attempts} recalls missed` : ''),
  };
}

/** Ranks targets by priority, highest first. Dismissed and zero-priority targets are left out. */
export function rank(targetList: Target[], signals: Signal[], nowDate = new Date()): Ranked[] {
  const now = nowDate.getTime();
  const today = nowDate.toISOString().slice(0, 10);
  const byForm = new Map<string, Signal[]>();
  for (const s of signals) {
    const list = byForm.get(s.form) ?? [];
    list.push(s);
    byForm.set(s.form, list);
  }
  const ranked: Ranked[] = [];
  // Open work for backpressure, counted whether or not it is due now.
  let open = 0;
  const taughtToday = new Set(signals.filter((s) => s.role === 'taught' && s.at && day(s.at) === today).map((s) => s.form)).size;
  for (const t of targetList) {
    if (t.hosted?.dismissed) continue;
    const own = (byForm.get(t.form) ?? []).slice().sort((a, b) => ageDays(b.at, now) - ageDays(a.at, now));
    const reasons: string[] = [];
    let score = 0;
    let pressing = false;
    let fresh = false;
    let purpose: Ranked['purpose'] = 'review';
    let contrast = false;
    let stage: Ranked['stage'];
    let settleScore = 0;

    // A word taught on a lesson card follows its assigned policy; its misses and
    // teaching belong to that lifecycle, and only a slip in its use stays a weakness.
    const lesson = own.filter((s) => s.role === 'taught' && s.graduation && s.at).sort((a, b) => a.at!.localeCompare(b.at!))[0];
    const life = lesson
      ? lifecycle(
          lesson.graduation!.policy,
          lesson.at!,
          own.filter((s) => s.exercise && s.at).map((s) => ({ at: s.at!, correct: s.role !== 'missed', typed: s.exercise === 'recall' })),
        )
      : undefined;
    if (life) {
      const due = isDue(life, today);
      if (life.state === 'first' || life.state === 'settling') pressing = true;
      if (due) {
        purpose = 'settle';
        stage = life.state === 'first' ? 'first' : life.state === 'graduated' ? 'checkup' : 'scheduled';
        settleScore = stage === 'first' ? FIRST_RECALL : DUE_RECALL;
      }
      reasons.push(
        `policy ${life.policy} · ` +
          (life.state === 'first' ? 'taught, first recall not done yet'
          : life.state === 'settling' ? `settling, ${life.clean} of ${life.needed} clean · ${due ? 'recall due' : 'next recall ' + life.due}`
          : life.state === 'graduated' ? `graduated · ${due ? 'check-up due' : 'check-up ' + life.due}`
          : 'graduated and checked'),
      );
    }
    const weak = own.filter((s) => (life ? production.has(s.role) : weakness[s.role]));
    if (weak.length) {
      const lastWeak = Math.min(...weak.map((s) => ageDays(s.at, now)));
      const cleanDays = new Set(own.filter((s) => clean(s) && ageDays(s.at, now) < lastWeak).map((s) => (s.at ? day(s.at) : '?'))).size;
      if (cleanDays >= GRADUATE_AFTER) reasons.push(`graduated after ${cleanDays} clean days`);
      else {
        const sum = weak.reduce((total, s) => total + weakness[s.role]! * decay(ageDays(s.at, now)), 0);
        score += sum * (1 - 0.35 * cleanDays);
        pressing = true;
        const slips = weak.filter((s) => production.has(s.role));
        if (slips.length && purpose !== 'settle') purpose = 'weakness';
        const lastSlip = Math.min(...slips.map((s) => ageDays(s.at, now)));
        contrast =
          weak.filter((s) => s.role === 'missed').length >= 2 ||
          (slips.length > 0 && own.some((s) => bounded.has(s.role) && ageDays(s.at, now) < lastSlip));
        const latest = weak[weak.length - 1];
        reasons.push(
          `${latest.role}${latest.evidence ? ` in “${latest.evidence.slice(0, 40)}”` : ''}` +
            (weak.length > 1 ? ` (+${weak.length - 1} earlier)` : '') +
            (cleanDays ? ` · ${cleanDays} clean day since` : ''),
        );
      }
    } else if (!own.length && (t.origin === 'saved' || (t.hosted?.inStash && t.hosted.mode === 'unstudied'))) {
      // A word the learner chose and has not studied waits to be taught, from
      // the journal or from the old app's stash alike.
      score += decay(ageDays(t.createdAt, now), 21);
      fresh = true;
      purpose = 'teach';
      reasons.push(t.origin === 'saved' ? 'saved, not practiced yet' : 'in the old stash, never taught');
    }

    const hosted = hostedScore(t, now);
    if (hosted.score) {
      score += hosted.score;
      reasons.push(hosted.reason!);
    }
    if (t.origin === 'imported' && own.length) reasons.push('also in the old app');
    // Practice already done today waits; a need noticed today does not.
    if (own.some((s) => s.practice && s.at && day(s.at) === today)) {
      score *= 0.3;
      reasons.push('practiced today');
    }
    // A due recall is not held back by practice today: the first recall belongs to
    // today's teaching, and a scheduled one is due at most once a day.
    score += settleScore;
    if (pressing) open++;
    if (score > 0)
      ranked.push({
        target: t, score, reasons, signals: own.length, pressing, fresh, purpose,
        ...(contrast && purpose !== 'settle' ? { contrast } : {}),
        ...(stage ? { stage } : {}),
        ...(life ? { life, taughtWith: lesson!.sentences ?? [] } : {}),
      });
  }
  ranked.sort((a, b) => b.score - a.score);
  // Backpressure on new words: a daily limit, and none while too much is still open.
  const allowance = open >= PRESSING_LIMIT ? 0 : Math.max(0, NEW_PER_DAY - taughtToday);
  let admitted = 0;
  return ranked.filter((r) => !r.fresh || admitted++ < allowance);
}
