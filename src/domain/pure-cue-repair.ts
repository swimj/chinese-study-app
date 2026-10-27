/** Shared stimulus invariants, independent of either reflection wire/storage model. */
export function pureCueStimulusRepairErrors(expected: unknown, stimulus: unknown): string[] {
  const errors: string[] = [];
  if (typeof stimulus !== 'string' || !stimulus.trim()) return ['stimulus: required'];
  if (stimulus.trim() === expected) errors.push('stimulus must change');
  if (stimulus !== stimulus.trim()) errors.push('stimulus: trim surrounding whitespace');
  return errors;
}
