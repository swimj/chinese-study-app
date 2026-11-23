import type { Judgment } from './judgment.ts';
import type { Ceiling } from './local-policy.ts';

// Media on the board (MEDIA.md). Items are references to hosted files, never
// rehosted copies. System items carry the judgment and ceiling they were
// attached with; the composition policy decides what is shown each render.
export type MediaAnchor = { kind: 'word' | 'annotation' | 'reading'; id: string };
export type LicenseCode = 'PD' | 'CC0' | 'CC-BY' | 'CC-BY-SA';
export type MediaItem = {
  id: string;
  kind: 'image' | 'link';
  origin: 'system' | 'learner';
  anchor: MediaAnchor;
  /** The anchor's term, shown as the clipping's caption. */
  caption: string;
  source: {
    provider: 'wikidata-commons';
    entityId?: string;
    pageUrl: string;
    thumbUrl?: string;
    width?: number;
    height?: number;
    title?: string;
    /** A link card's year, for a named work. */
    year?: string;
  };
  license?: { code: LicenseCode; url: string };
  credit?: { author: string; text: string };
  judgment?: Judgment;
  ceiling: Exclude<Ceiling, 'none'>;
  createdAt: string;
  /** ISO times. The later of kept and notForMe wins. */
  reactions: { kept?: string; notForMe?: string };
};
export type MediaDecision = {
  at: string;
  anchor: MediaAnchor;
  judgment: Judgment;
  ceiling: Ceiling;
  mediaId?: string;
};
export type Pictures = 'off' | 'quiet' | 'normal';
export type Settings = { pictures: Pictures };
/** One queued back-office consideration of an anchor piece (media/job.ts). */
export type MediaJob = {
  id: string;
  anchor: MediaAnchor;
  status: 'pending' | 'done' | 'failed' | 'skipped';
  queuedAt: string;
  finishedAt?: string;
  /** Why a job failed or was skipped. */
  outcome?: string;
};
export type MediaState = { media: MediaItem[]; mediaDecisions: MediaDecision[]; mediaJobs: MediaJob[]; settings: Settings };

export const DECISIONS_KEPT = 200;

/** Journals from before media open with nothing attached and pictures on. */
export function withMediaDefaults<S extends Partial<MediaState>>(s: S): S & MediaState {
  s.media ??= [];
  s.mediaDecisions ??= [];
  s.mediaJobs ??= [];
  s.settings ??= { pictures: 'normal' };
  s.settings.pictures ??= 'normal';
  return s as S & MediaState;
}

export function recordDecision(s: MediaState, decision: MediaDecision) {
  s.mediaDecisions.push(decision);
  if (s.mediaDecisions.length > DECISIONS_KEPT) s.mediaDecisions.splice(0, s.mediaDecisions.length - DECISIONS_KEPT);
}
