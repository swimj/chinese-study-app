// The media job: when a word is saved or a reading note is created, one
// back-office mediaConsider turn decides whether a picture could join it. Jobs
// run outside the learner's request, one at a time and at most DAILY_LIMIT a
// day (UTC), and commit only while still current, like word intake.
import { randomUUID } from 'node:crypto';
import { resolveAnchor, type AnnotationThread } from '../annotations.ts';
import type { MediaOutcome, MediaRequest } from '../situations/media.ts';
import { recordDecision, type MediaAnchor, type MediaItem, type MediaJob, type MediaState } from './model.ts';
export type { MediaJob } from './model.ts';

export const DAILY_LIMIT = 20;
const JOBS_KEPT = 200;

type Saved = { id: string; kind: string; title: string; detail: string; source: string; word?: { meaning: string; example: string } };
type Sources = Parameters<typeof resolveAnchor>[0];
type JournalLike = MediaState & Sources & { saved: Saved[]; annotationThreads: AnnotationThread[] };

/** Ids of the pieces that can anchor a picture: saved words and reading notes. */
export function anchorIds(s: JournalLike) {
  return new Set([
    ...s.saved.filter((item) => item.kind === 'Word').map((item) => item.id),
    ...s.annotationThreads.filter((t) => t.anchor.surface === 'read').map((t) => t.id),
  ]);
}

/** Queues one job for each anchor piece created since `before`. */
export function queueMediaJobs(s: JournalLike, before: Set<string>, now = new Date()) {
  const queued = new Set(s.mediaJobs.map((job) => job.anchor.id));
  let added = 0;
  for (const item of s.saved) {
    if (item.kind !== 'Word' || before.has(item.id) || queued.has(item.id)) continue;
    s.mediaJobs.push({ id: randomUUID(), anchor: { kind: 'word', id: item.id }, status: 'pending', queuedAt: now.toISOString() });
    added++;
  }
  for (const thread of s.annotationThreads) {
    if (thread.anchor.surface !== 'read' || before.has(thread.id) || queued.has(thread.id)) continue;
    s.mediaJobs.push({ id: randomUUID(), anchor: { kind: 'annotation', id: thread.id }, status: 'pending', queuedAt: now.toISOString() });
    added++;
  }
  return added;
}

/** What the back office sees about one anchor piece, or undefined if it is gone. */
export function mediaRequestFor(s: JournalLike, anchor: MediaAnchor): MediaRequest | undefined {
  if (anchor.kind === 'word') {
    const item = s.saved.find((w) => w.id === anchor.id);
    if (!item) return undefined;
    return {
      anchor,
      term: item.title,
      gloss: item.word?.meaning || item.detail || undefined,
      context: item.source && item.source !== item.title ? item.source : item.word?.example,
      candidates: [],
    };
  }
  if (anchor.kind === 'annotation') {
    const thread = s.annotationThreads.find((t) => t.id === anchor.id);
    if (!thread) return undefined;
    const { title, blocks } = resolveAnchor(s, thread.anchor);
    return {
      anchor,
      term: thread.anchor.quote,
      note: thread.messages.find((m) => m.role === 'user')?.text,
      context: blocks.map((b) => b.text).join('\n'),
      source: title,
      candidates: [],
    };
  }
  return undefined;
}

/** Model turns spent on media today (UTC). */
export function ranToday(s: MediaState, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  return s.mediaJobs.filter((job) => (job.status === 'done' || job.status === 'failed') && job.finishedAt?.startsWith(day)).length;
}

export function finishJob(s: MediaState, job: MediaJob, status: MediaJob['status'], now: Date, outcome?: string) {
  job.status = status;
  job.finishedAt = now.toISOString();
  if (outcome) job.outcome = outcome;
  const done = s.mediaJobs.filter((j) => j.status !== 'pending');
  if (done.length > JOBS_KEPT) {
    const drop = new Set(done.slice(0, done.length - JOBS_KEPT));
    s.mediaJobs = s.mediaJobs.filter((j) => !drop.has(j));
  }
}

/** Records the decision and, unless its ceiling is none, attaches the picked item. */
export function applyOutcome(s: MediaState, request: MediaRequest, outcome: MediaOutcome, now: Date) {
  const at = now.toISOString();
  let mediaId: string | undefined;
  const c = outcome.candidate;
  if (outcome.ceiling !== 'none' && c) {
    const item: MediaItem = {
      id: randomUUID(),
      kind: c.kind,
      origin: 'system',
      anchor: request.anchor,
      caption: request.term,
      source:
        c.kind === 'image'
          ? { provider: 'wikidata-commons', entityId: c.entityId, pageUrl: c.pageUrl, thumbUrl: c.thumbUrl, width: c.width, height: c.height, title: c.title }
          : { provider: 'wikidata-commons', entityId: c.entityId, pageUrl: c.pageUrl, title: c.label || c.title, year: c.year },
      license: c.kind === 'image' ? c.license : undefined,
      credit: c.kind === 'image' ? c.credit : undefined,
      judgment: outcome.judgment,
      ceiling: outcome.ceiling,
      createdAt: at,
      reactions: {},
    };
    s.media.push(item);
    mediaId = item.id;
  }
  recordDecision(s, { at, anchor: request.anchor, judgment: outcome.judgment, ceiling: outcome.ceiling, mediaId });
  return mediaId;
}
