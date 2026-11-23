import type { Judgment } from './judgment.ts';

export type Ceiling = 'none' | 'latent' | 'placed';

/**
 * Local policy v1: the most visible a system-proposed item may ever be.
 * The thresholds are taste and are expected to change; see MEDIA.md.
 */
export function ceilingFor(j: Judgment): Ceiling {
  if (j.truthfulness !== 'real') return 'none'; // v1 has no generation
  if (j.tone === 'jarring') return 'none';
  if (j.referent === 'scene' || j.referent === 'abstract') return 'none';
  if (j.senseMatch === 'none') return 'none';
  if (
    (j.referent === 'named' || j.referent === 'concrete') &&
    j.senseMatch === 'entity' &&
    (j.addedValue === 'cultural' || j.addedValue === 'recognition' || j.addedValue === 'interest')
  )
    return 'placed';
  return 'latent';
}
