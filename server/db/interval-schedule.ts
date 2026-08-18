/**
 * Small ±1 hour jitter on successful interval updates so words that share the
 * same base interval do not keep landing due together forever.
 *
 * Offsets {-1, 0, +1} with probabilities {0.3, 0.4, 0.3}.
 */
export function sampleIntervalHourFuzz(random: () => number = Math.random): -1 | 0 | 1 {
  const roll = random();
  if (roll < 0.3) {
    return -1;
  }
  if (roll < 0.7) {
    return 0;
  }
  return 1;
}

export function applyIntervalHourFuzz(
  intervalHours: number,
  random: () => number = Math.random,
): number {
  return Math.max(1, intervalHours + sampleIntervalHourFuzz(random));
}
