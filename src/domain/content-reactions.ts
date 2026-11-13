/** Learner reactions to app-written connections and feedback lessons. */
export const CONTENT_REACTIONS = ['saved', 'not_for_me'] as const;
export type ContentReaction = typeof CONTENT_REACTIONS[number];

export const NOT_FOR_ME_REASONS = ['wrong', 'already_knew', 'not_interesting', 'too_long', 'confusing'] as const;
export type NotForMeReason = typeof NOT_FOR_ME_REASONS[number];
export const NOT_FOR_ME_REASON_LABELS: Record<NotForMeReason, string> = {
  wrong: 'Wrong',
  already_knew: 'Already knew',
  not_interesting: 'Not interesting',
  too_long: 'Too long',
  confusing: 'Confusing',
};

export const REACTION_SURFACES = ['home', 'feedback', 'saved'] as const;
export type ReactionSurface = typeof REACTION_SURFACES[number];

export type ReactionSubject =
  | { kind: 'connection'; sessionId: string; noteIndex: number }
  | { kind: 'lesson'; messageId: string };

export type ContentReactionState = {
  subject: ReactionSubject;
  reaction: ContentReaction;
  reasons: NotForMeReason[];
  note: string | null;
  updatedAt: string;
};

/** Full desired state for one subject; `reaction: null` clears it. */
export type ContentReactionInput = {
  subject: ReactionSubject;
  reaction: ContentReaction | null;
  reasons: NotForMeReason[];
  note: string | null;
  surface: ReactionSurface;
};

export const MAX_REACTION_NOTE_LENGTH = 1000;

export class ContentReactionInputError extends Error {}

export function reactionSubjectKey(subject: ReactionSubject): string {
  return subject.kind === 'connection' ? `connection:${subject.sessionId}#${subject.noteIndex}` : `lesson:${subject.messageId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function fail(message: string): never { throw new ContentReactionInputError(message); }
function onlyKeys(value: Record<string, unknown>, keys: string[], label: string): void {
  const extra = Object.keys(value).find((key) => !keys.includes(key));
  if (extra) fail(`Unexpected ${label} field: ${extra}`);
}
function nonEmptyId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) fail(`Expected ${label}`);
  return value;
}

export function parseReactionSubject(value: unknown): ReactionSubject {
  if (!isRecord(value)) fail('Expected reaction subject');
  if (value.kind === 'connection') {
    onlyKeys(value, ['kind', 'sessionId', 'noteIndex'], 'subject');
    const noteIndex = value.noteIndex;
    if (typeof noteIndex !== 'number' || !Number.isInteger(noteIndex) || noteIndex < 0 || noteIndex > 99) fail('Expected connection noteIndex');
    return { kind: 'connection', sessionId: nonEmptyId(value.sessionId, 'connection sessionId'), noteIndex };
  }
  if (value.kind === 'lesson') {
    onlyKeys(value, ['kind', 'messageId'], 'subject');
    return { kind: 'lesson', messageId: nonEmptyId(value.messageId, 'lesson messageId') };
  }
  return fail('Expected subject kind connection or lesson');
}

export function parseContentReactionInput(value: unknown): ContentReactionInput {
  if (!isRecord(value)) fail('Expected reaction body');
  onlyKeys(value, ['subject', 'reaction', 'reasons', 'note', 'surface'], 'reaction');
  const subject = parseReactionSubject(value.subject);
  const reaction = value.reaction;
  if (reaction !== null && !CONTENT_REACTIONS.includes(reaction as ContentReaction)) fail('Expected reaction saved, not_for_me or null');
  const rawReasons = value.reasons ?? [];
  if (!Array.isArray(rawReasons) || rawReasons.some((reason) => !NOT_FOR_ME_REASONS.includes(reason as NotForMeReason))
    || new Set(rawReasons).size !== rawReasons.length) fail('Expected distinct known reasons');
  const reasons = NOT_FOR_ME_REASONS.filter((reason) => rawReasons.includes(reason));
  if (reasons.length && reaction !== 'not_for_me') fail('Reasons apply only to not_for_me');
  const rawNote = value.note ?? null;
  if (rawNote !== null && (typeof rawNote !== 'string' || rawNote.length > MAX_REACTION_NOTE_LENGTH)) fail('Expected note text of at most 1000 characters');
  const note = typeof rawNote === 'string' && rawNote.trim() ? rawNote : null;
  if (note !== null && reaction !== 'saved') fail('Notes apply only to saved items');
  const surface = value.surface;
  if (!REACTION_SURFACES.includes(surface as ReactionSurface)) fail('Expected reaction surface');
  return { subject, reaction: reaction as ContentReaction | null, reasons, note, surface: surface as ReactionSurface };
}

/** A saved-collection connection: one immutable note with its referenced words. */
export type SavedConnection = {
  sessionId: string;
  noteIndex: number;
  completedAt: string;
  text: string;
  words: Array<{ word: string; pinyin: string }>;
  reaction: ContentReactionState | null;
};
export type SavedLesson = {
  messageId: string;
  subjectLabel: string;
  body: unknown;
  createdAt: string;
  reaction: ContentReactionState;
};
export type SavedCollection = { connections: SavedConnection[]; lessons: SavedLesson[] };

export type ContentReactionSummary = {
  totals: Array<{ kind: ReactionSubject['kind']; reaction: ContentReaction; count: number }>;
  reasons: Array<{ kind: ReactionSubject['kind']; reason: NotForMeReason; count: number }>;
  connectionsByPrompt: Array<{ promptVersion: string; model: string; notes: number; saved: number; notForMe: number }>;
  flaggedWrong: Array<{ kind: ReactionSubject['kind']; learnerId: string; at: string; label: string; text: string }>;
};
