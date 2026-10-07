import { useCallback, useEffect, useRef } from 'react';
import type { WhatsNewPost } from '../domain/whats-new';
import type { WhatsNewCatalog } from '../features/attention/useWhatsNewCatalog';
import { useVisibleAcknowledgement } from '../features/attention/useVisibleAcknowledgement';

export function formatWhatsNewDate(date: string) {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

function WhatsNewArticle({ post, onRead, focus }: {
  post: WhatsNewPost; onRead?: (postIds: string[]) => Promise<void>; focus?: boolean;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const acknowledge = useCallback(async () => { await onRead?.([post.id]); }, [onRead, post.id]);
  useVisibleAcknowledgement(headingRef, onRead ? acknowledge : undefined);
  useEffect(() => { if (focus) headingRef.current?.focus(); }, [focus, post.id]);
  return <article className="about-update" aria-labelledby={`update-${post.id}`}>
    <time className="notes" dateTime={post.date}>{formatWhatsNewDate(post.date)}</time>
    <h2 ref={headingRef} tabIndex={focus ? -1 : undefined} id={`update-${post.id}`}>{post.title}</h2>
    {post.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
  </article>;
}

export function WhatsNewPosts({ posts, onRead, focus = false }: {
  posts: readonly WhatsNewPost[]; onRead?: (postIds: string[]) => Promise<void>; focus?: boolean;
}) {
  return <div className="about-updates">{posts.map(post => <WhatsNewArticle key={post.id} post={post} onRead={onRead} focus={focus} />)}</div>;
}

export function WhatsNewFeed({ catalog, onRead, selectedPostId, onViewAll }: {
  catalog: WhatsNewCatalog;
  onRead?: (postIds: string[]) => Promise<void>;
  selectedPostId?: string | null;
  onViewAll?: () => void;
}) {
  const { posts, error, retry } = catalog;
  const displayed = selectedPostId ? posts?.filter(post => post.id === selectedPostId) : posts;
  return <>
    {selectedPostId && onViewAll ? <button type="button" className="secondary-button" onClick={onViewAll}>← All updates</button> : null}
    {posts === null && !error ? <p role="status">Loading updates…</p> : null}
    {error ? <div role="alert"><p>{error}</p><button type="button" className="secondary-button" onClick={retry}>Retry loading updates</button></div> : null}
    {displayed ? displayed.length ? <WhatsNewPosts posts={displayed} onRead={onRead} focus={Boolean(selectedPostId)} />
      : <p>{selectedPostId ? 'This update is no longer available.' : 'No updates yet.'}</p> : null}
  </>;
}
