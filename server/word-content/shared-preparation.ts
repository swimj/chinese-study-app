import { randomUUID } from 'node:crypto';
import { ProviderHttpError } from '../llm/types.ts';
import {
  getSharedIntroductionLexicalWord, getSharedWordIntroductionContent,
  claimSharedWordIntroductionStage,
  finishSharedWordIntroductionBootstrap, finishSharedWordIntroductionTeaching,
  releaseSharedWordIntroductionStage,
  getSharedWordIntroductionComponent, saveSharedWordIntroductionComponent,
} from '../db/word-introductions.ts';
import {
  claimSharedWordReviewPreparation, finishSharedWordReviewPreparation,
  releaseSharedWordReviewPreparation,
} from '../db/review-content.ts';
import { isSharedWordPreparationReady, type WordPreparationStage } from '../db/preparation-work.ts';
import { normalizeWordContent, normalizeTeachingBeats, normalizePracticeRehearsals } from './authoring.ts';
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
      if (stage === 'teaching') {
        const keys = { teaching: await provider.generationKey('teaching'), practice: await provider.generationKey('practice') };
        async function component(part: 'teaching' | 'practice') {
          const existing = getSharedWordIntroductionComponent(wordId, token, content!.id, part, keys[part]);
          if (existing) return existing.payload;
          let componentInvocation: string | null | undefined;
          const options = { onInvocation: (id: string | null | undefined) => { componentInvocation = id; } };
          let output: unknown;
          try {
            output = await (part === 'teaching' ? provider.generateTeaching(content!, options) : provider.generatePractice(content!, options));
          } catch (error) { throw providerFailure(error); }
          const payload = validateWordProviderOutput(componentInvocation, () => part === 'teaching'
            ? { beats: normalizeTeachingBeats(output, content!) }
            : { rehearsals: normalizePracticeRehearsals(output, content!) });
          saveSharedWordIntroductionComponent(wordId, token, { contentId: content!.id, stage: part,
            generationKey: keys[part], payload, model: provider.model, invocationId: componentInvocation ?? null });
          return payload;
        }
        // Wait for both so a failed companion never releases the lease before a successful save.
        const results = await Promise.allSettled([component('teaching'), component('practice')]);
        const failure = results.find((result) => result.status === 'rejected'
          && result.reason instanceof WordPreparationProviderError && result.reason.providerWide)
          ?? results.find((result) => result.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
        const lesson = getSharedWordIntroductionComponent(wordId, token, content.id, 'teaching', keys.teaching)!;
        const practice = getSharedWordIntroductionComponent(wordId, token, content.id, 'practice', keys.practice)!;
        // Components were normalized before storage; package parsing/materialization revalidates their assembly.
        const teaching = { schemaVersion: 1 as const, id: `word-teaching:${randomUUID()}`, wordContentId: content.id,
          beats: (lesson.payload as { beats: import('../../src/domain/word-content/types.ts').TeachingPackage['beats'] }).beats,
          rehearsals: (practice.payload as { rehearsals: import('../../src/domain/word-content/types.ts').TeachingPackage['rehearsals'] }).rehearsals };
        finishSharedWordIntroductionTeaching(wordId, token, teaching, provider.model, keys);
      } else {
        let output: unknown;
        try { output = await provider.generateReview(content, generationOptions); }
        catch (error) { throw providerFailure(error); }
        const batch = randomUUID();
        const exercises = validateWordProviderOutput(invocationId, () => normalizeReviewExercises(output, content, (id) => `word-review:${batch}:${id}`));
        finishSharedWordReviewPreparation(wordId, token, exercises, provider.model);
      }
    },
  };
}
