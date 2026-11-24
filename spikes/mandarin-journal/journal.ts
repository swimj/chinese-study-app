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
import type { NoticeRequest } from './situations/notice.ts';
import {
  addJudgment, appendEvent, createRecordTables, events as recordEvents, formsIn, judgedToday, judgments as recordJudgments,
  meta, nextUnjudged, setMeta, targets as recordTargets, upsertTarget, type NewEvent, type JudgmentRecord,
} from './record.ts';
import { rank, signalsFrom, type ChoiceJudgment, type Ranked } from './priority.ts';

const text = z.string().trim().min(1).max(8000);
const source = z.string().max(12000);
const id = z.string().uuid();
export const actionSchema = z.discriminatedUnion('type', [
  addWordAction, clarifyWordAction, retryWordAction,
  z.object({
    id, type: z.literal('capture'), text: z.string().trim().min(1).max(2048),
    context: z.string().trim().max(2000).optional(),
  }),
  z.object({
    id,
    type: z.literal('tutor'),
    message: text,
    surface: text,
    source,
    referenceId: text.optional(),
    wordReplyTo: z.object({ intakeId: id, requestId: id }).optional(),
    captureQuestionId: id.optional(),
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
    id, type: z.literal('captureReading'), anchor: anchorSchema.extend({ surface: z.literal('read') }),
    note: z.string().trim().min(1).max(1600).optional(),
  }),
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
  z.object({ id, type: z.literal('mediaReaction'), mediaId: text, reaction: z.enum(['keep', 'notForMe']) }),
  z.object({ id, type: z.literal('settings'), pictures: z.enum(['off', 'quiet', 'normal']) }),
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
  wordIntakeId?: string;
  wordRequestId?: string;
  captureOriginId?: string;
  captureQuestionId?: string;
  captureResolved?: boolean;
};
type Thread = { id: string; title: string; source?: string; turns: (Message & { id: string })[] };
type Reflection = {
  id: string;
  threadId: string;
  overview: string;
  takeaways: { annotationId: string; messageId: string; quote: string; text: string }[];
  end: number;
};
type Attempt = { id: string; card: QueuedCard; answer: string; result: Result };
type Activity = { id: string; at: string; text: string; source: string; reference?: Reference };
// rationale is the tutor's reason for choosing this exercise. It stays with the
// card and is never treated as evidence about the learner.
// targets are the forms the journal asked this card to practice, when it asked for any.
type QueuedCard = Card & { title?: string; introduction?: string; rationale?: string; targets?: string[] };
/** What an action records beside the journal: events, and rule judgments made on the spot. */
type Outbox = { events: NewEvent[]; judgments: JudgmentRecord[]; priority: () => Ranked[] };
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
/** Model reads of the learner's language per UTC day. */
const NOTICE_DAILY_LIMIT = 150;
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
    wordIntakes: s.wordIntakes,
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
    .filter((thread) => thread.messages.length > 0)
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
/**
 * Daily mix asks for exercises on the highest-priority targets first, then
 * falls back to recent journal material. Targets already in play are skipped.
 */
function prioritySources(s: State, ranked: Ranked[]): { source: string; target: Ranked['target']; teach: boolean }[] {
  const inPlay = new Set([...s.pending, ...s.practice.cards.slice(s.practice.index)].flatMap((c) => c.targets ?? []));
  return ranked
    .filter((r) => !inPlay.has(r.target.form))
    .slice(0, 6)
    .map((r) => ({
      target: r.target,
      // A chosen word with no record of study yet is taught before it is practiced.
      teach: !r.signals && (r.target.origin === 'saved' || (!!r.target.hosted?.inStash && r.target.hosted.mode === 'unstudied')),
      source:
        'Target: ' + r.target.form + (r.target.pinyin ? ' (' + r.target.pinyin + ')' : '') +
        (r.target.gloss ? ' · ' + r.target.gloss : '') + '\nWhy now: ' + r.reasons.join('; '),
    }));
}
async function startPractice(s: State, mode: string, backend: Backend, continuing: boolean, outbox: Outbox) {
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
    const material = practiceSources(s, mode).map((source) => ({ source, target: undefined }));
    const prioritized = mode === 'Daily mix' ? prioritySources(s, outbox.priority()) : [];
    const sources: { source: string; target?: Ranked['target']; teach?: boolean }[] = [...prioritized, ...material];
    // The first visit opens quickly. Each explicit continuation can draw on more journal material.
    const budget = continuing ? 3 : cards.length ? 0 : 1;
    const previousPrompts = s.attempts.slice(-24).map((a) => a.card.prompt);
    for (let n = 0; n < budget && cards.length < 3 && sources.length; n++) {
      // Priority targets go in order; plain material rotates as before.
      const index = prioritized.length ? n % sources.length : continuing ? (s.attempts.length + n) % sources.length : 0;
      const { source, target, teach } = sources[index];
      const ctx = context(
        s,
        'practice',
        mode === 'Build vocabulary'
          ? 'Teach one useful word or sense from the supplied material.'
          : teach
            ? 'Teach the expression named in the supplied source, then offer an exercise on it. The learner sees only your reply and the exercise, so never call it “the target”.'
            : target
            ? 'Offer a fresh exercise that practices the expression named in the supplied source. The learner sees only the exercise, so never call it “the target”.'
            : 'Offer a fresh, relevant exercise if this material supports one.',
        mode,
        source,
      );
      const savedWord = s.saved.find(
        (item) => item.kind === 'Word' && (item.title + ' · ' + item.detail === ctx.source || item.title === target?.form),
      );
      if (savedWord?.word) ctx.practiceWord = { title: savedWord.title, ...savedWord.word };
      else if (target?.gloss)
        ctx.practiceWord = { title: target.form, pinyin: target.pinyin ?? '', meaning: target.gloss, example: '', translation: '' };
      ctx.previousPrompts = [...previousPrompts, ...cards.map((c) => c.prompt)];
      try {
        const response = await consult(backend, 'practiceGen', ctx);
        const fresh = exerciseCard(response.action, ctx);
        // A repeat of a served or queued prompt is skipped like an empty turn, not a failure.
        if (!fresh || ctx.previousPrompts.includes(fresh.prompt) || s.pending.some((c) => c.prompt === fresh.prompt))
          continue;
        if (mode === 'Build vocabulary' || teach) fresh.introduction = response.reply.trim() || undefined;
        if (target) fresh.targets = [target.form];
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
  outbox: Outbox,
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
  outbox.events.push({
    id: action.id, at, kind: 'annotation', surface: thread.anchor.surface, ref: thread.id,
    text: message, context: { respondingTo: thread.anchor.quote },
  });
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
type CaptureResult = { id: string; kind: 'reading'; url: string } | { id: string; kind: 'word' | 'tutor' };
function isReadingLink(text: string) {
  return /^https?:\/\/\S+$/i.test(text);
}

async function handleHomeCapture(
  s: State, backend: Backend, a: { id: string; text: string; context?: string }, outbox: Outbox, followUpTo?: Message,
) {
  const original = followUpTo?.captureOriginId
    ? s.tutor.find(turn => turn.role === 'user' && turn.id === followUpTo.captureOriginId)
    : followUpTo;
  if (followUpTo && !original) throw new Error('Missing original capture');
  const source = original?.source ?? a.context ?? '';
  const ctx = context(s, 'capture', a.text, 'home', source);
  if (followUpTo && original) {
    const question = s.tutor.find(turn => turn.role === 'assistant' && turn.captureQuestionId === followUpTo.id);
    if (!question) throw new Error('Missing capture clarification');
    ctx.captureFollowUp = { text: original.text, question: question.text,
      previousReply: original === followUpTo ? undefined : followUpTo.text };
  }
  const route = await consult(backend, 'capture', ctx);
  const learner: Message = { role: 'user', id: a.id, text: a.text, source, captureOriginId: original?.id };
  if (route.kind === 'clarify') {
    s.tutor.push(learner, { role: 'assistant', text: route.question, captureQuestionId: a.id });
    return;
  }
  if (route.kind === 'word') {
    const wordContext = [source, original?.text, a.text === route.target ? '' : a.text].filter(Boolean).join('\n');
    addWord(s.wordIntakes, s.saved, { type: 'addWord', id: a.id, text: route.target, context: wordContext });
    outbox.events.push({ id: a.id, at: new Date().toISOString(), kind: 'addWord', surface: 'home', text: route.target, context: { context: wordContext, sent: a.text } });
    const ready = s.wordIntakes.at(-1)?.status === 'ready';
    s.tutor.push(learner, { role: 'assistant', text: ready
      ? route.target + ' is already in your vocabulary.'
      : 'I’ll prepare ' + route.target + ' for vocabulary practice.' });
    return;
  }
  const askContext: TurnContext = { ...ctx, trigger: 'ask' };
  const response = await consult(backend, 'ask', askContext);
  s.tutor.push(learner, { role: 'assistant', text: response.reply, source });
  outbox.events.push({
    id: a.id, at: new Date().toISOString(), kind: 'ask', surface: 'home', text: a.text,
    context: { respondingTo: source.slice(0, 600) || undefined, tutorSaid: response.reply },
  });
  applyAction(s, response.action, askContext);
}

function answerEvent(attempt: Attempt, at: string | null): NewEvent {
  const c = attempt.card;
  return {
    id: attempt.id, at, kind: 'answer', surface: 'practice', ref: c.id, text: attempt.answer,
    context: {
      kind: c.kind, prompt: c.prompt, reference: c.answer, explanation: c.explanation,
      correct: attempt.result.correct, tutorSaid: attempt.result.feedback,
    },
    targets: c.targets ?? [],
  };
}
function choiceJudgment(eventId: string, correct: boolean, targets: string[], at: string): JudgmentRecord {
  const body: ChoiceJudgment = { correct, targets };
  return { id: randomUUID(), eventId, at, source: 'rule:choice-v1', body };
}

async function mutate(
  s: State,
  a: Action,
  backend: Backend,
  reviewImport: ReturnType<typeof createImportReviewer>,
  outbox: Outbox,
) {
  s.notice = '';
  const now = new Date().toISOString();
  switch (a.type) {
    case 'capture':
      if (isReadingLink(a.text)) return;
      return handleHomeCapture(s, backend, a, outbox);
    case 'addWord':
      outbox.events.push({ id: a.id, at: now, kind: 'addWord', surface: 'home', text: a.text, context: { context: a.context } });
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
    case 'captureReading': {
      const { anchor } = a;
      resolveAnchor(s, anchor);
      const existing = s.annotationThreads.find(({ anchor: other }) =>
        other.surface === anchor.surface && other.ownerId === anchor.ownerId &&
        other.startId === anchor.startId && other.startOffset === anchor.startOffset &&
        other.endId === anchor.endId && other.endOffset === anchor.endOffset
      );
      if (existing?.capturedAt && !a.note) return;
      const activity = existing?.capturedAt ? 'Added a note to a passage from ' : 'Saved a passage from ';
      const thread: AnnotationThread = existing ?? { id: a.id, anchor, messages: [] };
      const at = new Date().toISOString();
      thread.capturedAt ??= at;
      if (a.note) thread.messages.push({ role: 'user', text: a.note, at });
      if (!existing) s.annotationThreads.push(thread);
      if (!existing?.capturedAt)
        outbox.events.push({ id: a.id, at, kind: 'capture', surface: 'read', ref: thread.id, text: anchor.quote });
      if (a.note)
        outbox.events.push({ id: a.id + '-note', at, kind: 'annotation', surface: 'read', ref: thread.id, text: a.note, context: { respondingTo: anchor.quote } });
      const reference = annotationReference(s, thread);
      logActivity(s, activity + reference.label, reference.label, reference);
      return;
    }
    case 'annotate': {
      const anchor = anchorForQuote(s, 'read', a.documentId, a.paragraphId, a.quote);
      return postAnnotation(
        s,
        { ...a, type: 'annotationPost', anchor, message: a.text, askTutor: false },
        backend,
        outbox,
      );
    }
    case 'annotationPost':
      return postAnnotation(s, a, backend, outbox);
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
      outbox.events.push({
        id: a.id, at: now, kind: 'chat', surface: 'chat', ref: thread.id, text: a.message,
        context: { topic: thread.title, respondingTo: thread.turns.findLast((m) => m.role === 'assistant')?.text },
      });
      thread.turns.push(
        { id: a.id, role: 'user', text: a.message, source: a.source },
        { id: randomUUID(), role: 'assistant', text: reply, source: a.source },
      );
      return;
    }
    case 'tutor': {
      if ([a.referenceId, a.captureQuestionId, a.wordReplyTo].filter(Boolean).length > 1)
        throw new JournalConflict('Choose one item to reply to.');
      if (a.wordReplyTo) {
        const { intakeId, requestId } = a.wordReplyTo;
        const intake = s.wordIntakes.find(item => item.id === intakeId);
        if (!intake || intake.requestId !== requestId)
          throw new JournalConflict('This word question has changed.');
        resumeWord(s.wordIntakes, { type: 'clarifyWord', id: a.id, intakeId, reply: a.message });
        s.tutor.push({ role: 'user', text: a.message, source: intake.text, wordIntakeId: intakeId, wordRequestId: requestId });
        return;
      }
      if (a.captureQuestionId) {
        const question = s.tutor.find(m => m.role === 'assistant' && m.captureQuestionId === a.captureQuestionId);
        const original = s.tutor.find(m => m.role === 'user' && m.id === a.captureQuestionId);
        if (!question || question.captureResolved || !original)
          throw new JournalConflict('This tutor question is no longer waiting for a reply.');
        await handleHomeCapture(s, backend, { id: a.id, text: a.message }, outbox, original);
        question.captureResolved = true;
        return;
      }
      const anchor = a.referenceId ? resolveReference(s, a.referenceId, a.source) : undefined;
      const ctx = context(s, 'ask', a.message, a.surface, anchor?.source ?? a.source);
      if (anchor?.reference.kind === 'reading') ctx.readingContext = anchor.source;
      const response = await consult(backend, 'ask', ctx);
      outbox.events.push({
        id: a.id, at: now, kind: 'ask', surface: a.surface, ref: a.referenceId, text: a.message,
        context: { respondingTo: ctx.source.slice(0, 600) || undefined, tutorSaid: response.reply },
      });
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
      return startPractice(s, a.mode, backend, !!a.continue, outbox);
    case 'mediaReaction': {
      const item = s.media.find((m) => m.id === a.mediaId);
      if (!item) throw new JournalConflict('This picture is no longer on the board.');
      item.reactions[a.reaction === 'keep' ? 'kept' : 'notForMe'] = new Date().toISOString();
      return;
    }
    case 'settings':
      s.settings.pictures = a.pictures;
      return;
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
      outbox.events.push(answerEvent(s.attempts[s.attempts.length - 1], now));
      if (c.kind === 'choice' && c.targets?.length)
        outbox.judgments.push(choiceJudgment(a.id, correct === true, c.targets, now));
      return;
    }
  }
}

function recordWordOutcome(s: State, intake: WordIntake) {
  let text: string;
  switch (intake.status) {
    case 'clarify':
      if (!intake.question) throw new Error('Missing word question');
      text = intake.question;
      break;
    case 'failed':
      if (!intake.error) throw new Error('Missing word preparation error');
      text = intake.error;
      break;
    case 'ready': {
      const titles = intake.savedIds?.map(id => {
        const item = s.saved.find(item => item.id === id);
        if (!item) throw new Error('Missing prepared word');
        return item.title;
      });
      if (!titles?.length) throw new Error('Word preparation produced no saved items');
      text = 'Ready for vocabulary practice: ' + titles.join('、') + '.';
      break;
    }
    case 'pending':
      throw new Error('Cannot report unfinished word preparation');
  }
  s.tutor.push({ role: 'assistant', text, source: intake.text, wordIntakeId: intake.id, wordRequestId: intake.requestId });
}

// Opens a stored body in the current shape; older journal shapes are upgraded in memory.
function upgrade(body: string): State {
  const parsed = JSON.parse(body) as State & { chat?: Message[] };
  parsed.wordIntakes ??= [];
  // Before word questions lived in the tutor, unresolved requests appeared above the Home bar.
  for (const intake of parsed.wordIntakes) {
    if ((intake.status === 'clarify' || intake.status === 'failed') &&
        !parsed.tutor.some(m => m.role === 'assistant' && m.wordIntakeId === intake.id && m.wordRequestId === intake.requestId)) {
      recordWordOutcome(parsed, intake);
    }
  }
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
  return parsed;
}

/**
 * Earlier journal activity as events. Older shapes kept no time for most of it,
 * so those events carry none. Choice attempts get their rule judgment; the
 * model never reads converted history.
 */
function convertHistory(s: State): Outbox {
  const out: Outbox = { events: [], judgments: [], priority: () => [] };
  for (const thread of s.threads)
    thread.turns.forEach((m, i) => {
      if (m.role !== 'user') return;
      const respondingTo = thread.turns.slice(0, i).findLast((t) => t.role === 'assistant')?.text;
      out.events.push({ id: 'history-chat-' + m.id, at: null, kind: 'chat', surface: 'chat', ref: thread.id, text: m.text, context: { topic: thread.title, respondingTo } });
    });
  s.tutor.forEach((m, i) => {
    if (m.role === 'user') out.events.push({ id: 'history-ask-' + i, at: null, kind: 'ask', surface: 'tutor', text: m.text, context: { respondingTo: m.source?.slice(0, 600) } });
  });
  for (const t of s.annotationThreads) {
    if (t.capturedAt)
      out.events.push({ id: 'history-capture-' + t.id, at: t.capturedAt, kind: 'capture', surface: 'read', ref: t.id, text: t.anchor.quote });
    t.messages.forEach((m, i) => {
      if (m.role === 'user')
        out.events.push({ id: 'history-note-' + t.id + '-' + i, at: m.at ?? null, kind: 'annotation', surface: t.anchor.surface, ref: t.id, text: m.text, context: { respondingTo: t.anchor.quote } });
    });
  }
  for (const attempt of s.attempts) {
    out.events.push(answerEvent(attempt, null));
    if (attempt.card.kind === 'choice' && attempt.card.targets?.length)
      out.judgments.push(choiceJudgment(attempt.id, attempt.result.correct === true, attempt.card.targets, new Date().toISOString()));
  }
  for (const intake of s.wordIntakes)
    out.events.push({ id: 'history-word-' + intake.id, at: null, kind: 'addWord', surface: 'home', text: intake.text, context: { context: intake.context } });
  return out;
}

/** Saved words are targets the learner chose. */
function syncTargets(db: DatabaseSync, s: State) {
  const at = new Date().toISOString();
  for (const item of s.saved)
    if (item.kind === 'Word')
      upsertTarget(db, { form: item.title, gloss: item.word?.meaning ?? item.detail, pinyin: item.word?.pinyin ?? null, origin: 'saved', at });
}

/** The current priority ranking over a journal database. */
export function priorityOf(db: DatabaseSync, now = new Date()) {
  const byId = new Map(recordEvents(db).map((e) => [e.id, e]));
  return rank(recordTargets(db), signalsFrom(recordJudgments(db), byId), now);
}

/**
 * Reads a journal file without opening it for work: no background jobs, no
 * writes. For reports over a live journal or a copy.
 */
export function readJournal(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const row = db.prepare('SELECT body FROM journal WHERE id=1').get();
    if (!row) throw new Error('No journal in ' + path);
    const s = upgrade(String(row.body));
    return { view: publicState(s, engine.mode), mediaDecisions: s.mediaDecisions, mediaJobs: s.mediaJobs };
  } finally {
    db.close();
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
    return { revision: Number(row.revision), s: upgrade(String(row.body)) };
  }
  function record(outbox: Pick<Outbox, 'events' | 'judgments'>) {
    for (const e of outbox.events) appendEvent(db, e);
    for (const j of outbox.judgments) addJudgment(db, j);
  }
  createRecordTables(db);
  // The first open with a record converts earlier activity. Only events from
  // then on are read by the model.
  if (!meta(db, 'judge_from')) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const { s } = read();
      record(convertHistory(s));
      syncTargets(db, s);
      setMeta(db, 'judge_from', new Date().toISOString());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  const judgeFrom = meta(db, 'judge_from')!;
  const noticeSource = backend.mode === 'live' ? 'model:' + (process.env.JOURNAL_MODEL || 'gpt-6.2-sol') + '/notice-v1' : 'demo:notice-v1';
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
                syncTargets(db, latest);
              } catch {
                failure = 'The tutor returned an incomplete word. Try again.';
              }
            }
            if (failure) {
              intake.status = 'failed';
              intake.error = failure;
            }
            recordWordOutcome(latest, intake);
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
  // Reads each new piece of the learner's language, newest first, within a daily
  // limit. A failed read is recorded so it is not retried forever.
  async function prepareNotices() {
    while (!closed) {
      if (backend.mode === 'live' && judgedToday(db) >= NOTICE_DAILY_LIMIT) return;
      const event = nextUnjudged(db, noticeSource, judgeFrom);
      if (!event) return;
      const { s } = read();
      const forms = recordTargets(db).map((t) => t.form);
      const c = event.context as { respondingTo?: string; tutorSaid?: string; kind?: string; prompt?: string; reference?: string; explanation?: string };
      const request: NoticeRequest = {
        kind: event.kind as NoticeRequest['kind'],
        text: event.text,
        respondingTo: c.respondingTo,
        tutorSaid: c.tutorSaid || undefined,
        exercise: event.kind === 'answer' ? { prompt: c.prompt ?? '', reference: c.reference ?? '', explanation: c.explanation ?? '' } : undefined,
        intended: event.targets,
        knownInText: formsIn(event.text, forms),
      };
      const ctx = context(s, 'notice', event.text, event.surface, '');
      ctx.notice = request;
      let body: unknown;
      try {
        body = await consult(backend, 'notice', ctx);
      } catch (error) {
        body = { failed: String((error as Error)?.message ?? error).slice(0, 200) };
      }
      await enqueue(() => {
        if (closed) return;
        db.exec('BEGIN IMMEDIATE');
        try {
          const at = new Date().toISOString();
          addJudgment(db, { id: randomUUID(), eventId: event.id, at, source: noticeSource, body });
          const notice = body as Partial<SituationOutput<'notice'>>;
          // Needs and flawed uses become targets; a natural use only counts toward one that exists.
          for (const need of notice.needs ?? [])
            upsertTarget(db, { form: need.form, kind: need.kind, gloss: need.gloss, origin: 'noticed', at });
          for (const use of notice.uses ?? [])
            if (use.quality === 'flawed') upsertTarget(db, { form: use.form, kind: use.kind, origin: 'noticed', at });
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
  const notices = worker(prepareNotices);
  const wakeWords = words.wake;
  const wakeMedia = media.wake;

  async function perform(a: Action) {
    const hash = createHash('sha256').update(JSON.stringify(a)).digest('hex');
    const old = db.prepare('SELECT fingerprint FROM receipts WHERE id=?').get(a.id);
    const { s, revision } = read();
    // Intake IDs are immutable. Reconstruct the presentation result on receipt
    // replay, even after another action or a background worker has run.
    const result = (): ReturnType<typeof publicState> & { captureResult?: CaptureResult } => {
      const state = publicState(s, backend.mode);
      if (a.type !== 'capture') return state;
      const captureResult: CaptureResult = isReadingLink(a.text)
        ? { id: a.id, kind: 'reading', url: a.text }
        : { id: a.id, kind: s.wordIntakes.some(item => item.id === a.id) ? 'word' : 'tutor' };
      return { ...state, captureResult };
    };
    if (old) {
      if (old.fingerprint !== hash)
        throw new JournalConflict('This action ID already identifies a different request.');
      return result();
    }
    const before = anchorIds(s);
    const outbox: Outbox = { events: [], judgments: [], priority: () => priorityOf(db) };
    await mutate(s, a, backend, reviewImport, outbox);
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
      record(outbox);
      syncTargets(db, s);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    if (s.wordIntakes.some(item => item.status === 'pending')) wakeWords();
    if (s.mediaJobs.some((job) => job.status === 'pending')) wakeMedia();
    if (outbox.events.length) notices.wake();
    return result();
  }
  wakeWords();
  wakeMedia();
  notices.wake();
  return {
    get: () => publicState(read().s, backend.mode),
    /** Whether background word or media work is pending or running. */
    busy() {
      const { s } = read();
      return (
        words.busy() || media.busy() || notices.busy() ||
        (!!nextUnjudged(db, noticeSource, judgeFrom) && (backend.mode !== 'live' || judgedToday(db) < NOTICE_DAILY_LIMIT)) ||
        s.wordIntakes.some((item) => item.status === 'pending') ||
        (s.mediaJobs.some((job) => job.status === 'pending') && ranToday(s) < DAILY_LIMIT && s.settings.pictures !== 'off')
      );
    },
    readingParagraphs(documentId: string) {
      return documentsFor(read().s.reading).find(doc => doc.id === documentId)?.paragraphs;
    },
    act(a: Action) {
      return enqueue(() => perform(a));
    },
    /** What is worth practicing next, with reasons. */
    priority: (now?: Date) => priorityOf(db, now),
    close() {
      closed = true;
      db.close();
    },
  };
}
