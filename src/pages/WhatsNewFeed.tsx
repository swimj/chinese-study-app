import { useCallback, useEffect, useState } from 'react';
import type { WhatsNewPost } from '../domain/whats-new';
import { latestWhatsNewSequence } from '../features/attention/whats-new-attention';
import { fetchWhatsNew } from '../services/api';

export function WhatsNewPosts({ posts }: { posts: readonly WhatsNewPost[] }) {
  return <div className="about-updates">{posts.map((post) => <article className="about-update" key={post.id} aria-labelledby={`update-${post.id}`}>
    <time className="notes" dateTime={post.date}>{new Intl.DateTimeFormat('en-US', {
      year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
    }).format(new Date(`${post.date}T00:00:00Z`))}</time>
    <h2 id={`update-${post.id}`}>{post.title}</h2>
    {post.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
  </article>)}</div>;
}

export function WhatsNewFeed({ onDisplayed }: { onDisplayed?: (throughSequence: number) => Promise<void> }) {
  const [posts, setPosts] = useState<WhatsNewPost[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const acknowledge = useCallback((loaded: WhatsNewPost[]) => {
    if (onDisplayed) void onDisplayed(latestWhatsNewSequence(loaded)).catch(() => undefined);
  }, [onDisplayed]);

  useEffect(() => {
    let active = true;
    let request = 0;
    async function load() {
      const current = ++request;
      try {
        const feed = await fetchWhatsNew();
        if (active && current === request) { setPosts(feed.posts); setError(null); }
      } catch (err) {
        if (active && current === request) setError(err instanceof Error ? err.message : 'Failed to load updates');
      }
    }
    void load();
    function onFocus() { void load(); }
    function onVisibility() { if (document.visibilityState === 'visible') void load(); }
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      active = false;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [retry]);

  // This effect runs after the fetched feed has been rendered. Its snapshot is the
  // acknowledgement boundary, even when another post is published concurrently.
  useEffect(() => { if (posts !== null) acknowledge(posts); }, [posts, acknowledge]);

  return <>
    {posts === null && !error ? <p role="status">Loading updates…</p> : null}
    {error ? <div role="alert"><p>{error}</p><button type="button" className="secondary-button" onClick={() => setRetry((value) => value + 1)}>Retry loading updates</button></div> : null}
    {posts !== null ? posts.length ? <WhatsNewPosts posts={posts} /> : <p>No updates yet.</p> : null}
  </>;
}
