import { randomUUID } from 'node:crypto';
import { ProviderHttpError } from '../llm/types.ts';
import {
  getSharedIntroductionLexicalWord, getSharedWordIntroductionContent,
  claimSharedWordIntroductionStage,
  finishSharedWordIntroductionBootstrap, finishSharedWordIntroductionTeaching,
  releaseSharedWordIntroductionStage,
} from '../db/word-introductions.ts';
import {
  claimSharedWordReviewPreparation, finishSharedWordReviewPreparation,
  releaseSharedWordReviewPreparation,
} from '../db/review-content.ts';
import { isSharedWordPreparationReady, type WordPreparationStage } from '../db/preparation-work.ts';
import { normalizeWordContent, normalizeTeachingPackage } from './authoring.ts';
import { normalizeReviewExercises } from './review-authoring.ts';
import { createWordIntroductionProvider, validateWordProviderOutput, type WordIntroductionProvider } from './provider.ts';

export class WordPreparationProviderError extends Error {
  constructor(message: string, readonly providerWide: boolean) { super(message); }
}
function providerFailure(error: unknown): WordPreparationProviderError {
  const safeMessages = new Set([
    'Introduction generation output was truncated.',
    'Introduction generation returned invalid JSON.',
    'Introduction generation returned an invalid structure.',
  ]);
  if (error instanceof Error && safeMessages.has(error.message)) {
    return new WordPreparationProviderError(error.message, false);
  }
  if (error instanceof ProviderHttpError) {
    return new WordPreparationProviderError(`Provider returned HTTP ${error.status}.`,
      error.status === 401 || error.status === 403 || error.status === 429 || error.status >= 500);
  }
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return new WordPreparationProviderError('Provider request timed out or was interrupted.', true);
  }
  return new WordPreparationProviderError('Provider request failed (transport or response error).', true);
}
/** No learner context or private writes: background generation publishes only shared content. */
export function createSharedWordPreparation(provider: WordIntroductionProvider = createWordIntroductionProvider()) {
  return {
    isConfigured: () => provider.isConfigured(),
    source: getSharedWordIntroductionContent,
    ready: isSharedWordPreparationReady,
    claim(wordId: string, stage: WordPreparationStage, token: string, now: string, expiresAt: string) {
      if (stage === 'review') {
        const content = getSharedWordIntroductionContent(wordId);
        if (!content) throw new Error('Eligible bootstrap required before review');
        return claimSharedWordReviewPreparation(wordId, content.id, token, now, expiresAt);
      }
      return claimSharedWordIntroductionStage(wordId, stage, token, now, expiresAt);
    },
    release(wordId: string, stage: WordPreparationStage, token: string) {
      if (stage === 'review') releaseSharedWordReviewPreparation(wordId, token);
      else releaseSharedWordIntroductionStage(wordId, token);
    },
    async generate(wordId: string, stage: WordPreparationStage, token: string): Promise<void> {
      let invocationId: string | null | undefined;
      const generationOptions = { onInvocation: (id: string | null | undefined) => { invocationId = id; } };
      if (stage === 'bootstrap') {
        const lexical = getSharedIntroductionLexicalWord(wordId);
        if (!lexical) throw new Error('Lexical word missing');
        let output: unknown;
        try {
          output = await provider.generateBootstrap({ hanzi: lexical.hanzi, traditional: lexical.traditional,
            pinyin: lexical.pinyin, guidance: `Corpus meanings: ${lexical.meanings.join('; ')}`.slice(0, 2_000) }, generationOptions);
        } catch (error) { throw providerFailure(error); }
        const content = validateWordProviderOutput(invocationId, () => normalizeWordContent(output, { wordId, hanzi: lexical.hanzi, traditional: lexical.traditional, pinyin: lexical.pinyin }, `word-content:${randomUUID()}`));
        finishSharedWordIntroductionBootstrap(wordId, token, content, provider.model);
        return;
      }
      const content = getSharedWordIntroductionContent(wordId);
      if (!content) throw new Error('Eligible bootstrap content unavailable');
      let output: unknown;
      try { output = await (stage === 'teaching' ? provider.generateTeaching(content, generationOptions) : provider.generateReview(content, generationOptions)); }
      catch (error) { throw providerFailure(error); }
      // Validation diagnostics contain only shared model output identities, never learner evidence or provider bodies.
      if (stage === 'teaching') {
        const teaching = validateWordProviderOutput(invocationId, () => normalizeTeachingPackage(output, content, `word-teaching:${randomUUID()}`));
        finishSharedWordIntroductionTeaching(wordId, token, teaching, provider.model);
      } else {
        const batch = randomUUID();
        const exercises = validateWordProviderOutput(invocationId, () => normalizeReviewExercises(output, content, (id) => `word-review:${batch}:${id}`));
        finishSharedWordReviewPreparation(wordId, token, exercises, provider.model);
      }
    },
  };
}
