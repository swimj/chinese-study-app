import { randomUUID } from 'node:crypto';
import { wordContentFixtures } from '../../src/features/introduction-lab/samples.ts';
import {
  claimSharedWordIntroductionStage,
  finishSharedWordIntroductionBootstrap,
  finishSharedWordIntroductionTeaching,
} from '../db/word-introductions.ts';

/** Fresh dev seeds opt into the same authored examples used by the lab. */
export function seedWordIntroductionFixtures(wordIds: readonly string[]): void {
  for (const wordId of wordIds) {
    const fixture = wordContentFixtures.find(({ content }) => content.word.wordId === wordId);
    if (!fixture) throw new Error(`Unknown word introduction seed fixture: ${wordId}`);
    for (const stage of ['bootstrap', 'teaching'] as const) {
      const token = randomUUID();
      const now = new Date();
      const claim = claimSharedWordIntroductionStage(
        wordId, stage, token, now.toISOString(), new Date(now.getTime() + 60_000).toISOString(),
      );
      if (claim === 'ready') continue;
      if (claim !== 'claimed') throw new Error(`Introduction seed fixture is busy: ${wordId}`);
      if (stage === 'bootstrap') {
        finishSharedWordIntroductionBootstrap(wordId, token, fixture.content, 'authored-dev-fixture');
      } else {
        finishSharedWordIntroductionTeaching(wordId, token, fixture.teaching, 'authored-dev-fixture');
      }
    }
  }
}
