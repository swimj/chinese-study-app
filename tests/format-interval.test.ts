import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { formatIntervalHours } from '../src/lib/format-interval.ts';

describe('formatIntervalHours', () => {
  test('formats hours only when under a day', () => {
    assert.equal(formatIntervalHours(1), '1 hour');
    assert.equal(formatIntervalHours(5), '5 hours');
    assert.equal(formatIntervalHours(23), '23 hours');
  });

  test('formats whole days without leftover hours', () => {
    assert.equal(formatIntervalHours(24), '1 day');
    assert.equal(formatIntervalHours(48), '2 days');
  });

  test('formats mixed days and hours', () => {
    assert.equal(formatIntervalHours(25), '1 day, 1 hour');
    assert.equal(formatIntervalHours(50), '2 days, 2 hours');
  });
});
