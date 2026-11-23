import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openJournal } from './journal.ts';
import type { Judgment } from './media/judgment.ts';
import { ceilingFor } from './media/local-policy.ts';
import { DECISIONS_KEPT, recordDecision, withMediaDefaults } from './media/model.ts';
import { demoFriend, demoTutor } from './practice.ts';
import { initialReading } from './reading.ts';

const reasons = { referent: '', senseMatch: '', addedValue: '', truthfulness: '', tone: '' };
const judge = (overrides: Partial<Judgment>): Judgment => ({
  referent: 'concrete',
  senseMatch: 'entity',
  addedValue: 'cultural',
  truthfulness: 'real',
  tone: 'fits',
  reasons,
  ...overrides,
});

test('local policy maps every row of the v1 table to a ceiling', () => {
  // truthfulness != real → none
  assert.equal(ceilingFor(judge({ truthfulness: 'illustration' })), 'none');
  // tone == jarring → none
  assert.equal(ceilingFor(judge({ tone: 'jarring' })), 'none');
  // referent in {scene, abstract} → none, even with a strong entity match
  assert.equal(ceilingFor(judge({ referent: 'scene' })), 'none');
  assert.equal(ceilingFor(judge({ referent: 'abstract' })), 'none');
  // senseMatch == none → none
  assert.equal(ceilingFor(judge({ senseMatch: 'none' })), 'none');
  // named or concrete, entity, and cultural / recognition / interest → placed
  for (const referent of ['named', 'concrete'] as const)
    for (const addedValue of ['cultural', 'recognition', 'interest'] as const)
      assert.equal(ceilingFor(judge({ referent, addedValue })), 'placed', referent + ' ' + addedValue);
  // otherwise → latent: a memory or no added value, or only a text-search match
  assert.equal(ceilingFor(judge({ addedValue: 'memory' })), 'latent');
  assert.equal(ceilingFor(judge({ addedValue: 'none' })), 'latent');
  assert.equal(ceilingFor(judge({ senseMatch: 'search' })), 'latent');
  assert.equal(ceilingFor(judge({ referent: 'named', senseMatch: 'search', addedValue: 'interest' })), 'latent');
  // The spec's worked examples.
  assert.equal(ceilingFor(judge({})), 'placed', '报刊亭');
  assert.equal(ceilingFor(judge({ addedValue: 'memory' })), 'latent', '鸟食');
  assert.equal(ceilingFor(judge({ referent: 'named', addedValue: 'interest' })), 'placed', '芳华');
  assert.equal(ceilingFor(judge({ referent: 'abstract', senseMatch: 'none', addedValue: 'none' })), 'none', '分心');
  assert.equal(ceilingFor(judge({ referent: 'scene', senseMatch: 'search' })), 'none', '冲得发白');
});

test('decisions keep the newest 200', () => {
  const s = withMediaDefaults({});
  for (let i = 0; i < DECISIONS_KEPT + 5; i++)
    recordDecision(s, { at: String(i), anchor: { kind: 'word', id: 'w' }, judgment: judge({}), ceiling: 'placed' });
  assert.equal(s.mediaDecisions.length, DECISIONS_KEPT);
  assert.equal(s.mediaDecisions[0].at, '5');
});

test('a journal from before media opens with nothing attached and pictures on', () => {
  const dir = mkdtempSync(join(tmpdir(), 'journal-media-'));
  const path = join(dir, 'old.sqlite');
  try {
    const db = new DatabaseSync(path);
    db.exec('CREATE TABLE journal(id INTEGER PRIMARY KEY CHECK (id=1),revision INTEGER NOT NULL,body TEXT NOT NULL)');
    // The body an earlier version stored, before media existed.
    const old = {
      wordIntakes: [], tutor: [], activeThreadId: 'first', threads: [{ id: 'first', title: 'Conversation', turns: [] }],
      reflections: [], annotationThreads: [], activity: [], reading: initialReading(),
      saved: [], attempts: [], pending: [], practice: { mode: 'Daily mix', cards: [], index: 0, result: null }, notice: '',
    };
    db.prepare('INSERT INTO journal VALUES (1,3,?)').run(JSON.stringify(old));
    db.close();
    const j = openJournal(path, { mode: 'demo', tutor: async (ctx) => demoTutor(ctx), friend: async (ctx) => demoFriend(ctx) });
    try {
      const state = j.get();
      assert.deepEqual(state.media, []);
      assert.deepEqual(state.settings, { pictures: 'normal' });
    } finally {
      j.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
