import type {
  ContentExercise,
  TeachingPackage,
  TeachingPart,
  WordContentDocument,
} from '../../src/domain/word-content/types.js';
import type { ProductionExerciseSnapshot } from '../../src/domain/study-actions.js';
import type { ReviewSourceMetadata } from '../../src/domain/word-content/review-compat.js';

type Fixture = Readonly<{
  content: WordContentDocument;
  teaching: TeachingPackage;
}>;

const text = (value: string): TeachingPart => ({ kind: 'text', text: value });
const example = (
  exampleId: string,
  field: 'sentence' | 'translation' | 'pronunciation',
): TeachingPart => ({ kind: 'example', exampleId, field });
const note = (useId: string, noteIndex: number): TeachingPart => (
  { kind: 'use_note', useId, noteIndex }
);
const beat = (id: string, ...parts: TeachingPart[]) => ({ id, parts });

function targetAnswer(content: WordContentDocument) {
  return [{
    wordId: content.word.wordId,
    hanzi: content.word.hanzi,
    traditional: content.word.traditional,
  }];
}

function directRehearsal(content: WordContentDocument, id: string, stimulus: string): ContentExercise {
  return {
    id,
    contract: { kind: 'target_rehearsal', wordId: content.word.wordId },
    responseMode: 'hanzi_entry',
    instruction: 'Recall the expression taught in this introduction. Write it in Chinese characters.',
    stimulus: { kind: 'direct_text', text: stimulus },
    acceptedAnswers: targetAnswer(content),
  };
}

const baobeiContent: WordContentDocument = {
  schemaVersion: 1,
  id: 'content-baobei-1',
  word: { wordId: 'word-baobei', hanzi: '报备', traditional: '報備', pinyin: 'bàobèi' },
  uses: [
    {
      id: 'formal',
      label: 'Notify responsible people for the record',
      notes: ['报备 means giving the responsible people information so they have it on record, often in advance.'],
      exampleIds: ['property'],
    },
    {
      id: 'relationship',
      label: 'Keep a partner informed',
      notes: ['Between partners, 报备 can be a considerate heads-up or an excessive expectation to report one’s whereabouts; the situation sets the tone.'],
      exampleIds: ['coffee'],
    },
  ],
  examples: [
    {
      id: 'property',
      text: '你得先向物业报备朋友的车牌号。',
      pronunciation: 'Nǐ děi xiān xiàng wùyè bàobèi péngyou de chēpáihào.',
      translation: 'You need to notify property management of your friend’s license plate number beforehand.',
    },
    {
      id: 'coffee',
      text: '我现在出门买杯咖啡都得跟他报备。',
      pronunciation: 'Wǒ xiànzài chūmén mǎi bēi kāfēi dōu děi gēn tā bàobèi.',
      translation: 'Now I even have to check in with him when I go out to buy a coffee.',
    },
  ],
};

const baobei: Fixture = {
  content: baobeiContent,
  teaching: {
    schemaVersion: 1,
    id: 'teaching-baobei-1',
    wordContentId: baobeiContent.id,
    beats: [
      beat('b1', text('A friend is driving over to visit. Before they arrive, your apartment compound needs their license plate number on file.')),
      beat('b2', example('property', 'sentence'), example('property', 'pronunciation')),
      beat('b3', example('property', 'translation')),
      beat('b4', text('报备 · bàobèi'), note('formal', 0), text('Here, you give property management the details ahead of the visit.')),
      beat('b5', text('You also hear this word between partners. A friend complains that their partner expects to know about every outing:')),
      beat('b6', example('coffee', 'sentence'), example('coffee', 'pronunciation')),
      beat('b7', example('coffee', 'translation')),
      beat('b8', note('relationship', 0), text('Here, “even buying a coffee” makes it sound excessive.')),
      beat('b9', text('Think back to the license plate. What is similar about these two acts of 报备, and what feels different about the relationship between the people?')),
    ],
    rehearsals: [{
      id: 'rehearse-baobei-cloze',
      contract: { kind: 'target_rehearsal', wordId: baobeiContent.word.wordId },
      responseMode: 'hanzi_entry',
      instruction: 'Recall the taught expression for informing the responsible people ahead of time. Fill it in with Chinese characters.',
      stimulus: {
        kind: 'example_cloze',
        example: { contentId: baobeiContent.id, exampleId: 'property' },
        blanks: [{ start: 6, end: 8, expectedText: '报备' }],
        frame: null,
      },
      acceptedAnswers: targetAnswer(baobeiContent),
    }],
  },
};

const tengjiaoContent: WordContentDocument = {
  schemaVersion: 1,
  id: 'content-tengjiao-1',
  word: { wordId: 'word-tengjiao', hanzi: '藤椒', traditional: '藤椒', pinyin: 'téngjiāo' },
  uses: [{
    id: 'ingredient',
    label: 'Fragrant Sichuan pepper used in food',
    notes: ['藤椒 is a type of Sichuan pepper. Its small green berries flavor food and give a tingling, numbing sensation.'],
    exampleIds: ['chicken'],
  }],
  examples: [{
    id: 'chicken',
    text: '这道藤椒鸡吃起来很香，舌头还会有点麻。',
    pronunciation: 'Zhè dào téngjiāo jī chī qǐlái hěn xiāng, shétou hái huì yǒudiǎn má.',
    translation: 'This green Sichuan pepper chicken is fragrant, and it leaves your tongue feeling a little numb.',
  }],
};

const tengjiao: Fixture = {
  content: tengjiaoContent,
  teaching: {
    schemaVersion: 1,
    id: 'teaching-tengjiao-1',
    wordContentId: tengjiaoContent.id,
    beats: [
      beat('b1', text('You are looking through a restaurant menu. One chicken dish sounds unfamiliar; the server describes it as fragrant, with a tingling, numbing sensation.')),
      beat('b2', example('chicken', 'sentence'), example('chicken', 'pronunciation')),
      beat('b3', example('chicken', 'translation')),
      beat('b4', text('藤椒 · téngjiāo'), note('ingredient', 0), text('On this menu, 藤椒鸡 is chicken flavored with it.')),
      beat('b5', text('You might also see 藤椒油 on a bottle in the kitchen. Before moving on, imagine what it would add to a dish.')),
      beat('b6', text('藤椒油 is oil flavored with 藤椒. A little brings that flavor to the dish you are preparing.')),
    ],
    rehearsals: [directRehearsal(
      tengjiaoContent,
      'rehearse-tengjiao-direct',
      'At the restaurant, which pepper ingredient gave the chicken its fragrant, tingling flavor?',
    )],
  },
};

const paomoContent: WordContentDocument = {
  schemaVersion: 1,
  id: 'content-paomo-1',
  word: { wordId: 'word-paomo', hanzi: '泡沫', traditional: '泡沫', pinyin: 'pàomò' },
  uses: [
    {
      id: 'foam',
      label: 'Foam or lather',
      notes: ['泡沫 is a mass of small bubbles, such as soap lather or foam on a drink. 起泡沫 means to foam up.'],
      exampleIds: ['soap'],
    },
    {
      id: 'economic',
      label: 'An inflated economic bubble',
      notes: ['In economics, 泡沫 is a bubble: prices inflated beyond what the underlying assets reasonably support.'],
      exampleIds: ['housing'],
    },
  ],
  examples: [
    {
      id: 'soap',
      text: '洗手液一搓就起泡沫了。',
      pronunciation: 'Xǐshǒuyè yì cuō jiù qǐ pàomò le.',
      translation: 'As soon as you rub the hand soap between your hands, it starts to foam.',
    },
    {
      id: 'housing',
      text: '房价涨得太快，可能已经出现了泡沫。',
      pronunciation: 'Fángjià zhǎng de tài kuài, kěnéng yǐjīng chūxiàn le pàomò.',
      translation: 'Housing prices have risen so quickly that a bubble may already have formed.',
    },
  ],
};

const paomo: Fixture = {
  content: paomoContent,
  teaching: {
    schemaVersion: 1,
    id: 'teaching-paomo-1',
    wordContentId: paomoContent.id,
    beats: [
      beat('b1', text('You are washing your hands. As you rub them together, the soap turns into a mass of tiny bubbles.')),
      beat('b2', example('soap', 'sentence'), example('soap', 'pronunciation')),
      beat('b3', example('soap', 'translation')),
      beat('b4', text('泡沫 · pàomò'), note('foam', 0)),
      beat('b5', text('Later, you are reading about housing prices. They have risen rapidly, and people keep buying because they expect to sell for even more. An economist warns:')),
      beat('b6', example('housing', 'sentence'), example('housing', 'pronunciation')),
      beat('b7', example('housing', 'translation')),
      beat('b8', note('economic', 0), text('Think of the foam in your hands: full of air and easy to collapse. That image connects the two uses.')),
      beat('b9', text('Someone says 泡沫破了: “the bubble burst.” What would you picture in the kitchen? What would you picture in a housing report?')),
      beat('b10', text('In the kitchen, bubbles pop and the foam disappears. In the housing report, inflated prices fall sharply. The setting tells you which 泡沫 the speaker means.')),
    ],
    rehearsals: [{
      id: 'rehearse-paomo-cloze',
      contract: { kind: 'target_rehearsal', wordId: paomoContent.word.wordId },
      responseMode: 'hanzi_entry',
      instruction: 'Recall the taught expression for foam or lather. Fill it into the sentence in Chinese characters.',
      stimulus: {
        kind: 'example_cloze',
        example: { contentId: paomoContent.id, exampleId: 'soap' },
        blanks: [{ start: 7, end: 9, expectedText: '泡沫' }],
        frame: null,
      },
      acceptedAnswers: targetAnswer(paomoContent),
    }],
  },
};

const bukanContent: WordContentDocument = {
  schemaVersion: 1,
  id: 'content-bukan-1',
  word: { wordId: 'word-bukan', hanzi: '不堪', traditional: '不堪', pinyin: 'bùkān' },
  uses: [
    {
      id: 'after-description',
      label: 'Intensifies a description of an unbearable state',
      notes: ['After a description, 不堪 can intensify it: 疲惫不堪 means utterly worn out.'],
      exampleIds: ['exhausted'],
    },
    {
      id: 'before-action',
      label: 'Cannot bear or withstand what follows',
      notes: ['Before a verb or action, 不堪 means unable to bear it: 不堪忍受 is unbearable; 不堪一击 cannot withstand one attack.'],
      exampleIds: ['noise'],
    },
  ],
  examples: [
    {
      id: 'exhausted',
      text: '忙了一整天，我已经疲惫不堪了。',
      pronunciation: 'Máng le yì zhěng tiān, wǒ yǐjīng píbèi bùkān le.',
      translation: 'After a whole day of hard work, I am utterly exhausted.',
    },
    {
      id: 'noise',
      text: '楼上的噪音让人不堪忍受。',
      pronunciation: 'Lóushàng de zàoyīn ràng rén bùkān rěnshòu.',
      translation: 'The noise from upstairs is unbearable.',
    },
  ],
};

const bukan: Fixture = {
  content: bukanContent,
  teaching: {
    schemaVersion: 1,
    id: 'teaching-bukan-1',
    wordContentId: bukanContent.id,
    beats: [
      beat('b1', text('You have spent the whole day moving apartments: carrying boxes, climbing stairs, and unpacking. By evening, you barely have the energy to stand.')),
      beat('b2', example('exhausted', 'sentence'), example('exhausted', 'pronunciation')),
      beat('b3', example('exhausted', 'translation')),
      beat('b4', note('after-description', 0), text('Here 疲惫 means “exhausted”; 疲惫不堪 makes it more than you can bear.')),
      beat('b5', text('Now imagine the apartment upstairs is being renovated. Drilling goes on for hours, and you cannot find a quiet moment to rest.')),
      beat('b6', example('noise', 'sentence'), example('noise', 'pronunciation')),
      beat('b7', example('noise', 'translation')),
      beat('b8', note('before-action', 0), text('Compare the two patterns: 疲惫不堪 describes how worn out you feel; 不堪忍受 describes something you cannot tolerate.')),
      beat('b9', text('A team loses badly, and someone calls it 不堪一击. 一击 means “one blow.” What are they saying about the team?')),
      beat('b10', text('It is so weak it cannot withstand even one attack. Like 不堪忍受, 不堪 comes before what cannot be endured or withstood.')),
    ],
    rehearsals: [{
      id: 'rehearse-bukan-cloze',
      contract: { kind: 'target_rehearsal', wordId: bukanContent.word.wordId },
      responseMode: 'hanzi_entry',
      instruction: 'Recall the taught expression that intensifies 疲惫. Fill it in with Chinese characters.',
      stimulus: {
        kind: 'example_cloze',
        example: { contentId: bukanContent.id, exampleId: 'exhausted' },
        blanks: [{ start: 11, end: 13, expectedText: '不堪' }],
        frame: null,
      },
      acceptedAnswers: targetAnswer(bukanContent),
    }],
  },
};

const shichenDahaiContent: WordContentDocument = {
  schemaVersion: 1,
  id: 'content-shichen-dahai-1',
  word: { wordId: 'word-shichen-dahai', hanzi: '石沉大海', traditional: '石沉大海', pinyin: 'shí chén dà hǎi' },
  uses: [{
    id: 'unanswered',
    label: 'Sent something and heard nothing back',
    notes: ['石沉大海 pictures a stone sinking into the sea: a message, request, or application disappears without any reply. Silence does not necessarily mean rejection.'],
    exampleIds: ['proposal', 'resumes'],
  }],
  examples: [
    {
      id: 'proposal',
      text: '方案发过去以后就石沉大海了，一点回音都没有。',
      pronunciation: 'Fāng’àn fā guòqu yǐhòu jiù shí chén dà hǎi le, yìdiǎn huíyīn dōu méiyǒu.',
      translation: 'After I sent the proposal over, it disappeared without a trace—not a word back.',
    },
    {
      id: 'resumes',
      text: '投了十几份简历，全都石沉大海了。',
      pronunciation: null,
      translation: 'I sent more than ten résumés and heard nothing back from any of them.',
    },
  ],
};

const shichenDahai: Fixture = {
  content: shichenDahaiContent,
  teaching: {
    schemaVersion: 1,
    id: 'teaching-shichen-dahai-1',
    wordContentId: shichenDahaiContent.id,
    beats: [
      beat('b1', text('You sent someone a proposal last week. Since then, no reply, no update, nothing. A friend asks whether you have heard back.')),
      beat('b2', example('proposal', 'sentence'), example('proposal', 'pronunciation')),
      beat('b3', example('proposal', 'translation')),
      beat('b4', text('石沉大海 · shí chén dà hǎi'), note('unanswered', 0), text('Here 一点回音都没有, “not a word back,” reinforces the meaning.')),
      beat('b5', text('A friend talks about their job search:'), example('resumes', 'sentence'), text('Even if you miss the exact number, what happened to their applications?')),
      beat('b6', text('They sent out a bunch of résumés and heard nothing back. 石沉大海 gives the outcome and their frustration; they have not necessarily been rejected.')),
    ],
    rehearsals: [{
      id: 'rehearse-shichen-dahai-cloze',
      contract: { kind: 'target_rehearsal', wordId: shichenDahaiContent.word.wordId },
      responseMode: 'hanzi_entry',
      instruction: 'Recall the taught expression for a sent proposal receiving no reply. Fill it in with Chinese characters.',
      stimulus: {
        kind: 'example_cloze',
        example: { contentId: shichenDahaiContent.id, exampleId: 'proposal' },
        blanks: [{ start: 8, end: 12, expectedText: '石沉大海' }],
        frame: null,
      },
      acceptedAnswers: targetAnswer(shichenDahaiContent),
    }],
  },
};

const weisuoyuweiContent: WordContentDocument = {
  schemaVersion: 1,
  id: 'content-weisuoyuwei-1',
  word: { wordId: 'word-weisuoyuwei', hanzi: '为所欲为', traditional: '為所欲為', pinyin: 'wéi suǒ yù wéi' },
  uses: [{
    id: 'criticism',
    label: 'Do whatever one wants without regard for others',
    notes: ['为所欲为 usually criticizes someone for acting as if rules or other people do not limit them. The compact literary wording parses roughly as “do whatever one wants to do.”'],
    exampleIds: ['boss', 'money'],
  }],
  examples: [
    {
      id: 'boss',
      text: '他以为自己是老板，就可以为所欲为。',
      pronunciation: 'Tā yǐwéi zìjǐ shì lǎobǎn, jiù kěyǐ wéi suǒ yù wéi.',
      translation: 'He thinks being the boss means he can do whatever he likes.',
    },
    {
      id: 'money',
      text: '有钱就能为所欲为吗？',
      pronunciation: 'Yǒu qián jiù néng wéi suǒ yù wéi ma?',
      translation: 'Does having money mean you can do whatever you like?',
    },
  ],
};

const weisuoyuwei: Fixture = {
  content: weisuoyuweiContent,
  teaching: {
    schemaVersion: 1,
    id: 'teaching-weisuoyuwei-1',
    wordContentId: weisuoyuweiContent.id,
    beats: [
      beat('b1', text('Someone at work keeps changing plans without consulting anyone. When a colleague objects, they shrug: “I am in charge.” Another colleague has had enough.')),
      beat('b2', example('boss', 'sentence'), example('boss', 'pronunciation')),
      beat('b3', example('boss', 'translation')),
      beat('b4', text('为所欲为 · wéi suǒ yù wéi'), note('criticism', 0), text('Here, the colleague criticizes the boss for treating authority as permission to act however he wants.')),
      beat('b5', text('The wording is compact and literary. 欲 means “want”; 所欲为 means “what one wants to do”; the first 为 means “do.” That helps you reconstruct the whole phrase.')),
      beat('b6', text('Now someone complains about a player who keeps breaking the rules:'), example('money', 'sentence'), example('money', 'pronunciation'), example('money', 'translation'), text('What answer does the speaker expect?')),
      beat('b7', text('“No, of course not.” It is a protest, not a genuine question. When you hear 为所欲为, listen for the criticism that someone acts as though normal limits do not apply.')),
    ],
    rehearsals: [{
      id: 'rehearse-weisuoyuwei-cloze',
      contract: { kind: 'target_rehearsal', wordId: weisuoyuweiContent.word.wordId },
      responseMode: 'hanzi_entry',
      instruction: 'Recall the taught critical expression for doing whatever one wants. Fill it in with Chinese characters.',
      stimulus: {
        kind: 'example_cloze',
        example: { contentId: weisuoyuweiContent.id, exampleId: 'boss' },
        blanks: [{ start: 12, end: 16, expectedText: '为所欲为' }],
        frame: null,
      },
      acceptedAnswers: targetAnswer(weisuoyuweiContent),
    }],
  },
};

/** Edited examples from the authoring draft, retained as executable content fixtures. */
export const wordContentFixtures: readonly Fixture[] = [
  baobei,
  tengjiao,
  paomo,
  bukan,
  shichenDahai,
  weisuoyuwei,
];

/** A historical review cue and its cue-scoped reveal remain independent of teaching. */
export const legacyReviewFixture: ProductionExerciseSnapshot = {
  taskId: 'legacy-task-baobei',
  cueId: 'legacy-cue-baobei',
  cueType: 'definition_gloss',
  text: 'To notify the responsible people so they have the information on record.',
  acceptedAnswers: targetAnswer(baobeiContent),
  supplement: {
    supplementId: 'legacy-supplement-baobei',
    englishFrame: 'Notify property management ahead of a visitor arriving.',
    exampleSentence: '你得先向物业报备朋友的车牌号。',
    exampleTranslation: 'You need to notify property management of your friend’s license plate number beforehand.',
  },
};

/** A separately authored review exercise may cite the same immutable example. */
export const authoredReviewFixture: ContentExercise = {
  id: 'review-baobei-cloze',
  contract: { kind: 'targeted_review', wordId: baobeiContent.word.wordId },
  responseMode: 'hanzi_entry',
  instruction: '',
  stimulus: {
    kind: 'example_cloze',
    example: { contentId: baobeiContent.id, exampleId: 'property' },
    blanks: [{ start: 6, end: 8, expectedText: '报备' }],
    frame: null,
  },
  acceptedAnswers: targetAnswer(baobeiContent),
};

export const authoredReviewMetadata: ReviewSourceMetadata = {
  taskId: 'review-task-baobei',
  cueId: 'review-cue-baobei',
  cueType: 'minimal_context',
  supplement: null,
};

/** A definition cue may separately attach a pinned post-reveal example. */
export const authoredDefinitionFixture: ContentExercise = {
  id: 'review-baobei-definition',
  contract: { kind: 'targeted_review', wordId: baobeiContent.word.wordId },
  responseMode: 'hanzi_entry',
  instruction: '',
  stimulus: {
    kind: 'direct_text',
    text: 'To notify the responsible people so they have information on record.',
  },
  acceptedAnswers: targetAnswer(baobeiContent),
};

export const authoredDefinitionMetadata: ReviewSourceMetadata = {
  taskId: 'review-definition-task-baobei',
  cueId: 'review-definition-cue-baobei',
  cueType: 'definition_gloss',
  supplement: {
    kind: 'example',
    supplementId: 'review-supplement-baobei',
    englishFrame: 'A partner expects a message about a quick outing.',
    example: { contentId: baobeiContent.id, exampleId: 'coffee' },
  },
};
