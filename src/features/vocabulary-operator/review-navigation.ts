import { shortcutEventBlocked, type ShortcutKeyEvent } from '../../lib/keyboard';
import type { VocabularyContentProposal, VocabularyReflectionCase } from '../../domain/vocabulary-reflection';

export type ReviewItem = { kind: 'proposal'; value: VocabularyContentProposal } | { kind: 'case'; value: VocabularyReflectionCase };
export function reviewItemKey(item: ReviewItem): string {
  return item.kind === 'proposal' ? `proposal:${item.value.proposalId}` : `case:${item.value.caseId}`;
}

export function resolveReviewNavigation(event: ShortcutKeyEvent, context: {
  index: number; count: number; busy: boolean; nativeTarget: boolean;
}): number | null {
  if (shortcutEventBlocked(event) || event.shiftKey || context.busy || context.nativeTarget || !context.count) return null;
  const next = event.key === 'ArrowLeft' ? context.index - 1
    : event.key === 'ArrowRight' ? context.index + 1 : null;
  return next !== null && next >= 0 && next < context.count ? next : null;
}

/** Resolution time controls the default window; a search spans the retained archive. */
export function filterArchiveItems(items: ReviewItem[], query: string, now = Date.now()): ReviewItem[] {
  const search = query.trim().toLocaleLowerCase();
  return items.filter(item => {
    if (search) return JSON.stringify(item.value).toLocaleLowerCase().includes(search);
    const resolved = item.value.resolvedAt ? Date.parse(item.value.resolvedAt) : NaN;
    return resolved >= now - 12 * 60 * 60 * 1000 && resolved <= now;
  }).sort((a, b) => (Date.parse(b.value.resolvedAt ?? '') || 0) - (Date.parse(a.value.resolvedAt ?? '') || 0));
}
