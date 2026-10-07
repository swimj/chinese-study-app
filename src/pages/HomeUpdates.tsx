import type { WhatsNewPost } from '../domain/whats-new';
import type { WhatsNewCatalog } from '../features/attention/useWhatsNewCatalog';
import { formatWhatsNewDate } from './WhatsNewFeed';

export function UpdatePreviews({ posts, onOpenPost }: {
  posts: readonly WhatsNewPost[]; onOpenPost: (id: string) => void;
}) {
  return <ul className="home-update-list">{posts.map(post => <li key={post.id}>
    <button type="button" className="home-update-preview" onClick={() => onOpenPost(post.id)}>
      <time dateTime={post.date}>{formatWhatsNewDate(post.date)}</time>
      <span className="home-update-title">{post.title} <span aria-hidden="true">↗</span></span>
      <span className="home-update-summary">{post.summary}</span>
    </button>
  </li>)}</ul>;
}

export function HomeUpdates({ catalog, onOpenPost, onViewAll }: {
  catalog: WhatsNewCatalog;
  onOpenPost: (id: string) => void; onViewAll: () => void;
}) {
  const { posts, error, retry } = catalog;
  return <aside className="home-updates" aria-labelledby="home-updates-title">
    <div className="home-updates-heading"><h2 id="home-updates-title">Updates</h2>
      <button type="button" className="home-updates-all" onClick={onViewAll}>View all <span aria-hidden="true">→</span></button>
    </div>
    {posts === null && !error ? <p className="notes" role="status">Loading updates…</p> : null}
    {error ? <p className="notes" role="status">Couldn’t refresh updates. <button type="button" className="secondary-button" onClick={retry}>Try again</button></p> : null}
    {posts !== null && (posts.length ? <UpdatePreviews posts={posts.slice(0, 4)} onOpenPost={onOpenPost} /> : <p className="notes">No updates yet.</p>)}
  </aside>;
}
