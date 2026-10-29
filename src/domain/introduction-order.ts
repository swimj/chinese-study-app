export type StudyIntroductionOrder = 'random' | 'first' | 'paced';

export const DEFAULT_INTRODUCTION_SPACING = 3;
export const MAX_INTRODUCTION_SPACING = 10;

export function isStudyIntroductionOrder(value: unknown): value is StudyIntroductionOrder {
  return value === 'random' || value === 'first' || value === 'paced';
}

export function isStudyIntroductionSpacing(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
    && value >= 1 && value <= MAX_INTRODUCTION_SPACING;
}
