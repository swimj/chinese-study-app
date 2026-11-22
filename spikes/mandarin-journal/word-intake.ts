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
  z.object({ kind: z.literal('ready'), words: z.array(wordSchema) }),
  z.object({ kind: z.literal('clarify'), question: z.string(), suggestions: z.array(z.string()) }),
]);
export type WordDecision = z.infer<typeof wordDecisionSchema>;
export type WordContent = Omit<z.infer<typeof wordSchema>, 'title' | 'reuseId'>;
type Saved = { id: string; kind: string; title: string; detail: string; source: string; word?: WordContent };
type Exchange = { question: string; suggestions: string[]; reply: string };
export type WordIntake = {
  id: string;
  text: string;
  context?: string;
  status: 'pending' | 'ready' | 'clarify' | 'failed';
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

export function addWord(intakes: WordIntake[], saved: Saved[], action: z.infer<typeof addWordAction>) {
  const { id, text, context } = action;
  const reusable = reusableWord(saved, text, context);
  intakes.push({
    id,
    text,
    context,
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
  if (!intake.history.length && (decision.words.length !== 1 || decision.words[0].title !== intake.text)) {
    const suggestions = [...new Set(decision.words.map((w) => w.title))];
    if (suggestions.length > 1) suggestions.push(suggestions.join(' + '));
    intake.status = 'clarify';
    intake.question = 'Which expression would you like to study from “' + intake.text + '”?';
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
