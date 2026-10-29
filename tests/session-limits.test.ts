import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allocateSessionBucketSlots } from '../src/domain/session-limits.ts';

test('oversized admission preserves the scheduler mix and redistributes unavailable slots', () => {
  assert.deepEqual(allocateSessionBucketSlots({ review: 1000, learning: 1000, unstudied: 1000 }),
    { review: 500, learning: 300, unstudied: 200 });
  assert.deepEqual(allocateSessionBucketSlots({ review: 1000, learning: 1000, unstudied: 10 }),
    { review: 619, learning: 371, unstudied: 10 });
  assert.deepEqual(allocateSessionBucketSlots({ review: 0, learning: 2000, unstudied: 10 }),
    { review: 0, learning: 990, unstudied: 10 });
  assert.deepEqual(allocateSessionBucketSlots({ review: 1001, learning: 0, unstudied: 0 }),
    { review: 1000, learning: 0, unstudied: 0 });
});
