import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { checkReadingSize, createImportReviewer, legacyImportWarning } from './import-validation.ts';
import { extractArticle, ImportError } from './article.ts';
import { judgeImport } from './import-judge.ts';
import { articleUrl, importArticle } from './import-reading.ts';
import {
  initialReading,
  documentsFor,
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
import { validateTurn, type Reflection as TutorReflection, type SituationName, type SituationOutput, type TutorAction } from './situations/index.ts';

import {
  addWord, addWordAction, clarifyWordAction, retryWordAction, resumeWord, reusableWord, finishWord, wordRequest,
  OfflineWordUnavailable, type WordIntake, type WordContent, type WordDecision,
} from './word-intake.ts';
import { withMediaDefaults, type MediaState } from './media/model.ts';
import { anchorIds, applyOutcome, DAILY_LIMIT, finishJob, mediaRequestFor, queueMediaJobs, ranToday } from './media/job.ts';
import { OfflineMediaUnavailable } from './media/demo.ts';
import type { MediaOutcome } from './situations/media.ts';

const text = z.string().trim().min(1).max(8000);
const source = z.string().max(12000);
const id = z.string().uuid();
export const actionSchema = z.discriminatedUnion('type', [
  addWordAction, clarifyWordAction, retryWordAction,
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
  z.object({
    id, type: z.literal('importReading'), url: z.string().trim().min(1).max(4096),
    acceptPreview: id.optional(), pastedText: z.string().optional(),
  }),
  z.object({
    id, type: z.literal('importPdf'), title: z.string().trim().min(1).max(120),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/), paragraphs: z.array(z.string()),
  }),
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
// rationale is the tutor's reason for choosing this exercise. It stays with the
// card and is never treated as evidence about the learner.
type QueuedCard = Card & { title?: string; introduction?: string; rationale?: string };
type Item = { word?: WordContent; id: string; kind: string; title: string; detail: string; source: string; reference?: Reference };
type Result = { correct: boolean | null; feedback: string };
type Practice = { started?: boolean; mode: string; cards: QueuedCard[]; index: number; result: Result | null };
type State = {
  wordIntakes: WordIntake[];
  tutor: Message[];
  activeThreadId: string;
  threads: Thread[];
  reflections: Reflection[];
  annotationThreads: AnnotationThread[];
  activity: Activity[];
  reading: ReadingState;
  saved: Item[];
  // Earlier versions copied the tutor's practice rationales here and fed them
  // back as learner evidence. Existing entries are retained but no longer read.
  learning?: { text: string; source: string }[];
  attempts: Attempt[];
  pending: QueuedCard[];
  practice: Practice;
  notice: string;
} & MediaState;
const initial = (): State => ({
  wordIntakes: [],
  tutor: [],
  activeThreadId: 'first',
  threads: [{ id: 'first', title: 'Conversation', turns: [] }],
  reflections: [],
  annotationThreads: [],
  activity: [],
  reading: initialReading(),
  saved: [],
  attempts: [],
  pending: [],
  practice: { mode: 'Daily mix', cards: [], index: 0, result: null },
  notice: '',
  media: [],
  mediaDecisions: [],
  mediaJobs: [],
  settings: { pictures: 'normal' },
});
export const live = !!process.env.OPENAI_API_KEY && process.env.JOURNAL_DEMO !== '1';
type Backend = {
  importReading?: (url: URL) => ReturnType<typeof importArticle>;
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
    wordIntakes: s.wordIntakes.map(({ requestId, ...item }) => item),
    tutor: s.tutor,
    activeThreadId: s.activeThreadId,
    threads: s.threads.map(({ turns, ...thread }) => thread),
    chat: activeThread(s).turns,
    reflections: s.reflections,
    attempts: s.attempts,
    activity: s.activity,
    reading: {
      documentId: s.reading.documentId,
      positions: s.reading.positions,
      annotations: readingNotes(s.annotationThreads),
      documents: documentsFor(s.reading).map(doc => {
        const importWarning = legacyImportWarning(doc);
        return importWarning ? { ...doc, ...importWarning } : doc;
      }),
    },
    annotationThreads: s.annotationThreads,
    saved: s.saved,
    media: s.media,
    settings: s.settings,
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
/**
 * Asks the tutor in one situation and validates the result, whichever backend
 * produced it, before the journal applies anything.
 */
async function consult<K extends SituationName>(
  backend: Backend,
  name: K,
  ctx: TurnContext,
): Promise<SituationOutput<K>> {
  return validateTurn(name, await backend.tutor(ctx), ctx);
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
      const { title } = resolveAnchor(s, t.anchor);
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
function applyAction(s: State, a: TutorAction | null, ctx: TurnContext, reference?: Reference) {
  if (!a) return;
  if (a.kind === 'stash' || a.kind === 'note') {
    keep(s, a.kind === 'stash' ? 'Word' : 'Note', a.title, a.detail, ctx.source, reference);
    return;
  }
  const card = exerciseCard(a, ctx);
  if (!card) return;
  if (
    !s.pending.some((c) => c.prompt === card.prompt) &&
    !ctx.practiceStatus?.active.some((c) => c.prompt === card.prompt)
  ) {
    s.pending.push(card);
    logActivity(s, 'Queued practice · ' + card.title, ctx.source, reference);
  }
}
// The action has already passed its situation's validator.
function exerciseCard(a: TutorAction | null, ctx: TurnContext): QueuedCard | undefined {
  if (a?.kind !== 'practice' || !a.exercise) return;
  return { ...a.exercise, id: randomUUID(), title: a.title, rationale: a.detail, source: ctx.source };
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
    .map((t) => describeAnnotation(s, t));
  const readings = s.saved
    .filter((item) => item.kind === 'Reading')
    .slice(-3)
    .reverse()
    .map((item) => (item.title + ' · ' + item.detail).slice(0, 1800));
  const places = Object.entries(s.reading.positions).map(
    ([doc, paragraph]) => 'Encountered in reading: ' + readingSource(s.reading, doc + '/' + paragraph),
  );
  // The learner's own requests to the tutor, with what they were looking at.
  const requests = s.tutor
    .filter((m) => m.role === 'user')
    .slice(-4)
    .reverse()
    .map((m) => 'Asked the tutor · ' + m.text + (m.source ? ' · about: ' + m.source.slice(0, 600) : ''));
  return [
    ...new Set(
      mode === 'Build vocabulary'
        ? [...words, ...discussions, ...turns, ...readings, ...places, ...requests]
        : [...turns, ...discussions, ...words, ...readings, ...places, ...requests],
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
      const savedWord = s.saved.find(
        (item) => item.kind === 'Word' && item.title + ' · ' + item.detail === ctx.source,
      );
      if (savedWord?.word) ctx.practiceWord = { title: savedWord.title, ...savedWord.word };
      ctx.previousPrompts = [...previousPrompts, ...cards.map((c) => c.prompt)];
      try {
        const response = await consult(backend, 'practiceGen', ctx);
        const fresh = exerciseCard(response.action, ctx);
        // A repeat of a served or queued prompt is skipped like an empty turn, not a failure.
        if (!fresh || ctx.previousPrompts.includes(fresh.prompt) || s.pending.some((c) => c.prompt === fresh.prompt))
          continue;
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
      source: describeAnnotation(s, annotation),
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
  if (key.includes('/') || documentsFor(s.reading).some((doc) => doc.id === key)) {
    const reading = { ...s.reading, annotations: readingNotes(s.annotationThreads) };
    const { document, paragraph, annotation } = resolveReadingReference(key, reading);
    const selected = supplied.match(/^Selected text: (.+)$/m)?.[1];
    const quote =
      selected && paragraph?.text.includes(selected) ? selected : annotation?.quote || paragraph?.text || '';
    const original = annotation
      ? describeAnnotation(s, s.annotationThreads.find((t) => t.id === annotation.id)!)
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
    label: resolveAnchor(s, anchor).title,
    quote: anchor.quote,
    threadId: anchor.surface === 'chat' ? anchor.ownerId : undefined,
  };
}

function attachTakeaways(
  s: State,
  reflectionId: string,
  chatId: string,
  takeaways: TutorReflection['takeaways'],
): Reflection['takeaways'] {
  return takeaways.map((takeaway, index) => {
    const id = reflectionId + '-takeaway-' + index;
    const anchor = anchorForQuote(s, 'chat', chatId, takeaway.messageId, takeaway.quote);
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
    const source = describeAnnotation(s, thread);
    const selectedChat =
      thread.anchor.surface === 'chat' ? s.threads.find((t) => t.id === thread.anchor.ownerId) : undefined;
    const ctx = context(s, 'ask', message, thread.anchor.surface, source, selectedChat);
    if (thread.anchor.surface === 'read') ctx.readingContext = source;
    const response = await consult(backend, 'ask', ctx);
    thread.messages.push(
      { role: 'user', text: message, at },
      { role: 'assistant', text: response.reply, at: new Date().toISOString() },
    );
    // Persist the compact source link with any study action. The full discussion belongs to the annotation.
    applyAction(s, response.action, { ...ctx, source: reference.label + ' · ' + reference.quote }, reference);
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
  const { reflection } = await consult(backend, 'reflect', ctx);
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
async function mutate(s: State, a: Action, backend: Backend, reviewImport: ReturnType<typeof createImportReviewer>) {
  s.notice = '';
  switch (a.type) {
    case 'addWord':
      return addWord(s.wordIntakes, s.saved, a);
    case 'clarifyWord':
    case 'retryWord':
      return resumeWord(s.wordIntakes, a);
    case 'newThread': {
      s.threads.push({ id: a.id, title: a.title.trim(), source: a.source, turns: [] });
      s.activeThreadId = a.id;
      return;
    }
    case 'selectThread':
      if (!s.threads.some((t) => t.id === a.threadId)) throw new JournalConflict('Conversation unavailable.');
      s.activeThreadId = a.threadId;
      return;
    case 'importReading': {
      const url = articleUrl(a.url);
      const previous = s.reading.imports.findLast(entry => entry.sourceUrl === url.href);
      let document = previous;
      if (a.pastedText !== undefined) {
        if (a.acceptPreview) throw new ImportError(400, 'Choose either the fetched preview or pasted article text.');
        if (!a.pastedText.trim()) throw new ImportError(422, 'Paste the article text before importing.');
        const pasted = extractArticle(a.pastedText, 'text/plain', url);
        document = s.reading.imports.findLast(entry =>
          entry.sourceUrl === url.href && entry.title === pasted.title &&
          entry.paragraphs.length === pasted.paragraphs.length &&
          entry.paragraphs.every((p, i) => p.text === pasted.paragraphs[i].text && p.kind === pasted.paragraphs[i].kind) &&
          !legacyImportWarning(entry)
        );
        if (!document) {
          document = { ...pasted, importMethod: 'paste', id: previous ? randomUUID() : pasted.id };
          s.reading.imports.push(document);
        }
      } else if (!document || legacyImportWarning(document)) {
        document = await reviewImport(url, a.acceptPreview);
        // Keep earlier snapshots intact so their notes retain their original anchors.
        if (previous) document = { ...document, id: randomUUID() };
        s.reading.imports.push(document);
      }
      s.reading.documentId = document.id;
      return;
    }
    case 'importPdf': {
      const paragraphs = a.paragraphs.map(p => p.trim()).filter(Boolean);
      checkReadingSize(paragraphs);
      if (!paragraphs.some(p => /[\p{L}\p{N}]/u.test(p)))
        throw new ImportError(422, 'No readable text was found in this PDF.');
      const documentId = 'pdf-' + a.fingerprint;
      if (!s.reading.imports.some(doc => doc.id === documentId)) {
        s.reading.imports.push({
          id: documentId, kind: 'PDF', importMethod: 'pdf', title: a.title,
          paragraphs: paragraphs.map((text, i) => ({ id: 'p' + (i + 1), text })),
        });
      }
      s.reading.documentId = documentId;
      return;
    }
    case 'readingPosition':
      applyReadingPosition(s.reading, a.documentId, a.paragraphId);
      return;
    case 'annotate': {
      const anchor = anchorForQuote(s, 'read', a.documentId, a.paragraphId, a.quote);
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
      const source = thread.source || a.source;
      const imported = s.reading.imports.find(entry => entry.id === source);
      const discussion = imported ? readingSource(s.reading, imported.id) : undefined;
      if (a.type === 'reflect') return reflect(s, backend, discussion ?? a.source);
      const reply = await backend.friend(context(s, 'ask', a.message, 'chat', discussion ?? source));
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
      const response = await consult(backend, 'ask', ctx);
      s.tutor.push(
        { role: 'user', text: a.message, source: ctx.source, reference: anchor?.reference },
        { role: 'assistant', text: response.reply, source: ctx.source, reference: anchor?.reference },
      );
      applyAction(s, response.action, ctx, anchor?.reference);
      return;
    }
    case 'saveReading': {
      const imported = s.reading.imports.find(entry => entry.id === a.source);
      if (imported) {
        const excerpt = Array.from(imported.paragraphs.map(p => p.text).join(' '));
        const detail = excerpt.length > 220 ? excerpt.slice(0, 220).join('') + '…' : excerpt.join('');
        keep(s, 'Reading', imported.title, detail, imported.id, {
          kind: 'reading', id: imported.id, label: imported.title, quote: '',
        });
      } else {
        keep(s, 'Reading', a.title, a.detail, a.source);
      }
      return;
    }
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
          const response = await consult(backend, 'feedback', ctx);
          if (response.reply.trim()) {
            result.feedback = c.kind === 'open' ? response.reply : c.explanation + '\n' + response.reply;
            // Keep the full reaction on the attempt; link the answer in the shared stream.
            if (response.observation)
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
  const reviewImport = createImportReviewer(backend.importReading ?? importArticle, backend.mode === 'live' ? judgeImport : undefined);
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS journal(id INTEGER PRIMARY KEY CHECK (id=1),revision INTEGER NOT NULL,body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL);`);
  db.prepare('INSERT OR IGNORE INTO journal VALUES (1,0,?)').run(JSON.stringify(initial()));
  function read() {
    const row = db.prepare('SELECT revision,body FROM journal WHERE id=1').get()!;
    const parsed = JSON.parse(String(row.body)) as State & { chat?: Message[] };
    parsed.wordIntakes ??= [];
    withMediaDefaults(parsed);
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
    parsed.reading.imports ??= [];
    if (!parsed.annotationThreads) {
      parsed.annotationThreads = parsed.reading.annotations.map((note) => ({
        id: note.id,
        anchor: anchorForQuote(parsed, 'read', note.documentId, note.paragraphId, note.quote),
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
  function enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = tail.then(operation);
    tail = result.catch(() => {});
    return result;
  }

  let closed = false;
  // Model work runs outside the user action queue. Only its short commit joins
  // the queue, so it sees intervening actions and cannot overwrite a user turn.
  async function prepareWords() {
    while (!closed) {
      const { s } = read();
      const job = s.wordIntakes.find((item) => item.status === 'pending');
      if (!job) return;
      const ctx = context(s, 'wordIntake', job.text, 'Add word', job.context || '');
      ctx.wordIntake = wordRequest(job, s.saved);
      let decision: WordDecision | undefined;
      let failure: string | undefined;
      const reuse = !job.history.length && reusableWord(s.saved, job.text, job.context);
      try {
        if (!reuse) {
          decision = (await consult(backend, 'wordIntake', ctx)).wordDecision;
        }
      } catch (error) {
        failure =
          error instanceof OfflineWordUnavailable
            ? error.message
            : 'The tutor could not prepare this word. Try again.';
      }
      await enqueue(() => {
        if (closed) return;
        db.exec('BEGIN IMMEDIATE');
        try {
          const { s: latest } = read();
          const intake = latest.wordIntakes.find((item) => item.id === job.id);
          if (intake?.status === 'pending' && intake.requestId === job.requestId) {
            if (reuse) {
              intake.status = 'ready';
              intake.savedIds = [reuse.id];
            } else if (decision) {
              try {
                const before = anchorIds(latest);
                finishWord(intake, latest.saved, decision);
                queueMediaJobs(latest, before);
              } catch {
                failure = 'The tutor returned an incomplete word. Try again.';
              }
            }
            if (failure) {
              intake.status = 'failed';
              intake.error = failure;
            }
            db.prepare('UPDATE journal SET body=?,revision=revision+1 WHERE id=1').run(
              JSON.stringify(latest),
            );
          }
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      });
      wakeMedia();
    }
  }
  // One background consideration at a time, at most DAILY_LIMIT model turns a
  // day. Jobs over the limit stay pending until activity wakes the worker again.
  async function prepareMedia() {
    while (!closed) {
      const { s } = read();
      const job = s.mediaJobs.find((item) => item.status === 'pending');
      if (!job) return;
      const request = mediaRequestFor(s, job.anchor);
      let outcome: MediaOutcome | undefined;
      let skipped: string | undefined;
      let failure: string | undefined;
      if (s.settings.pictures === 'off') skipped = 'pictures-off';
      else if (!request) skipped = 'anchor-gone';
      else if (ranToday(s) >= DAILY_LIMIT) return;
      else {
        const ctx = context(s, 'mediaConsider', request.term, 'media', request.context ?? '');
        ctx.media = request;
        try {
          outcome = await consult(backend, 'mediaConsider', ctx);
        } catch (error) {
          if (error instanceof OfflineMediaUnavailable) skipped = 'offline';
          else failure = 'failed: ' + String((error as Error)?.message ?? error).slice(0, 200);
        }
      }
      await enqueue(() => {
        if (closed) return;
        db.exec('BEGIN IMMEDIATE');
        try {
          const { s: latest } = read();
          const current = latest.mediaJobs.find((item) => item.id === job.id);
          if (current?.status === 'pending') {
            const now = new Date();
            if (outcome && request && mediaRequestFor(latest, job.anchor)) {
              applyOutcome(latest, request, outcome, now);
              finishJob(latest, current, 'done', now);
            } else if (outcome) finishJob(latest, current, 'skipped', now, 'anchor-gone');
            else if (failure) finishJob(latest, current, 'failed', now, failure);
            else finishJob(latest, current, 'skipped', now, skipped);
            db.prepare('UPDATE journal SET body=?,revision=revision+1 WHERE id=1').run(JSON.stringify(latest));
          }
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      });
    }
  }
  // Model work runs outside the user action queue; see prepareWords.
  function worker(task: () => Promise<void>) {
    let running = false;
    let again = false;
    const wake = () => {
      if (closed) return;
      again = true;
      if (running) return;
      running = true;
      setImmediate(async () => {
        try {
          do {
            again = false;
            await task();
          } while (again && !closed);
        } catch {
          // A storage failure leaves the pending request durable. Retry after a
          // short delay without logging learner input or trapping the request loop.
          setTimeout(wake, 1000).unref();
        } finally {
          running = false;
        }
      });
    };
    return { wake, busy: () => running };
  }
  const words = worker(prepareWords);
  const media = worker(prepareMedia);
  const wakeWords = words.wake;
  const wakeMedia = media.wake;

  async function perform(a: Action) {
    const hash = createHash('sha256').update(JSON.stringify(a)).digest('hex');
    const old = db.prepare('SELECT fingerprint FROM receipts WHERE id=?').get(a.id);
    const { s, revision } = read();
    if (old) {
      if (old.fingerprint !== hash)
        throw new JournalConflict('This action ID already identifies a different request.');
      return publicState(s, backend.mode);
    }
    const before = anchorIds(s);
    await mutate(s, a, backend, reviewImport);
    queueMediaJobs(s, before);
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
    if (a.type === 'addWord' || a.type === 'clarifyWord' || a.type === 'retryWord') wakeWords();
    if (s.mediaJobs.some((job) => job.status === 'pending')) wakeMedia();
    return publicState(s, backend.mode);
  }
  wakeWords();
  wakeMedia();
  return {
    get: () => publicState(read().s, backend.mode),
    /** Whether background word or media work is pending or running. */
    busy() {
      const { s } = read();
      return (
        words.busy() || media.busy() ||
        s.wordIntakes.some((item) => item.status === 'pending') ||
        (s.mediaJobs.some((job) => job.status === 'pending') && ranToday(s) < DAILY_LIMIT && s.settings.pictures !== 'off')
      );
    },
    act(a: Action) {
      return enqueue(() => perform(a));
    },
    close() {
      closed = true;
      db.close();
    },
  };
}
