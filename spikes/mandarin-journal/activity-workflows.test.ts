import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { activityStep, createActivity } from './activity.ts';
import { openJournal } from './journal.ts';
import { demoFriend, demoTutor } from './practice.ts';
import { openReaderCatalog } from './reader-catalog.ts';
import { startReaderGrowth } from './reader-growth-queue.ts';
import { readerLedger } from './reader-ledger.ts';
import { createLookupService } from './reader-lookup-service.ts';
import { readerWorkflow } from './reader-workflow.ts';
import type { TurnContext } from './tutor.ts';

const backend = {
  mode: 'demo' as const,
  tutor: async (ctx: TurnContext) => activityStep('model', ctx.trigger, async () => demoTutor(ctx)),
  friend: async (ctx: TurnContext) => demoFriend(ctx),
};

async function settled(done: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!done() && Date.now() < deadline) await delay(5);
  assert.ok(done());
}

test('word intake after restart and its media work belong to the original action, including after receipt replay', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'activity-journal-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'journal.sqlite');
  const add = { type: 'addWord' as const, id: randomUUID(), text: '鸟食' };
  const first = createActivity(new DatabaseSync(path));
  const original = openJournal(path, backend, first);
  await first.action('Add word', add.id, () => original.act(add));
  const originalId = first.report(24).actions[0].id;
  original.close();
  first.db.close();

  const activity = createActivity(new DatabaseSync(path));
  const journal = openJournal(path, backend, activity);
  try {
    await activity.action('Add word', add.id, () => journal.act(add));
    await settled(() => !journal.busy());
    const { spans } = activity.trace(originalId)!;
    const jobs = spans.filter(span => span.kind === 'job');
    const word = jobs.find(span => span.label === 'Word intake')!;
    const media = jobs.find(span => span.label === 'Media consideration')!;
    assert.equal(jobs.length, 2);
    assert.equal(word.parentId, originalId);
    assert.equal(word.reference, add.id);
    assert.equal(word.outcome, 'Applied');
    assert.equal(media.parentId, word.id);
    assert.equal(media.outcome, 'Attached');
    assert.deepEqual(spans.filter(span => span.kind === 'model').map(span => span.parentId), [word.id, media.id]);
    const replay = activity.report(24).actions.find(action => action.id !== originalId)!;
    assert.equal(replay.outcome, 'Receipt replay');
    assert.equal(replay.callCount, 0);
    assert.equal(JSON.stringify(activity.trace(originalId)).includes(add.text), false);

    const reused = { ...add, id: randomUUID() };
    await activity.action('Add word', reused.id, () => journal.act(reused));
    const row = activity.report(24).actions.find(action => action.reference === reused.id)!;
    assert.equal(row.callCount, 0);
    assert.equal(row.outcome, 'Reused');
  } finally {
    journal.close();
    activity.db.close();
  }
});

test('a local lookup and its separately scheduled growth retain the decision reference with zero provider calls', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'activity-reader-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'reader.sqlite');
  const activity = createActivity(new DatabaseSync(path));
  t.after(() => activity.db.close());
  const ledger = readerLedger(path);
  const catalog = openReaderCatalog(path);
  // Leave the work pending so a new worker must restore it from disk.
  const flow = readerWorkflow(ledger, createLookupService({ selectorEnabled: false, contextEnabled: false }),
    () => [{ id: 'p', text: '小小的报刊亭。' }], () => {}, activity);
  const ref = randomUUID();
  const decision = await activity.action('Reader lookup', ref, () =>
    flow.lookup({ documentId: 'example', blockId: 'p', kind: 'tap', start: 4, end: 5 }));
  assert.equal(decision.route, 'catalog');
  startReaderGrowth(readerLedger(path), catalog, activity);
  await settled(() => Boolean(catalog.receipt(decision.id)));
  const action = activity.report(24).actions.find(row => row.reference === ref)!;
  assert.equal(action.outcome, 'catalog');
  assert.equal(action.callCount, 0);
  const [growth] = activity.trace(action.id)!.spans;
  assert.deepEqual([growth.parentId, growth.phase, growth.reference, growth.outcome],
    [action.id, 'background', decision.id, 'linked']);
});

test('practice prepared ahead follows the action that opened each card position and notices follow their event', async () => {
  const activity = createActivity(new DatabaseSync(':memory:'));
  let generated = 0;
  const journal = openJournal(':memory:', {
    ...backend,
    async tutor(ctx) {
      if (ctx.trigger !== 'practice') return backend.tutor(ctx);
      return activityStep('model', 'Generate exercise', async () => ({
        reply: 'Try a new exercise.',
        action: { kind: 'practice' as const, title: 'Exercise', detail: 'Review.',
          exercise: { kind: 'open' as const, prompt: ++generated + '：周末你打算做什么？', choices: [],
            answer: '我想去散步。', accepted: [], explanation: 'Reply about your plans.' } },
      }));
    },
  }, activity);
  const act = (a: Parameters<typeof journal.act>[0]) => activity.action(a.type, a.id, () => journal.act(a));
  const trace = (ref: string) => {
    const row = activity.report(24).actions.find(root => root.reference === ref)!;
    return activity.trace(row.id)!;
  };
  try {
    await act({ type: 'chat', id: randomUUID(), message: '我想去外面透透气。', source: '' });
    const start = randomUUID();
    await act({ type: 'practice', id: start, mode: 'Daily mix' });
    await settled(() => !journal.busy());
    const initial = trace(start);
    assert.deepEqual(initial.spans.filter(s => s.kind === 'model').map(s => s.phase), ['foreground', 'background', 'background']);
    assert.equal(initial.spans.filter(s => s.kind === 'job' && s.parentId === initial.action.id).length, 2);
    const card = journal.get().practice.card!;
    const answer = randomUUID();
    await act({ type: 'answer', id: answer, cardId: card.id, answer: '我想去散步。' });
    const next = randomUUID();
    await act({ type: 'next', id: next, cardId: card.id });
    await settled(() => !journal.busy());
    assert.ok(trace(answer).spans.some(s => s.kind === 'model' && s.phase === 'foreground'));
    assert.ok(trace(answer).spans.some(s => s.label === 'Language notice' && s.phase === 'background'));
    const replenished = trace(next);
    assert.equal(replenished.action.callCount, 1);
    assert.equal(replenished.spans[0].label, 'Prepare practice card');
    assert.equal(replenished.spans[0].parentId, replenished.action.id);

    const question = randomUUID();
    await act({ type: 'tutor', id: question, message: 'What does this mean?', surface: 'home', source: '' });
    await settled(() => !journal.busy());
    const asked = trace(question);
    const job = asked.spans.find(span => span.kind === 'job' && span.label === 'Language notice')!;
    assert.deepEqual([job.reference, job.parentId, job.outcome], [question, asked.action.id, 'Applied']);
    assert.ok(asked.spans.some(s => s.label === 'notice' && s.parentId === job.id));
  } finally {
    journal.close();
    activity.db.close();
  }
});
