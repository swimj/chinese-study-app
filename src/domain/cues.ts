import {
  normalizeProductionAnswerForProfile,
  type StudyProfileId,
} from '../study-profile';

export type TargetedCueFormat = 'definition_gloss' | 'minimal_context' | 'circumstance';

export type CueContentBase = {
  id: string;
  stimulus: string;
  acceptedWordIds: string[];
  active: boolean;
};

export type TargetedCueContent = CueContentBase & {
  kind: 'targeted';
  ownerWordId: string;
  format: TargetedCueFormat;
};

export type PureCueContent = CueContentBase & {
  kind: 'pure';
  axisNote: string;
  teachingNote: string;
};

export type CueContent = TargetedCueContent | PureCueContent;

export type AcceptedCueAnswer = {
  wordId: string;
  hanzi: string;
  traditional: string | null;
};

/**
 * The answer space copied onto a served action. Matching this snapshot keeps
 * live grading independent of later cue-content or lexical-content changes.
 */
export type ServedCueSnapshot = {
  acceptedAnswers: AcceptedCueAnswer[];
};

export function matchServedCueAnswer(
  snapshot: Pick<ServedCueSnapshot, 'acceptedAnswers'>,
  response: string | null,
  profileId: StudyProfileId = 'mandarin',
): AcceptedCueAnswer | null {
  if (response === null) return null;

  const normalizedResponse = normalizeProductionAnswerForProfile(response, profileId);
  return snapshot.acceptedAnswers.find((answer) => (
    cueAnswerForms(answer).some(
      (form) => normalizeProductionAnswerForProfile(form, profileId) === normalizedResponse,
    )
  )) ?? null;
}

export function assertTargetedCueAcceptsOnlyOwner(
  snapshot: Pick<ServedCueSnapshot, 'acceptedAnswers'>,
  ownerWordId: string,
): void {
  if (snapshot.acceptedAnswers.length !== 1) {
    throw new Error(
      'Production snapshot invariant violated: word-owned production must contain exactly one accepted answer.',
    );
  }

  const acceptedAnswer = snapshot.acceptedAnswers[0];
  if (acceptedAnswer === undefined || acceptedAnswer.wordId !== ownerWordId) {
    throw new Error(
      `Production snapshot invariant violated: word-owned production must accept only target word "${ownerWordId}".`,
    );
  }
}

function cueAnswerForms(answer: AcceptedCueAnswer): string[] {
  return [answer.hanzi, answer.traditional].filter((form): form is string => form !== null);
}
