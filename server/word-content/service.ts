import { randomUUID } from 'node:crypto';
import type { WordIntroductionResponse } from '../../src/domain/word-content/application.ts';
import {
  getIntroductionLexicalWord, getWordIntroductionLibrary,
  getWordIntroductionPreparation, claimWordIntroductionStage,
  finishWordIntroductionBootstrap, finishWordIntroductionTeaching, releaseWordIntroductionStage,
  pinWordTeachingPackage, completeWordTeachingPackage,
} from '../db/word-introductions.ts';
import { requireLearnerId } from '../db/learner-context.ts';
import { runHostedProviderWork } from '../hosted-runtime-controls.ts';
import { normalizeTeachingPackage, normalizeWordContent } from './authoring.ts';
import { createWordIntroductionProvider, type WordIntroductionProvider } from './provider.ts';

export class WordIntroductionServiceError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export type WordIntroductionService = {
  get(wordId: string): WordIntroductionResponse;
  prepare(wordId: string): Promise<WordIntroductionResponse>;
  complete(wordId: string, packageId: string): WordIntroductionResponse;
};

export type WordIntroductionStore = {
  lexical: typeof getIntroductionLexicalWord;
  library: typeof getWordIntroductionLibrary;
  preparation: typeof getWordIntroductionPreparation;
  claim: typeof claimWordIntroductionStage;
  finishBootstrap: typeof finishWordIntroductionBootstrap;
  finishTeaching: typeof finishWordIntroductionTeaching;
  release: typeof releaseWordIntroductionStage;
  pin: typeof pinWordTeachingPackage;
  complete: typeof completeWordTeachingPackage;
};

/** Generated content is shared; pinning and completion always run in the caller's context. */
export function createWordIntroductionService(options: {
  provider?: WordIntroductionProvider;
  store?: WordIntroductionStore;
  requireLearner?: () => string;
  wait?: () => Promise<void>;
  providerWork?: <T>(work: () => Promise<T>) => Promise<T>;
} = {}): WordIntroductionService {
  const provider = options.provider ?? createWordIntroductionProvider();
  const store: WordIntroductionStore = options.store ?? {
    lexical: getIntroductionLexicalWord, library: getWordIntroductionLibrary,
    preparation: getWordIntroductionPreparation, claim: claimWordIntroductionStage,
    finishBootstrap: finishWordIntroductionBootstrap, finishTeaching: finishWordIntroductionTeaching,
    release: releaseWordIntroductionStage,
    pin: pinWordTeachingPackage, complete: completeWordTeachingPackage,
  };
  const requireLearner = options.requireLearner ?? requireLearnerId;
  const providerWork = options.providerWork ?? runHostedProviderWork;
  const wait = options.wait ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 500)));
  const inFlight = new Map<string, Promise<string>>();

  function get(wordId: string): WordIntroductionResponse {
    requireLearner();
    if (wordId.length === 0 || wordId.length > 200) {
      throw new WordIntroductionServiceError(400, 'Invalid word ID.');
    }
    const library = store.library(wordId);
    if (library === null) throw new WordIntroductionServiceError(404, 'Word not found.');
    const prepared = store.preparation(wordId);
    const preparationUnavailable = library.selectedPackageId === null && (
      prepared?.packageId != null
      || (prepared?.contentId != null && !library.contents.some((entry) => entry.content.id === prepared.contentId))
    );
    return { ...library, generationAvailable: provider.isConfigured(), model: provider.model, preparationUnavailable };
  }

  async function stage(wordId: string, name: 'bootstrap' | 'teaching', work: (token: string) => Promise<void>): Promise<void> {
    const deadline = Date.now() + 10 * 60_000;
    while (true) {
      const now = Date.now();
      const token = randomUUID();
      // Longer than the provider's 180-second timeout; expired ownership cannot publish.
      const claim = store.claim(wordId, name, token, new Date(now).toISOString(), new Date(now + 5 * 60_000).toISOString());
      if (claim === 'ready') return;
      if (claim === 'claimed') {
        try { await providerWork(() => work(token)); }
        finally { store.release(wordId, token); }
        return;
      }
      if (now >= deadline) {
        throw new WordIntroductionServiceError(503, 'This introduction is still being prepared. Please try again shortly.');
      }
      await wait();
    }
  }

  async function generate(wordId: string): Promise<string> {
    const lexical = store.lexical(wordId);
    if (lexical === null) throw new WordIntroductionServiceError(404, 'Word not found.');
    await stage(wordId, 'bootstrap', async (token) => {
      let output: unknown;
      try {
        output = await provider.generateBootstrap({
          hanzi: lexical.hanzi, traditional: lexical.traditional, pinyin: lexical.pinyin,
          guidance: `Corpus meanings: ${lexical.meanings.join('; ')}`.slice(0, 2_000),
        });
      } catch {
        throw new WordIntroductionServiceError(502, 'Word preparation is temporarily unavailable. You can retry or continue with the usual cards.');
      }
      let content;
      try {
        content = normalizeWordContent(output, {
          wordId, hanzi: lexical.hanzi, traditional: lexical.traditional, pinyin: lexical.pinyin,
        }, `word-content:${randomUUID()}`);
      } catch {
        throw new WordIntroductionServiceError(502, 'The prepared word content did not pass validation. Please retry.');
      }
      store.finishBootstrap(wordId, token, content, provider.model);
    });
    const contentId = store.preparation(wordId)?.contentId;
    const content = get(wordId).contents.find((entry) => entry.content.id === contentId)?.content;
    if (!content) throw new WordIntroductionServiceError(409, 'This word’s prepared content is unavailable. You can continue with the usual cards.');
    // Content survives a teaching failure and is reused on the next attempt.
    await stage(wordId, 'teaching', async (token) => {
      let output: unknown;
      try { output = await provider.generateTeaching(content); }
      catch {
        throw new WordIntroductionServiceError(502, 'The introduction could not be prepared. Your word content is saved; retry when ready.');
      }
      let teaching;
      try { teaching = normalizeTeachingPackage(output, content, `word-teaching:${randomUUID()}`); }
      catch {
        throw new WordIntroductionServiceError(502, 'The introduction did not pass validation. Your word content is saved; please retry.');
      }
      store.finishTeaching(wordId, token, teaching, provider.model);
    });
    const packageId = get(wordId).selectedPackageId;
    if (!packageId) throw new WordIntroductionServiceError(409, 'This introduction is unavailable. You can continue with the usual cards.');
    return packageId;
  }

  return {
    get,
    async prepare(wordId) {
      const current = get(wordId);
      if (current.selectedPackageId !== null) {
        store.pin(wordId, current.selectedPackageId);
        return get(wordId);
      }
      if (current.preparationUnavailable) throw new WordIntroductionServiceError(409, 'This introduction is unavailable. You can continue with the usual cards.');
      if (!provider.isConfigured()) throw new WordIntroductionServiceError(503, 'Introduction generation is not configured. You can continue with the usual cards.');
      let pending = inFlight.get(wordId);
      if (pending === undefined) {
        // Bound whole-word work across learners while sharing identical concurrent requests.
        if (inFlight.size >= 3) throw new WordIntroductionServiceError(429, 'Other introductions are being prepared. Please try again shortly.');
        pending = generate(wordId);
        inFlight.set(wordId, pending);
        void pending.finally(() => inFlight.delete(wordId)).catch(() => undefined);
      }
      const packageId = await pending;
      store.pin(wordId, packageId);
      return get(wordId);
    },
    complete(wordId, packageId) {
      get(wordId);
      store.complete(wordId, packageId);
      return get(wordId);
    },
  };
}
