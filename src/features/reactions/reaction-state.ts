import { shortcutEventBlocked, type ShortcutKeyEvent } from '../../lib/keyboard';
import { NOT_FOR_ME_REASONS, type ContentReaction, type ContentReactionState, type NotForMeReason } from '../../domain/content-reactions';

/** The learner-chosen part of a reaction; subject and surface are added by the caller. */
export type ReactionChoice = { reaction: ContentReaction | null; reasons: NotForMeReason[]; note: string | null };

export const NO_REACTION: ReactionChoice = { reaction: null, reasons: [], note: null };

export function choiceOf(state: ContentReactionState | null | undefined): ReactionChoice {
  return state ? { reaction: state.reaction, reasons: state.reasons, note: state.note } : NO_REACTION;
}

/** Save and Not for me are exclusive toggles; switching drops the other's reasons or note. */
export function toggleSaved(current: ReactionChoice): ReactionChoice {
  return current.reaction === 'saved' ? NO_REACTION : { reaction: 'saved', reasons: [], note: null };
}
export function toggleNotForMe(current: ReactionChoice): ReactionChoice {
  return current.reaction === 'not_for_me' ? NO_REACTION : { reaction: 'not_for_me', reasons: [], note: null };
}
export function toggleReason(current: ReactionChoice, reason: NotForMeReason): ReactionChoice {
  if (current.reaction !== 'not_for_me') throw new Error('Reasons apply only to a Not for me reaction.');
  const next = current.reasons.includes(reason) ? current.reasons.filter((value) => value !== reason) : [...current.reasons, reason];
  return { ...current, reasons: NOT_FOR_ME_REASONS.filter((value) => next.includes(value)) };
}
export function withNote(current: ReactionChoice, note: string): ReactionChoice {
  if (current.reaction !== 'saved') throw new Error('Notes apply only to saved items.');
  return { ...current, note: note.trim() ? note : null };
}

/** S saves and X marks Not for me on the item in focus. */
export function reactionShortcut(event: ShortcutKeyEvent, editing: boolean): 'save' | 'not_for_me' | null {
  if (editing || shortcutEventBlocked(event) || event.shiftKey) return null;
  const key = event.key.toLowerCase();
  return key === 's' ? 'save' : key === 'x' ? 'not_for_me' : null;
}
