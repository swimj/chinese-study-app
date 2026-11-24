import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { addDays, learnerZone, learningDay, serverZone } from './day.ts';
import { actionSchema, openJournal, priorityOf, storedZone, zoneOf } from './journal.ts';
import { GRADUATION_VERSION, isDue, lifecycle, type Outcome } from './lifecycle.ts';
import { demoFriend, demoTutor } from './practice.ts';
import { rank, type Signal } from './priority.ts';
import { addJudgment, appendEvent, createRecordTables, judgedToday, type Target } from './record.ts';
import type { TurnContext } from './tutor.ts';

const NY = 'America/New_York';
const recall = (at: string, correct = true): Outcome => ({ at, correct, typed: true });

test('a learning day is the learner’s calendar day, across DST changes', () => {
  // 20:30 EST on 24 November is already the 25th in UTC.
  assert.equal(learningDay('2026-11-25T01:30:00.000Z', NY), '2026-11-24');
  assert.equal(learningDay('2026-11-25T01:30:00.000Z', 'UTC'), '2026-11-25');
  // Autumn: 23:30 EDT on 31 October, then 23:30 EST on 1 November (a 25-hour day).
  assert.equal(learningDay('2026-11-01T03:30:00.000Z', NY), '2026-10-31');
  assert.equal(learningDay('2026-11-02T04:30:00.000Z', NY), '2026-11-01');
  assert.equal(learningDay('2026-11-01T04:30:00.000Z', NY), '2026-11-01', 'midnight EDT has passed');
  // Spring: 23:59 EST on 7 March, then 03:30 EDT on 8 March (a 23-hour day).
  assert.equal(learningDay('2026-03-08T04:59:00.000Z', NY), '2026-03-07');
  assert.equal(learningDay('2026-03-08T07:30:00.000Z', NY), '2026-03-08');
  assert.equal(addDays('2026-03-07', 1), '2026-03-08', 'day arithmetic counts calendar days');
  assert.equal(addDays('2026-10-31', 14), '2026-11-14');
  assert.throws(() => addDays('2026-11-24T00:00:00Z', 1), /Not a day key/);
});

test('an evening recall due tomorrow is not due the same evening in New York', () => {
  // Taught at 10:00 EST and recalled in the same session; policy B wants the next recall tomorrow.
  const taught = '2026-11-24T15:00:00.000Z';
  const outcomes = [recall('2026-11-24T15:10:00.000Z')];
  const life = lifecycle('B', taught, outcomes, NY);
  assert.deepEqual([life.state, life.due], ['settling', '2026-11-25']);
  const evening = new Date('2026-11-25T01:30:00.000Z'); // 20:30 EST on the 24th
  assert.equal(isDue(life, learningDay(evening, NY)), false, 'not due this evening');
  assert.equal(isDue(life, learningDay('2026-11-25T14:00:00.000Z', NY)), true, 'due tomorrow morning');
  // Under UTC days it was due at 19:00 EST the same day: the quirk this fixes.
  assert.equal(isDue(lifecycle('B', taught, outcomes, 'UTC'), learningDay(evening, 'UTC')), true);

  const target: Target = { id: 1, form: '透透气', kind: 'word', gloss: null, pinyin: null, origin: 'saved', createdAt: taught, hosted: null };
  const signals: Signal[] = [
    { form: '透透气', role: 'taught', at: taught, eventId: 'l', practice: true, graduation: { policy: 'B', version: GRADUATION_VERSION } },
    { form: '透透气', role: 'correct', at: outcomes[0].at, eventId: 'r', practice: true, exercise: 'recall' },
  ];
  assert.equal(rank([target], signals, evening, NY).length, 0, 'the ranking does not ask for it this evening');
  assert.equal(rank([target], signals, new Date('2026-11-25T14:00:00.000Z'), NY)[0].stage, 'scheduled');
});

test('a recall late on the long autumn DST day counts on its own day', () => {
  // Taught and first recalled at 23:00 EDT on 31 October; policy A wants a recall on 1 November.
  const taught = '2026-11-01T03:00:00.000Z';
  const first = recall('2026-11-01T03:05:00.000Z');
  assert.equal(lifecycle('A', taught, [first], NY).due, '2026-11-01');
  // 23:30 EST on 1 November is 04:30Z on the 2nd: still the due day, so it is clean.
  const late = lifecycle('A', taught, [first, recall('2026-11-02T04:30:00.000Z')], NY);
  assert.deepEqual([late.clean, late.due], [1, '2026-11-02'], 'a 24-hour step from local midnight would have missed it');
});

test('a change of zone recomputes days from the stored instants without rewriting them', () => {
  const taught = '2026-11-24T15:00:00.000Z';
  const outcomes = [recall('2026-11-24T15:10:00.000Z')];
  // In Shanghai the lesson was at 23:00 on the 24th; the next recall is due on the 25th there.
  const shanghai = lifecycle('B', taught, outcomes, 'Asia/Shanghai');
  assert.equal(shanghai.due, '2026-11-25');
  // 20:30 EST on the 24th is 09:30 on the 25th in Shanghai: due there, not in New York.
  const now = '2026-11-25T01:30:00.000Z';
  assert.equal(isDue(shanghai, learningDay(now, 'Asia/Shanghai')), true);
  assert.equal(isDue(lifecycle('B', taught, outcomes, NY), learningDay(now, NY)), false);
  assert.equal(outcomes[0].at, '2026-11-24T15:10:00.000Z', 'the record keeps its UTC instant');
});

test('the daily read limit counts judgments on the learner’s day', () => {
  const db = new DatabaseSync(':memory:');
  createRecordTables(db);
  appendEvent(db, { id: 'e', at: null, kind: 'chat', surface: 'chat', text: '我想透透气' });
  const judge = (at: string, source = 'model:notice-v1') => addJudgment(db, { id: randomUUID(), eventId: 'e', at, source, body: {} });
  judge('2026-11-24T14:00:00.000Z'); // 09:00 EST on the 24th
  judge('2026-11-25T02:00:00.000Z'); // 21:00 EST on the 24th, already the 25th in UTC
  judge('2026-11-25T03:00:00.000Z', 'model:x/admit-v1'); // admission is not limited
  judge('2026-11-23T14:00:00.000Z'); // the day before
  const evening = new Date('2026-11-25T03:30:00.000Z');
  assert.equal(judgedToday(db, NY, evening), 2);
  assert.equal(judgedToday(db, 'UTC', evening), 1);
  db.close();
});

test('the browser’s zone becomes the learner’s setting; without one the server’s zone stands in', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'journal-day-'));
  const path = join(folder, 'journal.db');
  const demo = {
    mode: 'demo' as const,
    tutor: async (ctx: TurnContext) => demoTutor(ctx),
    friend: async (ctx: TurnContext) => demoFriend(ctx),
  };
  const j = openJournal(path, demo);
  try {
    assert.equal(j.get().settings.timeZone, undefined);
    assert.equal(learnerZone(j.get().settings), serverZone());
    await j.act({ id: randomUUID(), type: 'timeZone', timeZone: NY });
    assert.equal(j.get().settings.timeZone, NY);
    assert.equal(actionSchema.safeParse({ id: randomUUID(), type: 'timeZone', timeZone: 'Mars/Olympus' }).success, false);
    await j.act({ id: randomUUID(), type: 'timeZone', timeZone: 'Asia/Shanghai' });
    await j.act({ id: randomUUID(), type: 'settings', pictures: 'quiet' });
    assert.deepEqual(j.get().settings, { pictures: 'quiet', timeZone: 'Asia/Shanghai' }, 'other settings keep the zone');
  } finally {
    j.close();
  }
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    assert.equal(storedZone(db), 'Asia/Shanghai');
    assert.equal(zoneOf(db), 'Asia/Shanghai');
    assert.deepEqual(priorityOf(db), [], 'the ranking reads the stored zone');
  } finally {
    db.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
