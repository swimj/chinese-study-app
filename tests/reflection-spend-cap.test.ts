import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { LUNA_REFLECTION_MODEL_CHOICE } from '../server/reflection/model-arms.ts';
import {
  assertReflectionModelAllowedUnderSpendCap,
  buildReflectionSpendCap,
  DAILY_REFLECTION_SPEND_CAP_USD,
  ReflectionSpendCapError,
  utcDayKey,
  utcDayRange,
} from '../server/reflection/spend-cap.ts';

describe('reflection daily spend cap', () => {
  test('uses a 50-cent UTC-day threshold and treats exact equality as still under the cap', () => {
    const now = new Date('2026-09-10T15:30:00.000Z');
    assert.equal(DAILY_REFLECTION_SPEND_CAP_USD, 0.5);
    assert.equal(utcDayKey(now), '2026-09-10');
    assert.deepEqual(utcDayRange('2026-09-10'), {
      start: '2026-09-10T00:00:00.000Z',
      end: '2026-09-11T00:00:00.000Z',
    });

    assert.equal(buildReflectionSpendCap(0.5, now).lunaOnly, false);
    assert.equal(buildReflectionSpendCap(0.5001, now).lunaOnly, true);
    assert.deepEqual(buildReflectionSpendCap(0.62, now), {
      lunaOnly: true,
      spentUsd: 0.62,
      capUsd: 0.5,
      dayKey: '2026-09-10',
      resetsAt: '2026-09-11T00:00:00.000Z',
    });
  });

  test('allows Luna and refuses other arms once the cap is surpassed', () => {
    const spendCap = buildReflectionSpendCap(0.51, new Date('2026-09-10T00:00:00.000Z'));
    assert.doesNotThrow(() => (
      assertReflectionModelAllowedUnderSpendCap(LUNA_REFLECTION_MODEL_CHOICE, spendCap)
    ));
    assert.throws(
      () => assertReflectionModelAllowedUnderSpendCap('openai:gpt-5.6-terra-high', spendCap),
      (error: unknown) => {
        assert.equal(error instanceof ReflectionSpendCapError, true);
        assert.equal(
          (error as ReflectionSpendCapError).message,
          'Daily reflection spend cap reached. Only Luna is available until 2026-09-11T00:00:00.000Z.',
        );
        return true;
      },
    );
  });
});
