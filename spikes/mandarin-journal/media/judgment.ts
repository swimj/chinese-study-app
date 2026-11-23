import { z } from 'zod';

// Categorical judgments the model reports about one media candidate. The app's
// local policy (local-policy.ts) and composition policy (public/media-policy.js)
// turn them into what is shown; the model never decides visibility itself.
export const referents = ['named', 'concrete', 'scene', 'abstract'] as const;
export const senseMatches = ['entity', 'search', 'none'] as const;
export const addedValues = ['cultural', 'recognition', 'memory', 'interest', 'none'] as const;
export const truthfulnessValues = ['real', 'illustration'] as const;
export const tones = ['fits', 'jarring'] as const;

const reason = z.string().describe('One short sentence explaining this judgment.');
export const judgmentSchema = z.object({
  referent: z.enum(referents),
  senseMatch: z.enum(senseMatches),
  addedValue: z.enum(addedValues),
  truthfulness: z.enum(truthfulnessValues),
  tone: z.enum(tones),
  reasons: z.object({
    referent: reason,
    senseMatch: reason,
    addedValue: reason,
    truthfulness: reason,
    tone: reason,
  }),
});
export type Judgment = z.infer<typeof judgmentSchema>;
export type Referent = Judgment['referent'];
