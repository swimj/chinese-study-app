import type { ContentExerciseSnapshot } from '../domain/word-content/types';

// Compatibility for already-open session snapshots and archived lab drafts.
const legacyRehearsalInstruction = 'Recall the expression you just met. Enter only that expression in Chinese characters, not the whole sentence.';

/** Session-time copy seam. Keep generic framing out of persisted exercises. */
export function getRehearsalInstruction(exercise: ContentExerciseSnapshot): string {
  return exercise.instruction === legacyRehearsalInstruction ? '' : exercise.instruction;
}

export function formatRehearsalPrompt(exercise: ContentExerciseSnapshot): string {
  return [getRehearsalInstruction(exercise), exercise.stimulus.text].filter(Boolean).join('\n');
}
