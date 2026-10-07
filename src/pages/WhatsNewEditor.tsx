import { useEffect, useState } from 'react';
import type { WhatsNewPost } from '../domain/whats-new';
import { fetchOperatorWhatsNew, saveOperatorWhatsNew } from '../services/api';
import { WhatsNewPosts } from './WhatsNewFeed';
import './WhatsNewEditor.css';

type EditorFields = { id: string; date: string; title: string; body: string };
function newFields(): EditorFields {
  return { id: '', date: new Date().toISOString().slice(0, 10), title: '', body: '' };
}
function fieldsFor(post: WhatsNewPost): EditorFields {
  return { id: post.id, date: post.date, title: post.title, body: post.paragraphs.join('\n\n') };
}
export function splitBlogParagraphs(body: string): string[] {
  return body.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
}

export function WhatsNewEditor() {
  const [posts, setPosts] = useState<WhatsNewPost[]>([]);
  const [selected, setSelected] = useState<WhatsNewPost | null>(null);
  const [fields, setFields] = useState<EditorFields>(newFields);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const dirty = JSON.stringify(fields) !== JSON.stringify(selected ? fieldsFor(selected) : newFieldsWithDate(fields.date));
  useEffect(() => {
    let active = true;
    setLoading(true);
    void fetchOperatorWhatsNew().then((feed) => {
      if (active) { setPosts(feed.posts); setError(null); }
    }).catch((err: unknown) => {
      if (active) setError(err instanceof Error ? err.message : 'Failed to load posts');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload]);

  function select(post: WhatsNewPost | null) {
    setSelected(post); setFields(post ? fieldsFor(post) : newFields()); setMessage(null); setError(null);
  }
  async function save(status: 'draft' | 'published') {
    setSaving(true); setMessage(null); setError(null);
    try {
      const post = await saveOperatorWhatsNew({
        id: fields.id.trim(), expectedRevision: selected?.revision ?? null,
        date: fields.date, title: fields.title.trim(), paragraphs: splitBlogParagraphs(fields.body), status,
        sourceFrom: selected?.sourceFrom ?? null, sourceThrough: selected?.sourceThrough ?? null,
      });
      setPosts((previous) => [post, ...previous.filter((item) => item.id !== post.id)]);
      setSelected(post); setFields(fieldsFor(post));
      setMessage(post.status === 'published' ? 'Saved. This post is visible in What’s New.' : 'Draft saved. This post is hidden from learners.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to save post'); }
    finally { setSaving(false); }
  }
  function field(key: keyof EditorFields, value: string) { setFields((previous) => ({ ...previous, [key]: value })); }
  const paragraphs = splitBlogParagraphs(fields.body);
  const valid = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fields.id) && Boolean(fields.date && fields.title.trim() && paragraphs.length);
  const preview: WhatsNewPost = {
    id: fields.id || 'preview', revision: selected?.revision ?? 0, date: fields.date || newFields().date,
    title: fields.title || 'Untitled post', paragraphs, status: 'draft', publicationSequence: null,
    sourceFrom: null, sourceThrough: null, updatedAt: '',
  };
  return <section className="whats-new-editor">
    <h2>What’s New posts</h2>
    <p className="notes">Write plain text. Leave a blank line between paragraphs. Published posts appear immediately without restarting the app.</p>
    {loading ? <p role="status">Loading posts…</p> : null}
    <div className="whats-new-editor-picker">
      <label>Post<select disabled={loading || saving || dirty} value={selected?.id ?? ''} onChange={(event) => select(posts.find((post) => post.id === event.target.value) ?? null)}>
        <option value="">New post</option>
        {posts.map((post) => <option key={post.id} value={post.id}>{post.status === 'draft' ? 'Draft' : 'Published'} · {post.date} · {post.title}</option>)}
      </select></label>
      <button type="button" className="secondary-button" disabled={saving} onClick={() => {
        if (dirty) select(selected);
        else { select(null); setReload((value) => value + 1); }
      }}>{dirty ? 'Discard unsaved changes' : 'Reload posts'}</button>
    </div>
    <form onSubmit={(event) => { event.preventDefault(); if (valid && !saving && !loading) void save(selected?.status === 'published' ? 'published' : 'draft'); }}>
      <label>Post ID<input value={fields.id} disabled={selected !== null || saving} onChange={(event) => field('id', event.target.value)} placeholder="a-new-way-to-study" required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={120} /></label>
      <p className="notes">A unique permanent ID using lowercase letters, numbers, and hyphens.</p>
      <label>Date (UTC)<input type="date" value={fields.date} disabled={saving} onChange={(event) => field('date', event.target.value)} required /></label>
      <label>Title<input value={fields.title} disabled={saving} onChange={(event) => field('title', event.target.value)} required maxLength={200} /></label>
      <label>Paragraphs<textarea value={fields.body} disabled={saving} onChange={(event) => field('body', event.target.value)} required rows={12} maxLength={100000} /></label>
      {selected?.status === 'published' ? <p className="notes">Saving a draft removes this post from What’s New. Publishing edits updates the visible post without marking it unread again.</p> : <p className="notes">A draft stays hidden. Publishing makes it visible to learners and marks a new post unread.</p>}
      <div className="whats-new-editor-actions">
        <button type="button" className="secondary-button" disabled={loading || saving || !valid} onClick={() => void save('draft')}>{selected?.status === 'published' ? 'Unpublish and save draft' : 'Save draft'}</button>
        <button type="button" disabled={loading || saving || !valid} onClick={() => void save('published')}>{saving ? 'Saving…' : selected?.status === 'published' ? 'Publish changes' : 'Publish post'}</button>
      </div>
    </form>
    {error ? <p role="alert">{error} Your text remains in the editor. To load the latest saved version, copy your edits first, discard them, and reload posts.</p> : null}
    {message ? <p role="status">{message}</p> : null}
    <details><summary>Preview</summary><WhatsNewPosts posts={[preview]} /></details>
  </section>;
}
function newFieldsWithDate(date: string): EditorFields { return { id: '', date, title: '', body: '' }; }
