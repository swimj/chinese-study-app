import type {
  ProductionMistakeReflectionItemV1,
  ReflectionProviderFixtureV0,
  ReflectionWordSnapshotV1,
  SessionReflectionBundleV1,
} from '../contracts.js';

const FIXTURE_TIME = '2026-07-13T12:00:00.000Z';
const PREFIX = 'stress-yangtze-naming';
const ITEM_ID = `${PREFIX}-item`;
const TARGET_WORD_ID = `${PREFIX}-target`;
const SUBMITTED_WORD_ID = `${PREFIX}-submitted`;
const ATTEMPT_ID = `${PREFIX}-attempt-1`;
const CUE_TEXT = 'Yangtze river, or Chang Jiang';

function word(
  wordId: string,
  hanzi: string,
  pinyin: string,
  meanings: string[],
): ReflectionWordSnapshotV1 {
  return {
    wordId,
    hanzi,
    pinyin,
    meanings,
    production: { relevance: 'normal', notes: [] },
  };
}

const targetWord = word(
  TARGET_WORD_ID,
  '长江',
  'chángjiāng',
  ['Yangtze River', 'Chang Jiang'],
);

const submittedWord = word(
  SUBMITTED_WORD_ID,
  '扬子江',
  'yángzǐjiāng',
  [
    'Changjiang 長江|长江 or Yangtze River',
    'old name for Changjiang, especially the lower reaches around Yangzhou 扬州',
  ],
);

const item: ProductionMistakeReflectionItemV1 = {
  itemId: ITEM_ID,
  source: 'production_mistake',
  sourceActionKind: 'production',
  sessionActionId: `session-${PREFIX}/action-1`,
  occurredAt: '2026-07-13T11:55:00.000Z',
  targetWord,
  sessionNote: null,
  existingContent: {
    contrastClusters: [],
    knownAcceptedAlternates: [],
  },
  cuesAsShown: [{
    cueId: null,
    cueType: 'definition_gloss',
    displayOrder: 0,
    text: CUE_TEXT,
    displayedMeanings: targetWord.meanings,
  }],
  rawResponse: '扬子江',
  submittedWord,
  responseKind: 'matched_known_word',
  attempts: [{
    attemptId: ATTEMPT_ID,
    occurredAt: '2026-07-13T11:55:00.000Z',
    actionAttemptSequence: 1,
    outcome: 'incorrect',
    rating: 'forgot',
    response: '扬子江',
  }],
  attemptShape: {
    firstResponseOutcome: 'incorrect',
    resolution: 'unknown',
    terminalRating: 'forgot',
    attemptCountForAction: 1,
    managementAction: null,
  },
};

const bundle: SessionReflectionBundleV1 = {
  schemaVersion: 'session_reflection_bundle.v1',
  generatedAt: FIXTURE_TIME,
  session: {
    sessionId: `session-${PREFIX}`,
    startedAt: '2026-07-13T11:50:00.000Z',
    endedAt: FIXTURE_TIME,
    studyProfile: 'mandarin',
  },
  items: [item],
};

export const stressCaseFixtures: ReflectionProviderFixtureV0[] = [{
  fixtureVersion: 'reflection_provider_fixture.v0',
  fixtureId: 'stress-yangtze-name-production',
  source: {
    kind: 'user_supplied_stress_case',
    suppliedAt: '2026-07-13',
    title: '长江 / 扬子江 proper-name production',
  },
  readiness: 'ready',
  readinessNotes: [
    'Exploratory: score the diagnosis and question more strongly than the exact follow-up handle set.',
    'The supplied gloss is treated as evidence; the fixture does not require outside geographical claims.',
  ],
  inputBundle: bundle,
  referenceResult: {
    schemaVersion: 'session_reflection_result.v4',
    itemResults: [{
      itemId: ITEM_ID,
      diagnosisTags: [
        'valid_or_near_valid_alternate',
        'production_cue_overloaded',
        'insufficient_evidence',
      ],
      observation: '“Chang Jiang” effectively supplies the target pronunciation, while “Yangtze River” does not say whether the modern standard name or another valid name is required. The submitted gloss makes a simple wrong-answer diagnosis unsafe.',
      learnerExplanation: '长江 is the intended modern standard target here. The supplied gloss presents 扬子江 as a historically or regionally limited name for the same river, so it is related and potentially creditworthy without being interchangeable in every context. Whether recalling Chinese proper names is worthwhile production knowledge depends on the learner’s real communication goals.',
      proposals: [],
      questions: [{
        question: 'Should this production item test recall of the modern standard name 长江, accept any valid Chinese name for the river, or test geographical and cultural naming knowledge more broadly?',
        reason: 'Those goals imply different grading and may make production practice more or less valuable for this learner.',
      }],
      unhandledNeeds: [],
    }],
  },
  evaluation: {
    mode: 'exploratory',
    requiredDiagnosisTags: ['valid_or_near_valid_alternate', 'production_cue_overloaded', 'insufficient_evidence'],
    forbiddenDiagnosisTags: ['ordinary_retrieval_noise'],
    acceptableProposalProfiles: [
      {
        requiredKinds: [],
        allowedKinds: [],
        description: 'Retain the diagnosis and ask what competency is intended before choosing a concrete repair.',
      },
      {
        requiredKinds: ['repair_production_cue'],
        allowedKinds: ['repair_production_cue'],
        description: 'Offer a concrete goal-specific cue repair without pretending it settles the policy question.',
      },
    ],
    questionPolicy: 'required',
    unhandledNeedPolicy: 'allowed',
    requiredJudgments: [
      'Notice that “Chang Jiang” leaks the target pronunciation rather than serving as an ordinary semantic cue.',
      'Use the supplied gloss to treat 扬子江 as a valid historical or regional name, not an unrelated wrong answer.',
      'Distinguish the modern standard target from valid names that are not interchangeable in every context.',
      'Recognize that the value of producing geographical proper names depends on the learner’s communication goals.',
      'Ask what competency the production item is intended to test before committing to a policy-heavy repair.',
    ],
    forbiddenJudgments: [
      'Treat the response as an ordinary retrieval lapse.',
      'Claim that 长江 and 扬子江 are interchangeable in all contexts.',
      'Suppress proper-name production unconditionally without learner-goal evidence.',
      'Invent geographical distinctions beyond the supplied gloss and mark them as established evidence.',
    ],
  },
}];
