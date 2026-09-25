import { randomUUID } from 'node:crypto';
import { getWordIntroductionLibrary, getWordIntroductionPreparation } from '../db/word-introductions.ts';
import { claimWordReviewPreparation, finishWordReviewPreparation, releaseWordReviewPreparation } from '../db/review-content.ts';
import { requireLearnerId } from '../db/learner-context.ts';
import { runHostedProviderWork } from '../hosted-runtime-controls.ts';
import { normalizeReviewExercises } from './review-authoring.ts';
import { createWordIntroductionProvider, type WordIntroductionProvider } from './provider.ts';

export type WordReviewStore = {
  library: typeof getWordIntroductionLibrary;
  preparation: typeof getWordIntroductionPreparation;
  claim: typeof claimWordReviewPreparation;
  finish: typeof finishWordReviewPreparation;
  release: typeof releaseWordReviewPreparation;
};

/** Review authors independently over the bootstrap; it never promotes teaching drills. */
export function createWordReviewPreparationService(options: {
  provider?: WordIntroductionProvider;
  store?: WordReviewStore;
  requireLearner?: () => string;
  wait?: () => Promise<void>;
  providerWork?: <T>(work: () => Promise<T>) => Promise<T>;
} = {}) {
  const provider = options.provider ?? createWordIntroductionProvider();
  const store: WordReviewStore = options.store ?? {
    library: getWordIntroductionLibrary, preparation: getWordIntroductionPreparation,
    claim: claimWordReviewPreparation, finish: finishWordReviewPreparation, release: releaseWordReviewPreparation,
  };
  const requireLearner = options.requireLearner ?? requireLearnerId;
  const wait = options.wait ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 500)));
  const providerWork = options.providerWork ?? runHostedProviderWork;
  const inFlight = new Map<string, Promise<void>>();

  async function generate(wordId: string) {
    const contentId = store.preparation(wordId)?.contentId;
    const content = store.library(wordId)?.contents.find((entry) => entry.content.id === contentId)?.content;
    if (!content) throw new Error('Eligible bootstrap content is required to prepare review.');
    const deadline = Date.now() + 10 * 60_000;
    while (true) {
      const now = Date.now();
      const token = randomUUID();
      const claim = store.claim(wordId, content.id, token, new Date(now).toISOString(), new Date(now + 5 * 60_000).toISOString());
      if (claim === 'ready') return;
      if (claim === 'claimed') {
        try {
          if (!provider.isConfigured()) throw new Error('Review generation is not configured.');
          await providerWork(async () => {
            const output = await provider.generateReview(content);
            const batchId = randomUUID();
            const exercises = normalizeReviewExercises(output, content, (localId) => `word-review:${batchId}:${localId}`);
            store.finish(wordId, token, exercises, provider.model);
          });
        } finally { store.release(wordId, token); }
        return;
      }
      if (now >= deadline) throw new Error('Review examples are still being prepared.');
      await wait();
    }
  }

  return {
    async prepare(wordId: string): Promise<void> {
      requireLearner();
      let pending = inFlight.get(wordId);
      if (!pending) {
        if (inFlight.size >= 3) throw new Error('Other review examples are being prepared.');
        pending = generate(wordId);
        inFlight.set(wordId, pending);
        void pending.finally(() => inFlight.delete(wordId)).catch(() => undefined);
      }
      await pending;
    },
  };
}
