import { getDb } from './connection.ts';
import { requireLearnerId } from './learner-context.ts';
import { localNewWordDay } from '../vocabulary/composition.ts';
import { isLearnerPronunciationRejection, type VocabularyEncounterEvidence, type VocabularySessionProjection } from '../../src/domain/vocabulary-session.ts';
import { normalizeProductionAnswerForProfile } from '../../src/study-profile.ts';
import {
  VOCABULARY_PROGRESS_MINIMUM_JUDGED, VOCABULARY_PROGRESS_MINIMUM_SETTLED, VOCABULARY_PROGRESS_STICKINESS_GAP_DAYS,
  type VocabularyEfficiencyMonth, type VocabularyFirstProduction, type VocabularyProgress, type VocabularyProgressDay, type VocabularyProgressRate,
} from '../../src/domain/vocabulary-progress.ts';
export type { VocabularyProgress } from '../../src/domain/vocabulary-progress.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const BASELINE_DAYS = 14, RECENT_DAYS = 30, LONG_DAYS = 90, ACTIVITY_DAYS = 14, FIRST_PRODUCTION_LIMIT = 12;

export type VocabularyProgressCompletion = { stagedAt: string; activeDurationMs: number | null; report: VocabularySessionProjection };
export type VocabularyProgressInput = {
  /** One learner's closed completions, ordered by staging time. */
  completions: readonly VocabularyProgressCompletion[];
  /** Encounters in a feedback case whose judgment succeeded. Absent rejected productions remain pending. */
  judgedEncounterIds: ReadonlySet<string>;
  /** Judged encounters listed as unfair. */
  unfairEncounterIds: ReadonlySet<string>;
  /** Written forms for words whose producing snapshot did not carry them. */
  wordLabels?: ReadonlyMap<string, { hanzi: string; pinyin: string }>;
};

type AttemptResult = 'success' | 'failure' | 'void' | 'pending';
type Attempt = { key: string; cue: boolean; skill: 'recognition' | 'production' | 'contextual_selection' | 'cue'; held: boolean;
  contentId: string; at: number; result: AttemptResult; gapMs: number | null; novelContent: boolean; transferEligible: boolean };

const SKILL_BY_KIND = { recognition: 'recognition', production: 'production', contrast: 'contextual_selection' } as const;

function fail(message: string): never { throw new Error(`Malformed vocabulary progress report: ${message}`); }
function instant(value: unknown, what: string): number {
  const ms = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(ms)) fail(`${what} is not a timestamp`);
  return ms;
}
/** Shape checks for the fields this computation reads. Missing structure is a broken record, not an empty one. */
function assertReport(report: VocabularySessionProjection): void {
  if (!report || typeof report !== 'object' || !Array.isArray(report.encounters) || !report.words || typeof report.words !== 'object') fail('missing encounters or words');
  for (const encounter of report.encounters) {
    if (typeof encounter?.encounterId !== 'string' || !encounter.snapshot || typeof encounter.snapshot.contentId !== 'string'
      || !Array.isArray(encounter.effectiveResponses)) fail('encounter is missing its identity, snapshot or responses');
    if (encounter.snapshot.schedulingScope !== 'pure_cue' && encounter.snapshot.role === 'general' && typeof encounter.wordId !== 'string') fail(`word encounter ${encounter.encounterId} has no word`);
  }
  for (const [wordId, word] of Object.entries(report.words)) {
    if (!word || typeof word.initialMode !== 'string' || typeof word.admitted !== 'boolean' || typeof word.teachingCompleted !== 'boolean') fail(`word ${wordId} is missing its session state`);
  }
}
const isCue = (encounter: VocabularyEncounterEvidence) => encounter.snapshot.schedulingScope === 'pure_cue';
/** General, presented, not skipped, and answered. Teaching and priming never count. */
export function isCountableProgressEncounter(encounter: VocabularyEncounterEvidence): boolean {
  return encounter.snapshot.role === 'general' && !encounter.presentationUndone && !encounter.skipped && encounter.effectiveResponses.length > 0;
}
function itemKey(encounter: VocabularyEncounterEvidence): { key: string; skill: Attempt['skill'] } | null {
  if (isCue(encounter)) return { key: `cue:${encounter.snapshot.contentId}`, skill: 'cue' };
  const kind = encounter.snapshot.kind;
  if (kind === 'introduction') return null;
  const skill = SKILL_BY_KIND[kind];
  if (!skill) fail(`unknown exercise kind ${String(kind)}`);
  return { key: `word:${encounter.wordId}:${skill}`, skill };
}
function attemptResult(encounter: VocabularyEncounterEvidence, input: VocabularyProgressInput): AttemptResult {
  const payload = encounter.effectiveResponses[0]!.payload;
  if (payload.outcome === 'accepted') return payload.helpUsed === true ? 'failure' : 'success';
  if (encounter.snapshot.kind !== 'production') return 'failure';
  if (isLearnerPronunciationRejection(encounter.snapshot.kind, payload, encounter.snapshot.assessment?.acceptedAnswers ?? [])) return 'failure';
  if (input.unfairEncounterIds.has(encounter.encounterId)) return 'void';
  return input.judgedEncounterIds.has(encounter.encounterId) ? 'failure' : 'pending';
}
/** The produced word: the encounter's word, or the single reveal word a pure-cue answer names. */
function producedWord(encounter: VocabularyEncounterEvidence, response: string | null): string | null {
  if (!isCue(encounter)) return encounter.wordId;
  if (response === null) return null;
  const normalized = normalizeProductionAnswerForProfile(response, 'mandarin');
  if (!normalized) return null;
  const same = (form: string | null) => form !== null && normalizeProductionAnswerForProfile(form, 'mandarin') === normalized;
  const matches = new Set((encounter.snapshot.body.revealWords ?? []).filter(word => same(word.hanzi) || same(word.traditional)).map(word => word.wordId));
  return matches.size === 1 ? [...matches][0]! : null;
}
function rate(attempts: readonly Attempt[]): VocabularyProgressRate {
  const count = (result: AttemptResult) => attempts.filter(attempt => attempt.result === result).length;
  const success = count('success'), failure = count('failure');
  return { rate: success + failure < VOCABULARY_PROGRESS_MINIMUM_JUDGED ? null : success / (success + failure), success, failure, void: count('void'), pending: count('pending') };
}
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
const shiftDay = (dayKey: string, days: number) => new Date(Date.parse(`${dayKey}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** Pure: one chronological pass over a learner's closed completions. Never writes learner state. */
export function computeVocabularyProgress(input: VocabularyProgressInput, now: Date, timeZone?: string): VocabularyProgress {
  const dayOf = (at: string) => timeZone ? localNewWordDay(at, timeZone) : at.slice(0, 10);
  const nowMs = now.getTime(), today = dayOf(now.toISOString());
  const attempts: Attempt[] = [];
  const lastAttemptAt = new Map<string, number>(), contentsByItem = new Map<string, Set<string>>(), seenContent = new Set<string>();
  const activity = new Map<string, { words: Set<string>; cues: Set<string>; activeDurationMs: number }>();
  const produced = new Map<string, { at: number; encounter: VocabularyEncounterEvidence }>();
  const efficiency = new Map<string, { month: string | null; sessions: number; settled: boolean }>();
  let firstStagedAt: number | null = null, previousStagedAt = -Infinity;

  for (const completion of input.completions) {
    const stagedAt = instant(completion.stagedAt, 'staged time');
    if (stagedAt < previousStagedAt) throw new Error('Vocabulary progress completions must be ordered by staging time');
    previousStagedAt = stagedAt; firstStagedAt ??= stagedAt;
    const report = completion.report;
    assertReport(report);
    const day = dayOf(completion.stagedAt);
    const bucket = activity.get(day) ?? { words: new Set<string>(), cues: new Set<string>(), activeDurationMs: 0 };
    activity.set(day, bucket);
    const duration = completion.activeDurationMs;
    if (typeof duration === 'number' && Number.isSafeInteger(duration) && duration >= 0) bucket.activeDurationMs += duration;

    const sessionItems = new Set<string>(), sessionAttempts: Attempt[] = [];
    for (const encounter of report.encounters) {
      if (encounter.presentationUndone) continue;
      const novelContent = !seenContent.has(encounter.snapshot.contentId);
      seenContent.add(encounter.snapshot.contentId);
      if (!isCountableProgressEncounter(encounter)) continue;
      const item = itemKey(encounter);
      if (item === null) continue;
      if (encounter.snapshot.kind === 'production') {
        for (const response of encounter.effectiveResponses) {
          if (response.payload.outcome !== 'accepted' || response.payload.helpUsed === true) continue;
          const wordId = producedWord(encounter, response.payload.response);
          if (wordId !== null && !produced.has(wordId)) produced.set(wordId, { at: instant(response.occurredAt, 'response time'), encounter });
        }
      }
      if (sessionItems.has(item.key)) continue;
      sessionItems.add(item.key);
      const cue = item.skill === 'cue';
      (cue ? bucket.cues : bucket.words).add(item.key);
      const at = instant(encounter.effectiveResponses[0]!.occurredAt, 'response time');
      const previous = lastAttemptAt.get(item.key), contents = contentsByItem.get(item.key);
      sessionAttempts.push({ key: item.key, cue, skill: item.skill, contentId: encounter.snapshot.contentId, at,
        held: cue || encounter.mode === 'practice' || encounter.mode === 'maintain',
        result: attemptResult(encounter, input), gapMs: previous === undefined ? null : at - previous, novelContent,
        transferEligible: cue || (contents !== undefined && [...contents].some(id => id !== encounter.snapshot.contentId)) });
    }
    // Earlier sessions only: an item's gap and prior content never come from its own session.
    for (const attempt of sessionAttempts) {
      lastAttemptAt.set(attempt.key, attempt.at);
      const contents = contentsByItem.get(attempt.key) ?? new Set<string>();
      contents.add(attempt.contentId); contentsByItem.set(attempt.key, contents);
    }
    attempts.push(...sessionAttempts);

    for (const [wordId, word] of Object.entries(report.words)) {
      if (!word.admitted) continue;
      const state = efficiency.get(wordId) ?? { month: null, sessions: 0, settled: false };
      efficiency.set(wordId, state);
      if (state.settled) continue;
      if (word.initialMode === 'practice' || word.initialMode === 'maintain') { if (state.month !== null) state.settled = true; continue; }
      state.sessions++;
      if (word.teachingCompleted && state.month === null) state.month = day.slice(0, 7);
    }
  }

  const since = (days: number) => nowMs - days * DAY_MS;
  const within = (days: number) => (attempt: Attempt) => attempt.at > since(days) && attempt.at <= nowMs;
  const held = attempts.filter(attempt => attempt.held);
  const sticky = held.filter(within(LONG_DAYS)).filter(attempt => attempt.gapMs !== null && attempt.gapMs >= VOCABULARY_PROGRESS_STICKINESS_GAP_DAYS * DAY_MS);

  const days: VocabularyProgressDay[] = [];
  for (let offset = ACTIVITY_DAYS - 1; offset >= 0; offset--) {
    const dayKey = shiftDay(today, -offset), bucket = activity.get(dayKey);
    days.push({ dayKey, wordItems: bucket?.words.size ?? 0, cueItems: bucket?.cues.size ?? 0, activeDurationMs: bucket?.activeDurationMs ?? 0 });
  }

  const baselineEnd = firstStagedAt === null ? -Infinity : firstStagedAt + BASELINE_DAYS * DAY_MS;
  const firstProductions: VocabularyFirstProduction[] = [...produced.entries()]
    .filter(([, production]) => production.at >= baselineEnd && production.at <= nowMs)
    .sort((a, b) => b[1].at - a[1].at).slice(0, FIRST_PRODUCTION_LIMIT)
    .map(([wordId, production]) => {
      const reveal = production.encounter.snapshot.body.revealWords?.find(word => word.wordId === wordId);
      const label = reveal ?? input.wordLabels?.get(wordId);
      if (!label) throw new Error(`No written form for produced word ${wordId}`);
      return { wordId, hanzi: label.hanzi, pinyin: label.pinyin, dayKey: dayOf(new Date(production.at).toISOString()) };
    });

  const byMonth = new Map<string, { settled: number[]; settling: number }>();
  for (const state of efficiency.values()) {
    if (state.month === null) continue;
    const entry = byMonth.get(state.month) ?? { settled: [], settling: 0 };
    byMonth.set(state.month, entry);
    if (state.settled) entry.settled.push(state.sessions); else entry.settling++;
  }
  const efficiencyMonths: VocabularyEfficiencyMonth[] = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, entry]) => ({
    month, settled: entry.settled.length, settling: entry.settling,
    medianSessions: entry.settled.length < VOCABULARY_PROGRESS_MINIMUM_SETTLED ? null : median(entry.settled),
  }));

  return {
    today, days,
    activeVocabulary: { total: produced.size, addedLast30Days: [...produced.values()].filter(production => production.at > since(RECENT_DAYS) && production.at <= nowMs).length },
    firstProductions,
    recognition: rate(held.filter(within(RECENT_DAYS)).filter(attempt => attempt.skill === 'recognition')),
    stickiness: { ...rate(sticky), wordAttempts: sticky.filter(attempt => !attempt.cue).length, cueAttempts: sticky.filter(attempt => attempt.cue).length },
    transfer: rate(held.filter(within(LONG_DAYS)).filter(attempt => attempt.novelContent && attempt.transferEligible)),
    efficiency: efficiencyMonths,
  };
}

export type VocabularyProgressLoadStats = { completions: number; reportBytes: number };
/** Loads the current learner's closed runtime history. Legacy review summaries are deliberately ignored. */
export function loadVocabularyProgressInput(learnerId: string): { input: VocabularyProgressInput; stats: VocabularyProgressLoadStats } {
  const db = getDb();
  const rows = db.prepare(`SELECT staged_at,json_extract(input_json,'$.activeDurationMs') AS active_ms,report_json FROM vocabulary_session_completions
    WHERE learner_id=? AND status='closed' ORDER BY staged_at,completion_id`).all(learnerId) as { staged_at: string; active_ms: unknown; report_json: string }[];
  let reportBytes = 0;
  const completions = rows.map(row => {
    reportBytes += row.report_json.length;
    return { stagedAt: row.staged_at, activeDurationMs: typeof row.active_ms === 'number' ? row.active_ms : null, report: JSON.parse(row.report_json) as VocabularySessionProjection };
  });
  // A feedback case may be reassessed; its latest succeeded judgment decides.
  const judgments = db.prepare(`SELECT e.encounter_id,json_extract(j.result_json,'$.input.unfairEncounterIds') AS unfair FROM reflection_cases c
    JOIN reflection_case_evidence e ON e.case_id=c.case_id
    JOIN vocabulary_reflection_jobs j ON j.case_id=c.case_id AND j.status='succeeded'
    WHERE c.learner_id=? AND c.kind='learner_feedback' ORDER BY j.created_at,j.job_id`).all(learnerId) as { encounter_id: string; unfair: string | null }[];
  const verdict = new Map<string, boolean>();
  for (const row of judgments) {
    const unfair = row.unfair === null ? [] : JSON.parse(row.unfair) as unknown;
    if (!Array.isArray(unfair)) throw new Error('Feedback judgment has malformed unfair encounters');
    verdict.set(row.encounter_id, unfair.includes(row.encounter_id));
  }
  const wordLabels = new Map((db.prepare(`SELECT l.id,l.hanzi,l.pinyin FROM learner_words w JOIN lexical_words l ON l.id=w.word_id WHERE w.learner_id=?`)
    .all(learnerId) as { id: string; hanzi: string; pinyin: string }[]).map(row => [row.id, { hanzi: row.hanzi, pinyin: row.pinyin }]));
  return {
    input: { completions, judgedEncounterIds: new Set(verdict.keys()), unfairEncounterIds: new Set([...verdict].filter(([, unfair]) => unfair).map(([id]) => id)), wordLabels },
    stats: { completions: rows.length, reportBytes },
  };
}
export function getVocabularyProgress(now = new Date(), timeZone?: string): VocabularyProgress {
  return computeVocabularyProgress(loadVocabularyProgressInput(requireLearnerId()).input, now, timeZone);
}
