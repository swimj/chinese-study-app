import type { ContentQualityTarget } from '../../domain/content-quality';
import type { SessionStudyItem } from '../../domain/study-actions';

/** Rate the exercise as shown, retaining its authored or definition provenance. */
export function getSessionContentQualityTarget(
  item: Pick<SessionStudyItem, 'actionKind' | 'contentRef' | 'production' | 'rehearsal'>
    & Partial<Pick<SessionStudyItem, 'contrastSelection'>>,
  fallback?: { wordId: string; displayedMeanings: readonly string[] },
): ContentQualityTarget | null {
  if (item.actionKind === 'production' && item.rehearsal) {
    return { kind: 'rehearsal', packageId: item.rehearsal.packageId, rehearsalId: item.rehearsal.exerciseId };
  }
  if (item.actionKind === 'production' && item.production?.cueId) {
    return { kind: 'production_cue', id: item.production.cueId };
  }
  if (item.actionKind === 'production') {
    if (!fallback) throw new Error('Definition fallback feedback requires the displayed word and meanings.');
    return {
      kind: 'definition_fallback', wordId: fallback.wordId,
      expected: {
        promptText: item.production?.text ?? fallback.displayedMeanings.join('; '),
        displayedMeanings: item.production ? [] : [...fallback.displayedMeanings],
      },
    };
  }
  if (item.actionKind === 'contrast_selection' && item.contentRef?.type === 'contrast_prompt') {
    const prompt = item.contrastSelection?.prompt;
    if (!prompt || prompt.id !== item.contentRef.id) {
      throw new Error('Contrast quality feedback requires the matching frozen prompt.');
    }
    return { kind: 'contrast_prompt', id: prompt.id, expected: {
      promptText: prompt.promptText, explanation: prompt.explanation, targetWordId: prompt.targetWordId,
    } };
  }
  return null;
}

/** Reveal, frozen feedback and Undo retain the same display identity. */
export function sessionContentQualityEncounterId(sessionId: string, actionId: string, answeredCount: number): string {
  return `${sessionId}:${actionId}:${answeredCount}`;
}
