import { getDb } from './connection.ts';
import { requireLearnerId } from './learner-context.ts';
import { vocabularyStudyDayFormatter } from '../vocabulary/composition.ts';
import { isLearnerPronunciationRejection, type VocabularyEncounterEvidence, type VocabularySessionProjection } from '../../src/domain/vocabulary-session.ts';
import { normalizeProductionAnswerForProfile } from '../../src/study-profile.ts';
import {
  VOCABULARY_PROGRESS_MINIMUM_JUDGED, VOCABULARY_PROGRESS_MINIMUM_SETTLED, VOCABULARY_PROGRESS_STICKINESS_GAP_DAYS,
  type VocabularyEfficiencyMonth, type VocabularyFirstProduction, type VocabularyProgress, type VocabularyProgressDay, type VocabularyProgressRate,
} from '../../src/domain/vocabulary-progress.ts';
export type { VocabularyProgress } from '../../src/domain/vocabulary-progress.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const BASELINE_DAYS = 14, RECENT_DAYS = 30, LONG_DAYS = 90, ACTIVITY_DAYS = 14, FIRST_PRODUCTION_LIMIT = 12;

type WordLabel = { hanzi: string; pinyin: string };
type Production = { wordId: string; at: number; label?: WordLabel };
type CompletionAttempt = Pick<Attempt, 'key' | 'cue' | 'skill' | 'held' | 'contentId' | 'at'> & {
  firstPresentation: boolean; encounterId: string; outcome: 'success' | 'failure' | 'pending';
};
type CompletionFacts = {
  seenContent: string[]; attempts: CompletionAttempt[]; productions: Production[];
  words: { wordId: string; initialMode: string; teachingCompleted: boolean }[];
};
type VocabularyProgressCompletion = { stagedAt: string; activeDurationMs: number | null; facts: CompletionFacts };
export type VocabularyProgressInput = {
  /** One learner's closed completions, ordered by staging time. */
  completions: readonly VocabularyProgressCompletion[];
  /** Encounters in a feedback case whose judgment succeeded. Absent rejected productions remain pending. */
  judgedEncounterIds: ReadonlySet<string>;
  /** Judged encounters listed as unfair. */
  unfairEncounterIds: ReadonlySet<string>;
  /** Written forms for words whose producing snapshot did not carry them. */
  wordLabel?: (wordId: string) => WordLabel | undefined;
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
function firstOutcome(encounter: VocabularyEncounterEvidence): CompletionAttempt['outcome'] {
  const payload = encounter.effectiveResponses[0]!.payload;
  if (payload.outcome === 'accepted') return payload.helpUsed === true ? 'failure' : 'success';
  if (encounter.snapshot.kind !== 'production') return 'failure';
  if (isLearnerPronunciationRejection(encounter.snapshot.kind, payload, encounter.snapshot.assessment?.acceptedAnswers ?? [])) return 'failure';
  return 'pending';
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

/** Everything in these facts comes from immutable closed evidence. Judgments, labels,
 * time windows and relationships to earlier sessions are resolved when reading. */
export function progressCompletionFacts(report: VocabularySessionProjection): CompletionFacts {
  assertReport(report);
  const seenContent = new Set<string>(), items = new Set<string>();
  const attempts: CompletionAttempt[] = [], productions = new Map<string, Production>();
  for (const encounter of report.encounters) {
    if (encounter.presentationUndone) continue;
    const contentId = encounter.snapshot.contentId;
    const firstPresentation = !seenContent.has(contentId);
    seenContent.add(contentId);
    if (!isCountableProgressEncounter(encounter)) continue;
    const item = itemKey(encounter);
    if (!item) continue;
    if (encounter.snapshot.kind === 'production') {
      for (const response of encounter.effectiveResponses) {
        if (response.payload.outcome !== 'accepted' || response.payload.helpUsed === true) continue;
        const wordId = producedWord(encounter, response.payload.response);
        if (wordId === null || productions.has(wordId)) continue;
        const reveal = encounter.snapshot.body.revealWords?.find(word => word.wordId === wordId);
        productions.set(wordId, { wordId, at: instant(response.occurredAt, 'response time'),
          label: reveal && { hanzi: reveal.hanzi, pinyin: reveal.pinyin } });
      }
    }
    if (items.has(item.key)) continue;
    items.add(item.key);
    const cue = item.skill === 'cue';
    attempts.push({ ...item, cue, contentId, firstPresentation, encounterId: encounter.encounterId,
      held: cue || encounter.mode === 'practice' || encounter.mode === 'maintain',
      at: instant(encounter.effectiveResponses[0]!.occurredAt, 'response time'), outcome: firstOutcome(encounter) });
  }
  const words = Object.entries(report.words).filter(([, word]) => word.admitted)
    .map(([wordId, word]) => ({ wordId, initialMode: word.initialMode, teachingCompleted: word.teachingCompleted }));
  return { seenContent: [...seenContent], attempts, productions: [...productions.values()], words };
}

/** Fold immutable completion facts in staging order using the current judgments and clock. */
export function computeVocabularyProgress(input: VocabularyProgressInput, now: Date, timeZone?: string): VocabularyProgress {
  const dayOf = vocabularyStudyDayFormatter(timeZone);
  const nowMs = now.getTime(), today = dayOf(now.toISOString());
  const attempts: Attempt[] = [];
  const lastAttemptAt = new Map<string, number>(), contentsByItem = new Map<string, Set<string>>(), seenContent = new Set<string>();
  const activity = new Map<string, { words: Set<string>; cues: Set<string>; activeDurationMs: number }>();
  const produced = new Map<string, Production>();
  const efficiency = new Map<string, { month: string | null; sessions: number; settled: boolean }>();
  let firstStagedAt: number | null = null, previousStagedAt = -Infinity;

  for (const completion of input.completions) {
    const stagedAt = instant(completion.stagedAt, 'staged time');
    if (stagedAt < previousStagedAt) throw new Error('Vocabulary progress completions must be ordered by staging time');
    previousStagedAt = stagedAt; firstStagedAt ??= stagedAt;
    const facts = completion.facts;
    const day = dayOf(completion.stagedAt);
    const bucket = activity.get(day) ?? { words: new Set<string>(), cues: new Set<string>(), activeDurationMs: 0 };
    activity.set(day, bucket);
    const duration = completion.activeDurationMs;
    if (typeof duration === 'number' && Number.isSafeInteger(duration) && duration >= 0) bucket.activeDurationMs += duration;

    for (const production of facts.productions) {
      if (!produced.has(production.wordId)) produced.set(production.wordId, production);
    }
    for (const attempt of facts.attempts) {
      (attempt.cue ? bucket.cues : bucket.words).add(attempt.key);
      const previous = lastAttemptAt.get(attempt.key), contents = contentsByItem.get(attempt.key);
      let result: AttemptResult = attempt.outcome;
      if (result === 'pending') {
        if (input.unfairEncounterIds.has(attempt.encounterId)) result = 'void';
        else if (input.judgedEncounterIds.has(attempt.encounterId)) result = 'failure';
      }
      attempts.push({ ...attempt, result, gapMs: previous === undefined ? null : attempt.at - previous,
        novelContent: attempt.firstPresentation && !seenContent.has(attempt.contentId),
        transferEligible: attempt.cue || (contents !== undefined && (contents.size > 1 || !contents.has(attempt.contentId))) });
      // Each fact represents a distinct item within this session.
      lastAttemptAt.set(attempt.key, attempt.at);
      const updated = contents ?? new Set<string>();
      updated.add(attempt.contentId); contentsByItem.set(attempt.key, updated);
    }
    for (const contentId of facts.seenContent) seenContent.add(contentId);

    for (const word of facts.words) {
      const wordId = word.wordId;
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
      const label = production.label ?? input.wordLabel?.(wordId);
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

export type VocabularyProgressLoadStats = { completions: number; reportsRead: number; reportBytes: number };

// Cache serialized facts so the retained payload has an exact byte budget. The database
// enforces immutability once closed. A replaced connection starts with an empty cache.
const FACT_BUDGET = 4 * 1024 * 1024;
const factCaches = new WeakMap<ReturnType<typeof getDb>, { entries: Map<string, Buffer>; bytes: number }>();

function loadClosedCompletions(learnerId: string) {
  const db = getDb();
  const committedCache = db.isTransaction ? undefined : factCaches.get(db);
  const cache = committedCache ?? { entries: new Map<string, Buffer>(), bytes: 0 };
  if (!db.isTransaction && !committedCache) factCaches.set(db, cache);
  // Check membership on every request. Never read report or action payloads on a hit.
  const rows = db.prepare(`SELECT completion_id FROM vocabulary_session_completions
    WHERE learner_id=? AND status='closed' ORDER BY staged_at,completion_id`).all(learnerId) as { completion_id: string }[];
  const byId = new Map<string, VocabularyProgressCompletion>(), missing: string[] = [];
  for (const { completion_id: id } of rows) {
    const hit = cache.entries.get(id);
    if (!hit) { missing.push(id); continue; }
    byId.set(id, JSON.parse(hit.toString()) as VocabularyProgressCompletion);
    cache.entries.delete(id);
    cache.entries.set(id, hit);
  }
  let reportBytes = 0;
  if (missing.length) {
    const reports = db.prepare(`SELECT completion_id, staged_at, json_extract(input_json,'$.activeDurationMs') AS active_ms, report_json
      FROM vocabulary_session_completions WHERE learner_id=? AND status='closed' AND completion_id IN (SELECT value FROM json_each(?))`);
    for (const row of reports.iterate(learnerId, JSON.stringify(missing))) {
      const report = String(row.report_json), id = String(row.completion_id);
      reportBytes += Buffer.byteLength(report);
      const completion = { stagedAt: String(row.staged_at), activeDurationMs: typeof row.active_ms === 'number' ? row.active_ms : null,
        facts: progressCompletionFacts(JSON.parse(report) as VocabularySessionProjection) };
      byId.set(id, completion);
      const encoded = Buffer.from(JSON.stringify(completion));
      if (encoded.length > FACT_BUDGET) continue;
      while (cache.bytes + encoded.length > FACT_BUDGET) {
        const oldest = cache.entries.keys().next().value!;
        cache.bytes -= cache.entries.get(oldest)!.length;
        cache.entries.delete(oldest);
      }
      cache.entries.set(id, encoded);
      cache.bytes += encoded.length;
    }
  }
  const completions = rows.map(({ completion_id }) => {
    const completion = byId.get(completion_id);
    if (!completion) throw new Error('Closed vocabulary completion disappeared during progress load');
    return completion;
  });
  return { completions, stats: { completions: rows.length, reportsRead: missing.length, reportBytes } };
}

export function loadVocabularyProgressInput(learnerId: string): { input: VocabularyProgressInput; stats: VocabularyProgressLoadStats } {
  const db = getDb();
  const { completions, stats } = loadClosedCompletions(learnerId);
  const pending = completions.flatMap(completion => completion.facts.attempts
    .filter(attempt => attempt.outcome === 'pending').map(attempt => attempt.encounterId));
  // A feedback case may be reassessed; its latest succeeded judgment decides.
  const judgments = pending.length === 0 ? [] : db.prepare(`SELECT e.encounter_id,json_extract(j.result_json,'$.input.unfairEncounterIds') AS unfair FROM reflection_cases c
    JOIN reflection_case_evidence e ON e.case_id=c.case_id
    JOIN vocabulary_reflection_jobs j ON j.case_id=c.case_id AND j.status='succeeded'
    WHERE c.learner_id=? AND c.kind='learner_feedback' AND e.encounter_id IN (SELECT value FROM json_each(?))
    ORDER BY j.created_at,j.job_id`).all(learnerId, JSON.stringify(pending)) as { encounter_id: string; unfair: string | null }[];
  const verdict = new Map<string, boolean>();
  for (const row of judgments) {
    const unfair = row.unfair === null ? [] : JSON.parse(row.unfair) as unknown;
    if (!Array.isArray(unfair)) throw new Error('Feedback judgment has malformed unfair encounters');
    verdict.set(row.encounter_id, unfair.includes(row.encounter_id));
  }
  const labelQuery = db.prepare(`SELECT l.hanzi,l.pinyin FROM learner_words w JOIN lexical_words l ON l.id=w.word_id
    WHERE w.learner_id=? AND w.word_id=?`);
  const wordLabel = (wordId: string) => labelQuery.get(learnerId, wordId) as WordLabel | undefined;
  return {
    input: { completions, judgedEncounterIds: new Set(verdict.keys()), unfairEncounterIds: new Set([...verdict].filter(([, unfair]) => unfair).map(([id]) => id)), wordLabel },
    stats,
  };
}
export function getVocabularyProgress(now = new Date(), timeZone?: string): VocabularyProgress {
  return computeVocabularyProgress(loadVocabularyProgressInput(requireLearnerId()).input, now, timeZone);
}
