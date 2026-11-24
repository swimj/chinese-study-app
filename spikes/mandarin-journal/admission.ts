// Admission: whether something the learner brought in also becomes a target the
// journal teaches. Asking about an item makes it a piece; admission is a separate
// judgment in the record, so it can be rerun and the result is always derived
// (MODEL.md principles 1 and 11). An explicit save always admits.
import type { JudgmentRecord, Target } from './record.ts';

/** An explicit save by the learner: the reader of the record trusts it as stated. */
export const EXPLICIT_SOURCE = 'rule:admit-v1';
export const ADMIT_PROMPT = 'admit-v1';
/** Judgment sources for admission end in /admit-vN or :admit-vN; other readers skip them. */
export const isAdmission = (source: string) => /[:/]admit-v\d+$/.test(source);

export type AdmissionDecision = { form: string; admit: boolean; reason: string };
/** What the admission judgment read: enough to rerun it on the same evidence. */
export type AdmissionRequest = {
  forms: { form: string; pinyin: string; gloss: string; example: string }[];
  /** The learner's own submission, verbatim. */
  sent: string;
  /** Where they met it, as they described it. */
  context?: string;
  /** The learner's replies to clarification questions, in order. */
  replies: string[];
  /** What the tutor told them about it. */
  explanation: string;
};
/** explicit: an explicit save, admitted by rule. failed: the judgment did not complete; it admits nothing. */
export type AdmissionBody = { decisions: AdmissionDecision[]; explicit?: boolean; request?: AdmissionRequest; failed?: string };

export const LEGACY_REASON = 'saved before admission was judged';

export function explicitAdmission(eventId: string, forms: string[], reason: string, at = new Date().toISOString()): JudgmentRecord {
  const body: AdmissionBody = { decisions: forms.map((form) => ({ form, admit: true, reason })), explicit: true };
  return { id: crypto.randomUUID(), eventId, at, source: EXPLICIT_SOURCE, body };
}

/**
 * The admitted forms, each with the reason it was admitted.
 * - An explicit save admits, and no later judgment takes that back.
 * - Otherwise each event's newest completed judgment counts (judgments can be rerun),
 *   and a form is admitted when any event's current judgment admits it.
 * - A saved target created before admission existed (admitFrom) was saved under the
 *   old rule that every save is studied, so it counts as an explicit save. With no
 *   admitFrom (a journal not yet opened with this version), every saved target does.
 */
export function admitted(judgmentList: JudgmentRecord[], targetList: Target[], admitFrom: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  const latest = new Map<string, JudgmentRecord>();
  for (const j of judgmentList) {
    if (!isAdmission(j.source)) continue;
    const body = j.body as AdmissionBody;
    if (body.explicit) {
      for (const d of body.decisions) if (d.admit) out.set(d.form, d.reason);
      continue;
    }
    if (body.failed) continue;
    const seen = latest.get(j.eventId);
    if (!seen || seen.at <= j.at) latest.set(j.eventId, j);
  }
  for (const j of latest.values())
    for (const d of (j.body as AdmissionBody).decisions) if (d.admit && !out.has(d.form)) out.set(d.form, d.reason);
  for (const t of targetList)
    if (t.origin === 'saved' && (!admitFrom || t.createdAt <= admitFrom) && !out.has(t.form)) out.set(t.form, LEGACY_REASON);
  return out;
}
