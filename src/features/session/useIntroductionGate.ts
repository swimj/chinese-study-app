import { useEffect, useState } from 'react';
import { fetchWordIntroduction } from '../../services/api';
import {
  checkIntroductionGate, introductionGateCandidate, settleIntroductionGate,
  type IntroductionGateEntry, type IntroductionGateLedger,
} from './introduction-gate';

export type SessionIntroductionGate = IntroductionGateEntry & { dismiss: () => void; complete?: () => void };

export function useIntroductionGate(input: Parameters<typeof introductionGateCandidate>[0]): { gate: SessionIntroductionGate | null; reopen: (sessionId: string, wordId: string) => void } {
  const candidate = introductionGateCandidate(input);
  const key = candidate?.key ?? null;
  const wordId = candidate?.wordId ?? null;
  const [ledger, setLedger] = useState<IntroductionGateLedger>({});
  const status = key === null ? null : ledger[key] ?? 'checking';

  useEffect(() => {
    if (key === null || wordId === null || status !== 'checking') return;
    return checkIntroductionGate(wordId, fetchWordIntroduction, (nextStatus) => {
      setLedger((previous) => settleIntroductionGate(previous, key, nextStatus));
    });
  }, [key, wordId, status]);

  const gate = candidate === null || status === null || status === 'passed' ? null : {
    ...candidate, status,
    dismiss: () => setLedger((previous) => settleIntroductionGate(previous, candidate.key, 'passed')),
  };
  return {
    gate,
    reopen: (sessionId, restoredWordId) => setLedger((previous) => ({
      ...previous, [JSON.stringify([sessionId, restoredWordId])]: 'introduction',
    })),
  };
}
