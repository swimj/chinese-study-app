import { demoCapture, requestsCaptureNote } from './situations/capture.ts';
import { demoIntake, demoStashGlosses } from './word-intake-demo.ts';
import { demoMedia } from './media/demo.ts';
import { demoNotice } from './situations/notice.ts';
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
    prompt:
      '散场 (sànchǎng) describes an event ending as the audience disperses. Which caption fits 散场以后?',
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
    prompt:
      '天气预报还没出来，没人知道明天会不会下雨。朋友问你要不要取消。你回答：“＿＿明天下雨，我也照样去。”',
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

const distraction = /分心|干别的去了|做着做着|distract|sidetrack|drift(?:ed|ing)? (?:off|away)/i;
const freshAir = /透透气|透气|fresh air|breather/i;
const library = /图书馆|library/i;
const concert = /演唱会|散场|哼|concert/i;
const birds = /鸟|鳥|bird|sparrow|麻雀|feeder/i;
const only = /只是在等|只在等|只在|只是|“只”|\bonly\b/i;

function response(reply: string, action: TutorResult['action'] = null): TutorResult {
  return { reply, action };
}

type Exercise = NonNullable<NonNullable<TutorResult['action']>['exercise']>;
function open(prompt: string, answer: string, explanation: string): Exercise {
  return { kind: 'open', prompt, answer, explanation, choices: [] };
}
function choice(prompt: string, choices: string[], answer: string, explanation: string): Exercise {
  return { kind: 'choice', prompt, choices, answer, explanation };
}

type Series = { match: RegExp; title: string; introduction: string; exercises: Exercise[] };
const series: Series[] = [
  {
    match: only,
    title: 'Saying what “only” applies to',
    introduction: 'Where you put 只 helps a listener hear what you are ruling out.',
    exercises: [
      choice(
        'A neighbor thinks you are feeding the birds. You have no food and are simply waiting for a friend: “我＿＿在这儿等人。”',
        ['只是', '才刚'],
        '只是',
        '只是在这儿等人 presents waiting as the whole activity. 才刚 puts the emphasis on how recently you started.',
      ),
      open(
        'You watch birds on Sundays and never on other days. Tell a friend which days you go, making the restriction clear.',
        '我只在星期天去看鸟。',
        '只 in front of 在星期天 limits the days. Other ways to express that restriction work too.',
      ),
      open(
        'Someone thinks you took a photo of the bird. Say you just looked at it for a moment.',
        '我只是看了一眼，没拍照。',
        'A brief look is all you did. 只是 makes that contrast explicit.',
      ),
      choice(
        'Someone asks how many feeders you hung. One was enough: “阳台太小，我＿＿挂了一个。”',
        ['只', '又'],
        '只',
        '只 limits the number to one. 又 would suggest adding another.',
      ),
      open(
        'The neighbor thinks you are moving the feeder permanently. Reassure them that you are just cleaning it.',
        '我只是把它洗一洗，等会儿还放回去。',
        'Explain what you are doing and rule out the more drastic interpretation.',
      ),
      open(
        'You can recognize sparrows, but no other birds. Tell someone the limit of your bird knowledge.',
        '我只认得麻雀。',
        '只认得麻雀 limits which birds you can identify. An equivalent phrasing also works.',
      ),
    ],
  },
  {
    match: birds,
    title: 'Who feeds and who eats?',
    introduction: 'Try describing who is waiting, who brings the food, and who eats it.',
    exercises: [
      open(
        'You put seeds on the balcony and step back. Tell your friend what you are waiting for the sparrows to come and do.',
        '我在等麻雀过来吃鸟食。',
        'In 等麻雀过来吃, the sparrows come and eat. A different wording that keeps the same roles works too.',
      ),
      choice(
        '爷爷已经把小米撒在阳台上了。他退到屋里，等着麻雀＿＿。',
        ['过来吃', '过来喂'],
        '过来吃',
        'The millet is ready. The sparrows come to eat it. 喂 would make the sparrows do the feeding.',
      ),
      open(
        'Someone asks why you have a bag of seeds in your hand. Tell them you want to feed the birds yourself.',
        '我想拿这些小米喂鸟。',
        'The person does the feeding in 我喂鸟. In 鸟吃小米 the birds do the eating.',
      ),
      choice(
        '窗边有一窝雏鸟。成鸟一天来好几趟，衔着虫子回来＿＿雏鸟。',
        ['等', '喂'],
        '喂',
        'The adult brings insects and feeds the chicks. The verb describes what the adult does.',
      ),
      open(
        'A child says the sunflower seeds are for people. Explain that you put them outside for the birds to eat.',
        '这些瓜子是我放在外面给鸟吃的。',
        '给鸟吃 makes the birds the intended eaters. 拿来喂鸟 also expresses the purpose.',
      ),
      open(
        'You never saw a bird feed its chicks this morning. You only saw the chicks waiting for their mother to bring food. Describe that scene.',
        '我只看到雏鸟在等妈妈回来喂它们。',
        'In 等妈妈回来喂它们, the mother is the one who brings the food and feeds the chicks.',
      ),
    ],
  },
  {
    match: distraction,
    title: 'When your attention shifts',
    introduction: 'Try describing the moment your attention moved to something else.',
    exercises: [
      catalogue[3]!,
      open(
        'A friend wonders why lunch took an hour to cook. Describe the recipe search that turned into scrolling restaurant reviews.',
        '我本来想查个菜谱，结果看起餐馆点评来了。',
        'Make the first intention and what drew you away clear. 本来想…结果… is one way.',
      ),
      choice(
        '图书馆很安静，可手机每响一次，我就忍不住看一眼。通知太容易让我＿＿了。',
        ['分心', '放心'],
        '分心',
        '分心 describes attention pulled away; 放心 is feeling reassured.',
      ),
    ],
  },
  {
    match: freshAir,
    title: 'Stepping outside for air',
    introduction: 'Think about why someone would step outside partway through an evening.',
    exercises: [
      catalogue[1]!,
      open(
        'Dinner is still going on. Tell your friend you want to step out for some air and will be right back.',
        '我出去透透气，马上回来。',
        'Make the reason for your short break clear. 透透气 is one everyday way to say it.',
      ),
      choice(
        '会议室门窗紧闭。休息时大家走到院子里，想＿＿。',
        ['透透气', '打听消息'],
        '透透气',
        'The stuffy room gives them a reason to get some air.',
      ),
    ],
  },
  {
    match: /散场|concert|演唱会/i,
    title: 'When the audience leaves',
    introduction: '散场 describes a show coming to an end as the audience disperses.',
    exercises: [
      choice(
        '最后一首歌唱完了，观众开始往出口走。演唱会刚＿＿。',
        ['开场', '散场'],
        '散场',
        '散场 marks the end, when people start to leave.',
      ),
      open(
        'A friend asks when to pick you up at the theater. Tell them to come after the show lets out.',
        '你等散场以后再来接我吧。',
        'The pickup is after the audience starts to leave.',
      ),
    ],
  },
  {
    match: /修复|修理|damaged data/i,
    title: 'Restoring damaged data',
    introduction: '修复 is a useful verb when something damaged can be restored.',
    exercises: [
      catalogue[0]!,
      open(
        'The old footage was damaged, but a film archive has restored it. Tell a friend what the archive did.',
        '电影资料馆修复了那段受损的影像。',
        '修复 can describe restoring footage or a recording.',
      ),
    ],
  },
];

function reflect(input: TurnContext): TutorResult {
  const turns = (input.reflectionTurns ?? []).filter((turn) => turn.role === 'user' && turn.text.trim());
  const all = turns.map((turn) => turn.text).join('\n');
  const takeaways: NonNullable<TutorResult['reflection']>['takeaways'] = [];
  const add = (pattern: RegExp, text: string) => {
    for (const turn of turns) {
      const quote = turn.text.match(pattern)?.[0];
      if (!quote) continue;
      takeaways.push({ messageId: turn.id, quote, text });
      return;
    }
  };
  add(
    /等着?鸟来喂/,
    'In 等着鸟来喂, the bird sounds like the one doing the feeding. If you mean it comes to eat the seeds, try 等着鸟来吃鸟食.',
  );
  add(
    /只是在等|只在等|\bonly\b/i,
    '我只是在等 says waiting is all you are doing. Compare 我只在早上等, where 只 limits the time to mornings.',
  );
  add(
    /get distracted|分心|干别的去了|做着做着/i,
    '我容易分心 names the pull on your attention. 做着做着就干别的去了 lets the listener picture one activity turning into another.',
  );
  add(
    /透透气|fresh air/i,
    '出去透透气 gives a reason for stepping out. Add when you came back if you want to make it clear this was a short break.',
  );
  if (birds.test(all) && !takeaways.some((item) => item.text.includes('鸟来喂'))) {
    add(
      /麻雀|(?:小|喂|看)?鸟|sparrows?|birds?/i,
      'You can make the scene more specific by naming the bird’s action: 麻雀停在栏杆上 describes it landing or perching on the railing.',
    );
  }
  if (!takeaways.length) {
    add(
      /图书馆|library/i,
      '在图书馆 gives a location; 去图书馆 describes the trip. Choose the one that puts the listener at the right point in your story.',
    );
    add(
      /散场|演唱会|concert/i,
      '散场以后 locates a memory just after the show finishes and people start heading out.',
    );
  }
  const topics = [
    birds.test(all) && 'watching birds',
    only.test(all) && 'how to express “only”',
    distraction.test(all) && 'what draws your attention away',
    library.test(all) && 'time at the library',
    freshAir.test(all) && 'stepping outside for air',
    concert.test(all) && 'the concert',
  ].filter((topic) => topic !== false);
  const overview = topics.length
    ? 'You talked about ' + new Intl.ListFormat('en').format(topics) + '.'
    : turns.length
      ? 'You spoke about “' + turns[0]!.text.slice(0, 90) + '”.'
      : 'There are no learner messages to reflect on yet.';
  return { reply: overview, action: null, reflection: { overview, takeaways: takeaways.slice(0, 4) } };
}

function recentEvidence(input: TurnContext): string[] {
  return [
    ...input.tutorHistory
      .slice(-2)
      .reverse()
      .map((turn) => turn.text),
    ...input.chatHistory
      .filter((turn) => turn.role === 'user')
      .slice(-3)
      .reverse()
      .map((turn) => turn.text),
    ...input.saved
      .filter((item) => item.kind === 'Word')
      .slice(-3)
      .reverse()
      .map((item) => item.title),
  ];
}

function practice(input: TurnContext): TutorResult {
  if (input.practiceWord) {
    const w = input.practiceWord;
    const prompt = 'How would you say this in Mandarin? “' + w.translation + '”';
    if (input.previousPrompts?.includes(prompt)) return response('');
    return response(w.title + ' (' + w.pinyin + ') · ' + w.meaning, {
      kind: 'practice',
      title: w.title,
      detail: w.meaning,
      exercise: {
        kind: 'open',
        prompt,
        choices: [],
        answer: w.example,
        explanation: 'One natural phrasing is ' + w.example + ' ' + w.meaning,
      },
    });
  }
  const evidence = [input.message, input.source, ...recentEvidence(input)];
  for (const sample of evidence) {
    const candidates = series.filter((item) => item.match.test(sample));
    for (const item of candidates) {
      const vocabulary = input.surface === 'Build vocabulary' && item.match === distraction;
      const exercises = vocabulary ? [catalogue[5]!, ...item.exercises] : item.exercises;
      const exercise = exercises.find((candidate) => !input.previousPrompts?.includes(candidate.prompt));
      if (!exercise) continue;
      const { kind, prompt, choices, answer, explanation } = exercise;
      return response(item.introduction, {
        kind: 'practice',
        title: item.title,
        detail: item.introduction,
        exercise: { kind, prompt, choices: [...choices], answer, explanation },
      });
    }
  }
  return response(
    input.trigger === 'practice' ? '' : 'Which expression or moment would you like to practice?',
  );
}

function stash(input: TurnContext): TutorResult {
  const explicitWord = input.message.match(
    /(?:stash|save|keep|remember|add|收藏|记住)\s*(?:the (?:word|phrase)\s*)?[“"「']?\s*([\p{Script=Han}]{1,8})/iu,
  )?.[1];
  const targets = ['透透气', '散场', '容易分心', '分心', '内耗', '修复', '只是', '鸟食', '喂鸟'];
  const known = [
    input.message,
    ...input.tutorHistory
      .slice(-2)
      .reverse()
      .map((turn) => turn.text),
    input.source,
  ]
    .map((text) => targets.find((word) => text.includes(word)))
    .find(Boolean);
  const title = explicitWord ?? known;
  if (!title) return response('Which Chinese word or expression would you like to keep?');

  return response('I’ve kept ' + title + ' for study.', {
    kind: 'stash',
    title,
    detail: demoStashGlosses[title] ?? input.message,
    exercise: null,
  });
}

export function demoTutor(input: TurnContext): TutorResult {
  const text = input.message.trim();
  const described = text + '\n' + input.source;
  switch (input.trigger) {
    case 'capture':
      return { capture: demoCapture(input) };
    case 'mediaConsider':
      return demoMedia(input);
    case 'notice':
      return { notice: demoNotice(input) };
    case 'wordIntake':
      if (!input.wordIntake) throw new Error('Missing word intake');
      return { reply: '', action: null, wordDecision: demoIntake(input.wordIntake) };
    case 'reflect':
      return reflect(input);
    case 'practice':
      return practice(input);
    case 'answer': {
      if (only.test(input.source) && text.includes('只在等'))
        return {
          ...response(
            'If you mean “I’m just waiting,” 我只是在等 makes the whole activity the focus. For “I wait only here,” say 我只在这儿等.',
          ),
          observation:
            'With 只在等, consider what “only” limits: 只在这儿等 singles out a place, while 只是在等 frames waiting as all you are doing.',
        };
      if (birds.test(input.source) && /鸟来喂/.test(text))
        return response(
          '鸟来喂 makes the bird the one doing the feeding. For the bird to arrive and eat, you could say 鸟过来吃鸟食。',
        );
      const eating = text.match(/(?:鸟|麻雀|它们)[^。！？]{0,15}?(?:吃|啄)/);
      if (birds.test(input.source) && eating)
        return response('With “' + eating[0] + '”, the listener can tell who is doing the eating.');
      if (text.includes('本来') && text.includes('结果'))
        return response(
          '本来 sets up your original intention and 结果 introduces what actually happened. That sequence makes the change easy to follow.',
        );
      if (only.test(input.source) && /只[在是认]/.test(text))
        return response(
          'Read the words right after 只 aloud. They carry the restriction: 只在星期天 limits the day, while 只是在等 limits the activity.',
        );
      const exercise = series
        .flatMap((item) => item.exercises)
        .find((item) => input.source.includes(item.prompt));
      if (exercise)
        return response('One possible phrasing is “' + exercise.answer + '” ' + exercise.explanation);
      return response('Which part of your wording would you like to revisit?');
    }
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
  const status = input.practiceStatus;
  const asksStatus =
    /(?:already|pending|queued|queue(?:d)? yet|upcoming|in (?:my|the) (?:queue|session)|on (?:my|the) list|what.*(?:scheduled|ready)|排好|排队了吗|有哪些练习)/i.test(
      text,
    ) || /^(?:did|have|is|are|do I have|what(?:’s|'s| is))\b.*(?:practi[cs]e|exercises?|queue)/i.test(text);
  const command = text.replace(/^(?:(?:can|could|would) (?:you|we|I)\s+)?(?:please\s+)?/i, '');
  const queueRequest =
    /^(?:queue|practi[cs]e|rehearse)\b|^(?:add|make|create|give|schedule|put|let[’']?s|I (?:want|would like)|I'd like)\b.*(?:practi[cs]e|exercise|drill|queue)|^(?:安排|想做|来个).*练习/i.test(
      command,
    );
  if (status && (asksStatus || queueRequest)) {
    const namedSeries = series.find((item) => item.match.test(text));
    const selected =
      namedSeries ??
      (queueRequest
        ? [input.source, ...recentEvidence(input)]
            .map((part) => series.find((item) => item.match.test(part)))
            .find(Boolean)
        : undefined);
    const matching = (entry: { title: string; prompt: string }) =>
      selected
        ? entry.title === selected.title || selected.match.test(entry.title + ' ' + entry.prompt)
        : asksStatus;
    const pending = status.pending.filter(matching);
    const active = status.active.filter(matching);
    if (pending.length || active.length) {
      const lines = [
        pending.length ? 'Queued for later: ' + pending.map((entry) => entry.title).join(', ') + '.' : '',
        active.length
          ? 'In your current session: ' + active.map((entry) => entry.title).join(', ') + '.'
          : '',
      ];
      return response(lines.filter(Boolean).join(' '));
    }
    if (asksStatus)
      return response(
        selected
          ? 'I don’t see an exercise on that in your queue or current session.'
          : 'Your queue and current session have no exercises.',
      );
  }
  if (queueRequest) return practice(input);
  if (input.captureFollowUp && requestsCaptureNote(text)) {
    return response('I’ve kept the passage as a note.', {
      kind: 'note', title: input.captureFollowUp.text, detail: input.captureFollowUp.text, exercise: null,
    });
  }
  const note = text.match(
    /^(?:(?:could|can) you\s+)?(?:please\s+)?(?:(?:save|keep|add|make) (?:a |this )?note(?: that)?|note to self|记一笔)\s*[:：,]?\s+(.+)$/is,
  );
  if (note)
    return response('I’ve kept your note.', {
      kind: 'note',
      title: note[1]!.trim(),
      detail: input.source.trim() || note[1]!.trim(),
      exercise: null,
    });
  if (
    /^(?:(?:could|can) you\s+)?(?:please\s+)?(?:stash|save|keep|remember|add)\b/i.test(text) ||
    /^(?:收藏|记住)/.test(text)
  )
    return stash(input);
  if (/值得/.test(described) && /意思|什么意思|mean|explain|worth/i.test(text))
    return response('值得 (zhíde) means “to be worth.” In 这本书值得看吗, 值得看 means “worth reading,” so the question is “Is this book worth reading?”');
  if (input.captureFollowUp?.text.includes('一部电影') && /部/.test(text) && /measure word|classifier|量词/i.test(text))
    return response('Yes. 部 is a measure word for films and other works. 一部电影 means “a movie,” so 我昨天看了一部电影 sounds natural.');
  const focus =
    [text, input.source].find((part) => series.some((item) => item.match.test(part)) || /内耗/.test(part)) ??
    text;
  if (only.test(focus))
    return response(
      '只 goes before the part you want to limit. 我只在早上等 means mornings are the only time I wait. 我只是在等 means waiting is all I’m doing.',
    );
  if (birds.test(focus))
    return response(
      'If the birds are coming to eat what you put out, try 我在等鸟过来吃鸟食. In 我想喂鸟, you are the one feeding them.',
    );
  if (freshAir.test(focus))
    return response(
      '透透气 (tòu tou qì) means to get some air. 我想出去透透气 works even when what you really want is a change of scene.',
    );
  if (distraction.test(focus))
    return response(
      'If you mean that staying on task is hard, 我在家容易分心 fits. If you want to describe what actually happens, try 我做着做着就干别的去了. Which is closer to your thought?',
    );
  if (/内耗/.test(focus))
    return response(
      '内耗 also works for a group. 两个部门争来争去，公司的内耗越来越严重。 The organization loses energy to its own friction.',
    );
  if (/散场/.test(text))
    return response(
      '散场 (sànchǎng) is when a performance ends and the crowd begins to leave. 散场以后 places the story in that little stretch of time afterwards.',
    );
  if (/chat|reflect|聊天|回顾/i.test(text)) return response(reflect(input).reply ?? '');
  return response(
    'I don’t have an offline example for that expression. The live tutor can discuss it in context.',
  );
}

export function demoFriend(input: TurnContext): string {
  const text = input.message;
  const previous = input.chatHistory.filter((turn) => turn.role === 'assistant').map((turn) => turn.text);
  const topic =
    [
      text,
      input.topic ?? '',
      ...input.chatHistory
        .filter((turn) => turn.role === 'user')
        .slice(-2)
        .reverse()
        .map((turn) => turn.text),
    ].find((part) =>
      [birds, library, concert, distraction, freshAir].some((pattern) => pattern.test(part)),
    ) ?? '';
  let replies: string[];
  if (birds.test(topic)) {
    if (/鸟食|种子|seeds?|喂|feed/i.test(text))
      replies = [
        '把鸟食放好以后，最有意思的就是等第一只过来。它可能先在栏杆上停一会儿，看看四周才肯下嘴。',
        '要是有一只先吃上了，旁边那几只大概也会跟过来。一下子就热闹了。',
      ];
    else
      replies = [
        '麻雀落在阳台上时，常常是先听见爪子轻轻一响，回头才看见它。安静等一会儿倒挺有意思。',
        '要是离得远，看不清羽毛，还能听叫声。光听声音和亲眼看见，感觉挺不一样。',
      ];
  } else if (distraction.test(topic))
    replies = [
      '手机最会挑时候，刚想专心就亮一下。等回过神来，书还停在原来那一页。',
      '在家桌子旁边还有杯子要洗、衣服要收，每件事好像都只需要一分钟。',
    ];
  else if (library.test(topic))
    replies = [
      '图书馆那种安静挺特别的。大家明明都在忙自己的事，坐在一起又像有个伴。',
      '尤其是能听到翻书声的时候，比家里完全没动静还容易坐住。',
    ];
  else if (concert.test(topic))
    replies = [
      '演唱会结束以后，人都走到街上了，耳朵里好像还留着最后一首歌。',
      '有时候回家路上有人轻轻哼一句，旁边的人也接得上，倒像演出还没完。',
    ];
  else if (freshAir.test(topic))
    replies = [
      '哪怕只出去走一圈，街上的声音一换，心情也跟着松一点。',
      '晚上出去走走挺好，风凉一点，脚步也慢下来。',
    ];
  else if (input.topic?.trim())
    replies = [
      '说到' + input.topic + '，你最先想到的是哪一个画面？',
      '有时候一个小细节比从头讲起更有意思。你刚才想到的那个细节是什么？',
    ];
  else if (/^(你好|嗨|hello|hi)[！!。,.，\s]*$/i.test(text)) return '你好！今天有什么想聊的？';
  else return '你刚才说的这件事，我还想多听一点。后来呢？';
  return replies.find((reply) => !previous.includes(reply)) ?? replies[previous.length % replies.length]!;
}
