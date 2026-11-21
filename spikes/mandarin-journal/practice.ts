import type { TurnContext, TutorResult } from './tutor.ts';

export type Card = {
  id: string;
  kind: 'choice' | 'open';
  prompt: string;
  choices: string[];
  answer: string;
  explanation: string;
  source: string;
};

export const catalogue: Card[] = [
  {
    id: 'restore-data',
    kind: 'choice',
    source: 'Word choice · 修理 and 修复',
    prompt: '停电后有些数据损坏了。技术员正在想办法＿＿这些数据。',
    choices: ['修理', '修复'],
    answer: '修复',
    explanation:
      '修复数据 means to restore damaged data. 修理 is more natural with something physical, such as a broken radio.',
  },
  {
    id: 'step-out',
    kind: 'choice',
    source: 'Reading · 散场以后',
    prompt: '“我想出去透透气。” What does the speaker want to do?',
    choices: ['Step out for some air.', 'Meet outside to exchange news.'],
    answer: 'Step out for some air.',
    explanation: '出去透透气 can be a short change of scene. The room itself can be perfectly comfortable.',
  },
  {
    id: 'san-chang',
    kind: 'choice',
    source: 'Build vocabulary · 散场',
    prompt: '散场 (sànchǎng) describes an event ending as the audience disperses. Which caption fits 散场以后?',
    choices: ['观众听着开场音乐，陆续找位子。', '观众往出口走，还有人哼着最后一首歌。'],
    answer: '观众往出口走，还有人哼着最后一首歌。',
    explanation: '散场以后 means after the show lets out. 开场 is the beginning.',
  },
  {
    id: 'drift-away',
    kind: 'open',
    source: 'Free production · Losing your train of thought',
    prompt:
      'You sat down to sort your photos and half an hour later you were watching videos. Tell a friend how that happened, in your own words.',
    choices: [],
    answer: '我本来想整理照片，结果看起视频来了。',
    explanation:
      'The starting intention and the switch to another activity are the point. 做着做着… and 本来想…结果… can both tell that story.',
  },
  {
    id: 'rain-contrast',
    kind: 'choice',
    source: 'Word choice · 尽管 and 就算',
    prompt: '天气预报还没出来，没人知道明天会不会下雨。朋友问你要不要取消。你回答：“＿＿明天下雨，我也照样去。”',
    choices: ['尽管', '就算'],
    answer: '就算',
    explanation:
      '就算 takes the rain as a possibility and says your plan holds either way. 尽管 would typically acknowledge a circumstance as given.',
  },
  {
    id: 'fen-xin',
    kind: 'choice',
    source: 'Build vocabulary · 分心',
    prompt:
      '分心 (fēnxīn) means your attention is pulled away. “我在家容易分心。” Which example illustrates that?',
    choices: ['本来在看书，手机一响，我就去刷消息了。', '专心看完了书，然后按计划休息。'],
    answer: '本来在看书，手机一响，我就去刷消息了。',
    explanation:
      'The interruption draws the reader’s attention away. 分心 describes the shift in attention regardless of whether you get up or stay seated.',
  },
];

const drift = catalogue[3]!;
const breeze = catalogue[1]!;
const distraction = /分心|干别的去了|做着做着|distract|sidetrack|drift(?:ed|ing)? (?:off|away)/i;
const freshAir = /透透气|透气|fresh air|breather/i;
const library = /图书馆|library/i;
const concert = /演唱会|散场|哼|concert/i;

function response(reply: string, action: TutorResult['action'] = null): TutorResult {
  return { reply, action };
}

function recentLearnerWords(input: TurnContext): string {
  return input.chatHistory
    .filter((turn) => turn.role === 'user')
    .slice(-5)
    .map((turn) => turn.text)
    .join('\n');
}

function practiceFor(card: Card, reason: string): TutorResult {
  const { kind, prompt, choices, answer, explanation } = card;
  return response(reason, {
    kind: 'practice',
    title: card.source,
    detail: reason,
    exercise: { kind, prompt, choices: [...choices], answer, explanation },
  });
}

function reflect(input: TurnContext): TutorResult {
  const learner = recentLearnerWords(input);
  if (distraction.test(learner)) {
    return response(
      'You described getting pulled into a different activity. 我在家容易分心 gives the short version; 做着做着就干别的去了 describes how it happens. Which one sounds closer to what you meant?',
    );
  }
  if (freshAir.test(learner))
    return response(
      'You used the idea of getting some air in the conversation. What did going out change for you that day?',
    );
  if (library.test(learner))
    return response(
      'You brought up the library. Was there a part of what you wanted to say about being there that felt easier in English?',
    );
  if (concert.test(learner))
    return response('You brought up the show. Was there a sound or feeling you wanted a more precise word for?');
  return response('Which line from the conversation felt a little different from what you meant?');
}

function practice(input: TurnContext): TutorResult {
  const evidence = [
    recentLearnerWords(input),
    ...input.learning.map((item) => item.text),
    ...input.saved.map((item) => item.title),
  ].join('\n');
  if (input.surface === 'Build vocabulary' && /分心/.test(evidence))
    return practiceFor(
      catalogue[5]!,
      '分心 means your attention is drawn away. Try it in a situation you recognize.',
    );
  if (distraction.test(evidence))
    return practiceFor(
      drift,
      'You’ve been talking about how one task turns into another. Try telling that story once in a new setting.',
    );
  if (freshAir.test(evidence))
    return practiceFor(
      breeze,
      'You encountered 透透气. Here’s a short check on what the speaker actually wants to do.',
    );
  return response('There’s an ordinary mixed review ready. I don’t have a personal follow-up to add yet.');
}

function stash(input: TurnContext): TutorResult {
  const explicitWord = input.message.match(
    /(?:stash|save|remember|add|收藏|记住)\s*(?:the (?:word|phrase)\s*)?[“"「']?\s*([\p{Script=Han}]{1,8})/iu,
  )?.[1];
  const words = input.message + ' ' + input.source;
  const known = ['透透气', '散场', '分心', '内耗', '修复'].find((word) => words.includes(word));
  const title = explicitWord ?? known;
  if (!title) return response('Which Chinese word or expression would you like to keep?');
  const glosses: Record<string, string> = {
    透透气: 'Step out for some air or a change of scene.',
    分心: 'Have your attention drawn away from what you are doing.',
    散场: 'An event ends and its audience starts leaving.',
    内耗: 'Friction within a group or person that uses up energy.',
    修复: 'Restore something that has been damaged, such as data.',
  };
  return response('I’ve kept ' + title + ' for study.', {
    kind: 'stash',
    title,
    detail: glosses[title] ?? input.message,
    exercise: null,
  });
}

export function demoTutor(input: TurnContext): TutorResult {
  const text = input.message.trim();
  const described = text + '\n' + input.source;
  switch (input.trigger) {
    case 'reflect':
      return reflect(input);
    case 'practice':
      return practice(input);
    case 'answer':
      if (distraction.test(described) || /photos|照片|视频/.test(described)) {
        return response(
          'One way to tell it is “我本来想整理照片，结果看起视频来了。” 做着做着… also gives the listener a sense of the gradual shift. How close is that to what you meant?',
        );
      }
      return response(
        'There can be several natural ways to express that. Which part of your wording would you like to revisit?',
      );
    case 'miss':
      if (/修理|修复/.test(described))
        return response(
          'With damaged data, 修复数据 is the usual pairing. You could 修理 a damaged device, such as the computer itself.',
        );
      if (freshAir.test(described))
        return response(
          'Picture someone stepping out of the concert hall for some air. That’s what 透透气 gets across here.',
        );
      if (/尽管|就算/.test(described))
        return response(
          'They still don’t know whether it will rain. 就算 lets the speaker entertain the possibility and keep the plan either way.',
        );
      if (/散场/.test(described))
        return response('Imagine the house lights coming on and people heading out. That’s 散场.');
      if (distraction.test(described))
        return response(
          'The phone pulled the reader’s attention elsewhere. That is the moment you could describe as 分心.',
        );
      return response('');
    case 'ask':
      break;
  }
  if (/^(?:please\s+)?(?:save (?:a |this )?note|keep (?:a |this )?note|note to self|记一笔)\s*[:：]/i.test(text)) {
    const body = text.replace(/^[^:：]*[:：]\s*/, '').trim();
    if (body)
      return response('I’ve kept your note.', { kind: 'note', title: body, detail: input.source, exercise: null });
  }
  if (/^(?:please\s+)?(?:stash|save|remember|add|收藏|记住)\b/i.test(text) || /^(?:收藏|记住)/.test(text))
    return stash(input);
  if (/\b(?:practi[cs]e|exercise|rehearse)\b|练习/i.test(text)) return practice(input);
  if (freshAir.test(described))
    return response(
      '透透气 (tòu tou qì) means to get some air. 我想出去透透气 works even when what you really want is a change of scene.',
    );
  if (distraction.test(described))
    return response(
      'If you mean that staying on task is hard, 我在家容易分心 fits. If you want to describe what actually happens, try 我做着做着就干别的去了. Which is closer to your thought?',
    );
  if (/内耗/.test(described))
    return response(
      '内耗 also works for a group. 两个部门争来争去，公司的内耗越来越严重。 The organization loses energy to its own friction.',
    );
  if (/散场/.test(text))
    return response(
      '散场 (sànchǎng) is when a performance ends and the crowd begins to leave. 散场以后 places the story in that little stretch of time afterwards.',
    );
  if (/chat|reflect|聊天|回顾/i.test(text)) return reflect(input);
  return response(
    'The offline tutor can try the concert reading, 分心, or the library conversation. A connected tutor can discuss what you just wrote.',
  );
}

export function demoFriend(input: TurnContext): string {
  const text = input.message;
  if (distraction.test(text))
    return '我也有过这种时候，本来只想看一眼手机，一抬头半小时就过去了。你在图书馆一般能坐多久？';
  if (library.test(text))
    return '我挺喜欢图书馆里那种安静的热闹。大家明明都在忙自己的事，坐在一起又像有个伴。你也有这种感觉吗？';
  if (concert.test(text)) return '演唱会结束以后我也舍不得马上回家。你最近有没有哪首歌，听完了还会一路哼着？';
  if (freshAir.test(text)) return '嗯，哪怕只是出去走一圈，回来的时候心情也会不一样。你一般喜欢往哪儿走？';
  if (/^(你好|嗨|hello|hi)\b/i.test(text) || text === '你好' || text === '嗨') return '你好！今天过得怎么样？';
  return '你刚才说的这件事，我还想多听一点。后来呢？';
}
