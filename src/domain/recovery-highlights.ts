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
  result: 'success' | 'miss' | 'excluded';
};

const DAY_MS = 86_400_000;

/** Input contains only the first accepted encounter for each session/word/skill. */
export function deriveRecoveryHighlights(encounters: readonly RecoveryEncounter[]): RecoveryHighlight[] {
  const groups = new Map<string, RecoveryEncounter[]>();
  for (const encounter of encounters) {
    const key = JSON.stringify([encounter.wordId, encounter.skill]);
    const group = groups.get(key) ?? [];
    group.push(encounter);
    groups.set(key, group);
  }
  const highlights: RecoveryHighlight[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.attemptId.localeCompare(b.attemptId));
    const days = new Map<string, RecoveryEncounter[]>();
    for (const encounter of group) {
      const day = encounter.occurredAt.slice(0, 10);
      days.set(day, [...(days.get(day) ?? []), encounter]);
    }
    let history: RecoveryEncounter[] = [];
    let trouble: { rules: RecoveryHighlight['troubleRules']; attempts: RecoveryEncounter[] } | null = null;
    let latestMiss: RecoveryEncounter | null = null;
    let successes: RecoveryEncounter[] = [];
    for (const day of days.values()) {
      let representative: RecoveryEncounter | null = null;
      let includedInEpisode = false;
      for (const encounter of day) {
        if (encounter.result === 'miss') latestMiss = encounter;
        // Process in time order: a later miss breaks an unfinished streak, but
        // cannot un-consume a milestone already earned in an earlier session.
        if (representative?.result === 'miss'
          || (representative?.result === 'excluded' && encounter.result !== 'miss')
          || (representative?.result === 'success' && encounter.result === 'success')) continue;
        representative = encounter;
        if (includedInEpisode) history[history.length - 1] = encounter;
        else { history.push(encounter); includedInEpisode = true; }
        if (encounter.result === 'miss') {
          successes = [];
          if (!trouble) {
            const recentFive = history.slice(-5).filter((item) => item.result === 'miss');
            const today = Date.parse(`${encounter.occurredAt.slice(0, 10)}T00:00:00.000Z`);
            const recentThirty = history.filter((item) => item.result === 'miss'
              && Date.parse(`${item.occurredAt.slice(0, 10)}T00:00:00.000Z`) >= today - 29 * DAY_MS);
            const rules: RecoveryHighlight['troubleRules'] = [];
            if (recentFive.length >= 3) rules.push('three_of_five');
            if (recentThirty.length >= 3) rules.push('three_days_in_thirty');
            if (rules.length > 0) {
              const supporting = new Set([
                ...(recentFive.length >= 3 ? recentFive : []),
                ...(recentThirty.length >= 3 ? recentThirty : []),
              ]);
              const attempts = history.filter((item) => supporting.has(item));
              trouble = { rules, attempts };
            }
          }
        } else if (encounter.result === 'excluded') {
          successes = [];
        } else {
          successes.push(encounter);
          if (successes.length === 3) {
            if (trouble && latestMiss) highlights.push({
              id: `word_recovery.v1/${encounter.attemptId}`,
              ruleVersion: 'word_recovery.v1',
              wordId: encounter.wordId, hanzi: encounter.hanzi, traditional: encounter.traditional,
              skill: encounter.skill, troubleRules: trouble.rules,
              troubleAttempts: trouble.attempts.map(reference), latestMiss: reference(latestMiss),
              successAttempts: successes.map(reference),
            });
            // Three successes end prior trouble even if the window clipped its start.
            // Otherwise moving the cutoff could reuse misses from an earlier recovery.
            history = [];
            trouble = null;
            latestMiss = null;
            successes = [];
            includedInEpisode = false;
          }
        }
      }
    }
  }
  return highlights.sort((a, b) => a.successAttempts[2].occurredAt.localeCompare(b.successAttempts[2].occurredAt)
    || a.id.localeCompare(b.id));
}

function reference(encounter: RecoveryEncounter): RecoveryAttemptReference {
  return { attemptId: encounter.attemptId, sessionId: encounter.sessionId,
    actionId: encounter.actionId, occurredAt: encounter.occurredAt };
}
