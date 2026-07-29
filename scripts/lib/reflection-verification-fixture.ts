import type {
  ReflectionOperation,
  SessionReflectionBundleV1,
  SessionReflectionResultV4,
} from '../../src/domain/reflection.ts';
import type { MaterializeReflectionArtifactInput } from '../../server/db/reflections.ts';

export const reflectionVerificationFixture = {
  generatedAt: '2026-07-29T12:00:00.000Z',
  startedAt: '2026-07-29T11:30:00.000Z',
  sessionId: 'reflection-verification-session',
  flowVersion: 'initial_post_session_reflection.v1',
} as const;

const words = {
  yu: word('reflection-yu', '俞', 'Yú', ['Yu (surname)']),
  nanguai: word('reflection-nanguai', '难怪', 'nán guài', ['no wonder', 'not surprising']),
  guaiBude: word('reflection-guai-bude', '怪不得', 'guài bu dé', ['no wonder', "so that's why"]),
  chijing: word('reflection-chijing', '吃惊', 'chī jīng', ['to be surprised', 'startled']),
  zhenhan: word('reflection-zhenhan', '震撼', 'zhèn hàn', ['to deeply shock', 'stun']),
  zaiyi: word('reflection-zaiyi', '在意', 'zài yì', ['to care about', 'be concerned with']),
  jieyi: word('reflection-jieyi', '介意', 'jiè yì', ['to mind', 'to object to', 'to take offense']),
};

export function buildReflectionVerificationMaterializationInput(
  sourceSessionId = reflectionVerificationFixture.sessionId,
): MaterializeReflectionArtifactInput {
  const evidenceBundle: SessionReflectionBundleV1 = {
    schemaVersion: 'session_reflection_bundle.v1',
    generatedAt: reflectionVerificationFixture.generatedAt,
    session: {
      sessionId: sourceSessionId,
      startedAt: reflectionVerificationFixture.startedAt,
      endedAt: reflectionVerificationFixture.generatedAt,
      studyProfile: 'mandarin',
    },
    items: [
      productionItem('surname', words.yu, words.zhenhan, 'Yu'),
      productionItem('alternate', words.nanguai, words.guaiBude, '怪不得'),
      productionItem('cue', words.chijing, words.zhenhan, '震撼'),
      productionItem('contrast', words.zaiyi, words.jieyi, '介意'),
    ],
  };

  const result: SessionReflectionResultV4 = {
    schemaVersion: 'session_reflection_result.v4',
    itemResults: [
      itemResult('surname', 'This surname is useful to recognize but not worth direct English-to-hanzi production.', {
        kind: 'suppress_definition_production',
        version: 1,
        wordId: words.yu.wordId,
      }),
      itemResult('alternate', 'The submitted phrase is a reasonable answer to this broad no-wonder cue.', {
        kind: 'accept_production_alternate',
        version: 1,
        targetWordId: words.nanguai.wordId,
        alternateWordId: words.guaiBude.wordId,
      }),
      itemResult('cue', 'The English cue makes ordinary surprise and strong emotional impact look too similar.', {
        kind: 'repair_production_cue',
        version: 1,
        wordId: words.chijing.wordId,
        proposedCues: [{
          cueType: 'definition_gloss',
          text: 'to be surprised or startled (ordinary reaction)',
        }],
        repairIntent: 'add_distinguishing_anchor',
      }),
      itemResult('contrast', 'These words need contextual practice: concern or emotional investment differs from objection or offense.', {
        kind: 'create_contrast_cluster',
        version: 1,
        title: '在意 / 介意 — concern and objection',
        clusterNote: 'Separate caring about something from minding or objecting to it.',
        members: [
          { wordId: words.zaiyi.wordId, nuanceNote: 'care about; be concerned with' },
          { wordId: words.jieyi.wordId, nuanceNote: 'mind; object to; take offense' },
        ],
        prompts: [
          {
            targetWordId: words.zaiyi.wordId,
            promptText: '她很在意别人怎么看她。',
            explanation: 'Here the focus is personal concern and emotional investment.',
          },
          {
            targetWordId: words.jieyi.wordId,
            promptText: '你介意我坐这里吗？',
            explanation: 'Here the focus is whether someone minds or objects.',
          },
        ],
      }),
    ],
  };

  return {
    sourceSessionId,
    reflectionFlowVersion: reflectionVerificationFixture.flowVersion,
    generatedAt: reflectionVerificationFixture.generatedAt,
    provider: 'fixture',
    model: 'reflection-verification-fixture',
    promptVersion: 'reflection-verification-fixture.v1',
    evidenceBundle,
    result,
  };
}

function itemResult(itemId: string, observation: string, operation: ReflectionOperation): SessionReflectionResultV4['itemResults'][number] {
  return {
    itemId,
    diagnosisTags: ['persistent_confusion'],
    observation,
    learnerExplanation: null,
    proposals: [{
      proposalGroupKey: null,
      rationale: 'This deterministic fixture keeps one reviewable operation per brainstorm case.',
      operation,
    }],
    questions: [],
    unhandledNeeds: [],
  };
}

function productionItem(
  itemId: string,
  targetWord: SessionReflectionBundleV1['items'][number]['targetWord'],
  submittedWord: SessionReflectionBundleV1['items'][number]['targetWord'],
  rawResponse: string,
): SessionReflectionBundleV1['items'][number] {
  return {
    itemId,
    sessionActionId: `fixture-action-${itemId}`,
    occurredAt: '2026-07-29T11:59:00.000Z',
    source: 'production_mistake',
    sourceActionKind: 'production',
    targetWord,
    sessionNote: null,
    existingContent: { contrastClusters: [], knownAcceptedAlternates: [] },
    cuesAsShown: [{
      cueId: null,
      cueType: 'definition_gloss',
      displayOrder: 0,
      text: targetWord.meanings.join('; '),
      displayedMeanings: targetWord.meanings,
    }],
    rawResponse,
    submittedWord,
    responseKind: 'matched_known_word',
  };
}

function word(
  wordId: string,
  hanzi: string,
  pinyin: string,
  meanings: string[],
): SessionReflectionBundleV1['items'][number]['targetWord'] {
  return {
    wordId,
    hanzi,
    pinyin,
    meanings,
  };
}
