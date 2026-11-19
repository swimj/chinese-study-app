import type { BucketSessionCommitIntent } from '../../lib/session-state';

export type DeferredSessionCommit = Exclude<BucketSessionCommitIntent, { type: 'none' }>;
