// Composition policy v1 (MEDIA.md): runs over every media item on the board and
// decides what is actually shown. Each rule can only lower an item's stored
// ceiling, and each demotion records a reason code. Learner media and items the
// learner kept are always placed. Pure and deterministic, so the board does not
// reshuffle between renders; shared by the page and Node tests and tools.
import { buildScrapbook } from './scrapbook.js';

const LEVEL = { none: 0, latent: 1, placed: 2 };
// When a rule must choose which items keep `placed`.
const VALUE = { cultural: 4, interest: 3, recognition: 2, memory: 1, none: 0 };
const HOUR = 3600_000;
const DAY = 24 * HOUR;

export const policy = {
  clusterCap: 1,
  textPerImage: 6,
  pacing: { count: 2, window: DAY },
  taste: { dismissals: 2, window: 14 * DAY, cap: 30 * DAY },
};

const time = (iso) => (iso ? Date.parse(iso) : NaN);

/** Kept or brought by the learner: shown regardless of either policy. */
export function learnerChosen(item) {
  if (item.origin === 'learner') return true;
  const kept = time(item.reactions?.kept), rejected = time(item.reactions?.notForMe);
  return kept >= (rejected || -Infinity);
}
function rejected(item) {
  const kept = time(item.reactions?.kept), notForMe = time(item.reactions?.notForMe);
  return notForMe >= (kept || -Infinity);
}

/** Referent categories capped at latent by the taste rule at `now`, with when each cap ends. */
export function tasteCaps(media, now) {
  const byReferent = new Map();
  for (const item of media) {
    const at = time(item.reactions?.notForMe);
    if (item.origin !== 'system' || !item.judgment || !(at <= now) || !rejected(item)) continue;
    const list = byReferent.get(item.judgment.referent) || [];
    list.push(at);
    byReferent.set(item.judgment.referent, list);
  }
  const caps = new Map();
  const { dismissals, window, cap } = policy.taste;
  for (const [referent, times] of byReferent) {
    times.sort((a, b) => a - b);
    for (let i = dismissals - 1; i < times.length; i++) {
      const until = times[i] + cap;
      if (times[i] - times[i - dismissals + 1] <= window && now < until)
        caps.set(referent, Math.max(caps.get(referent) || 0, until));
    }
  }
  return caps;
}

function preferred(a, b) {
  return (
    (VALUE[b.judgment?.addedValue] ?? 0) - (VALUE[a.judgment?.addedValue] ?? 0) ||
    (time(b.createdAt) || 0) - (time(a.createdAt) || 0) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/**
 * Returns `{ [mediaId]: { level, reasons[] } }` for every media item in the
 * journal state. `now` is a millisecond time or ISO string.
 */
export function compose(state, now = Date.now()) {
  const t = typeof now === 'number' ? now : Date.parse(now);
  const media = state.media || [];
  const pictures = state.settings?.pictures || 'normal';
  const out = {};

  // The board as the learner sees it: which cluster holds each anchor, and how much text there is.
  const home = new Map();
  let textPieces = 0;
  for (const cluster of buildScrapbook(state, { readingLabel: () => '' })) {
    for (const scrap of cluster.scraps) {
      home.set(scrap.id, cluster.key);
      textPieces++;
    }
  }
  const demote = (item, level, reason) => {
    const entry = out[item.id];
    if (LEVEL[level] < LEVEL[entry.level]) {
      entry.level = level;
      entry.reasons.push(reason);
    }
  };

  const caps = tasteCaps(media, t);
  const deleted = new Set((state.board?.deletedPieces || []).filter(piece => piece.kind === 'media').map(piece => piece.pieceId));
  const system = [];
  for (const item of media) {
    const chosen = learnerChosen(item);
    out[item.id] = { level: chosen ? 'placed' : item.ceiling, reasons: [] };
    if (deleted.has(item.id)) {
      demote(item, 'none', 'deleted');
      continue;
    }
    // Nowhere to show it: its piece is no longer on the board.
    if (!home.has(item.anchor.id)) demote(item, 'none', 'no-anchor');
    if (chosen) continue;
    if (rejected(item)) demote(item, 'none', 'not-for-me');
    if (pictures === 'off') demote(item, 'none', 'setting');
    if (pictures === 'quiet') demote(item, 'latent', 'setting');
    if (item.judgment && caps.has(item.judgment.referent)) demote(item, 'latent', 'taste');
    system.push(item);
  }

  const placed = () => system.filter((item) => out[item.id].level === 'placed').sort(preferred);
  const perCluster = new Map();
  for (const item of placed()) {
    const key = home.get(item.anchor.id);
    const n = perCluster.get(key) || 0;
    if (n >= policy.clusterCap) demote(item, 'latent', 'cluster-cap');
    else perCluster.set(key, n + 1);
  }
  const allowed = Math.ceil(textPieces / policy.textPerImage);
  placed().forEach((item, i) => {
    if (i >= allowed) demote(item, 'latent', 'mix-ratio');
  });
  placed()
    .filter((item) => t - time(item.createdAt) < policy.pacing.window)
    .forEach((item, i) => {
      if (i >= policy.pacing.count) demote(item, 'latent', 'pacing');
    });
  return out;
}
