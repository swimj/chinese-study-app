import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { admitted, LEGACY_REASON, type AdmissionBody } from './admission.ts';
import { openJournal } from './journal.ts';
import { demoFriend, demoTutor } from './practice.ts';
import { rank } from './priority.ts';
import { judgments, type JudgmentRecord, type Target } from './record.ts';
import type { TurnContext } from './tutor.ts';

const demo = {
  mode: 'demo' as const,
  tutor: async (ctx: TurnContext) => demoTutor(ctx),
  friend: async (ctx: TurnContext) => demoFriend(ctx),
};
type Journal = ReturnType<typeof openJournal>;
async function settle(j: Journal) {
  for (let i = 0; i < 100 && j.busy(); i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(j.busy(), false, 'background work should finish');
}
function sandbox() {
  const folder = mkdtempSync(join(tmpdir(), 'journal-admission-'));
  return { path: join(folder, 'journal.db'), done: () => rmSync(folder, { recursive: true, force: true }) };
}
function judgmentsIn(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return judgments(db);
  } finally {
    db.close();
  }
}
const capture = (text: string, context?: string) => ({ type: 'capture' as const, id: randomUUID(), text, ...(context ? { context } : {}) });
const lastReply = (j: Journal) => j.get().tutor.at(-1)!.text;
const teachable = (j: Journal) => j.priority().filter((r) => r.purpose === 'teach').map((r) => r.target.form);

test('a word asked about is explained first and goes through the admission judgment', async () => {
  const box = sandbox();
  const j = openJournal(box.path, demo);
  try {
    const ask = capture('值得', '听朋友说的');
    const pending = await j.act(ask);
    assert.equal(pending.wordIntakes[0].intent, 'ask');
    assert.doesNotMatch(pending.tutor.at(-1)!.text, /practice/i, 'nothing promises practice before the judgment');
    await settle(j);
    const reply = lastReply(j);
    assert.match(reply, /^值得 \(zhíde\): Be worth doing/, 'the explanation comes first');
    assert.match(reply, /\n\nI’ll also bring 值得 into practice\.$/, 'one line on practice, last, because it was admitted');
    const [judgment] = judgmentsIn(box.path);
    assert.equal(judgment.source, 'demo/admit-v1');
    assert.equal(judgment.eventId, ask.id);
    const body = judgment.body as AdmissionBody;
    assert.deepEqual(body.decisions.map((d) => [d.form, d.admit]), [['值得', true]]);
    assert.ok(body.decisions[0].reason, 'the judgment records its reason');
    assert.equal(body.request?.sent, '值得', 'the judgment keeps what it read, so it can be rerun');
    assert.match(j.priority().find((r) => r.target.form === '值得')!.reasons.join(), /admitted: An everyday word/);
  } finally {
    j.close();
    box.done();
  }
});

test('a word the judgment does not admit stays a quiet piece and is never taught', async () => {
  const box = sandbox();
  const asked: TurnContext[] = [];
  const j = openJournal(box.path, {
    ...demo,
    tutor: async (ctx: TurnContext) => {
      if (ctx.trigger === 'practice' || ctx.trigger === 'teach') asked.push(ctx);
      return demoTutor(ctx);
    },
  });
  try {
    await j.act({ id: randomUUID(), type: 'addWord', text: '报备' });
    await j.act(capture('图书馆'));
    await settle(j);
    assert.equal(lastReply(j), '图书馆 (túshūguǎn): A library.\n我想去图书馆借本书。 I want to go to the library to borrow a book.');
    const judgment = judgmentsIn(box.path).find((x) => x.source === 'demo/admit-v1')!;
    assert.deepEqual((judgment.body as AdmissionBody).decisions.map((d) => [d.form, d.admit]), [['图书馆', false]]);
    assert.ok(j.get().saved.some((item) => item.title === '图书馆'), 'it is a piece on the board');
    assert.deepEqual(teachable(j), ['报备']);
    for (const mode of ['Daily mix', 'Build vocabulary'] as const) {
      await j.act({ id: randomUUID(), type: 'practice', mode });
      await settle(j);
    }
    assert.ok(asked.length > 1, 'practice was prepared from the journal');
    assert.ok(asked.every((ctx) => !JSON.stringify([ctx.source, ctx.teach ?? null]).includes('图书馆')), 'not material for exercises either');
  } finally {
    j.close();
    box.done();
  }
});

test('an explicit save always admits, from Home, a clarification reply, or the tutor', async () => {
  const box = sandbox();
  const j = openJournal(box.path, demo);
  try {
    // The demo judgment would not admit 图书馆; an explicit save does not ask it.
    const save = capture('save 图书馆');
    assert.equal((await j.act(save)).wordIntakes[0].intent, 'save');
    await settle(j);
    assert.match(lastReply(j), /^图书馆 \(túshūguǎn\)[\s\S]*\n\nI’ll also bring 图书馆 into practice\.$/);
    // A clarification reply that asks to save it.
    const part = capture('蜘');
    await j.act(part);
    await settle(j);
    const intake = j.get().wordIntakes.find((w) => w.id === part.id)!;
    assert.equal(intake.status, 'clarify');
    await j.act({ id: randomUUID(), type: 'tutor', message: '蜘蛛, and save it', surface: 'home', source: '蜘', wordReplyTo: { intakeId: part.id, requestId: intake.requestId } });
    await settle(j);
    // The tutor keeping a word on request.
    const stash = { id: randomUUID(), type: 'tutor' as const, message: 'save 透透气', surface: 'home', source: '' };
    await j.act(stash);
    const explicit = judgmentsIn(box.path).filter((x) => x.source === 'rule:admit-v1');
    assert.deepEqual(explicit.map((x) => [x.eventId, (x.body as AdmissionBody).decisions.map((d) => d.form)]), [
      [save.id, ['图书馆']], [part.id, ['蜘蛛']], [stash.id, ['透透气']],
    ]);
    assert.equal(judgmentsIn(box.path).length, 3, 'no model judgment was asked for');
    assert.deepEqual(teachable(j).sort(), ['图书馆', '蜘蛛', '透透气'].sort());
  } finally {
    j.close();
    box.done();
  }
});

const target = (form: string, createdAt = '2026-11-20T00:00:00.000Z'): Target => ({
  id: 1, form, kind: 'word', gloss: null, pinyin: null, origin: 'saved', createdAt, hosted: null,
});
const judged = (eventId: string, at: string, decisions: [string, boolean][], over: Partial<AdmissionBody> = {}, source = 'model:x/admit-v1'): JudgmentRecord => ({
  id: randomUUID(), eventId, at, source, body: { decisions: decisions.map(([form, admit]) => ({ form, admit, reason: admit ? 'useful' : 'recognize only' })), ...over },
});

test('admission can be rerun: the newest reading of an event counts, but never against an explicit save', () => {
  const day = (n: number) => `2026-11-${n}T00:00:00.000Z`;
  const list = [
    judged('ask1', day(21), [['我勒个去', true]]),
    judged('ask1', day(22), [['我勒个去', false]]),
    judged('ask1', day(23), [], { failed: 'timeout' }),
    judged('ask2', day(21), [['钻空子', false]]),
    judged('ask3', day(22), [['钻空子', true]]),
    judged('save', day(21), [['值得', true]], { explicit: true }, 'rule:admit-v1'),
    judged('ask4', day(23), [['值得', false]]),
  ];
  const forms = admitted(list, [], day(20));
  assert.equal(forms.has('我勒个去'), false, 'a rerun replaces the earlier reading; a failed one counts for nothing');
  assert.equal(forms.get('钻空子'), 'useful', 'admitted when any event’s current reading admits it');
  assert.equal(forms.get('值得'), 'useful', 'a later ask does not take back an explicit save');
  const saved = [target('值得'), target('我勒个去')];
  assert.deepEqual(rank(saved, [], new Date(day(24)), forms).map((r) => r.target.form), ['值得']);
  assert.deepEqual(rank(saved, [], new Date(day(24))), [], 'with no admissions, nothing saved is taught');
});

test('saved words from before admission stay targets without a migration', async () => {
  const before = '2026-11-20T00:00:00.000Z';
  const forms = admitted([], [target('报备', before), target('新词', '2026-11-21T00:00:00.000Z'), { ...target('分心', before), origin: 'noticed' }], before);
  assert.deepEqual([...forms], [['报备', LEGACY_REASON]], 'only words saved before admission existed');
  assert.ok(admitted([], [target('报备')], undefined).has('报备'), 'a journal not yet opened with this version keeps every save');

  const box = sandbox();
  let j = openJournal(box.path, demo);
  try {
    await j.act({ id: randomUUID(), type: 'addWord', text: '报备' });
    await settle(j);
    j.close();
    // A journal from before admission: its saves have no admission judgments.
    const db = new DatabaseSync(box.path);
    db.exec("DELETE FROM judgments; DELETE FROM record_meta WHERE key='admit_from'");
    db.close();
    j = openJournal(box.path, demo);
    assert.match(j.priority().find((r) => r.target.form === '报备')!.reasons.join(), /admitted: saved before admission was judged/);
    await j.act(capture('图书馆'));
    await settle(j);
    assert.deepEqual(teachable(j), ['报备'], 'a word asked about afterwards still needs admitting');
  } finally {
    j.close();
    box.done();
  }
});
