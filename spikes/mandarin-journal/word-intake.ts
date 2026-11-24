import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { JournalConflict } from './annotations.ts';

const id = z.string().uuid();
export const addWordAction = z.object({
  type: z.literal('addWord'),
  id,
  text: z.string().trim().min(1).max(320),
  context: z.string().trim().max(2000).optional(),
});
export const clarifyWordAction = z.object({
  type: z.literal('clarifyWord'),
  id,
  intakeId: id,
  reply: z.string().trim().min(1).max(1000),
});
export const retryWordAction = z.object({ type: z.literal('retryWord'), id, intakeId: id });

const wordSchema = z.object({
  title: z.string(),
  pinyin: z.string(),
  meaning: z.string(),
  example: z.string(),
  translation: z.string(),
  reuseId: z.string().nullable(),
});
export const wordDecisionSchema = z.union([
  z.object({
    kind: z.literal('ready'),
    words: z.array(wordSchema),
    /** What the expression means where the learner met it, and its register, for the learner to read first. */
    explanation: z.string(),
    /** Whether a reply to a clarification explicitly asked to save, learn or practice it. */
    saveRequested: z.boolean(),
  }),
  z.object({ kind: z.literal('clarify'), question: z.string(), suggestions: z.array(z.string()) }),
]);
export type WordDecision = z.infer<typeof wordDecisionSchema>;
export type WordContent = Omit<z.infer<typeof wordSchema>, 'title' | 'reuseId'>;
/**
 * ask: the learner brought the item in to find out about it; a judgment decides
 * whether it is also taught. save: they explicitly asked to keep or learn it, which
 * always admits it. Intakes from before this distinction are saves.
 */
export type IntakeIntent = 'ask' | 'save';
type Saved = { id: string; kind: string; title: string; detail: string; source: string; word?: WordContent };
type Exchange = { question: string; suggestions: string[]; reply: string };
export type WordIntake = {
  id: string;
  text: string;
  context?: string;
  status: 'pending' | 'ready' | 'clarify' | 'failed';
  intent?: IntakeIntent;
  history: Exchange[];
  question?: string;
  suggestions?: string[];
  savedIds?: string[];
  error?: string;
  // Identifies this generation across retries, replies and server instances.
  requestId: string;
};
export type WordRequest = Pick<WordIntake, 'text' | 'context' | 'history'> & {
  localWords: { id: string; title: string; detail: string }[];
};

function matchingWords(saved: Saved[], title: string) {
  return saved.filter((item) => item.kind === 'Word' && item.title === title && item.detail.trim());
}

export function reusableWord(saved: Saved[], text: string, context?: string) {
  const existing = matchingWords(saved, text);
  if (existing.length === 1 && existing[0].word && (!context || context === existing[0].source))
    return existing[0];
}

/**
 * Starts an intake. An existing word is reused at once only for an explicit save;
 * an ask always goes to the tutor, which explains it first.
 */
export function addWord(
  intakes: WordIntake[], saved: Saved[], action: z.infer<typeof addWordAction>, intent: IntakeIntent = 'save',
) {
  const { id, text, context } = action;
  const reusable = intent === 'save' && reusableWord(saved, text, context);
  intakes.push({
    id,
    text,
    context,
    intent,
    status: reusable ? 'ready' : 'pending',
    savedIds: reusable ? [reusable.id] : undefined,
    history: [],
    requestId: id,
  });
}

export function resumeWord(
  intakes: WordIntake[],
  action: z.infer<typeof clarifyWordAction | typeof retryWordAction>,
) {
  const item = intakes.find((item) => item.id === action.intakeId);
  if (!item) throw new JournalConflict('This word request is unavailable.');
  if (action.type === 'clarifyWord') {
    if (item.status !== 'clarify' || !item.question)
      throw new JournalConflict('This word no longer needs a reply.');
    item.history.push({ question: item.question, suggestions: item.suggestions ?? [], reply: action.reply });
  } else if (item.status !== 'failed') {
    throw new JournalConflict('This word is no longer waiting for a retry.');
  }
  delete item.question;
  delete item.suggestions;
  delete item.error;
  item.status = 'pending';
  item.requestId = action.id;
}

export function wordRequest(intake: WordIntake, saved: Saved[]): WordRequest {
  const { text, context, history } = intake;
  const evidence = [
    text,
    context,
    ...history.flatMap((exchange) => [...exchange.suggestions, exchange.reply]),
  ].join(' ');
  const localWords = saved
    .filter((item) => item.kind === 'Word' && item.detail.trim() && evidence.includes(item.title))
    .map(({ id, title, detail }) => ({ id, title, detail }));
  return { text, context, history, localWords };
}

/** Whether a ready decision still needs the learner to choose among expressions. */
export function needsChoice(intake: Pick<WordIntake, 'history' | 'text'>, decision: WordDecision) {
  return decision.kind === 'ready' && !intake.history.length && (decision.words.length !== 1 || decision.words[0].title !== intake.text);
}

/** Whether this intake is an explicit save: the learner's submission, or a reply to a clarification, asked to keep it. */
export function isExplicitSave(intake: Pick<WordIntake, 'intent' | 'history'>, decision?: WordDecision) {
  return intake.intent !== 'ask' || (!!intake.history.length && decision?.kind === 'ready' && decision.saveRequested);
}

/** A reused word's explanation, from what was prepared when it was first saved. */
export function describeSaved(item: Saved) {
  const w = item.word;
  return w ? `${item.title} (${w.pinyin}): ${w.meaning}\n${w.example} ${w.translation}` : `${item.title}: ${item.detail}`;
}

/** The tutor's reply to a finished intake: the explanation first, then one line on practice only if admitted. */
export function intakeReply(explanation: string, admittedTitles: string[]) {
  const text = explanation.trim();
  if (!text) throw new Error('An intake reply needs its explanation');
  return admittedTitles.length ? text + '\n\nI’ll also bring ' + admittedTitles.join('、') + ' into practice.' : text;
}

export function finishWord(intake: WordIntake, saved: Saved[], decision: WordDecision) {
  if (decision.kind === 'clarify') {
    if (
      !decision.question.trim() ||
      decision.suggestions.length > 5 ||
      decision.suggestions.some((s) => !s.trim() || s.length > 1000)
    )
      throw new Error('Incomplete word clarification');
    intake.status = 'clarify';
    intake.question = decision.question.trim();
    intake.suggestions = [...new Set(decision.suggestions)];
    return;
  }
  if (!decision.words.length || decision.words.length > 6)
    throw new Error('Invalid number of lexical targets');
  if (!decision.explanation.trim()) throw new Error('A ready word needs its explanation');
  for (const w of decision.words) {
    if (
      ![w.title, w.pinyin, w.meaning, w.example, w.translation].every((field) => field.trim()) ||
      !w.example.includes(w.title) ||
      !/\p{Script=Han}/u.test(w.title)
    )
      throw new Error('Incomplete contextual word');
    if (w.reuseId && !matchingWords(saved, w.title).some((item) => item.id === w.reuseId))
      throw new Error('Invalid local word reference');
  }
  if (needsChoice(intake, decision)) {
    const suggestions = [...new Set(decision.words.map((w) => w.title))];
    if (suggestions.length > 1) suggestions.push(suggestions.join(' + '));
    intake.status = 'clarify';
    intake.question = 'Which expression in “' + intake.text + '” do you mean?';
    intake.suggestions = suggestions;
    return;
  }
  const savedIds = new Set<string>();
  for (const { title, reuseId, ...word } of decision.words) {
    const detail = word.pinyin + ' · ' + word.meaning + '\n' + word.example + ' ' + word.translation;
    const matches = matchingWords(saved, title);
    const previous = matches.find((item) => item.id === reuseId || item.detail === detail);
    if (previous) {
      previous.word ??= word;
      savedIds.add(previous.id);
    } else {
      const item = {
        id: randomUUID(),
        kind: 'Word',
        title,
        detail,
        source: intake.context || intake.text,
        word,
      };
      saved.push(item);
      savedIds.add(item.id);
    }
  }
  intake.savedIds = [...savedIds];
  intake.status = 'ready';
}

export class OfflineWordUnavailable extends Error {}
