import { useState } from 'react';
import type { WordIntroductionResponse } from '../../domain/word-content/application';
import {
  introductionGateCandidate, introductionGateStatus,
  type IntroductionGateEntry, type IntroductionGateLedger,
} from './introduction-gate';

export type SessionIntroductionGate = IntroductionGateEntry & {
  preloadedIntroduction: WordIntroductionResponse;
  dismiss: () => void;
  complete: () => void;
};

type GateInput = Parameters<typeof introductionGateCandidate>[0] & {
  introductions?: Readonly<Record<string, WordIntroductionResponse>>;
};

export function useIntroductionGate(input: GateInput): {
  gate: Omit<SessionIntroductionGate, 'complete'> | null;
  reopen: (sessionId: string, wordId: string) => void;
} {
  const candidate = introductionGateCandidate(input);
  const [ledger, setLedger] = useState<IntroductionGateLedger>({});
  if (candidate === null || ledger[candidate.key] === 'passed') {
    return {
      gate: null,
      reopen: (sessionId, wordId) => setLedger((previous) => ({
        ...previous, [JSON.stringify([sessionId, wordId])]: 'introduction',
      })),
    };
  }
  const preloadedIntroduction = input.introductions?.[candidate.wordId];
  if (!preloadedIntroduction || preloadedIntroduction.wordId !== candidate.wordId) {
    throw new Error('An admitted Mandarin word has no introduction snapshot.');
  }
  return {
    gate: {
      ...candidate,
      status: introductionGateStatus(preloadedIntroduction),
      preloadedIntroduction,
      dismiss: () => setLedger((previous) => ({ ...previous, [candidate.key]: 'passed' })),
    },
    reopen: (sessionId, wordId) => setLedger((previous) => ({
      ...previous, [JSON.stringify([sessionId, wordId])]: 'introduction',
    })),
  };
}
