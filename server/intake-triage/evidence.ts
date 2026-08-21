import type {
  IntakeTriageProviderRequest,
  IntakeTriageProviderWord,
} from '../../src/domain/intake-triage.ts';
import type { IntakeTriagePriorityWordsResponse } from '../../src/types.ts';
import { config } from '../db/connection.ts';
import { getIntakeTriagePageState } from '../db/intake-triage.ts';
import { getTopUnstudiedPriorityWords } from '../db/persistence.ts';
import { fingerprintIntakeTriageLexicalSnapshot } from './fingerprint.ts';
import { INTAKE_TRIAGE_PROMPT_VERSION } from './provider.ts';

export type SelectedIntakeTriageWord = {
  wordId: string;
  contentFingerprint: string;
  providerWord: IntakeTriageProviderWord;
};

export function getIntakeTriagePriorityWords(limit = 50): IntakeTriagePriorityWordsResponse {
  const payload = getTopUnstudiedPriorityWords(limit);
  if (config.studyProfile !== 'mandarin') {
    return {
      words: payload.words.map((entry) => ({ ...entry, intakeTriage: null })),
      analysisCandidateCount: 0,
    };
  }
  const state = getIntakeTriagePageState(payload.words, INTAKE_TRIAGE_PROMPT_VERSION);
  return {
    words: payload.words.map((entry) => ({
      ...entry,
      intakeTriage: state.annotationsByWordId.get(entry.word.id) ?? null,
    })),
    analysisCandidateCount: state.candidateWordIds.size,
  };
}

export function selectIntakeTriageWords(limit = 50): SelectedIntakeTriageWord[] {
  if (config.studyProfile !== 'mandarin') return [];
  const payload = getTopUnstudiedPriorityWords(limit);
  const state = getIntakeTriagePageState(payload.words, INTAKE_TRIAGE_PROMPT_VERSION);
  return payload.words
    .filter((entry) => state.candidateWordIds.has(entry.word.id))
    .map((entry) => ({
      wordId: entry.word.id,
      contentFingerprint: fingerprintIntakeTriageLexicalSnapshot({
        hanzi: entry.word.hanzi,
        traditional: entry.word.traditional,
        pinyin: entry.word.pinyin,
        meanings: entry.word.meanings,
        examples: entry.word.examples,
      }),
      providerWord: {
        hanzi: entry.word.hanzi,
        pinyin: entry.word.pinyin,
        meanings: entry.word.meanings,
        examples: entry.word.examples,
      },
    }));
}

export function buildIntakeTriageProviderRequest(
  selectedWords: SelectedIntakeTriageWord[],
): IntakeTriageProviderRequest {
  const lexicalReferences = new Set<string>();
  for (const { providerWord } of selectedWords) {
    const reference = JSON.stringify([providerWord.hanzi, providerWord.pinyin]);
    if (lexicalReferences.has(reference)) {
      throw new Error('Invariant violated: intake triage Hanzi and pinyin references must be unique.');
    }
    lexicalReferences.add(reference);
  }
  return { words: selectedWords.map((entry) => entry.providerWord) };
}
