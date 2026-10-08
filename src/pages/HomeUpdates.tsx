import { useCallback, useRef } from 'react';
import type { WhatsNewPost } from '../domain/whats-new';
import type { WhatsNewCatalog } from '../features/attention/useWhatsNewCatalog';
import { useVisibleAcknowledgement } from '../features/attention/useVisibleAcknowledgement';
import { formatWhatsNewDate } from './WhatsNewFeed';

function UnseenMarker({ postId, onVisible }: { postId: string; onVisible: (postIds: string[]) => Promise<void> }) {
  const markerRef = useRef<HTMLSpanElement | null>(null);
  const acknowledge = useCallback(() => onVisible([postId]), [onVisible, postId]);
  useVisibleAcknowledgement(markerRef, acknowledge);
  return <span ref={markerRef} className="home-update-unseen" aria-label="Unread update">New</span>;
}

export function UpdatePreviews({ posts, unseenPostIds = [], onUnseenBadgeVisible = async () => {}, onOpenPost }: {
  posts: readonly WhatsNewPost[];
  unseenPostIds?: readonly string[];
  onUnseenBadgeVisible?: (postIds: string[]) => Promise<void>;
  onOpenPost: (id: string) => void;
}) {
  const unseen = new Set(unseenPostIds);
  return <ul className="home-update-list">{posts.map(post => <li key={post.id}>
    <button type="button" className="home-update-preview" onClick={() => onOpenPost(post.id)}>
      <time dateTime={post.date}>{formatWhatsNewDate(post.date)}</time>
      <span className="home-update-title">{post.title} <span aria-hidden="true">↗</span>
        {unseen.has(post.id) ? <UnseenMarker postId={post.id} onVisible={onUnseenBadgeVisible} /> : null}
      </span>
      <span className="home-update-summary">{post.summary}</span>
    </button>
  </li>)}</ul>;
}

export function HomeUpdatesCollapsedControl({ unseenPostIds, onVisible, onExpand }: {
  unseenPostIds: readonly string[];
  onVisible: (postIds: string[]) => Promise<void>;
  onExpand: () => void;
}) {
  const badgeRef = useRef<HTMLSpanElement | null>(null);
  const acknowledge = useCallback(() => onVisible([...unseenPostIds]), [onVisible, unseenPostIds]);
  useVisibleAcknowledgement(badgeRef, unseenPostIds.length ? acknowledge : undefined, unseenPostIds.length > 0);
  return <div className="home-updates-collapsed-control">
    <button type="button" className="home-updates-show" aria-expanded="false" onClick={onExpand}>
      <span>What’s new</span>
      {unseenPostIds.length ? <span ref={badgeRef} className="home-updates-count" aria-label={`${unseenPostIds.length} unread updates`}>{unseenPostIds.length}</span> : null}
      <span className="home-updates-show-action">Show →</span>
    </button>
  </div>;
}

export function HomeUpdates({ catalog, unseenPostIds = [], onUnseenBadgeVisible = async () => {}, onOpenPost, onViewAll, onCollapse = () => {} }: {
  catalog: WhatsNewCatalog;
  unseenPostIds?: readonly string[];
  onUnseenBadgeVisible?: (postIds: string[]) => Promise<void>;
  onOpenPost: (id: string) => void;
  onViewAll: () => void;
  onCollapse?: () => void;
}) {
  const { posts, error, retry } = catalog;
  return <aside className="home-updates" aria-labelledby="home-updates-title">
    <div className="home-updates-heading">
      <h2 id="home-updates-title">Updates</h2>
      <div className="home-updates-actions">
        <button type="button" className="home-updates-all" onClick={onViewAll}>View all <span aria-hidden="true">→</span></button>
        <button type="button" className="home-updates-collapse" aria-expanded="true" onClick={onCollapse}>Hide updates</button>
      </div>
    </div>
    {posts === null && !error ? <p className="notes" role="status">Loading updates…</p> : null}
    {error ? <p className="notes" role="status">Couldn’t refresh updates. <button type="button" className="secondary-button" onClick={retry}>Try again</button></p> : null}
    {posts !== null && (posts.length ? <UpdatePreviews posts={posts.slice(0, 4)} unseenPostIds={unseenPostIds}
      onUnseenBadgeVisible={onUnseenBadgeVisible} onOpenPost={onOpenPost} /> : <p className="notes">No updates yet.</p>)}
  </aside>;
}
