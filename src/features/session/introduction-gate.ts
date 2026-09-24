import type { WordIntroductionResponse } from '../../domain/word-content/application';

export type IntroductionGateStatus = 'checking' | 'introduction' | 'unavailable' | 'passed';
export type IntroductionGateEntry = { key: string; wordId: string; status: IntroductionGateStatus };
export type IntroductionGateLedger = Readonly<Record<string, IntroductionGateStatus>>;

type IntroductionCompletionTarget = {
  state: object | null;
  wordId: string | null | undefined;
  gateKey: string | null | undefined;
};

/** An awaited prior commit must not complete a gate after its session state or navigation changed. */
export function sameIntroductionCompletionTarget(
  source: IntroductionCompletionTarget, current: IntroductionCompletionTarget,
): boolean {
  return source.state !== null && source.state === current.state
    && source.wordId != null && source.wordId === current.wordId
    && source.gateKey != null && source.gateKey === current.gateKey;
}

export function introductionGateCandidate(input: {
  sessionId: string | null; visible: boolean; profile: string;
  word: { id: string; status: string } | null; completedSession: boolean;
}): { key: string; wordId: string } | null {
  if (!input.sessionId || !input.visible || input.completedSession
    || input.profile !== 'mandarin' || input.word?.status !== 'unstudied') return null;
  return { key: JSON.stringify([input.sessionId, input.word.id]), wordId: input.word.id };
}

export function introductionGateStatus(response: WordIntroductionResponse): IntroductionGateStatus {
  // A private navigation marker is not session coverage: explicit in-session completion is required.
  if (response.preparationUnavailable) return 'unavailable';
  return response.selectedPackageId !== null || response.generationAvailable ? 'introduction' : 'unavailable';
}

/** A late check cannot reopen a gate the learner already bypassed/completed. */
export function settleIntroductionGate(
  ledger: IntroductionGateLedger, key: string, status: IntroductionGateStatus,
): IntroductionGateLedger {
  if (ledger[key] === 'passed') return ledger;
  return { ...ledger, [key]: status };
}

/** Cancellation fences resolution even if the transport ignores AbortSignal. */
export function checkIntroductionGate(
  wordId: string,
  load: (wordId: string, signal: AbortSignal) => Promise<WordIntroductionResponse>,
  settle: (status: IntroductionGateStatus) => void,
): () => void {
  const controller = new AbortController();
  let current = true;
  void load(wordId, controller.signal).then((response) => {
    if (!current) return;
    if (response.wordId !== wordId) throw new Error('Introduction response word mismatch');
    settle(introductionGateStatus(response));
  }).catch(() => {
    if (current) settle('unavailable');
  });
  return () => { current = false; controller.abort(); };
}
