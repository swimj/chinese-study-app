import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  applyIntervalHourFuzz,
  sampleIntervalHourFuzz,
} from '../server/db/interval-schedule.ts';

describe('interval hour fuzz', () => {
  test('samples -1, 0, and +1 on the configured probability thresholds', () => {
    assert.equal(sampleIntervalHourFuzz(() => 0), -1);
    assert.equal(sampleIntervalHourFuzz(() => 0.299999), -1);
    assert.equal(sampleIntervalHourFuzz(() => 0.3), 0);
    assert.equal(sampleIntervalHourFuzz(() => 0.699999), 0);
    assert.equal(sampleIntervalHourFuzz(() => 0.7), 1);
    assert.equal(sampleIntervalHourFuzz(() => 0.999), 1);
  });

  test('applies fuzz while keeping intervals at least one hour', () => {
    assert.equal(applyIntervalHourFuzz(24, () => 0), 23);
    assert.equal(applyIntervalHourFuzz(24, () => 0.5), 24);
    assert.equal(applyIntervalHourFuzz(24, () => 0.8), 25);
    assert.equal(applyIntervalHourFuzz(1, () => 0), 1);
  });
});
