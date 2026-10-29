export const MAX_SESSION_ITEMS = 1000;

export const DEFAULT_SESSION_BUCKET_WEIGHTS = { review: 50, learning: 30, unstudied: 20 } as const;
type SessionBucket = keyof typeof DEFAULT_SESSION_BUCKET_WEIGHTS;
type BucketCounts = Record<SessionBucket, number>;

/** Preserve the live scheduler's mix, redistributing slots from exhausted buckets. */
export function allocateSessionBucketSlots(counts: BucketCounts): BucketCounts {
  const buckets = Object.keys(DEFAULT_SESSION_BUCKET_WEIGHTS) as SessionBucket[];
  if (buckets.reduce((sum, bucket) => sum + counts[bucket], 0) <= MAX_SESSION_ITEMS) return { ...counts };
  const slots: BucketCounts = { review: 0, learning: 0, unstudied: 0 };
  let remaining = MAX_SESSION_ITEMS;
  let open = buckets.filter((bucket) => counts[bucket] > 0);
  while (open.length > 0) {
    const totalWeight = open.reduce((sum, bucket) => sum + DEFAULT_SESSION_BUCKET_WEIGHTS[bucket], 0);
    const exhausted = open.filter((bucket) => counts[bucket] <= remaining * DEFAULT_SESSION_BUCKET_WEIGHTS[bucket] / totalWeight);
    if (exhausted.length > 0) {
      for (const bucket of exhausted) { slots[bucket] = counts[bucket]; remaining -= counts[bucket]; }
      open = open.filter((bucket) => !exhausted.includes(bucket));
      continue;
    }
    const shares = open.map((bucket) => ({ bucket, exact: remaining * DEFAULT_SESSION_BUCKET_WEIGHTS[bucket] / totalWeight }));
    for (const { bucket, exact } of shares) slots[bucket] = Math.floor(exact);
    const remainder = MAX_SESSION_ITEMS - buckets.reduce((sum, bucket) => sum + slots[bucket], 0);
    shares.sort((a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)));
    for (const { bucket } of shares.slice(0, remainder)) slots[bucket] += 1;
    break;
  }
  return slots;
}
