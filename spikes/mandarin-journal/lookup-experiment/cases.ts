// Brackets belong to the fixture notation. Provider input contains the unmarked
// text and the UTF-16 range used by the browser. Spans and intent are scoring keys.
export type LookupCase = {
  id: string;
  kind: 'tap' | 'selection';
  text: string;
  start: number;
  end: number;
  acceptableSpans: string[];
  intent: string;
};

function stimulus(marked: string) {
  const parts = /^([^【】]*)【([^【】]+)】([^【】]*)$/u.exec(marked);
  if (!parts) throw new Error('Each lookup case needs exactly one marked occurrence');
  const [, before, target, after] = parts;
  return { text: before + target + after, start: before.length, end: before.length + target.length };
}

function tap(id: string, marked: string, acceptableSpans: string[], intent: string): LookupCase {
  const input = stimulus(marked);
  return { id, kind: 'tap', ...input, acceptableSpans, intent };
}

function select(id: string, marked: string, intent: string): LookupCase {
  const input = stimulus(marked);
  return { id, kind: 'selection', ...input, acceptableSpans: [input.text.slice(input.start, input.end)], intent };
}

export const cases: LookupCase[] = [
  tap('kiosk-newsstand', '河边那座旧报【刊】亭关了三年。', ['报刊亭'],
    'Identify the newsstand as a single object. The next character 关 begins what happened to it.'),
  tap('kiosk-still', '玻璃上【还】贴着一张早已过期的订报广告。', ['还', '还贴着'],
    'Read hái. The advertisement is still stuck to the glass.'),
  tap('kiosk-return', '没带伞就拿一把。有空了再【还】。', ['还', '再还'],
    'Read huán. The implied object is the borrowed umbrella.'),
  tap('show-listening', '我本来只想出去透透气，听着【听】着，也跟着唱了起来。', ['听着听着', '听着'],
    'The second 听 belongs to the repetition. Continued listening sets the scene for starting to sing along.'),
  tap('kiosk-sew', '说那是给我【缝】裤脚剩下的几颗扣子。', ['缝', '缝裤脚'],
    'Read féng. She stitched the trouser hems; these buttons were left over.'),
  tap('kiosk-first-glance', '深蓝，【乍】一看像黑的。', ['乍一看', '乍', '乍一看像黑的'],
    'At first glance the dark blue looks black. Give the relevant initial-impression sense.'),
  tap('probe-study-life', '我们研究【生】命的起源，也记录它的变化。', ['生命'],
    '研究 is the verb and 生命 begins its object. Explain life here.'),
  tap('probe-grad-student', '我们系的研究【生】正在记录植物的变化。', ['研究生'],
    '研究生 names the graduate students doing the recording.'),
  tap('probe-duck', '湖边有一只【鸭】，身后跟着三只小鸭。', ['鸭'],
    'The first 鸭 is a standalone noun for the duck. 一只 counts it.'),
  tap('probe-screwdriver', '消息里写着“🔧请带上螺【丝】刀”。', ['螺丝刀'],
    'Identify the whole tool, a screwdriver. The emoji before the tap occupies two UTF-16 code units.'),
  tap('probe-cannot-eat', '她急得饭都吃【不】下。', ['吃不下'],
    '吃不下 expresses being unable to eat or get food down because she is anxious.'),
  tap('probe-surname', '这位师傅姓【单】，大家都叫他单师傅。', ['单', '姓单'],
    'Read Shàn, the surname. The first occurrence follows 姓.'),

  select('probe-ticket', '上车前，请拿好【车票】。',
    'A ticket for the journey. An exact lexical gloss suffices.'),
  select('probe-concrete-tool', '修抽屉时，我找了半天才找到【螺丝刀】。',
    'A screwdriver. A concise whole-word gloss suffices.'),
  select('probe-play', '轮到她【弹】这首曲子了。',
    'Read tán and gloss playing the piece on an instrument. Keep just the selected character.'),
  select('probe-clever-saying', '他自作主张改了报价，结果【聪明反被聪明误】。',
    'Explain how trying to be clever backfired. The proverb is useful as a unit; seven separate character glosses add little.'),
  select('probe-idiom', '最后那段解释反而让人误会，真是【画蛇添足】。',
    'An unnecessary addition spoils the result. A literal image is useful only if it helps convey that point.'),
  select('probe-long-noun', '山路上停着一辆【公共汽车】。',
    'Simply a bus. The four-character length alone does not warrant internal segmentation.'),
  select('show-two-actions', '我本来只想出去透透气，【听着听着，也跟着唱了起来】。',
    'Explain the transition from ongoing listening to beginning to sing along. 听着听着, 跟着, and 唱了起来 are useful groupings.'),
  select('kiosk-result', '【青绿色的铁皮被雨冲得发白】，玻璃上还贴着一张早已过期的订报广告。',
    'Rain washed the blue-green sheet metal pale. Show how 被 introduces what affected it and 得发白 gives the result.'),
  select('probe-cross-boundary', '我们研【究生】命的起源，也记录它的变化。',
    'Respect 究生 as the selection. Explain that it straddles 研究 and 生命, without inventing a lexical meaning for the fragment.'),
  select('probe-second-return', '借的伞还没【还】，我明天就送回去。',
    'This second 还 is huán, return the umbrella. Earlier 还 is hái in 还没.'),
  select('probe-reschedule', '她提议【把会议推迟到周五】，好让大家都有时间准备。',
    '把 identifies the meeting being moved and 到周五 gives the new time. Explain the phrase as a rescheduling action.'),
  select('probe-finally', '我【好不容易】挤上了最后一班车。',
    'Only after considerable effort or difficulty. Teach the conventional whole expression in context.'),
];
