import { getConfig, getDb } from '../db/connection.ts';
import { requireLearnerId } from '../db/learner-context.ts';
import { getPureCueContent, getPureCueServedSnapshot } from '../db/pure-cues.ts';
import { getActiveProductionCuesForWord } from '../db/production-cues.ts';
import { normalizeMandarinHanziLookup } from '../db/hanzi-lookup.ts';
import type { PureCueAssessmentEvent } from '../../src/domain/pure-cues.ts';
import type { ReflectionWordSnapshotV1 } from '../../src/domain/reflection.ts';
import {
  parsePureCueReflectionBundle,
  type PureCueReflectionBundleV1,
  type PureCueReflectionItemV1,
} from '../../src/domain/pure-cue-reflection.ts';
import { INITIAL_REFLECTION_MAX_EVIDENCE_ITEMS, ReflectionEvidenceError } from './evidence.ts';

export function buildPureCueReflectionBundle(
  sessionId: string,
  generatedAt: string,
): PureCueReflectionBundleV1 | null {
  const learnerId = requireLearnerId();
  const session = getDb().prepare(`SELECT id, started_at, ended_at FROM study_sessions WHERE id = ?`)
    .get(sessionId) as { id: string; started_at: string; ended_at: string | null } | undefined;
  if (!session) throw new ReflectionEvidenceError('session_not_found', 'Study session not found.');
  if (!getDb().prepare('SELECT 1 FROM review_session_summaries WHERE session_id = ?').get(sessionId)) {
    throw new ReflectionEvidenceError('session_not_completed', 'The study session is not completed.');
  }
  if (getConfig().studyProfile !== 'mandarin') return null;
  const rows = getDb().prepare(`SELECT attempt_id, snapshot_id, session_action_id, events_json
    FROM pure_cue_attempts WHERE learner_id = ? AND session_id = ?
    ORDER BY committed_at, attempt_id`).all(learnerId, sessionId) as Array<{
      attempt_id: string; snapshot_id: string; session_action_id: string; events_json: string;
    }>;
  const items: PureCueReflectionItemV1[] = [];
  const seenCues = new Set<string>();
  const seenWords = new Set<string>();
  for (const row of rows) {
    const first = (JSON.parse(row.events_json) as PureCueAssessmentEvent[])[0];
    if (!first || first.outcome !== 'rejected' || !first.response?.trim()) continue;
    const candidates = getDb().prepare('SELECT id FROM lexical_words WHERE normalized_hanzi = ?')
      .all(normalizeMandarinHanziLookup(first.response)) as Array<{ id: string }>;
    // Ambiguous lexical identity is not authority to modify an arbitrary word.
    if (candidates.length !== 1) continue;
    const wordId = candidates[0]!.id;
    const snapshot = getPureCueServedSnapshot(row.snapshot_id);
    if (!snapshot) throw new Error('Pure cue attempt has no owned served snapshot.');
    const currentCue = getPureCueContent(snapshot.pureCueId);
    if (!currentCue?.active || currentCue.acceptedWordIds.includes(wordId) || seenCues.has(currentCue.id) || seenWords.has(wordId)) continue;
    if (snapshot.acceptedAnswers.some((answer) => answer.wordId === wordId)) continue;
    items.push({
      source: 'pure_cue_mistake', sourceActionKind: 'pure_cue',
      itemId: `pure-cue:${row.attempt_id}`, sourceAttemptId: row.attempt_id,
      firstEventId: first.eventId, sessionActionId: row.session_action_id,
      occurredAt: first.occurredAt, rawResponse: first.response,
      submittedWord: pureCueReflectionWord(wordId), servedSnapshot: snapshot,
      currentCue: { id: currentCue.id, stimulus: currentCue.stimulus, axisNote: currentCue.axisNote, teachingNote: currentCue.teachingNote, acceptedWordIds: currentCue.acceptedWordIds, acceptedWords: currentCue.acceptedWordIds.map(pureCueReflectionWord) },
      activeProductionCues: getActiveProductionCuesForWord(wordId).map((cue) => ({
        cueId: cue.cueId, cueType: cue.cueType, text: cue.text, acceptedWordIds: cue.acceptedWordIds,
      })),
      targetWord: null, sessionNote: null,
      existingContent: { contrastClusters: [], knownAcceptedAlternates: [] },
    });
    seenCues.add(currentCue.id);
    seenWords.add(wordId);
    if (items.length >= INITIAL_REFLECTION_MAX_EVIDENCE_ITEMS) break;
  }
  if (items.length === 0) return null;
  return parsePureCueReflectionBundle({
    schemaVersion: 'pure_cue_reflection_bundle.v1', generatedAt,
    session: { sessionId, startedAt: session.started_at, endedAt: session.ended_at, studyProfile: 'mandarin' },
    items,
  });
}

export function pureCueReflectionWord(wordId: string): ReflectionWordSnapshotV1 {
  const word = getDb().prepare('SELECT hanzi, pinyin, meaning, meanings_json FROM lexical_words WHERE id = ?')
    .get(wordId) as { hanzi: string; pinyin: string; meaning: string; meanings_json: string } | undefined;
  if (!word) throw new Error(`Pure cue reflection word ${wordId} is unavailable.`);
  const meanings = JSON.parse(word.meanings_json) as string[];
  return { wordId, hanzi: word.hanzi, pinyin: word.pinyin, meanings: meanings.length ? meanings : [word.meaning] };
}
