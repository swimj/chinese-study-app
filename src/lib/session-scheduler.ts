import type { SessionItemWithWord } from '../types';

export type SessionBuckets = {
  review: SessionItemWithWord[];
  learning: SessionItemWithWord[];
  unstudied: SessionItemWithWord[];
};

type QueueNode = {
  item: SessionItemWithWord;
  next: QueueNode | null;
};

export type LinkedQueue = {
  head: QueueNode | null;
  tail: QueueNode | null;
  length: number;
};

export type SessionSchedulerPolicy = {
  unstudiedInterleaveInterval: number;
};

export type SessionScheduler = {
  reviewQueue: LinkedQueue;
  learningQueue: LinkedQueue;
  unstudiedPool: SessionItemWithWord[];
  policy: SessionSchedulerPolicy;
  interleaveCursor: number;
  activeItem: SessionItemWithWord | null;
  rngState: number;
};

export type RemoveSchedulerWordResult = {
  scheduler: SessionScheduler;
  removedReviewItemIds: string[];
};

const DEFAULT_POLICY: SessionSchedulerPolicy = {
  unstudiedInterleaveInterval: 5,
};

const DEFAULT_SEED = 0x9e3779b9;

export function createSessionScheduler({
  buckets,
  policy,
  seed,
}: {
  buckets: SessionBuckets;
  policy?: Partial<SessionSchedulerPolicy>;
  seed?: number;
}): SessionScheduler {
  const scheduler: SessionScheduler = {
    reviewQueue: createQueue(buckets.review),
    learningQueue: createQueue(buckets.learning),
    unstudiedPool: [...buckets.unstudied],
    policy: {
      ...DEFAULT_POLICY,
      ...policy,
    },
    interleaveCursor: 0,
    activeItem: null,
    rngState: normalizeSeed(seed ?? DEFAULT_SEED),
  };

  return nextScheduler(scheduler);
}

export function nextScheduler(scheduler: SessionScheduler): SessionScheduler {
  const selection = recomputeActiveItem(scheduler);
  if (!selection) {
    return scheduler;
  }

  if (selection.source === 'unstudied') {
    scheduler.interleaveCursor = 0;
    scheduler.rngState = lcg(scheduler.rngState);
  } else {
    scheduler.interleaveCursor += 1;
  }

  return scheduler;
}

export function getSchedulerActiveItem(scheduler: SessionScheduler): SessionItemWithWord | undefined {
  return scheduler.activeItem ?? undefined;
}

export function getSchedulerItems(scheduler: SessionScheduler): SessionItemWithWord[] {
  return [...queueToArray(scheduler.reviewQueue), ...queueToArray(scheduler.learningQueue), ...scheduler.unstudiedPool];
}

export function getSchedulerLength(scheduler: SessionScheduler): number {
  return scheduler.reviewQueue.length + scheduler.learningQueue.length + scheduler.unstudiedPool.length;
}

export function consumeActiveSchedulerItem(scheduler: SessionScheduler): SessionScheduler {
  const active = getSchedulerActiveItem(scheduler);
  if (!active) {
    throw new Error('Invariant violated: attempted to consume active scheduler item when no active item is set');
  }

  if (active.word.status === 'review') {
    assertHeadMatchesActive(scheduler.reviewQueue, active, 'review');
    dequeue(scheduler.reviewQueue);
  } else if (active.word.status === 'learning') {
    assertHeadMatchesActive(scheduler.learningQueue, active, 'learning');
    dequeue(scheduler.learningQueue);
  } else {
    removeFromPoolById(scheduler.unstudiedPool, active.reviewItem.id);
  }

  return nextScheduler(scheduler);
}

export function rotateActiveSchedulerItem(scheduler: SessionScheduler): SessionScheduler {
  const active = getSchedulerActiveItem(scheduler);
  if (!active) {
    throw new Error('Invariant violated: attempted to rotate active scheduler item when no active item is set');
  }

  if (active.word.status === 'review') {
    assertHeadMatchesActive(scheduler.reviewQueue, active, 'review');
    rotateHeadToTail(scheduler.reviewQueue);
  } else if (active.word.status === 'learning') {
    assertHeadMatchesActive(scheduler.learningQueue, active, 'learning');
    rotateHeadToTail(scheduler.learningQueue);
  }

  return nextScheduler(scheduler);
}

export function removeSchedulerWord(
  scheduler: SessionScheduler,
  wordId: string,
  status: 'review' | 'learning' | 'unstudied',
): RemoveSchedulerWordResult {
  let removedReviewItemIds: string[] = [];

  switch (status) {
    case 'review':
      removedReviewItemIds = removeWordFromQueueById(scheduler.reviewQueue, wordId);
      break;
    case 'learning':
      removedReviewItemIds = removeWordFromQueueById(scheduler.learningQueue, wordId);
      break;
    case 'unstudied':
      removedReviewItemIds = removeWordFromArrayPoolById(scheduler.unstudiedPool, wordId);
      break;
  }

  return {
    scheduler: nextScheduler(scheduler),
    removedReviewItemIds,
  };
}

export function removeUnstudiedCandidateByReviewItemId(
  scheduler: SessionScheduler,
  reviewItemId: string,
): SessionScheduler {
  removeFromPoolById(scheduler.unstudiedPool, reviewItemId);

  const active = getSchedulerActiveItem(scheduler);
  if (active && active.reviewItem.id === reviewItemId) {
    return nextScheduler(scheduler);
  }

  return scheduler;
}

export function pruneSchedulerItems(
  scheduler: SessionScheduler,
  keep: (item: SessionItemWithWord, index: number) => boolean,
): SessionScheduler {
  let index = 0;
  const keepWithIndex = (item: SessionItemWithWord) => {
    const shouldKeep = keep(item, index);
    index += 1;
    return shouldKeep;
  };

  filterQueueInPlace(scheduler.reviewQueue, keepWithIndex);
  filterQueueInPlace(scheduler.learningQueue, keepWithIndex);
  scheduler.unstudiedPool = scheduler.unstudiedPool.filter(keepWithIndex);
  recomputeActiveItem(scheduler);
  return scheduler;
}

export function cloneSessionScheduler(scheduler: SessionScheduler): SessionScheduler {
  return {
    reviewQueue: cloneQueue(scheduler.reviewQueue),
    learningQueue: cloneQueue(scheduler.learningQueue),
    unstudiedPool: scheduler.unstudiedPool.map(cloneSessionItemWithWord),
    policy: {
      ...scheduler.policy,
    },
    interleaveCursor: scheduler.interleaveCursor,
    activeItem: scheduler.activeItem ? cloneSessionItemWithWord(scheduler.activeItem) : null,
    rngState: scheduler.rngState,
  };
}

function pickNextSource(scheduler: SessionScheduler): 'review' | 'learning' | 'unstudied' {
  const hasReview = scheduler.reviewQueue.length > 0;
  const hasLearning = scheduler.learningQueue.length > 0;
  const hasUnstudied = scheduler.unstudiedPool.length > 0;

  if ((hasReview || hasLearning) && hasUnstudied) {
    if (scheduler.interleaveCursor >= scheduler.policy.unstudiedInterleaveInterval) {
      return 'unstudied';
    }
  }

  if (hasReview) {
    return 'review';
  }

  if (hasLearning) {
    return 'learning';
  }

  return 'unstudied';
}

function pickActiveForSource(
  scheduler: SessionScheduler,
  source: 'review' | 'learning' | 'unstudied',
): SessionItemWithWord {
  if (source === 'review') {
    if (!scheduler.reviewQueue.head) {
      throw new Error('Invariant violated: review source selected with an empty review queue');
    }
    return scheduler.reviewQueue.head.item;
  }

  if (source === 'learning') {
    if (!scheduler.learningQueue.head) {
      throw new Error('Invariant violated: learning source selected with an empty learning queue');
    }
    return scheduler.learningQueue.head.item;
  }

  if (scheduler.unstudiedPool.length === 0) {
    throw new Error('Invariant violated: unstudied source selected with an empty unstudied pool');
  }

  const index = lcg(scheduler.rngState) % scheduler.unstudiedPool.length;
  return scheduler.unstudiedPool[index];
}

function lcg(value: number): number {
  return (Math.imul(value, 1664525) + 1013904223) >>> 0;
}

function normalizeSeed(seed: number): number {
  return (seed >>> 0) || 1;
}

function removeFromPoolById(pool: SessionItemWithWord[], reviewItemId: string) {
  const index = pool.findIndex((item) => item.reviewItem.id === reviewItemId);
  if (index >= 0) {
    pool.splice(index, 1);
  }
}

function createQueue(items: SessionItemWithWord[]): LinkedQueue {
  const queue: LinkedQueue = {
    head: null,
    tail: null,
    length: 0,
  };

  for (const item of items) {
    enqueue(queue, item);
  }

  return queue;
}

function cloneQueue(queue: LinkedQueue): LinkedQueue {
  return createQueue(queueToArray(queue).map(cloneSessionItemWithWord));
}

function queueToArray(queue: LinkedQueue): SessionItemWithWord[] {
  const out: SessionItemWithWord[] = [];
  let node = queue.head;

  while (node) {
    out.push(node.item);
    node = node.next;
  }

  return out;
}

function dequeue(queue: LinkedQueue): void {
  if (!queue.head) {
    throw new Error('Invariant violated: attempted to dequeue an empty scheduler queue');
  }

  const headNode = queue.head;
  queue.head = headNode.next;
  queue.length -= 1;

  if (!queue.head) {
    queue.tail = null;
  }
}

function enqueue(queue: LinkedQueue, item: SessionItemWithWord): void {
  const node: QueueNode = { item, next: null };

  if (!queue.head) {
    queue.head = node;
    queue.tail = node;
    queue.length = 1;
    return;
  }

  queue.tail!.next = node;
  queue.tail = node;
  queue.length += 1;
}

function rotateHeadToTail(queue: LinkedQueue) {
  if (queue.length <= 1 || !queue.head || !queue.tail) {
    return;
  }

  const headNode = queue.head;
  queue.head = headNode.next;
  headNode.next = null;
  queue.tail.next = headNode;
  queue.tail = headNode;
}

function assertHeadMatchesActive(
  queue: LinkedQueue,
  activeItem: SessionItemWithWord,
  source: 'review' | 'learning',
): void {
  if (!queue.head) {
    throw new Error(`Invariant violated: ${source} queue is empty while active ${source} item exists`);
  }

  if (queue.head.item.reviewItem.id !== activeItem.reviewItem.id) {
    throw new Error(
      `Invariant violated: active ${source} item is not the queue head (${activeItem.reviewItem.id} !== ${queue.head.item.reviewItem.id})`,
    );
  }
}

function filterQueueInPlace(queue: LinkedQueue, keep: (item: SessionItemWithWord) => boolean): void {
  let prev: QueueNode | null = null;
  let node = queue.head;

  while (node) {
    const next = node.next;

    if (!keep(node.item)) {
      if (prev) {
        prev.next = next;
      } else {
        queue.head = next;
      }

      if (queue.tail === node) {
        queue.tail = prev;
      }

      queue.length -= 1;
      node.next = null;
    } else {
      prev = node;
    }

    node = next;
  }
}

function removeWordFromQueueById(queue: LinkedQueue, wordId: string): string[] {
  const removedReviewItemIds: string[] = [];
  filterQueueInPlace(queue, (item) => {
    if (item.word.id !== wordId) {
      return true;
    }

    removedReviewItemIds.push(item.reviewItem.id);
    return false;
  });

  return removedReviewItemIds;
}

function removeWordFromArrayPoolById(pool: SessionItemWithWord[], wordId: string): string[] {
  const removedReviewItemIds: string[] = [];

  for (let index = pool.length - 1; index >= 0; index -= 1) {
    if (pool[index].word.id !== wordId) {
      continue;
    }

    removedReviewItemIds.push(pool[index].reviewItem.id);
    pool.splice(index, 1);
  }

  return removedReviewItemIds;
}

function cloneSessionItemWithWord(item: SessionItemWithWord): SessionItemWithWord {
  return {
    reviewItem: { ...item.reviewItem },
    word: {
      ...item.word,
      meanings: [...item.word.meanings],
      examples: [...item.word.examples],
    },
  };
}

function recomputeActiveItem(
  scheduler: SessionScheduler,
): { source: 'review' | 'learning' | 'unstudied'; item: SessionItemWithWord } | null {
  if (getSchedulerLength(scheduler) === 0) {
    scheduler.activeItem = null;
    return null;
  }

  const source = pickNextSource(scheduler);
  const item = pickActiveForSource(scheduler, source);
  scheduler.activeItem = item;
  return { source, item };
}
