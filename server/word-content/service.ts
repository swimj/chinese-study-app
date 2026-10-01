import type { WordIntroductionResponse } from '../../src/domain/word-content/application.ts';
import {
  getWordIntroductionLibrary, getWordIntroductionPreparation,
  pinWordTeachingPackage, completeWordTeachingPackage,
} from '../db/word-introductions.ts';
import { requireLearnerId } from '../db/learner-context.ts';
import { enqueueWordPreparation, getWordPreparationWork } from '../db/preparation-work.ts';
import { createWordIntroductionProvider, type WordIntroductionProvider } from './provider.ts';

export class WordIntroductionServiceError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export type WordIntroductionService = {
  get(wordId: string): WordIntroductionResponse;
  prepare(wordId: string): Promise<WordIntroductionResponse>;
  open(wordId: string, packageId: string): WordIntroductionResponse;
  complete(wordId: string, packageId: string): WordIntroductionResponse;
};

export type WordIntroductionStore = {
  library: typeof getWordIntroductionLibrary;
  preparation: typeof getWordIntroductionPreparation;
  pin: typeof pinWordTeachingPackage;
  complete: typeof completeWordTeachingPackage;
};

/** HTTP reads and explicit preparation are queue-backed. Only the worker may call a model. */
export function createWordIntroductionService(options: {
  provider?: Pick<WordIntroductionProvider, 'model' | 'isConfigured'>;
  store?: WordIntroductionStore;
  queue?: { enqueue: typeof enqueueWordPreparation; get: typeof getWordPreparationWork };
  requireLearner?: () => string;
  wake?: () => void;
} = {}): WordIntroductionService {
  const provider = options.provider ?? createWordIntroductionProvider();
  const store = options.store ?? {
    library: getWordIntroductionLibrary,
    preparation: getWordIntroductionPreparation,
    pin: pinWordTeachingPackage,
    complete: completeWordTeachingPackage,
  };
  const queue = options.queue ?? { enqueue: enqueueWordPreparation, get: getWordPreparationWork };
  const requireLearner = options.requireLearner ?? requireLearnerId;

  function get(wordId: string): WordIntroductionResponse {
    requireLearner();
    if (wordId.length === 0 || wordId.length > 200) {
      throw new WordIntroductionServiceError(400, 'Invalid word ID.');
    }
    const library = store.library(wordId);
    if (library === null) throw new WordIntroductionServiceError(404, 'Word not found.');
    const prepared = store.preparation(wordId);
    const teachingWork = queue.get(wordId, 'teaching');
    const bootstrapWork = queue.get(wordId, 'bootstrap');
    const preparationUnavailable = library.selectedPackageId === null && (
      teachingWork?.status === 'paused' || bootstrapWork?.status === 'paused'
      || prepared?.packageId != null
      || (prepared?.contentId != null && !library.contents.some((entry) => entry.content.id === prepared.contentId))
    );
    const preparationPending = library.selectedPackageId === null && !preparationUnavailable && bootstrapWork?.status !== 'paused'
      && (teachingWork?.status === 'queued' || teachingWork?.status === 'running');
    return {
      ...library, generationAvailable: provider.isConfigured(), model: provider.model,
      preparationUnavailable, preparationPending,
    };
  }

  return {
    get,
    async prepare(wordId) {
      const current = get(wordId);
      if (current.selectedPackageId !== null || current.preparationUnavailable) return current;
      const work = queue.enqueue(wordId, 'teaching');
      if (work.status === 'queued') options.wake?.();
      return get(wordId);
    },
    open(wordId, packageId) {
      const current = get(wordId);
      if (!current.packages.some(({ teaching }) => teaching.id === packageId)) {
        throw new WordIntroductionServiceError(409, 'This introduction is unavailable. Please reopen it.');
      }
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
