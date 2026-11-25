import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { buildFixture } from './fixture.ts';
import { openJournal } from './journal.ts';
import { demoFriend, demoTutor } from './practice.ts';
import { events, judgments, targets } from './record.ts';
import type { TurnContext } from './tutor.ts';

const demo = {
  mode: 'demo' as const,
  tutor: async (ctx: TurnContext) => demoTutor(ctx),
  friend: async (ctx: TurnContext) => demoFriend(ctx),
};

test('board dispositions persist without changing their sources or learning evidence', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'journal-board-'));
  const path = join(directory, 'fixture.sqlite');
  try {
    const before = await buildFixture(path);
    const db = new DatabaseSync(path);
    let journal = openJournal(path, demo);
    try {
      const evidence = () => [events(db), judgments(db), targets(db)];
      const record = evidence();
      const original = db.prepare('SELECT body FROM journal WHERE id=1').get()!;
      const group = (key: string, disposition: 'archived' | 'deleted' | 'visible') =>
        journal.act({ type: 'boardGroup', id: randomUUID(), key, disposition });
      const docKey = 'read:' + before.reading.documents[0].id;
      const chatKey = 'chat:' + before.activeThreadId;
      await group(docKey, 'archived');
      await group(chatKey, 'archived');
      await group(docKey, 'archived');
      assert.deepEqual(journal.get().board.archivedGroups, [docKey, chatKey]);
      await group(chatKey, 'visible');
      await group(chatKey, 'deleted');
      await assert.rejects(group(chatKey, 'visible'), /deleted/);
      await assert.rejects(group('loose', 'archived'), /unavailable/);

      const note = before.annotationThreads.find(t => t.anchor.surface === 'read')!;
      const takeaway = before.reflections[0].takeaways[0];
      const word = before.saved.find(item => item.kind === 'Word')!;
      const pieces = [
        { kind: 'annotation', pieceId: note.id },
        { kind: 'annotation', pieceId: takeaway.annotationId },
        { kind: 'saved', pieceId: word.id },
        { kind: 'line', pieceId: before.chat.find(m => m.role === 'user')!.id },
        { kind: 'media', pieceId: before.media[0].id },
      ] as const;
      for (const piece of pieces) {
        const action = { id: randomUUID(), type: 'deletePiece', ...piece } as const;
        await journal.act(action);
        await journal.act(action);
      }
      await assert.rejects(journal.act({ type: 'deletePiece', id: randomUUID(), kind: 'saved', pieceId: note.id }), /unavailable/);
      journal.close();
      journal = openJournal(path, demo);
      const view = journal.get();
      assert.deepEqual(view.board.archivedGroups, [docKey]);
      assert.deepEqual(view.board.deletedGroups, [chatKey]);
      assert.deepEqual(view.board.deletedPieces.map(({ kind, pieceId }) => ({ kind, pieceId })), pieces);
      assert(!view.reading.annotations.some(n => n.id === note.id));
      assert(!view.annotationThreads.some(n => n.id === note.id || n.id === takeaway.annotationId));
      assert(!view.reflections[0].takeaways.some(t => t.annotationId === takeaway.annotationId));
      assert.deepEqual(view.chat, before.chat);
      assert.deepEqual(view.practice, before.practice);
      const persisted = db.prepare('SELECT body FROM journal WHERE id=1').get()!;
      assert.deepEqual({ ...JSON.parse(String(persisted.body)), board: null }, { ...JSON.parse(String(original.body)), board: null });
      assert.deepEqual(evidence(), record);

      await assert.rejects(journal.act({
        type: 'annotationPost', id: randomUUID(), annotationId: note.id, askTutor: false, message: 'stale reply',
      }), /unavailable/);
      const resaved = await journal.act({ type: 'addWord', id: randomUUID(), text: word.title });
      assert(!resaved.board.deletedPieces.some(p => p.pieceId === word.id));
      assert.deepEqual(resaved.saved, before.saved);
      const fresh = await journal.act({ type: 'captureReading', id: randomUUID(), anchor: { ...note.anchor, surface: 'read' }, note: 'A new note here.' });
      assert(fresh.annotationThreads.some(t => t.id !== note.id && t.messages[0]?.text === 'A new note here.'));
    } finally {
      journal.close();
      db.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a slower explicit save can reuse a hidden word, but a subsequent deletion wins', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'journal-board-resave-'));
  const path = join(directory, 'fixture.sqlite');
  try {
    const before = await buildFixture(path);
    const word = before.saved.find(item => item.title === '鸟食')!;
    let started!: () => void;
    const preparing = new Promise<void>(resolve => { started = resolve; });
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const journal = openJournal(path, {
      ...demo,
      async tutor(ctx) {
        if (ctx.trigger === 'wordIntake') {
          started();
          await waiting;
        }
        return demoTutor(ctx);
      },
    });
    try {
      const save = () => journal.act({ type: 'addWord', id: randomUUID(), text: word.title, context: '另一包鸟食。' });
      const settle = async () => {
        for (let i = 0; i < 100 && journal.busy(); i++) await new Promise(resolve => setTimeout(resolve, 10));
        assert(!journal.busy());
        assert.deepEqual(journal.get().wordIntakes.at(-1)?.savedIds, [word.id]);
      };
      await save();
      await preparing;
      await journal.act({ type: 'deletePiece', id: randomUUID(), kind: 'saved', pieceId: word.id });
      release();
      await settle();
      assert(journal.get().board.deletedPieces.some(p => p.pieceId === word.id));
      await save();
      await settle();
      assert(!journal.get().board.deletedPieces.some(p => p.pieceId === word.id));
    } finally {
      release();
      journal.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('old journals give separate, stable board identities to observations with the same text', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'journal-board-upgrade-'));
  const path = join(directory, 'journal.sqlite');
  try {
    openJournal(path, demo).close();
    const db = new DatabaseSync(path);
    try {
      const message = { role: 'assistant', kind: 'observation', text: 'Worth another look.' };
      db.prepare("UPDATE journal SET body=json_set(json_remove(body, '$.board'), '$.tutor', json(?))").run(JSON.stringify([message, message]));
    } finally {
      db.close();
    }
    const journal = openJournal(path, demo);
    try {
      const ids = journal.get().tutor.map(m => m.id!);
      assert(ids.every(Boolean));
      assert.notEqual(ids[0], ids[1]);
      assert.deepEqual(journal.get().board, { archivedGroups: [], deletedGroups: [], deletedPieces: [] });
      await journal.act({ type: 'deletePiece', id: randomUUID(), kind: 'observation', pieceId: ids[0] });
      assert.deepEqual(journal.get().tutor.map(m => m.id), ids);
      assert.deepEqual(journal.get().board.deletedPieces.map(p => p.pieceId), [ids[0]]);
    } finally {
      journal.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
