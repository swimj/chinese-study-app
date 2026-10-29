import type { WordContentDocument } from './types';

/** Exact post-answer teaching selected when the exercise is served, never prompt evidence. */
export type BootstrapRevealSnapshot = {
  readonly contentId: string;
  readonly useId: string;
  readonly exampleId: string;
  readonly englishFrame: string;
  readonly exampleSentence: string;
  readonly exampleTranslation: string;
};

export function selectBootstrapReveal(content: WordContentDocument, date: Date): BootstrapRevealSnapshot {
  const day = Math.floor(date.getTime() / 86_400_000);
  if (!Number.isFinite(day) || content.uses.length === 0) {
    throw new Error('Bootstrap reveal requires a valid date and at least one source use.');
  }
  const index = ((day % content.uses.length) + content.uses.length) % content.uses.length;
  return materializeBootstrapReveal(content, index);
}

/** New-word recognition walks source order, independently of recall success. */
export function selectSequentialBootstrapReveal(content: WordContentDocument, completedRecognitionAttempts: number): BootstrapRevealSnapshot {
  if (!Number.isSafeInteger(completedRecognitionAttempts) || completedRecognitionAttempts < 0 || content.uses.length === 0) {
    throw new Error('Sequential bootstrap reveal requires a nonnegative attempt count and at least one source use.');
  }
  return materializeBootstrapReveal(content, completedRecognitionAttempts % content.uses.length);
}

function materializeBootstrapReveal(content: WordContentDocument, index: number): BootstrapRevealSnapshot {
  const use = content.uses[index];
  const example = content.examples.find((row) => row.id === use.exampleIds[0]);
  if (!example) throw new Error(`Bootstrap use ${use.id} has no linked example.`);
  return {
    contentId: content.id, useId: use.id, exampleId: example.id,
    englishFrame: use.label, exampleSentence: example.text, exampleTranslation: example.translation,
  };
}

export function isBootstrapRevealSnapshot(value: unknown): value is BootstrapRevealSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const fields = ['contentId', 'useId', 'exampleId', 'englishFrame', 'exampleSentence', 'exampleTranslation'];
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === fields.length
    && fields.every((field) => typeof record[field] === 'string' && record[field].trim().length > 0);
}
