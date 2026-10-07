import type { WhatsNewPost } from '../../domain/whats-new';

export function latestWhatsNewSequence(posts: readonly WhatsNewPost[]): number {
  return posts.reduce((latest, post) => Math.max(latest, post.publicationSequence ?? 0), 0);
}

export function countUnseenWhatsNew(posts: readonly WhatsNewPost[], seenThroughSequence: number | null): number {
  if (seenThroughSequence === null) return 0;
  return posts.filter((post) => post.publicationSequence !== null && post.publicationSequence > seenThroughSequence).length;
}
