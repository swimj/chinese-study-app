import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { deriveRecoveryHighlights, type RecoveryEncounter } from '../src/domain/recovery-highlights.ts';

function encounter(day: number, result: RecoveryEncounter['result'], overrides: Partial<RecoveryEncounter> = {}): RecoveryEncounter {
  const occurredAt = new Date(Date.UTC(2026, 0, day, 12)).toISOString();
  return {
    attemptId: `attempt-${day}`, sessionId: `session-${day}`, actionId: `action-${day}`,
    occurredAt, wordId: 'word-a', hanzi: '殊不知', traditional: null,
    skill: 'recognition', result, ...overrides,
  };
}

function sequence(results: RecoveryEncounter['result'][], firstDay = 1): RecoveryEncounter[] {
  return results.map((result, index) => encounter(firstDay + index, result));
}

const trouble = () => sequence(['miss', 'miss', 'miss']);

describe('recovery highlights', () => {
  test('requires repeated trouble and three subsequent successful days', () => {
    assert.deepEqual(deriveRecoveryHighlights(sequence(['miss', 'success', 'success', 'success'])), []);
    assert.deepEqual(deriveRecoveryHighlights([...trouble(), ...sequence(['success', 'success'], 4)]), []);
    const [highlight] = deriveRecoveryHighlights([...trouble(), ...sequence(['success', 'success', 'success'], 4)]);
    assert.ok(highlight);
    assert.deepEqual(highlight.troubleRules, ['three_of_five', 'three_days_in_thirty']);
    assert.deepEqual(highlight.troubleAttempts.map((item) => item.attemptId), ['attempt-1', 'attempt-2', 'attempt-3']);
    assert.equal(highlight.latestMiss.attemptId, 'attempt-3');
    assert.deepEqual(highlight.successAttempts.map((item) => item.attemptId), ['attempt-4', 'attempt-5', 'attempt-6']);
    assert.equal(highlight.successAttempts[2].sessionId, 'session-6');
    assert.equal(highlight.successAttempts[2].actionId, 'action-6');
    assert.equal(highlight.ruleVersion, 'word_recovery.v1');
  });

  test('three of five establishes trouble even when misses are outside thirty days', () => {
    const results = deriveRecoveryHighlights([
      encounter(1, 'miss'), encounter(40, 'success'), encounter(80, 'miss'),
      encounter(120, 'success'), encounter(160, 'miss'),
      ...sequence(['success', 'success', 'success'], 200),
    ]);
    assert.equal(results.length, 1);
    assert.deepEqual(results[0].troubleRules, ['three_of_five']);
    assert.deepEqual(results[0].troubleAttempts.map((item) => item.attemptId), ['attempt-1', 'attempt-80', 'attempt-160']);
  });

  test('three miss days in thirty establishes trouble without three misses in any five encounters', () => {
    const results = deriveRecoveryHighlights(sequence([
      'miss', 'success', 'success', 'miss', 'success', 'success', 'miss',
      'success', 'success', 'success',
    ]));
    assert.equal(results.length, 1);
    assert.deepEqual(results[0].troubleRules, ['three_days_in_thirty']);
    assert.deepEqual(new Set(results[0].troubleAttempts.map((item) => item.attemptId)), new Set(['attempt-1', 'attempt-4', 'attempt-7']));
  });

  test('thirty-day trouble window includes today and the preceding twenty-nine UTC dates', () => {
    const history = [encounter(1, 'miss'), encounter(2, 'success'), encounter(3, 'success'),
      encounter(15, 'miss'), encounter(16, 'success'), encounter(17, 'success')];
    assert.equal(deriveRecoveryHighlights([...history, encounter(30, 'miss'),
      ...sequence(['success', 'success', 'success'], 32)]).length, 1);
    assert.deepEqual(deriveRecoveryHighlights([...history, encounter(31, 'miss'),
      ...sequence(['success', 'success', 'success'], 32)]), []);
  });

  test('multiple misses or successes on one day count only once', () => {
    const repeated = (day: number, result: RecoveryEncounter['result']) => [
      encounter(day, result), encounter(day, result, { attemptId: `second-${day}`, sessionId: `second-session-${day}` }),
      encounter(day, result, { attemptId: `third-${day}`, sessionId: `third-session-${day}` }),
    ];
    assert.deepEqual(deriveRecoveryHighlights([...repeated(1, 'miss'), ...sequence(['success', 'success', 'success'], 2)]), []);
    assert.deepEqual(deriveRecoveryHighlights([...trouble(), ...repeated(4, 'success')]), []);
    assert.equal(deriveRecoveryHighlights([...trouble(), ...repeated(4, 'success'), ...sequence(['success', 'success'], 5)]).length, 1);
  });

  test('a later miss on a successful day interrupts an unfinished streak', () => {
    const history = [...trouble(), ...sequence(['success', 'success'], 4),
      encounter(5, 'miss', { attemptId: 'late-miss', sessionId: 'late-session', occurredAt: '2026-01-05T23:59:59.000Z' })];
    assert.deepEqual(deriveRecoveryHighlights(history), []);
    assert.deepEqual(deriveRecoveryHighlights([...history, ...sequence(['success', 'success'], 6)]), []);
    const [highlight] = deriveRecoveryHighlights([...history, ...sequence(['success', 'success', 'success'], 6)]);
    assert.equal(highlight.latestMiss.attemptId, 'late-miss');
    assert.deepEqual(highlight.successAttempts.map((item) => item.attemptId), ['attempt-6', 'attempt-7', 'attempt-8']);
  });

  test('a later same-day miss cannot un-consume an earned milestone or reuse its old trouble', () => {
    const history = [...trouble(), ...sequence(['success', 'success', 'success'], 4)];
    const earned = deriveRecoveryHighlights(history);
    assert.equal(earned.length, 1);
    const laterHistory = [...history,
      encounter(6, 'miss', { attemptId: 'late-miss', sessionId: 'late-session', occurredAt: '2026-01-06T23:59:59.000Z' }),
      ...sequence(['success', 'success', 'success'], 7)];
    assert.deepEqual(deriveRecoveryHighlights(laterHistory), earned);
  });

  test('latest miss evidence references the later miss when a day contains multiple misses', () => {
    const [highlight] = deriveRecoveryHighlights([...trouble(),
      encounter(3, 'miss', { attemptId: 'latest-miss', sessionId: 'latest-session', occurredAt: '2026-01-03T23:59:59.000Z' }),
      ...sequence(['success', 'success', 'success'], 4)]);
    assert.equal(highlight.latestMiss.attemptId, 'latest-miss');
    assert.equal(highlight.latestMiss.sessionId, 'latest-session');
  });

  test('corrected or unknown encounters neither establish trouble nor bridge a success streak', () => {
    assert.deepEqual(deriveRecoveryHighlights(sequence(['miss', 'excluded', 'miss', 'success', 'success', 'success'])), []);
    const history = [...trouble(), ...sequence(['success', 'success', 'excluded', 'success', 'success'], 4)];
    assert.deepEqual(deriveRecoveryHighlights(history), []);
    const [highlight] = deriveRecoveryHighlights([...history, encounter(9, 'success')]);
    assert.deepEqual(highlight.successAttempts.map((item) => item.attemptId), ['attempt-7', 'attempt-8', 'attempt-9']);
  });

  test('exclusion on a successful day blocks that day from counting as success', () => {
    const history = [...trouble(), ...sequence(['success', 'success', 'success'], 4),
      encounter(5, 'excluded', { attemptId: 'corrected-attempt', sessionId: 'corrected-session' })];
    assert.deepEqual(deriveRecoveryHighlights(history), []);
  });

  test('a recovery consumes the trouble episode and requires fresh trouble before another milestone', () => {
    const history = sequence(['miss', 'miss', 'miss', 'success', 'success', 'success',
      'miss', 'success', 'success', 'success', 'success', 'success', 'success']);
    assert.equal(deriveRecoveryHighlights(history).length, 1);
    const highlights = deriveRecoveryHighlights([...history, ...sequence(['miss', 'miss', 'miss', 'success', 'success', 'success'], 14)]);
    assert.equal(highlights.length, 2);
    assert.notEqual(highlights[0].id, highlights[1].id);
    assert.ok(highlights[1].troubleAttempts.every((item) => Number(item.attemptId.slice('attempt-'.length)) > 6));
    assert.equal(highlights[1].latestMiss.attemptId, 'attempt-16');
  });

  test('established trouble does not expire while waiting for later recall evidence', () => {
    assert.equal(deriveRecoveryHighlights([...trouble(), encounter(100, 'success'), encounter(200, 'success'), encounter(300, 'success')]).length, 1);
  });

  test('clipping an old trouble threshold cannot reuse its remaining misses after three successes', () => {
    // The moving cutoff dropped the first miss of an earlier recovered episode.
    // Two surviving old misses must not combine with a fresh miss to award again.
    const results = deriveRecoveryHighlights(sequence([
      'miss', 'miss', 'success', 'success', 'success', 'miss', 'success', 'success', 'success',
    ]));
    assert.deepEqual(results, []);
  });

  test('words and skills cannot supply evidence for one another', () => {
    const history = [...trouble(),
      ...sequence(['success', 'success', 'success'], 4).map((item) => ({ ...item, skill: 'production' as const })),
      ...sequence(['success', 'success', 'success'], 7).map((item) => ({ ...item, wordId: 'word-b' }))];
    assert.deepEqual(deriveRecoveryHighlights(history), []);
    const [highlight] = deriveRecoveryHighlights([...history, ...sequence(['success', 'success', 'success'], 10)]);
    assert.equal(highlight.wordId, 'word-a');
    assert.equal(highlight.skill, 'recognition');
  });

  test('derivation is deterministic for unordered input and does not mutate source evidence', () => {
    const history = sequence(['miss', 'miss', 'miss', 'success', 'success', 'success']);
    const expected = deriveRecoveryHighlights(history);
    const frozen = Object.freeze([...history].reverse().map((item) => Object.freeze({ ...item })));
    assert.deepEqual(deriveRecoveryHighlights(frozen), expected);
    assert.equal(frozen[0].attemptId, 'attempt-6');
  });
});
