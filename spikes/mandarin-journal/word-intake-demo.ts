import {
  OfflineWordUnavailable,
  type WordContent,
  type WordDecision,
  type WordRequest,
} from './word-intake.ts';

export const demoStashGlosses: Record<string, string> = {
  透透气: 'Step out for some air or a change of scene.',
  容易分心: 'Be easily distracted.',
  分心: 'Have your attention drawn away from what you are doing.',
  散场: 'An event ends and its audience starts leaving.',
  内耗: 'Friction within a group or person that uses up energy.',
  只是: 'Simply or merely, as in 我只是在等。',
  鸟食: 'Food meant for birds.',
  喂鸟: 'Feed the birds.',
  修复: 'Restore something that has been damaged, such as data.',
};

// Curated offline examples exercise the same transitions as the live tutor.
const demoWords: Record<string, { title: string } & WordContent> = Object.fromEntries(
  [
    [
      '值得',
      'zhíde',
      'Be worth doing or deserving of something.',
      '这本书值得再读一遍。',
      'This book is worth reading again.',
    ],
    [
      '报备',
      'bàobèi',
      'Notify someone for the record or to keep them informed.',
      '周末有访客，需要提前向物业报备。',
      'If you have visitors this weekend, you need to notify the property manager in advance.',
    ],
    ['蜘蛛', 'zhīzhū', 'A spider.', '窗台上有一只蜘蛛。', 'There is a spider on the windowsill.'],
    ['鸟食', 'niǎoshí', 'Bird food, such as seed put out for birds.', '我在阳台上放了一些鸟食。', 'I put some bird food out on the balcony.'],
    [
      '散场',
      'sànchǎng',
      'A performance or gathering ends and the audience disperses.',
      '电影散场了，大家慢慢往外走。',
      'The movie let out and everyone slowly headed outside.',
    ],
    [
      '透透气',
      'tòu tou qì',
      'Get some air or a short change of scene.',
      '屋里太闷了，我出去透透气。',
      'It is stuffy inside. I’m stepping out for some air.',
    ],
    [
      '分心',
      'fēnxīn',
      'Have your attention drawn away.',
      '手机一响，我就容易分心。',
      'I get distracted easily when my phone rings.',
    ],
    [
      '内耗',
      'nèihào',
      'Internal friction that drains energy.',
      '两个部门天天争，公司的内耗越来越严重。',
      'The two departments argue every day, and the internal friction at the company is growing worse.',
    ],
    [
      '有所',
      'yǒusuǒ',
      'To some extent, before an action or change.',
      '休息以后，情况有所好转。',
      'After some rest, things improved somewhat.',
    ],
    [
      '图书馆',
      'túshūguǎn',
      'A library.',
      '我想去图书馆借本书。',
      'I want to go to the library to borrow a book.',
    ],
    [
      '修复',
      'xiūfù',
      'Restore something damaged.',
      '技术员修复了损坏的数据。',
      'The technician restored the damaged data.',
    ],
  ].map(([title, pinyin, meaning, example, translation]) => [
    title,
    { title, pinyin, meaning, example, translation },
  ]),
);
demoWords['行（可以）'] = {
  title: '行',
  pinyin: 'xíng',
  meaning: 'Be acceptable or workable.',
  example: '我们改到周五见，行吗？',
  translation: 'Can we move our meeting to Friday?',
};
demoWords['行（行业）'] = {
  title: '行',
  pinyin: 'háng',
  meaning: 'A line of work or trade.',
  example: '我在这行干了十年。',
  translation: 'I have worked in this line of business for ten years.',
};

export function recognizesDemoWord(text: string) {
  return Object.hasOwn(demoWords, text) || ['行', '蜘', '蛛'].includes(text);
}

export function demoIntake(request: WordRequest): WordDecision {
  const { text, context, history, localWords } = request;
  const reply = history.at(-1)?.reply ?? '';
  function ready(...keys: string[]): WordDecision {
    return {
      kind: 'ready',
      words: keys.map((key) => {
        const word = demoWords[key];
        if (!word) throw new Error('Unknown offline word fixture');
        const previous = localWords.find(
          (w) =>
            w.title === word.title &&
            (w.detail.includes(word.meaning) || w.detail === demoStashGlosses[word.title]),
        );
        return { ...word, reuseId: previous?.id ?? null };
      }),
    };
  }
  if (text === '蜘' || text === '蛛') {
    if (/蜘蛛|^yes\b|^是的?$|spider/i.test(reply)) return ready('蜘蛛');
    return {
      kind: 'clarify',
      question:
        text + ' is a component of 蜘蛛, the word for a spider. Would you like to study the whole word?',
      suggestions: ['蜘蛛'],
    };
  }
  if (text === '行') {
    const clue = reply || context || '';
    if (/可以|行吗|可行|第一|first|workable|okay/i.test(clue)) return ready('行（可以）');
    if (/行业|这行|第二|second|trade|profession/i.test(clue)) return ready('行（行业）');
    return {
      kind: 'clarify',
      question: 'Did you meet 行 as xíng, meaning something works or is OK, or háng, a line of work?',
      suggestions: ['行（可以）', '行（行业）'],
    };
  }
  if (text.includes('散场') && text.includes('透透气')) {
    if (/both|两个|都要|都加/i.test(reply) || (reply.includes('散场') && reply.includes('透透气')))
      return ready('散场', '透透气');
    if (/散场|第一|first/i.test(reply)) return ready('散场');
    if (/透透气|第二|second/i.test(reply)) return ready('透透气');
    return {
      kind: 'clarify',
      question:
        '散场 describes the show letting out. 透透气 means stepping out for air. Which would you like to study?',
      suggestions: ['散场', '透透气', '散场 + 透透气'],
    };
  }
  if (Object.hasOwn(demoWords, text)) return ready(text);
  throw new OfflineWordUnavailable(
    'This word is outside the offline examples. It can be prepared with the live tutor.',
  );
}
