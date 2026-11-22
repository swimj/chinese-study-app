import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import {
  initialReading,
  readingDocuments,
  applyReadingPosition,
  resolveReadingReference,
  readingSource,
  type ReadingState,
} from './reading.ts';
import {
  anchorSchema,
  anchorForQuote,
  describeAnnotation,
  JournalConflict,
  readingNotes,
  resolveAnchor,
  type AnnotationThread,
} from './annotations.ts';
export { JournalConflict } from './annotations.ts';
import { catalogue, demoFriend, demoTutor, type Card } from './practice.ts';
import { friendTurn, tutorTurn, type TurnContext, type TutorResult } from './tutor.ts';

const text = z.string().trim().min(1).max(8000);
const source = z.string().max(12000);
const id = z.string().uuid();
export const actionSchema = z.discriminatedUnion('type', [
  z.object({
    id,
    type: z.literal('tutor'),
    message: text,
    surface: text,
    source,
    referenceId: text.optional(),
  }),
  z.object({ id, type: z.literal('chat'), message: text, source, threadId: text.optional() }),
  z.object({ id, type: z.literal('reflect'), source, threadId: text.optional() }),
  z.object({
    id,
    type: z.literal('practice'),
    mode: z.enum(['Daily mix', 'Past mistakes', 'Build vocabulary']),
    continue: z.boolean().optional(),
  }),
  z.object({
    id,
    type: z.literal('newThread'),
    title: z.string().trim().min(1).max(120),
    source: source.optional(),
  }),
  z.object({ id, type: z.literal('selectThread'), threadId: text }),
  z.object({ id, type: z.literal('readingPosition'), documentId: text, paragraphId: text }),
  z.object({
    id,
    type: z.literal('annotate'),
    documentId: text,
    paragraphId: text,
    quote: source,
    text: z.string().trim().min(1).max(1600),
  }),
  z
    .object({
      id,
      type: z.literal('annotationPost'),
      anchor: anchorSchema.optional(),
      annotationId: text.optional(),
      message: text,
      askTutor: z.boolean(),
    })
    .refine(
      (a) => Boolean(a.anchor) !== Boolean(a.annotationId),
      'Choose a selection or an existing annotation.',
    ),
  z.object({ id, type: z.literal('answer'), answer: text, cardId: text }),
  z.object({ id, type: z.literal('next'), cardId: text }),
  z.object({ id, type: z.literal('saveReading'), title: text, detail: text, source }),
]);
type Action = z.infer<typeof actionSchema>;
type Reference = {
  kind: 'attempt' | 'reflection' | 'reading' | 'annotation';
  id: string;
  quote: string;
  label: string;
  threadId?: string;
};
type Message = TurnContext['tutorHistory'][number] & {
  id?: string;
  reference?: Reference;
  kind?: 'observation';
};
type Thread = { id: string; title: string; source?: string; turns: (Message & { id: string })[] };
type Reflection = {
  id: string;
  threadId: string;
  overview: string;
  takeaways: { annotationId: string; messageId: string; quote: string; text: string }[];
  end: number;
};
type Attempt = { id: string; card: Card; answer: string; result: Result };
type Activity = { id: string; at: string; text: string; source: string; reference?: Reference };
type QueuedCard = Card & { title?: string; introduction?: string };
type Item = { id: string; kind: string; title: string; detail: string; source: string; reference?: Reference };
type Result = { correct: boolean | null; feedback: string };
type Practice = { started?: boolean; mode: string; cards: QueuedCard[]; index: number; result: Result | null };
type State = {
  tutor: Message[];
  activeThreadId: string;
  threads: Thread[];
  reflections: Reflection[];
  annotationThreads: AnnotationThread[];
  activity: Activity[];
  reading: ReadingState;
  saved: Item[];
  learning: { text: string; source: string }[];
  attempts: Attempt[];
  pending: QueuedCard[];
  practice: Practice;
  notice: string;
};
const initial = (): State => ({
  tutor: [],
  activeThreadId: 'first',
  threads: [{ id: 'first', title: 'Conversation', turns: [] }],
  reflections: [],
  annotationThreads: [],
  activity: [],
  reading: initialReading(),
  saved: [],
  learning: [],
  attempts: [],
  pending: [],
  practice: { mode: 'Daily mix', cards: [], index: 0, result: null },
  notice: '',
});
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
    activeThreadId: s.activeThreadId,
    threads: s.threads.map(({ turns, ...thread }) => thread),
    chat: activeThread(s).turns,
    reflections: s.reflections,
    attempts: s.attempts,
    activity: s.activity,
    reading: { ...s.reading, annotations: readingNotes(s.annotationThreads), documents: readingDocuments },
    annotationThreads: s.annotationThreads,
    saved: s.saved,
    learning: s.learning,
    notice: s.notice,
    practice: {
      mode: p.mode,
      card: current
        ? {
            id: current.id,
            kind: current.kind,
            prompt: current.prompt,
            choices: current.choices,
            introduction: current.introduction,
          }
        : null,
      result: p.result,
      done: !!p.started && p.index >= p.cards.length,
    },
  };
}
function activeThread(s: State): Thread {
  const thread = s.threads.find((t) => t.id === s.activeThreadId);
  if (!thread) throw new Error('Missing active conversation');
  return thread;
}
function logActivity(s: State, text: string, source: string, reference?: Reference) {
  s.activity.push({ id: randomUUID(), at: new Date().toISOString(), text, source, reference });
}
function context(
  s: State,
  trigger: TurnContext['trigger'],
  message: string,
  surface: string,
  src: string,
  chat = activeThread(s),
): TurnContext {
  return {
    trigger,
    message,
    surface,
    source: src,
    tutorHistory: s.tutor,
    topic: chat.title,
    chatHistory: chat.turns,
    annotations: s.annotationThreads.flatMap((t) => {
      const { title } = resolveAnchor(s.threads, t.anchor);
      return t.messages.map((m) => ({ role: m.role, text: m.text, source: title, quote: t.anchor.quote }));
    }),
    otherChatHistory: s.threads
      .filter((t) => t.id !== chat.id)
      .flatMap((t) => t.turns.map((m) => ({ ...m, source: t.title }))),
    practiceStatus: {
      pending: s.pending.map((c) => ({ title: c.title ?? c.source, prompt: c.prompt })),
      active: s.practice.cards
        .slice(s.practice.index + (s.practice.result ? 1 : 0))
        .map((c) => ({ title: c.title ?? c.source, prompt: c.prompt })),
    },
    saved: s.saved,
    learning: s.learning,
  };
}
function keep(s: State, kind: string, title: string, detail: string, src: string, reference?: Reference) {
  if (
    !s.saved.some(
      (item) => item.kind === kind && item.title === title && item.detail === detail && item.source === src,
    )
  ) {
    s.saved.push({ id: randomUUID(), kind, title, detail, source: src, reference });
    logActivity(s, 'Saved ' + kind.toLowerCase() + ' · ' + title, reference?.label ?? src, reference);
  }
}
function applyAction(s: State, response: TutorResult, ctx: TurnContext, reference?: Reference) {
  const a = response.action;
  if (!a) return;
  if (a.kind === 'stash' || a.kind === 'note') {
    keep(s, a.kind === 'stash' ? 'Word' : 'Note', a.title, a.detail, ctx.source, reference);
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
  if (
    !s.pending.some((c) => c.prompt === e.prompt) &&
    !ctx.practiceStatus?.active.some((c) => c.prompt === e.prompt)
  ) {
    s.pending.push({ ...e, id: randomUUID(), title: a.title, source: ctx.source });
    if (ctx.trigger !== 'practice') logActivity(s, 'Queued practice · ' + a.title, ctx.source, reference);
  }
}
function practiceSources(s: State, mode: string): string[] {
  const words = s.saved
    .filter((item) => item.kind === 'Word')
    .slice(-8)
    .reverse()
    .map((item) => item.title + ' · ' + item.detail);
  const turns = [activeThread(s), ...s.threads.filter((t) => t.id !== s.activeThreadId)].flatMap((t) =>
    t.turns
      .filter((m) => m.role === 'user')
      .slice(-5)
      .reverse()
      .map((m) => t.title + ' · ' + m.text),
  );
  const discussions = s.annotationThreads
    .slice(-8)
    .reverse()
    .map((t) => describeAnnotation(s.threads, t));
  const readings = s.saved
    .filter((item) => item.kind === 'Reading')
    .slice(-3)
    .reverse()
    .map((item) => (item.title + ' · ' + item.detail).slice(0, 1800));
  const places = Object.entries(s.reading.positions).map(
    ([doc, paragraph]) => 'Encountered in reading: ' + readingSource(s.reading, doc + '/' + paragraph),
  );
  const notes = s.learning
    .slice(-4)
    .reverse()
    .map((item) => item.text);
  return [
    ...new Set(
      mode === 'Build vocabulary'
        ? [...words, ...discussions, ...turns, ...readings, ...places, ...notes]
        : [...turns, ...discussions, ...words, ...readings, ...places, ...notes],
    ),
  ];
}
async function startPractice(s: State, mode: string, backend: Backend, continuing = false) {
  const p = s.practice;
  if (p.mode === mode && p.index < p.cards.length) return;
  // Switching modes returns unattempted personal cards to the queue.
  if (p.mode !== mode && p.mode !== 'Past mistakes') {
    const remaining = p.cards.slice(p.index + (p.result ? 1 : 0));
    s.pending.unshift(...remaining.filter((c) => !catalogue.some((seed) => seed.id === c.id)));
  }
  let cards: QueuedCard[] = [];
  if (mode === 'Past mistakes') {
    const latest = new Map(s.attempts.map((a) => [a.card.id, a]));
    cards = [...latest.values()]
      .reverse()
      .filter((a) => a.result.correct === false)
      .slice(0, 4)
      .map((a) => a.card);
  } else {
    cards = s.pending.splice(0, 3);
    const sources = practiceSources(s, mode);
    // The first visit opens quickly. Each explicit continuation can draw on more journal material.
    const budget = continuing ? 3 : cards.length ? 0 : 1;
    const previousPrompts = s.attempts.slice(-24).map((a) => a.card.prompt);
    for (let n = 0; n < budget && cards.length < 3 && sources.length; n++) {
      const index = continuing ? (s.attempts.length + n) % sources.length : 0;
      const ctx = context(
        s,
        'practice',
        mode === 'Build vocabulary'
          ? 'Teach one useful word or sense from the supplied material.'
          : 'Offer a fresh, relevant exercise if this material supports one.',
        mode,
        sources[index],
      );
      ctx.previousPrompts = [...previousPrompts, ...cards.map((c) => c.prompt)];
      try {
        const response = await backend.tutor(ctx);
        if (!response.action?.exercise || ctx.previousPrompts.includes(response.action.exercise.prompt))
          continue;
        applyAction(s, response, ctx);
        const fresh = s.pending.shift();
        if (!fresh) throw new Error('Missing generated card');
        if (mode === 'Build vocabulary') fresh.introduction = response.reply.trim();
        cards.push(fresh);
      } catch {
        s.notice = 'The tutor could not prepare more practice this time.';
        break;
      }
    }
    if (!sources.length && !cards.length && !s.notice) {
      const seen = new Map(s.attempts.map((attempt, i) => [attempt.card.id, i]));
      cards = catalogue
        .filter((c) => mode !== 'Build vocabulary' || c.source.startsWith('Build vocabulary'))
        .sort((a, b) => (seen.get(a.id) ?? -1) - (seen.get(b.id) ?? -1))
        .slice(0, 3);
    }
    if (sources.length && !cards.length && !s.notice) s.notice = 'No fresh follow-up from this material yet.';
  }
  s.practice = { started: true, mode, cards, index: 0, result: null };
}

function resolveReference(s: State, key: string, supplied: string): { reference: Reference; source: string } {
  const annotation = s.annotationThreads.find((t) => t.id === key);
  if (annotation)
    return {
      reference: annotationReference(s, annotation),
      source: describeAnnotation(s.threads, annotation),
    };
  const attempt = s.attempts.find((a) => a.id === key);
  if (attempt)
    return {
      reference: { kind: 'attempt', id: key, label: 'Practice', quote: attempt.answer },
      source: JSON.stringify({
        exercise: attempt.card.prompt,
        learnerAnswer: attempt.answer,
        feedback: attempt.result.feedback,
      }),
    };
  const reflection = s.reflections.find((r) => r.id === key);
  if (reflection) {
    const takeaway = reflection.takeaways.find((t) => supplied.includes(t.quote));
    const label = s.threads.find((t) => t.id === reflection.threadId)!.title;
    return {
      reference: {
        kind: 'reflection',
        id: key,
        label,
        quote: takeaway?.quote ?? reflection.overview,
        threadId: reflection.threadId,
      },
      source: JSON.stringify({
        overview: reflection.overview,
        takeaways: reflection.takeaways,
        selected: supplied,
      }),
    };
  }
  if (key.includes('/') || readingDocuments.some((doc) => doc.id === key)) {
    const reading = { ...s.reading, annotations: readingNotes(s.annotationThreads) };
    const { document, paragraph, annotation } = resolveReadingReference(key, reading);
    const selected = supplied.match(/^Selected text: (.+)$/m)?.[1];
    const quote =
      selected && paragraph?.text.includes(selected) ? selected : annotation?.quote || paragraph?.text || '';
    const original = annotation
      ? describeAnnotation(s.threads, s.annotationThreads.find((t) => t.id === annotation.id)!)
      : readingSource(reading, key);
    return {
      reference: { kind: 'reading', id: key, label: document.title, quote: quote.slice(0, 120) },
      source: selected === quote && !annotation ? original + '\nSelected text: ' + quote : original,
    };
  }
  throw new JournalConflict('This source is no longer available.');
}

function annotationReference(s: State, thread: AnnotationThread): Reference {
  const { anchor, id } = thread;
  return {
    kind: 'annotation',
    id,
    label: resolveAnchor(s.threads, anchor).title,
    quote: anchor.quote,
    threadId: anchor.surface === 'chat' ? anchor.ownerId : undefined,
  };
}

function attachTakeaways(
  s: State,
  reflectionId: string,
  chatId: string,
  takeaways: NonNullable<TutorResult['reflection']>['takeaways'],
): Reflection['takeaways'] {
  return takeaways.map((takeaway, index) => {
    const id = reflectionId + '-takeaway-' + index;
    const anchor = anchorForQuote(s.threads, 'chat', chatId, takeaway.messageId, takeaway.quote);
    s.annotationThreads.push({ id, anchor, messages: [{ role: 'assistant', text: takeaway.text }] });
    return { ...takeaway, annotationId: id };
  });
}

async function postAnnotation(
  s: State,
  action: Extract<Action, { type: 'annotationPost' }>,
  backend: Backend,
) {
  const { anchor, annotationId, message, askTutor } = action;
  if (Boolean(anchor) === Boolean(annotationId))
    throw new JournalConflict('Choose a selection or an existing annotation.');
  if (anchor && s.annotationThreads.some((t) => t.id === action.id))
    throw new JournalConflict('This annotation already exists.');
  const thread: AnnotationThread | undefined = anchor
    ? { id: action.id, anchor, messages: [] }
    : s.annotationThreads.find((t) => t.id === annotationId);
  if (!thread) throw new JournalConflict('This annotation is unavailable.');
  const reference = annotationReference(s, thread);
  const at = new Date().toISOString();
  if (askTutor) {
    const source = describeAnnotation(s.threads, thread);
    const selectedChat =
      thread.anchor.surface === 'chat' ? s.threads.find((t) => t.id === thread.anchor.ownerId) : undefined;
    const ctx = context(s, 'ask', message, thread.anchor.surface, source, selectedChat);
    if (thread.anchor.surface === 'read') ctx.readingContext = source;
    const response = await backend.tutor(ctx);
    if (!response.reply.trim()) throw new Error('Tutor returned no annotation reply.');
    thread.messages.push(
      { role: 'user', text: message, at },
      { role: 'assistant', text: response.reply, at: new Date().toISOString() },
    );
    // Persist the compact source link with any study action. The full discussion belongs to the annotation.
    applyAction(s, response, { ...ctx, source: reference.label + ' · ' + reference.quote }, reference);
  } else {
    thread.messages.push({ role: 'user', text: message, at });
  }
  if (anchor) s.annotationThreads.push(thread);
  const activity = askTutor
    ? 'Discussed a selection in '
    : anchor
      ? 'Annotated '
      : 'Added to an annotation in ';
  logActivity(s, activity + reference.label, reference.label, reference);
}

async function reflect(s: State, backend: Backend, source: string) {
  const thread = activeThread(s);
  const previous = s.reflections.findLast((r) => r.threadId === thread.id);
  const stretch = thread.turns.slice(previous?.end ?? 0);
  if (!stretch.some((m) => m.role === 'user')) return;
  const ctx = context(s, 'reflect', 'Reflect on this stretch of the conversation.', 'chat', source);
  ctx.reflectionTurns = stretch.map((m) => ({ id: m.id, role: m.role, text: m.text }));
  const { reflection } = await backend.tutor(ctx);
  if (
    !reflection?.overview.trim() ||
    reflection.takeaways.some(
      (t) =>
        !t.quote.trim() ||
        !t.text.trim() ||
        !stretch.some((m) => m.role === 'user' && m.id === t.messageId && m.text.includes(t.quote)),
    )
  ) {
    throw new Error('The reflection could not be anchored to the learner’s words.');
  }
  const reflectionId = randomUUID();
  const entry = {
    ...reflection,
    id: reflectionId,
    threadId: thread.id,
    end: thread.turns.length,
    takeaways: attachTakeaways(s, reflectionId, thread.id, reflection.takeaways),
  };
  s.reflections.push(entry);
  const reference: Reference = {
    kind: 'reflection',
    id: entry.id,
    label: thread.title,
    quote: entry.takeaways[0]?.quote ?? '',
    threadId: thread.id,
  };
  s.tutor.push({
    role: 'assistant',
    kind: 'observation',
    text: entry.overview,
    source: thread.title,
    reference,
  });
  logActivity(s, 'Reflected on ' + thread.title, thread.title, reference);
}
async function mutate(s: State, a: Action, backend: Backend) {
  s.notice = '';
  switch (a.type) {
    case 'newThread': {
      s.threads.push({ id: a.id, title: a.title.trim(), source: a.source, turns: [] });
      s.activeThreadId = a.id;
      return;
    }
    case 'selectThread':
      if (!s.threads.some((t) => t.id === a.threadId)) throw new JournalConflict('Conversation unavailable.');
      s.activeThreadId = a.threadId;
      return;
    case 'readingPosition':
      applyReadingPosition(s.reading, a.documentId, a.paragraphId);
      return;
    case 'annotate': {
      const anchor = anchorForQuote(s.threads, 'read', a.documentId, a.paragraphId, a.quote);
      return postAnnotation(
        s,
        { ...a, type: 'annotationPost', anchor, message: a.text, askTutor: false },
        backend,
      );
    }
    case 'annotationPost':
      return postAnnotation(s, a, backend);
    case 'chat':
    case 'reflect': {
      const thread = activeThread(s);
      if (a.threadId && a.threadId !== thread.id)
        throw new JournalConflict('The selected conversation changed.');
      if (a.type === 'reflect') return reflect(s, backend, a.source);
      const reply = await backend.friend(context(s, 'ask', a.message, 'chat', thread.source || a.source));
      thread.turns.push(
        { id: a.id, role: 'user', text: a.message, source: a.source },
        { id: randomUUID(), role: 'assistant', text: reply, source: a.source },
      );
      return;
    }
    case 'tutor': {
      const anchor = a.referenceId ? resolveReference(s, a.referenceId, a.source) : undefined;
      const ctx = context(s, 'ask', a.message, a.surface, anchor?.source ?? a.source);
      if (anchor?.reference.kind === 'reading') ctx.readingContext = anchor.source;
      const response = await backend.tutor(ctx);
      s.tutor.push({ role: 'user', text: a.message, source: ctx.source, reference: anchor?.reference });
      if (response.reply.trim())
        s.tutor.push({
          role: 'assistant',
          text: response.reply,
          source: ctx.source,
          reference: anchor?.reference,
        });
      applyAction(s, response, ctx, anchor?.reference);
      return;
    }
    case 'saveReading':
      keep(s, 'Reading', a.title, a.detail, a.source);
      return;
    case 'practice':
      return startPractice(s, a.mode, backend, a.continue);
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
          JSON.stringify({
            prompt: c.prompt,
            expected: c.answer,
            explanation: c.explanation,
            source: c.source,
          }),
        );
        try {
          const response = await backend.tutor(ctx);
          if (response.reply.trim()) {
            result.feedback = c.kind === 'open' ? response.reply : c.explanation + '\n' + response.reply;
            // Keep the full reaction on the attempt; link the answer in the shared stream.
            if (response.observation?.trim())
              s.tutor.push({
                role: 'assistant',
                kind: 'observation',
                text: response.observation,
                source: c.source,
                reference: { kind: 'attempt', id: a.id, quote: a.answer, label: 'Practice' },
              });
          }
        } catch {
          s.notice = 'Your answer was recorded. Tutor feedback is unavailable for this turn.';
        }
      }
      p.result = result;
      s.attempts.push({ id: a.id, card: c, answer: a.answer, result });
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
    const parsed = JSON.parse(String(row.body)) as State & { chat?: Message[] };
    if (!parsed.threads) {
      const turns = (parsed.chat ?? []).map((turn, i) => ({ ...turn, id: 'legacy-turn-' + i }));
      const birds = turns.some((m) => /鸟|bird|Audubon/i.test(m.text));
      parsed.activeThreadId = 'first';
      parsed.threads = [{ id: 'first', title: birds ? 'Birdwatching' : 'Conversation', turns }];
      parsed.reflections = [];
      parsed.activity = [];
      parsed.reading = initialReading();
      parsed.attempts.forEach((a, i) => {
        a.id = 'legacy-attempt-' + i;
      });
      // Old open-answer bubbles duplicated the feedback verbatim. Only link exact matches.
      for (const a of parsed.attempts) {
        if (a.result.correct !== null) continue;
        const message = parsed.tutor.find(
          (m) =>
            !m.reference &&
            m.role === 'assistant' &&
            m.text === a.result.feedback &&
            m.source?.includes(a.card.prompt),
        );
        if (message) {
          message.kind = 'observation';
          message.reference = { kind: 'attempt', id: a.id, quote: a.answer, label: 'Practice' };
          message.text = '';
        }
      }
      delete parsed.chat;
    }
    if (!parsed.annotationThreads) {
      parsed.annotationThreads = parsed.reading.annotations.map((note) => ({
        id: note.id,
        anchor: anchorForQuote(parsed.threads, 'read', note.documentId, note.paragraphId, note.quote),
        messages: [{ role: 'user', text: note.text }],
      }));
      parsed.reading.annotations = [];
      for (const reflection of parsed.reflections) {
        reflection.takeaways = attachTakeaways(
          parsed,
          reflection.id,
          reflection.threadId,
          reflection.takeaways,
        );
      }
    }
    return { revision: Number(row.revision), s: parsed };
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
