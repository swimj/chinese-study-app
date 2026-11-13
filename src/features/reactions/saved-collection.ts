import { reactionSubjectKey, type ContentReactionState, type ReactionSubject, type SavedCollection } from '../../domain/content-reactions';

export type SavedView = 'saved' | 'connections';

export type SavedItem =
  | { kind: 'connection'; key: string; subject: ReactionSubject; at: string; text: string; words: Array<{ word: string; pinyin: string }> }
  | { kind: 'lesson'; key: string; subject: ReactionSubject; at: string; label: string; body: unknown };

export type SavedGroup = { key: string; label: string; items: SavedItem[] };

export function savedItems(collection: SavedCollection): SavedItem[] {
  return [
    ...collection.connections.map((note): SavedItem => {
      const subject: ReactionSubject = { kind: 'connection', sessionId: note.sessionId, noteIndex: note.noteIndex };
      return { kind: 'connection', key: reactionSubjectKey(subject), subject, at: note.completedAt, text: note.text, words: note.words };
    }),
    ...collection.lessons.map((lesson): SavedItem => {
      const subject: ReactionSubject = { kind: 'lesson', messageId: lesson.messageId };
      return { kind: 'lesson', key: reactionSubjectKey(subject), subject, at: lesson.createdAt, label: lesson.subjectLabel, body: lesson.body };
    }),
  ].sort((a, b) => b.at.localeCompare(a.at) || a.key.localeCompare(b.key));
}

/** Keys saved when the page loaded; items un-saved during a visit stay listed so the choice can be undone. */
export function initiallySaved(collection: SavedCollection): Set<string> {
  return new Set([...collection.connections, ...collection.lessons]
    .flatMap((item) => item.reaction?.reaction === 'saved' ? [reactionSubjectKey(item.reaction.subject)] : []));
}

export function visibleItems(items: SavedItem[], view: SavedView, listed: ReadonlySet<string>,
  states: ReadonlyMap<string, ContentReactionState>, word: string | null): SavedItem[] {
  return items.filter((item) => view === 'connections'
    ? item.kind === 'connection'
    : listed.has(item.key) || states.get(item.key)?.reaction === 'saved')
    .filter((item) => word === null || (item.kind === 'connection' && item.words.some((entry) => entry.word === word)));
}

/** Saved items group by month; all connections group by their session day (UTC date keys, local labels). */
export function groupItems(items: SavedItem[], view: SavedView, locale?: string): SavedGroup[] {
  const groups: SavedGroup[] = [];
  for (const item of items) {
    const date = new Date(item.at);
    const key = view === 'saved' ? item.at.slice(0, 7) : item.at.slice(0, 10);
    const label = view === 'saved'
      ? date.toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' })
      : date.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    const last = groups[groups.length - 1];
    if (last?.key === key) last.items.push(item); else groups.push({ key, label, items: [item] });
  }
  return groups;
}

/** Fisher–Yates order for the one-at-a-time view. */
export function shuffled<T>(values: readonly T[], random: () => number = Math.random): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}
