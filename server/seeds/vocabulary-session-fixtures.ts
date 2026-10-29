import type { VocabularyContentDraft } from '../../src/domain/vocabulary-content.ts';
import { getConfig, getDb } from '../db/connection.ts';
import { createVocabularyContent, createVocabularySense } from '../db/vocabulary-content.ts';

type PracticeFixture = {
  wordId: string;
  hanzi: string;
  traditional: string;
  definition: string;
  teachingNote: string;
  examples: readonly [string, string];
  translations: readonly [string, string];
};

/** Authored walkthrough material, not an evaluation set or generated production content. */
const practiceFixtures: readonly PracticeFixture[] = [
  {
    wordId: 'hc-鼓舞-gǔu5fwǔ', hanzi: '鼓舞', traditional: '鼓舞',
    definition: 'To lift someone’s spirits and give them confidence to keep going.',
    teachingNote: '鼓舞 emphasizes the boost in morale: 受到鼓舞 means to feel encouraged or inspired.',
    examples: ['教练的信任给了年轻队员很大的鼓舞。', '看到救援队赶到，大家都深受鼓舞。'],
    translations: ['The coach’s trust gave the young players a great boost in morale.', 'Everyone felt greatly encouraged when they saw the rescue team arrive.'],
  },
  {
    wordId: 'hc-百分点-bǎiu5ffēnu5fdiǎn', hanzi: '百分点', traditional: '百分點',
    definition: 'The unit used for the difference between two percentage figures, rather than their relative growth.',
    teachingNote: '从20%到25% is an increase of 五个百分点. State the starting and ending percentages before describing the difference.',
    examples: ['支持率从百分之四十升到百分之四十五，提高了五个百分点。', '失业率从百分之六降到百分之四，下降了两个百分点。'],
    translations: ['Support rose from 40% to 45%, an increase of five percentage points.', 'Unemployment fell from 6% to 4%, a decrease of two percentage points.'],
  },
  {
    wordId: 'hc-部署-bùu5fshǔ', hanzi: '部署', traditional: '部署',
    definition: 'To arrange people or resources strategically, or put a software system into its intended running environment.',
    teachingNote: '部署 is used for organized operational arrangements and software deployment: 部署救援力量、部署应用。',
    examples: ['台风到来之前，当地已经部署了救援力量。', '测试通过以后，工程师把新版本部署到服务器上。'],
    translations: ['Before the typhoon arrived, the local authorities had already deployed rescue resources.', 'After the tests passed, the engineer deployed the new version to the server.'],
  },
  {
    wordId: 'hc-馋-chán', hanzi: '馋', traditional: '饞',
    definition: 'To crave tasty food; to have your appetite tempted by something delicious.',
    teachingNote: '馋 focuses on wanting something delicious, rather than simply being hungry. 看得我都馋了 means that seeing it has made you crave it.',
    examples: ['闻到烤红薯的香味，我一下子就馋了。', '你发的火锅照片看得我都馋了。'],
    translations: ['The smell of roasted sweet potatoes suddenly made me crave them.', 'Your hotpot photos have made my mouth water.'],
  },
  {
    wordId: 'hc-阐述-chǎnu5fshù', hanzi: '阐述', traditional: '闡述',
    definition: 'To explain a view, argument, or principle in a clear and developed way, especially in formal speech or writing.',
    teachingNote: '阐述 commonly takes 观点、理由、原理 as its object. It suggests a developed explanation, rather than merely mentioning a point.',
    examples: ['请在报告中详细阐述你的观点。', '作者用三个例子阐述了这个原理。'],
    translations: ['Please explain your position in detail in the report.', 'The author used three examples to explain this principle.'],
  },
];

export const vocabularySessionPracticeWordIds = practiceFixtures.map(({ wordId }) => wordId);

const heldFixture: PracticeFixture = {
  wordId: 'hc-花卉-huāu5fhuì', hanzi: '花卉', traditional: '花卉',
  definition: 'A collective term for flowering plants, often used in gardening, exhibitions, and horticulture.',
  teachingNote: '花卉 is a collective horticultural term. For a particular flower or bouquet in everyday conversation, 花 is usually enough.',
  examples: ['这家苗圃专门培育适合阳台种植的花卉。', '春季花卉展吸引了许多园艺爱好者。'],
  translations: ['This nursery specializes in flowering plants suitable for growing on balconies.', 'The spring flower exhibition attracted many gardening enthusiasts.'],
};

/**
 * Called only by the fresh-directory vocabulary fixture command, inside its transaction.
 * Creates current content directly; the caller owns learner modes and schedules.
 */
export function prepareVocabularySessionPracticeFixtures(): {
  practiceWordIds: string[];
  exerciseIdsByWord: Record<string, string[]>;
  heldWordId: string;
  heldIntroductionId: string;
  heldTeachingExerciseId: string;
} {
  const config = getConfig();
  if (config.mode !== 'dev' || config.authMode !== 'trusted_local' || config.studyProfile !== 'mandarin') {
    throw new Error('Vocabulary session fixtures require trusted-local Mandarin development mode');
  }
  const db = getDb();
  if (!db.isTransaction) throw new Error('Vocabulary session fixtures require the fixture transaction');
  const exerciseIdsByWord: Record<string, string[]> = {};
  for (const fixture of [...practiceFixtures, heldFixture]) {
    const lexical = db.prepare('SELECT hanzi FROM lexical_words WHERE id=?').get(fixture.wordId) as { hanzi: string } | undefined;
    if (lexical?.hanzi !== fixture.hanzi) throw new Error(`Missing vocabulary fixture lexical word: ${fixture.wordId}`);
    // Synthetic authored mappings make sense-specific reveals reviewable in this
    // fresh walkthrough. Other fixtures deliberately exercise dictionary fallback.
    const sense = ['馋','百分点'].includes(fixture.hanzi) ? createVocabularySense({
      senseId: `vocabulary-session-fixture:${fixture.wordId}:sense`,wordId: fixture.wordId,
      description: { label: fixture.definition,notes: [fixture.teachingNote],
        source: { kind: 'authored_dev_fixture',fixture: 'vocabulary-session-walkthrough',synthetic: true } },
    },{ kind: 'operator',id: 'vocabulary-session-fixture' }) : undefined;
    exerciseIdsByWord[fixture.wordId] = [];
    for (let variant = 0; variant < 3; variant++) {
      const exampleIndex = variant === 1 ? 1 : 0;
      const sentence = fixture.examples[exampleIndex];
      const definition = variant === 2;
      const prompt = definition ? fixture.definition : sentence.replace(fixture.hanzi, '____');
      const contentId = `vocabulary-session-fixture:${fixture.wordId}:${variant + 1}`;
      const draft: VocabularyContentDraft = {
        contentId, kind: 'exercise', payloadVersion: 1,
        exerciseType: definition ? 'definition' : 'cloze', skill: 'production', exerciseRole: 'general',
        body: {
          prompt,
          instruction: definition ? 'Give the Mandarin word.' : 'Fill the gap with the Mandarin expression.',
          stimulus: { kind: 'direct_text', text: prompt },
          reveal: { exampleSentence: sentence, exampleTranslation: fixture.translations[exampleIndex], teachingNote: fixture.teachingNote },
          source: { kind: 'authored_dev_fixture', fixture: 'vocabulary-session-walkthrough' },
        },
        assessment: { responseMode: 'hanzi_entry' },
        accessScope: 'shared', availability: 'active', originKind: 'human',
        authorKind: 'operator', authorId: 'vocabulary-session-fixture',
        words: [{ wordId: fixture.wordId, relation: 'target',
          ...(sense ? { senseId: sense.senseId,senseMappingEstablishedAt: sense.createdAt } : {}) }],
        answers: [{ wordId: fixture.wordId, acceptedForms: [...new Set([fixture.hanzi, fixture.traditional])] }],
      };
      createVocabularyContent(draft, { kind: 'operator', id: 'vocabulary-session-fixture' });
      exerciseIdsByWord[fixture.wordId].push(contentId);
    }
  }
  const heldTeachingExerciseId = `vocabulary-session-fixture:${heldFixture.wordId}:teaching`;
  const heldIntroductionId = `vocabulary-session-fixture:${heldFixture.wordId}:introduction`;
  const actor = { kind: 'operator' as const, id: 'vocabulary-session-fixture' };
  createVocabularyContent({
    contentId: heldTeachingExerciseId, kind: 'exercise', payloadVersion: 1,
    exerciseType: 'cloze', skill: 'production', exerciseRole: 'teaching',
    body: {
      prompt: '园艺中心出售各种适合室内种植的____。', instruction: 'Use the expression just taught.',
      reveal: { exampleSentence: '园艺中心出售各种适合室内种植的花卉。',
        exampleTranslation: 'The garden center sells various flowering plants suitable for growing indoors.',
        teachingNote: heldFixture.teachingNote },
    },
    assessment: { responseMode: 'hanzi_entry' }, accessScope: 'shared', availability: 'active',
    originKind: 'human', authorKind: 'operator', authorId: actor.id,
    words: [{ wordId: heldFixture.wordId, relation: 'target' }],
    answers: [{ wordId: heldFixture.wordId, acceptedForms: ['花卉'] }],
  }, actor);
  createVocabularyContent({
    contentId: heldIntroductionId, kind: 'introduction', payloadVersion: 1,
    body: { beats: [
      { id: 'meaning', text: '花卉 (huā huì) is a collective term for flowering plants. You will see it in garden centers, exhibitions, and horticultural writing.' },
      { id: 'example', text: '园艺中心出售各种适合室内种植的花卉。\nThe garden center sells various flowering plants suitable for growing indoors.' },
      { id: 'usage', text: heldFixture.teachingNote },
    ] },
    accessScope: 'shared', availability: 'active', originKind: 'human', authorKind: 'operator', authorId: actor.id,
    words: [{ wordId: heldFixture.wordId, relation: 'target' }],
    teachingExercises: [{ exerciseId: heldTeachingExerciseId, exerciseVersion: 1 }],
  }, actor);
  return { practiceWordIds: [...vocabularySessionPracticeWordIds], exerciseIdsByWord,
    heldWordId: heldFixture.wordId, heldIntroductionId, heldTeachingExerciseId };
}
