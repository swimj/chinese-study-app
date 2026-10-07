export type WhatsNewPost = {
  id: string;
  revision: number;
  date: string;
  title: string;
  paragraphs: string[];
  status: 'draft' | 'published';
  publicationSequence: number | null;
  sourceFrom: string | null;
  sourceThrough: string | null;
  updatedAt: string;
};
export type WhatsNewWriteRequest = Pick<WhatsNewPost,
  'id' | 'date' | 'title' | 'paragraphs' | 'status' | 'sourceFrom' | 'sourceThrough'> & {
  expectedRevision: number | null;
};
export class WhatsNewInputError extends Error {}
export function parseWhatsNewWriteRequest(value: unknown): WhatsNewWriteRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new WhatsNewInputError('Expected a post object.');
  const post = value as Record<string, unknown>;
  const keys = new Set(['id', 'expectedRevision', 'date', 'title', 'paragraphs', 'status', 'sourceFrom', 'sourceThrough']);
  if (Object.keys(post).some(key => !keys.has(key))) throw new WhatsNewInputError('Unknown post field.');
  if (typeof post.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,119}$/.test(post.id)) throw new WhatsNewInputError('Expected a lowercase post slug of at most 120 characters.');
  if (post.expectedRevision !== null && (!Number.isSafeInteger(post.expectedRevision) || (post.expectedRevision as number) < 1)) throw new WhatsNewInputError('Expected a revision or null for a new post.');
  if (typeof post.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(post.date) || !Number.isFinite(new Date(`${post.date}T00:00:00Z`).getTime()) || new Date(`${post.date}T00:00:00Z`).toISOString().slice(0, 10) !== post.date) throw new WhatsNewInputError('Expected a valid YYYY-MM-DD post date.');
  if (typeof post.title !== 'string' || !post.title.trim() || post.title.length > 200) throw new WhatsNewInputError('Expected a title of 1–200 characters.');
  if (!Array.isArray(post.paragraphs) || !post.paragraphs.length || post.paragraphs.length > 100 || post.paragraphs.some(p => typeof p !== 'string' || !p.trim() || p.length > 10000) || post.paragraphs.reduce((n: number, p: string) => n + p.length, 0) > 100000) throw new WhatsNewInputError('Expected 1–100 nonempty paragraphs, at most 10,000 characters each and 100,000 total.');
  if (post.status !== 'draft' && post.status !== 'published') throw new WhatsNewInputError('Expected draft or published status.');
  for (const key of ['sourceFrom', 'sourceThrough']) {
    if (post[key] !== null && (typeof post[key] !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(post[key] as string))) throw new WhatsNewInputError('Expected full commit SHAs or null provenance.');
  }
  return { id: post.id, expectedRevision: post.expectedRevision as number | null, date: post.date,
    title: post.title, paragraphs: [...post.paragraphs], status: post.status,
    sourceFrom: post.sourceFrom as string | null, sourceThrough: post.sourceThrough as string | null };
}
