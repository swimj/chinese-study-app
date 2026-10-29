import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { deriveRecoveryHighlight, type RecoveryEncounter } from '../src/domain/recovery-highlights.ts';

function encounter(day: number, result: RecoveryEncounter['result'], overrides: Partial<RecoveryEncounter> = {}): RecoveryEncounter {
  return {
    attemptId: `attempt-${day}`, sessionId: `session-${day}`, actionId: `action-${day}`,
    occurredAt: new Date(Date.UTC(2026, 0, day, 12)).toISOString(),
    wordId: 'word-a', hanzi: '殊不知', traditional: null,
    skill: 'recognition', result, ...overrides,
  };
}

function sequence(results: RecoveryEncounter['result'][], firstDay = 1): RecoveryEncounter[] {
  return results.map((result, index) => encounter(firstDay + index, result));
}

function derive(history: RecoveryEncounter[]) {
  return deriveRecoveryHighlight(history.at(-1)!, history);
}

function later(day: number, result: RecoveryEncounter['result']): RecoveryEncounter {
  return encounter(day, result, {
    attemptId: `later-${day}`, sessionId: `later-session-${day}`, actionId: `later-action-${day}`,
    occurredAt: new Date(Date.UTC(2026, 0, day, 23)).toISOString(),
  });
}

const trouble = () => sequence(['miss', 'miss', 'miss']);

describe('candidate recovery highlights', () => {
  // Sequences are chronological; the final item is the single current candidate.
  // The evaluator walks each sequence right-to-left, matching the flow chart.
  type Case = { name: string; results: RecoveryEncounter['result'][]; earns: boolean };
  const phases: Record<string, Case[]> = {
    'candidate input guards (raw session lapses are also tested at the DB boundary)': [
      { name: 'current miss cannot earn recovery', results: ['miss', 'miss', 'miss', 'success', 'success', 'miss'], earns: false },
      { name: 'current compensation cannot earn recovery', results: ['miss', 'miss', 'miss', 'success', 'success', 'neutral'], earns: false },
      { name: 'current unknown result cannot earn recovery', results: ['miss', 'miss', 'miss', 'success', 'success', 'excluded'], earns: false },
    ],
    'backward success search': [
      { name: 'first success after trouble', results: ['miss', 'miss', 'miss', 'success'], earns: false },
      { name: 'second success after trouble', results: ['miss', 'miss', 'miss', 'success', 'success'], earns: false },
      { name: 'third success after trouble', results: ['miss', 'miss', 'miss', 'success', 'success', 'success'], earns: true },
      { name: 'fourth success does not repeat recovery', results: ['miss', 'miss', 'miss', 'success', 'success', 'success', 'success'], earns: false },
      { name: 'uncompensated miss interrupts improvement', results: ['miss', 'miss', 'miss', 'success', 'success', 'miss', 'success', 'success'], earns: false },
      { name: 'three fresh successes after interruption qualify', results: ['miss', 'miss', 'miss', 'success', 'success', 'miss', 'success', 'success', 'success'], earns: true },
      { name: 'compensation neither counts nor interrupts successes', results: ['miss', 'miss', 'miss', 'success', 'neutral', 'success', 'neutral', 'success'], earns: true },
      { name: 'compensation cannot replace third successful day', results: ['miss', 'miss', 'miss', 'success', 'neutral', 'success'], earns: false },
      { name: 'unknown result interrupts success evidence', results: ['miss', 'miss', 'miss', 'success', 'excluded', 'success', 'success'], earns: false },
      { name: 'unknown evidence between improvement and trouble blocks attribution', results: ['miss', 'miss', 'miss', 'excluded', 'success', 'success', 'success'], earns: false },
      { name: 'history ends before three successful days', results: ['success'], earns: false },
    ],
    'backward trouble search': [
      { name: 'a single miss is insufficient', results: ['miss', 'success', 'success', 'success'], earns: false },
      { name: 'two misses are insufficient', results: ['miss', 'miss', 'success', 'success', 'success'], earns: false },
      { name: 'compensation cannot establish trouble', results: ['miss', 'neutral', 'miss', 'success', 'success', 'success'], earns: false },
      { name: 'unknown historical evidence interrupts an earlier success boundary', results: ['miss', 'miss', 'miss', 'success', 'success', 'excluded', 'success', 'success', 'miss', 'success', 'success', 'success'], earns: true },
      { name: 'one fresh miss cannot reuse recovered trouble', results: ['miss', 'miss', 'miss', 'success', 'success', 'success', 'miss', 'success', 'success', 'success'], earns: false },
      { name: 'clipped old trouble cannot be combined with a fresh miss', results: ['miss', 'miss', 'success', 'success', 'success', 'miss', 'success', 'success', 'success'], earns: false },
      { name: 'neutral evidence cannot hide an earlier episode boundary', results: ['miss', 'miss', 'miss', 'success', 'neutral', 'success', 'success', 'miss', 'success', 'success', 'success'], earns: false },
      { name: 'history ends with three successes but no trouble', results: ['success', 'success', 'success'], earns: false },
      { name: 'neutral-only older history cannot supply trouble', results: ['neutral', 'neutral', 'success', 'success', 'success'], earns: false },
    ],
  };
  for (const [phase, cases] of Object.entries(phases)) {
    describe(phase, () => {
      for (const { name, results, earns } of cases) {
        test(name, () => assert.equal(derive(sequence(results)) !== null, earns));
      }
    });
  }

  test('returns chronological supporting attempt references for the selected candidate', () => {
    const highlight = derive([...trouble(), ...sequence(['success', 'success', 'success'], 4)]);
    assert.ok(highlight);
    assert.deepEqual(highlight.troubleRules, ['three_of_five', 'three_days_in_thirty']);
    assert.deepEqual(highlight.troubleAttempts.map(item => item.attemptId), ['attempt-1', 'attempt-2', 'attempt-3']);
    assert.equal(highlight.latestMiss.attemptId, 'attempt-3');
    assert.deepEqual(highlight.successAttempts.map(item => item.attemptId), ['attempt-4', 'attempt-5', 'attempt-6']);
    assert.deepEqual(highlight.successAttempts[2], {
      attemptId: 'attempt-6', sessionId: 'session-6', actionId: 'action-6', occurredAt: '2026-01-06T12:00:00.000Z',
    });
    assert.equal(highlight.ruleVersion, 'word_recovery.v1');
    assert.equal(highlight.wordId, 'word-a');
    assert.equal(highlight.skill, 'recognition');
  });

  test('three missed days can establish trouble without three misses among five encounters', () => {
    const highlight = derive(sequence(['miss', 'success', 'success', 'miss', 'success', 'success', 'miss', 'success', 'success', 'success']));
    assert.ok(highlight);
    assert.deepEqual(highlight.troubleRules, ['three_days_in_thirty']);
    assert.deepEqual(highlight.troubleAttempts.map(item => item.attemptId), ['attempt-1', 'attempt-4', 'attempt-7']);
  });

  test('compensated encounters in trouble evidence are skipped without counting as misses', () => {
    const highlight = derive(sequence(['miss', 'neutral', 'miss', 'neutral', 'miss', 'success', 'success', 'success']));
    assert.ok(highlight);
    assert.deepEqual(highlight.troubleAttempts.map(item => item.attemptId), ['attempt-1', 'attempt-3', 'attempt-5']);
  });

  test('multiple misses on one day cannot establish trouble', () => {
    assert.equal(derive([encounter(1, 'miss'), later(1, 'miss'), ...sequence(['success', 'success', 'success'], 2)]), null);
  });

  test('multiple successful sessions on one day count only once', () => {
    assert.equal(derive([...trouble(), encounter(4, 'success'), later(4, 'success'), encounter(5, 'success')]), null);
    const highlight = derive([...trouble(), encounter(4, 'success'), later(4, 'success'), encounter(5, 'success'), encounter(6, 'success')]);
    assert.ok(highlight);
    assert.deepEqual(highlight.successAttempts.map(item => item.attemptId), ['attempt-4', 'attempt-5', 'attempt-6']);
  });

  test('a later successful session on the third day cannot earn the same milestone', () => {
    const history = [...trouble(), ...sequence(['success', 'success', 'success'], 4)];
    assert.ok(derive(history));
    assert.equal(derive([...history, later(6, 'success')]), null);
  });

  test('a miss earlier on the candidate day vetoes its success', () => {
    assert.equal(derive([...trouble(), ...sequence(['success', 'success'], 4), encounter(6, 'miss'), later(6, 'success')]), null);
  });

  test('a historical day containing a miss cannot contribute to the current success suffix', () => {
    assert.equal(derive([...trouble(), encounter(4, 'miss'), later(4, 'success'), ...sequence(['success', 'success'], 5)]), null);
  });

  test('historical compensation on a successful day does not veto that day', () => {
    const highlight = derive([...trouble(), encounter(4, 'success'), later(4, 'neutral'), ...sequence(['success', 'success'], 5)]);
    assert.ok(highlight);
    assert.deepEqual(highlight.successAttempts.map(item => item.attemptId), ['attempt-4', 'attempt-5', 'attempt-6']);
  });

  test('backward trouble search stops at an earlier morning three-success boundary despite its afternoon miss', () => {
    const history = [...trouble(), ...sequence(['success', 'success', 'success'], 4)];
    assert.equal(derive([...history, later(6, 'miss'), ...sequence(['success', 'success', 'success'], 7)]), null);
  });

  test('a miss before same-day success prevents a false earlier three-success boundary', () => {
    const highlight = derive([
      ...trouble(), encounter(4, 'success'), encounter(5, 'success'),
      encounter(6, 'miss'), later(6, 'success'), encounter(7, 'miss'),
      ...sequence(['success', 'success', 'success'], 8),
    ]);
    assert.ok(highlight);
    assert.deepEqual(highlight.troubleAttempts.map(item => item.attemptId), ['attempt-3', 'attempt-6', 'attempt-7']);
  });

  test('latest miss provenance names the later session when a day has multiple misses', () => {
    const highlight = derive([...trouble(), later(3, 'miss'), ...sequence(['success', 'success', 'success'], 4)]);
    assert.ok(highlight);
    assert.equal(highlight.latestMiss.attemptId, 'later-3');
    assert.equal(highlight.latestMiss.sessionId, 'later-session-3');
  });

  test('fresh trouble evidence cannot include attempts from the earlier recovered episode', () => {
    const highlight = derive(sequence(['miss', 'miss', 'miss', 'success', 'success', 'success', 'miss', 'miss', 'miss', 'success', 'success', 'success']));
    assert.ok(highlight);
    assert.deepEqual(highlight.troubleAttempts.map(item => item.attemptId), ['attempt-7', 'attempt-8', 'attempt-9']);
  });

  test('mixed words or skills violate the single-candidate history contract', () => {
    const history = [...trouble(), ...sequence(['success', 'success', 'success'], 4)];
    const candidate = history.at(-1)!;
    assert.throws(() => deriveRecoveryHighlight(candidate, [...history, encounter(2, 'miss', { wordId: 'word-b' })]), /one candidate word and skill/);
    assert.throws(() => deriveRecoveryHighlight(candidate, [...history, encounter(2, 'miss', { skill: 'production' })]), /one candidate word and skill/);
  });

  test('candidate must be the latest encounter supplied', () => {
    const history = [...trouble(), ...sequence(['success', 'success', 'success'], 4)];
    assert.equal(deriveRecoveryHighlight(history.at(-1)!, [...history, encounter(7, 'success')]), null);
    assert.equal(deriveRecoveryHighlight(history.at(-1)!, history.slice(0, -1)), null);
  });

  test('unordered evidence is deterministic and input objects remain unchanged', () => {
    const history = [...trouble(), ...sequence(['success', 'success', 'success'], 4)];
    const candidate = history.at(-1)!;
    const frozen = Object.freeze([...history].reverse().map(item => Object.freeze({ ...item })));
    assert.deepEqual(deriveRecoveryHighlight(candidate, frozen), deriveRecoveryHighlight(candidate, history));
    assert.equal(frozen[0].attemptId, 'attempt-6');
  });
});
