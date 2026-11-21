import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { catalogue, demoFriend, demoTutor, type Card } from './practice.ts';
import { friendTurn, tutorTurn, type TurnContext, type TutorResult } from './tutor.ts';

const text = z.string().trim().min(1).max(8000);
const source = z.string().max(12000);
const id = z.string().uuid();
export const actionSchema = z.discriminatedUnion('type', [
  z.object({ id, type: z.literal('tutor'), message: text, surface: text, source }),
  z.object({ id, type: z.literal('chat'), message: text, source }),
  z.object({ id, type: z.literal('reflect'), source }),
  z.object({ id, type: z.literal('practice'), mode: z.enum(['Daily mix', 'Past mistakes', 'Build vocabulary']) }),
  z.object({ id, type: z.literal('answer'), answer: text, cardId: text }),
  z.object({ id, type: z.literal('next'), cardId: text }),
  z.object({ id, type: z.literal('saveReading'), title: text, detail: text, source }),
]);
type Action = z.infer<typeof actionSchema>;
type Message = TurnContext['tutorHistory'][number];
type Item = { id: string; kind: string; title: string; detail: string; source: string };
type Result = { correct: boolean | null; feedback: string };
type Practice = { started?: boolean; mode: string; cards: Card[]; index: number; result: Result | null };
type State = {
  tutor: Message[];
  chat: Message[];
  saved: Item[];
  learning: { text: string; source: string }[];
  attempts: { card: Card; answer: string; result: Result }[];
  pending: Card[];
  practice: Practice;
  lastPracticeContext: string;
  notice: string;
};
const initial = (): State => ({
  tutor: [],
  chat: [],
  saved: [],
  learning: [],
  attempts: [],
  pending: [],
  practice: { mode: 'Daily mix', cards: [], index: 0, result: null },
  lastPracticeContext: '',
  notice: '',
});
export class JournalConflict extends Error {}
export const live = !!process.env.OPENAI_API_KEY && process.env.JOURNAL_DEMO !== '1';
type Backend = {
  tutor: (ctx: TurnContext) => Promise<TutorResult>;
  friend: (ctx: TurnContext) => Promise<string>;
  mode: 'live' | 'demo';
};
export const engine: Backend = live
  ? { tutor: tutorTurn, friend: friendTurn, mode: 'live' }
  : { tutor: async (ctx) => demoTutor(ctx), friend: async (ctx) => demoFriend(ctx), mode: 'demo' };

function publicState(s: State, mode: Backend['mode']) {
  const p = s.practice,
    current = p.cards[p.index];
  return {
    mode,
    tutor: s.tutor,
    chat: s.chat,
    saved: s.saved,
    learning: s.learning,
    notice: s.notice,
    practice: {
      mode: p.mode,
      card: current
        ? { id: current.id, kind: current.kind, prompt: current.prompt, choices: current.choices }
        : null,
      result: p.result,
      done: !!p.started && p.index >= p.cards.length,
    },
  };
}
function context(
  s: State,
  trigger: TurnContext['trigger'],
  message: string,
  surface: string,
  src: string,
): TurnContext {
  return {
    trigger,
    message,
    surface,
    source: src,
    tutorHistory: s.tutor,
    chatHistory: s.chat,
    saved: s.saved,
    learning: s.learning,
  };
}
function keep(s: State, kind: string, title: string, detail: string, src: string) {
  if (
    !s.saved.some(
      (item) => item.kind === kind && item.title === title && item.detail === detail && item.source === src,
    )
  )
    s.saved.push({ id: randomUUID(), kind, title, detail, source: src });
}
function apply(s: State, response: TutorResult, ctx: TurnContext) {
  if (response.reply.trim()) s.tutor.push({ role: 'assistant', text: response.reply, source: ctx.source });
  const a = response.action;
  if (!a) return;
  if (a.kind === 'stash' || a.kind === 'note') {
    keep(s, a.kind === 'stash' ? 'Word' : 'Note', a.title, a.detail, ctx.source);
    return;
  }
  if (!a.exercise) return;
  const e = a.exercise;
  if (
    !e.prompt.trim() ||
    !e.explanation.trim() ||
    (e.kind === 'choice' &&
      (e.choices.length < 2 || new Set(e.choices).size !== e.choices.length || !e.choices.includes(e.answer)))
  )
    throw new Error('The tutor returned an incomplete exercise.');
  const observation = { text: a.title + ' — ' + a.detail, source: ctx.source };
  if (!s.learning.some((x) => x.text === observation.text && x.source === observation.source))
    s.learning.push(observation);
  if (!s.pending.some((c) => c.prompt === e.prompt))
    s.pending.push({ ...e, id: randomUUID(), source: ctx.source });
}
async function startPractice(s: State, mode: string, backend: Backend) {
  const p = s.practice;
  if (p.mode === mode && p.index < p.cards.length) return;
  const meaningful =
    s.chat.some((m) => m.role === 'user') || s.saved.some((i) => i.kind === 'Word') || s.learning.length > 0;
  const fingerprint = JSON.stringify([mode, s.chat.length, s.saved.length, s.learning.length]);
  if (mode !== 'Past mistakes' && meaningful && !s.pending.length && fingerprint !== s.lastPracticeContext) {
    const sourceItem = mode === 'Build vocabulary' ? s.saved.filter((i) => i.kind === 'Word').at(-1) : undefined;
    const src = sourceItem
      ? sourceItem.title + ' · ' + sourceItem.detail + ' · ' + sourceItem.source
      : s.chat.filter((m) => m.role === 'user').at(-1)?.text ||
        s.saved.at(-1)?.title ||
        s.learning.at(-1)?.source ||
        'Journal';
    const ctx = context(
      s,
      'practice',
      mode === 'Build vocabulary'
        ? 'Teach a useful new word or sense from this learner’s material.'
        : 'Choose at most one useful follow-up from the learner’s material.',
      mode,
      src,
    );
    try {
      apply(s, await backend.tutor(ctx), ctx);
      s.lastPracticeContext = JSON.stringify([mode, s.chat.length, s.saved.length, s.learning.length]);
    } catch {
      s.notice = 'Personalized practice is unavailable for this session. The prepared exercises are ready.';
    }
  }
  let cards: Card[];
  if (mode === 'Past mistakes') {
    const latest = new Map(s.attempts.map((a) => [a.card.id, a]));
    cards = [...latest.values()]
      .reverse()
      .filter((a) => a.result.correct === false)
      .map((a) => a.card)
      .slice(0, 4);
  } else {
    const personal = s.pending.shift();
    const lastSeen = new Map(s.attempts.map((attempt, i) => [attempt.card.id, i]));
    const defaults = catalogue
      .filter((card) => mode !== 'Build vocabulary' || card.source.startsWith('Build vocabulary'))
      .sort((a, b) => (lastSeen.get(a.id) ?? -1) - (lastSeen.get(b.id) ?? -1));
    cards = [...(personal ? [personal] : []), ...defaults.filter((c) => c.prompt !== personal?.prompt)].slice(
      0,
      3,
    );
  }
  s.practice = { started: true, mode, cards, index: 0, result: null };
}
async function mutate(s: State, a: Action, backend: Backend) {
  s.notice = '';
  switch (a.type) {
    case 'chat': {
      const reply = await backend.friend(context(s, 'ask', a.message, 'chat', a.source));
      s.chat.push(
        { role: 'user', text: a.message, source: a.source },
        { role: 'assistant', text: reply, source: a.source },
      );
      return;
    }
    case 'tutor':
    case 'reflect': {
      const reflecting = a.type === 'reflect',
        msg = reflecting ? 'Help me reflect on this conversation.' : a.message;
      const ctx = context(s, reflecting ? 'reflect' : 'ask', msg, reflecting ? 'chat' : a.surface, a.source);
      const response = await backend.tutor(ctx);
      s.tutor.push({ role: 'user', text: msg, source: ctx.source });
      apply(s, response, ctx);
      return;
    }
    case 'saveReading':
      keep(s, 'Reading', a.title, a.detail, a.source);
      return;
    case 'practice':
      return startPractice(s, a.mode, backend);
    case 'answer':
    case 'next': {
      const p = s.practice,
        c = p.cards[p.index];
      if (!c || a.cardId !== c.id) throw new JournalConflict('This exercise changed. Refresh the session.');
      if (a.type === 'next') {
        if (!p.result) throw new JournalConflict('Answer before continuing.');
        p.index++;
        p.result = null;
        return;
      }
      if (p.result) throw new JournalConflict('This exercise already has an answer.');
      if (c.kind === 'choice' && !c.choices.includes(a.answer))
        throw new JournalConflict('Choose one of the offered expressions.');
      const correct = c.kind === 'choice' ? a.answer === c.answer : null;
      const result = { correct, feedback: c.explanation };
      if (correct !== true) {
        const ctx = context(
          s,
          c.kind === 'open' ? 'answer' : 'miss',
          a.answer,
          'practice',
          JSON.stringify({ prompt: c.prompt, expected: c.answer, explanation: c.explanation, source: c.source }),
        );
        try {
          const response = await backend.tutor(ctx);
          if (c.kind === 'open' && response.reply.trim()) result.feedback = response.reply;
          apply(s, response, ctx);
        } catch {
          s.notice = 'Your answer was recorded. Tutor feedback is unavailable for this turn.';
        }
      }
      p.result = result;
      s.attempts.push({ card: c, answer: a.answer, result });
      return;
    }
  }
}

export function openJournal(path: string, backend: Backend = engine) {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS journal(id INTEGER PRIMARY KEY CHECK (id=1),revision INTEGER NOT NULL,body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL);`);
  db.prepare('INSERT OR IGNORE INTO journal VALUES (1,0,?)').run(JSON.stringify(initial()));
  function read() {
    const row = db.prepare('SELECT revision,body FROM journal WHERE id=1').get()!;
    return { revision: Number(row.revision), s: JSON.parse(String(row.body)) as State };
  }
  let tail: Promise<unknown> = Promise.resolve();
  async function perform(a: Action) {
    const hash = createHash('sha256').update(JSON.stringify(a)).digest('hex');
    const old = db.prepare('SELECT fingerprint FROM receipts WHERE id=?').get(a.id);
    const { s, revision } = read();
    if (old) {
      if (old.fingerprint !== hash)
        throw new JournalConflict('This action ID already identifies a different request.');
      return publicState(s, backend.mode);
    }
    await mutate(s, a, backend);
    db.exec('BEGIN IMMEDIATE');
    try {
      if (
        !db
          .prepare('UPDATE journal SET body=?,revision=revision+1 WHERE id=1 AND revision=?')
          .run(JSON.stringify(s), revision).changes
      )
        throw new JournalConflict('Another session updated the journal. Please retry.');
      db.prepare('INSERT INTO receipts VALUES (?,?)').run(a.id, hash);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return publicState(s, backend.mode);
  }
  return {
    get: () => publicState(read().s, backend.mode),
    act(a: Action) {
      const result = tail.then(() => perform(a));
      tail = result.catch(() => {});
      return result;
    },
    close: () => db.close(),
  };
}
