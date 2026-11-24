// Priority, version 0: what is worth practicing next. Derived entirely from the
// record, so it can be recomputed whenever the policy or the judgments change.
// New signals from the learner's journal dominate; the hosted app's SRS state
// is a weaker input. A weakness gets a small, bounded repetition budget and
// then graduates; nothing is maintained on a schedule forever.
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

export type Role = 'needed' | 'flawed' | 'missed' | 'avoided' | 'used' | 'correct';
const weakness: Partial<Record<Role, number>> = { needed: 3, flawed: 2, missed: 2, avoided: 1 };
/** practice marks signals from an exercise answer, as opposed to the learner's own use elsewhere. */
export type Signal = { form: string; role: Role; at: string | null; eventId: string; evidence?: string; practice?: boolean };

/** A choice answer's outcome, judged by rule with no model call. */
export type ChoiceJudgment = { correct: boolean; targets: string[] };

/** Flattens judgments into per-form signals. Each judgment dates from its event. */
export function signalsFrom(judgmentList: JudgmentRecord[], eventsById: Map<string, RecordedEvent>): Signal[] {
  const out: Signal[] = [];
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
    if (!event) continue;
    const at = event.at;
    const practice = event.kind === 'answer';
    const push = (form: string, role: Role, evidence?: string) => out.push({ form, role, at, eventId: event.id, evidence, practice });
    if (j.source.startsWith('rule:')) {
      const body = j.body as ChoiceJudgment;
      for (const form of body.targets) push(form, body.correct ? 'correct' : 'missed', event.text);
      continue;
    }
    const n = j.body as Notice;
    for (const use of n.uses) push(use.form, use.quality === 'natural' ? 'used' : 'flawed', event.text);
    for (const need of n.needs) push(need.form, 'needed', need.evidence);
    for (const x of n.intended) push(x.form, x.outcome === 'natural' ? 'used' : x.outcome === 'flawed' ? 'flawed' : 'avoided', event.text);
  }
  return out;
}

export type Ranked = { target: Target; score: number; reasons: string[]; signals: number };

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
  for (const t of targetList) {
    if (t.hosted?.dismissed) continue;
    const own = (byForm.get(t.form) ?? []).slice().sort((a, b) => ageDays(b.at, now) - ageDays(a.at, now));
    const reasons: string[] = [];
    let score = 0;

    const weak = own.filter((s) => weakness[s.role]);
    if (weak.length) {
      const lastWeak = Math.min(...weak.map((s) => ageDays(s.at, now)));
      const cleanDays = new Set(
        own.filter((s) => (s.role === 'used' || s.role === 'correct') && ageDays(s.at, now) < lastWeak).map((s) => (s.at ? day(s.at) : '?')),
      ).size;
      if (cleanDays >= GRADUATE_AFTER) reasons.push(`graduated after ${cleanDays} clean days`);
      else {
        const sum = weak.reduce((total, s) => total + weakness[s.role]! * decay(ageDays(s.at, now)), 0);
        score += sum * (1 - 0.35 * cleanDays);
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
    if (score > 0) ranked.push({ target: t, score, reasons, signals: own.length });
  }
  return ranked.sort((a, b) => b.score - a.score);
}
