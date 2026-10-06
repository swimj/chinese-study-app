export type RecoverySkill = 'recognition' | 'production';

export type RecoveryAttemptReference = {
  attemptId: string;
  sessionId: string;
  actionId: string;
  occurredAt: string;
};

/** A derived milestone, not an exposure event or a mastery assessment. */
export type RecoveryHighlight = {
  id: string;
  ruleVersion: 'word_recovery.v1';
  wordId: string;
  hanzi: string;
  traditional: string | null;
  skill: RecoverySkill;
  troubleRules: Array<'three_of_five' | 'three_days_in_thirty'>;
  troubleAttempts: RecoveryAttemptReference[];
  latestMiss: RecoveryAttemptReference;
  successAttempts: RecoveryAttemptReference[];
};

export type RecoveryEncounter = RecoveryAttemptReference & {
  wordId: string;
  hanzi: string;
  traditional: string | null;
  skill: RecoverySkill;
  result: 'success' | 'miss' | 'neutral' | 'excluded';
};

/**
 * Inspect one current-session candidate, newest to oldest. The caller supplies
 * only this word/skill's first accepted encounters inside the bounded window.
 * Historical compensation is neutral; unknown evidence remains a barrier.
 */
export function deriveRecoveryHighlight(
  candidate: RecoveryEncounter,
  history: readonly RecoveryEncounter[],
): RecoveryHighlight | null {
  if (candidate.result !== 'success') return null;
  for (const encounter of history) {
    if (encounter.wordId !== candidate.wordId || encounter.skill !== candidate.skill) {
      throw new Error('Recovery history must belong to one candidate word and skill.');
    }
  }
  const ordered = [...history].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)
    || b.attemptId.localeCompare(a.attemptId));
  if (ordered[0]?.attemptId !== candidate.attemptId) return null;
  const days: RecoveryEncounter[][] = [];
  for (const encounter of ordered) {
    const last = days.at(-1);
    if (last?.[0].occurredAt.slice(0, 10) === encounter.occurredAt.slice(0, 10)) last.push(encounter);
    else days.push([encounter]);
  }

  const successes: RecoveryEncounter[] = [];
  let troubleDay = -1;
  for (let index = 0; index < days.length; index++) {
    const day = days[index];
    const effective = day.filter(item => item.result !== 'neutral');
    if (effective.length === 0) continue;
    const miss = effective.find(item => item.result === 'miss');
    if (miss) {
      if (successes.length !== 3) return null;
      troubleDay = index;
      break;
    }
    if (effective.some(item => item.result === 'excluded')) return null;
    // The first success that day earns the day; later sessions cannot earn it again.
    const firstSuccess = effective.at(-1)!;
    if (successes.length === 0 && firstSuccess.attemptId !== candidate.attemptId) return null;
    successes.push(firstSuccess);
    if (successes.length > 3) return null; // Current success is fourth or later.
  }
  if (troubleDay < 0) return null;

  const misses: RecoveryEncounter[] = [];
  let earlierSuccessDays = 0;
  let countedDays = 0;
  const latestMiss = days[troubleDay].find(item => item.result === 'miss')!;
  for (let index = troubleDay; index < days.length; index++) {
    const day = days[index];
    let dayHasMiss = false;
    let dayHasEvidence = false;
    let pendingSuccess = false;
    // On the newest missed day, start at its last miss, ignoring later same-day
    // successes. Earlier successes on that day can close an older episode.
    const start = index === troubleDay ? day.indexOf(latestMiss) : 0;
    for (const encounter of day.slice(start)) {
      if (encounter.result === 'neutral') continue;
      dayHasEvidence = true;
      if (encounter.result === 'miss') {
        earlierSuccessDays = 0;
        pendingSuccess = false;
        if (!dayHasMiss) {
          dayHasMiss = true;
          misses.push(encounter);
          if (misses.length === 3) {
            return {
              id: `word_recovery.v1/${candidate.attemptId}`, ruleVersion: 'word_recovery.v1',
              wordId: candidate.wordId, hanzi: candidate.hanzi, traditional: candidate.traditional,
              skill: candidate.skill,
              // All supplied history is within 30 days. Three distinct missed
              // days suffice; record whether the narrower last-five rule also fits.
              troubleRules: countedDays < 5 ? ['three_of_five', 'three_days_in_thirty'] : ['three_days_in_thirty'],
              troubleAttempts: [...misses].reverse().map(reference), latestMiss: reference(latestMiss),
              successAttempts: [...successes].reverse().map(reference),
            };
          }
        }
      } else if (encounter.result === 'excluded') {
        earlierSuccessDays = 0;
        pendingSuccess = false;
      } else {
        pendingSuccess = true;
      }
    }
    if (dayHasEvidence) countedDays++;
    if (pendingSuccess && ++earlierSuccessDays === 3) return null;
  }
  return null;
}

function reference(encounter: RecoveryEncounter): RecoveryAttemptReference {
  return { attemptId: encounter.attemptId, sessionId: encounter.sessionId,
    actionId: encounter.actionId, occurredAt: encounter.occurredAt };
}
