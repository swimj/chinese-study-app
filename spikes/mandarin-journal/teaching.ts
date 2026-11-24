// Teaching an expression the learner has chosen but never studied: an ordered
// sequence of beats the learner advances one at a time before practicing it.
import type { TurnContext } from './tutor.ts';

export type BeatPart =
  | { kind: 'text'; text: string }
  | { kind: 'chinese'; text: string; pinyin?: string }
  | { kind: 'translation'; text: string }
  | { kind: 'note'; text: string };
export type Beat = { id: string; parts: BeatPart[] };

/**
 * What the journal knows about the expression. A word the learner saved through
 * intake also has the example sentence and translation prepared then; `why` is
 * the journal's evidence for teaching it now, including where it was met.
 */
export type TeachTarget = {
  form: string;
  pinyin: string | null;
  gloss: string | null;
  example?: string;
  translation?: string;
  why?: string;
};
export type TeachRequest = TeachTarget;

/**
 * Asks for teaching beats on one target. Returns undefined when the call or its
 * validation fails, so the caller can still serve practice without them.
 */
export async function teachingFor(
  target: TeachTarget,
  ctx: TurnContext,
  consult: (ctx: TurnContext) => Promise<Beat[]>,
): Promise<Beat[] | undefined> {
  try {
    const beats = await consult({ ...ctx, trigger: 'teach', teach: target });
    return beats.length ? beats : undefined;
  } catch (error) {
    console.warn('Teaching ' + target.form + ' failed: ' + (error instanceof Error ? error.message : String(error)));
    return undefined;
  }
}
