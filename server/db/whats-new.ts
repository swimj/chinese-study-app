import { getDb } from './connection.ts';
import { parseWhatsNewWriteRequest, type WhatsNewPost } from '../../src/domain/whats-new.ts';
export class WhatsNewConflictError extends Error {}
type PostRow = Omit<WhatsNewPost, 'paragraphs'> & { paragraphsJson: string };
const SELECT = `SELECT post_id AS id, revision, date, title, summary, paragraphs_json AS paragraphsJson,
  status, publication_sequence AS publicationSequence, source_from AS sourceFrom,
  source_through AS sourceThrough, updated_at AS updatedAt FROM whats_new_posts`;
function decode(row: PostRow): WhatsNewPost {
  const { paragraphsJson, ...post } = row;
  return { ...post, paragraphs: JSON.parse(paragraphsJson) as string[] };
}
export function listWhatsNewPosts(options: { includeDrafts?: boolean } = {}): WhatsNewPost[] {
  return (getDb().prepare(`${SELECT} ${options.includeDrafts ? '' : "WHERE status = 'published'"}
    ORDER BY publication_sequence DESC, updated_at DESC, post_id ASC`).all() as PostRow[]).map(decode);
}
export function getLatestWhatsNewPublicationSequence(): number {
  return (getDb().prepare('SELECT COALESCE(MAX(publication_sequence), 0) AS sequence FROM whats_new_posts').get() as { sequence: number }).sequence;
}
export function saveWhatsNewPost(value: unknown, actorId: string): WhatsNewPost {
  const request = parseWhatsNewWriteRequest(value);
  if (typeof actorId !== 'string' || !actorId.trim()) throw new Error('Expected a nonempty blog actor id.');
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = db.prepare(`${SELECT} WHERE post_id = ?`).get(request.id) as PostRow | undefined;
    if ((existing?.revision ?? null) !== request.expectedRevision) throw new WhatsNewConflictError('This post changed. Reload it before saving.');
    const publicationSequence = existing?.publicationSequence ?? (request.status === 'published' ? getLatestWhatsNewPublicationSequence() + 1 : null);
    const post: WhatsNewPost = { id: request.id, revision: (existing?.revision ?? 0) + 1,
      date: request.date, title: request.title, summary: request.summary, paragraphs: request.paragraphs, status: request.status,
      sourceFrom: request.sourceFrom, sourceThrough: request.sourceThrough,
      publicationSequence, updatedAt: new Date().toISOString() };
    db.prepare(`INSERT INTO whats_new_posts (post_id, revision, date, title, summary, paragraphs_json, status,
      publication_sequence, source_from, source_through, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(post_id) DO UPDATE SET revision=excluded.revision, date=excluded.date, title=excluded.title, summary=excluded.summary,
      paragraphs_json=excluded.paragraphs_json, status=excluded.status, publication_sequence=excluded.publication_sequence,
      source_from=excluded.source_from, source_through=excluded.source_through, updated_at=excluded.updated_at`)
      .run(post.id, post.revision, post.date, post.title, post.summary, JSON.stringify(post.paragraphs), post.status,
        post.publicationSequence, post.sourceFrom, post.sourceThrough, post.updatedAt);
    db.prepare('INSERT INTO whats_new_post_revisions (post_id, revision, actor_id, saved_at, post_json) VALUES (?, ?, ?, ?, ?)')
      .run(post.id, post.revision, actorId, post.updatedAt, JSON.stringify(post));
    db.exec('COMMIT');
    return post;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
