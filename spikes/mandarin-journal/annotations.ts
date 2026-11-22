import { z } from 'zod';
import { documentsFor, type ReadingState, type Annotation } from './reading.ts';

export class JournalConflict extends Error {}

const key = z.string().min(1);
export const anchorSchema = z.object({
  surface: z.enum(['read', 'chat']),
  ownerId: key,
  startId: key,
  endId: key,
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().nonnegative(),
  quote: z.string().min(1),
});
export type Anchor = z.infer<typeof anchorSchema>;
export type AnnotationMessage = { role: 'user' | 'assistant'; text: string; at?: string };
export type AnnotationThread = { id: string; anchor: Anchor; messages: AnnotationMessage[] };
type Block = { id: string; text: string; role?: AnnotationMessage['role'] };
type Conversation = { id: string; title: string; turns: Block[] };

type Sources = { threads: Conversation[]; reading: ReadingState };

function owner(
  sources: Sources,
  surface: Anchor['surface'],
  ownerId: string,
): { title: string; blocks: Block[] } {
  if (surface === 'read') {
    const doc = documentsFor(sources.reading).find((d) => d.id === ownerId);
    if (doc) return { title: doc.title, blocks: doc.paragraphs };
  } else {
    const chat = sources.threads.find((c) => c.id === ownerId);
    if (chat) return { title: chat.title, blocks: chat.turns };
  }
  throw new JournalConflict('This annotation source is unavailable.');
}

// DOM Range and String.slice both count UTF-16 code units.
function validOffset(text: string, offset: number) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length) return false;
  // At a boundary inside a surrogate pair, the preceding code unit starts a supplementary character.
  return offset === 0 || text.codePointAt(offset - 1)! <= 0xffff;
}

export function resolveAnchor(sources: Sources, anchor: Anchor) {
  const { title, blocks } = owner(sources, anchor.surface, anchor.ownerId);
  const first = blocks.findIndex((block) => block.id === anchor.startId);
  const last = blocks.findIndex((block) => block.id === anchor.endId);
  if (
    first < 0 ||
    last < first ||
    !validOffset(blocks[first].text, anchor.startOffset) ||
    !validOffset(blocks[last].text, anchor.endOffset)
  ) {
    throw new JournalConflict('This selection is outside its source.');
  }
  const selected = blocks.slice(first, last + 1);
  const quote = selected
    .map((block, i) =>
      block.text.slice(
        i === 0 ? anchor.startOffset : 0,
        i === selected.length - 1 ? anchor.endOffset : undefined,
      ),
    )
    .join('\n');
  if (!quote.trim() || quote !== anchor.quote)
    throw new JournalConflict('The selected text does not match its source.');
  return { title, blocks: selected };
}

// Older bookmarks and reflection results identify one block and a quote, without offsets.
export function anchorForQuote(
  sources: Sources,
  surface: Anchor['surface'],
  ownerId: string,
  blockId: string,
  selected: string,
): Anchor {
  const block = owner(sources, surface, ownerId).blocks.find((entry) => entry.id === blockId);
  if (!block) throw new JournalConflict('This annotation source is unavailable.');
  const quote = selected || block.text;
  const startOffset = block.text.indexOf(quote);
  if (startOffset < 0) throw new JournalConflict('The selected text does not match its source.');
  return {
    surface,
    ownerId,
    startId: blockId,
    endId: blockId,
    startOffset,
    endOffset: startOffset + quote.length,
    quote,
  };
}

export function describeAnnotation(sources: Sources, { anchor, messages }: AnnotationThread) {
  const { title, blocks } = resolveAnchor(sources, anchor);
  return [
    title,
    ...blocks.map((b) =>
      b.role ? (b.role === 'user' ? 'Learner: ' : 'Conversation partner: ') + b.text : b.text,
    ),
    'Selected text: ' + anchor.quote,
    ...messages.map((m) => (m.role === 'user' ? 'Learner annotation: ' : 'Tutor annotation: ') + m.text),
  ].join('\n');
}

export function readingNotes(threads: AnnotationThread[]): Annotation[] {
  return threads
    .filter((t) => t.anchor.surface === 'read')
    .map(({ id, anchor, messages }) => ({
      id,
      documentId: anchor.ownerId,
      paragraphId: anchor.startId,
      quote: anchor.quote,
      text: messages[0].text,
    }));
}
