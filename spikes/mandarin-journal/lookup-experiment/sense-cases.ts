import { readFileSync } from 'node:fs';
import { createReaderCatalog } from '../reader-catalog.ts';

const catalog = createReaderCatalog(JSON.parse(readFileSync(new URL('./sense-catalog.sample.json', import.meta.url), 'utf8')));
// Editorial, context-free reminders. Each spelling gets the same first card in every passage.
const reminders: Record<string, [string,string]> = {
  '泡沫':['pàomò','foam, bubbles'], '不堪':['bùkān','unable to bear'], '垂':['chuí','hang down'],
  '有所':['yǒusuǒ','to some extent'], '与':['yǔ','and, with'], '还':['hái / huán','still, also / give back'],
  '聪明反被聪明误':['cōngming fǎn bèi cōngming wù','too clever for one’s own good'], '报刊亭':['bàokāntíng','newsstand'],
};
function probe(id: string, marked: string, expected: string | null, intent: string, omit?: string) {
  const parts = /^([^【】]*)【([^【】]+)】([^【】]*)$/u.exec(marked);
  if (!parts) throw new Error('Invalid case ' + id);
  const [,before,span,after] = parts;
  const candidates = catalog.sensesFor(span).filter(s => s.senseId !== omit);
  if (expected !== null && !candidates.some(s => s.senseId === expected)) throw new Error('Missing expected sense ' + id);
  const [pinyin,gloss] = reminders[span];
  return { id, occurrence: { text: before+span+after, start: before.length, end: before.length+span.length },
    candidates, expected, intent, reminder: { span,pinyin,gloss } };
}
export const senseCases = [
  probe('newsstand','河边那座旧【报刊亭】关了三年。','stand','A concrete object where the single-word reminder already suffices.'),
  probe('second-return','借的伞还没【还】，我明天就送回去。','return','The second occurrence means return the umbrella.'),
  probe('first-still','借的伞【还】没还，我明天就送回去。','still','The first occurrence means still.'),
  probe('also','她除了会弹琴，【还】会修琴。','also','An additional skill.'),
  probe('foam','洗碗池里堆着厚厚一层【泡沫】。','泡沫/0','Physical suds.'),
  probe('bubble','价格远超实际价值，他担心这是一场【泡沫】。','泡沫/1','Inflated value.'),
  probe('missing-bubble','估值涨了十倍，投资者担心【泡沫】会破。',null,'Figurative use was deliberately omitted from the candidates.','泡沫/1'),
  probe('cannot-bear','老桥早已【不堪】重负，只好暂时封闭。','不堪/0','Unable to withstand the load.'),
  probe('extremely','忙了三天，他已经疲惫【不堪】。','不堪/1','Post-adjective intensifier.'),
  probe('compound','得知祖父病情【垂】危，她连夜赶回家。',null,'The physical sense does not apply inside 垂危.'),
  probe('degree','修缮以后，屋里的采光【有所】改善。','有所/0','The improvement is qualified in degree.'),
  probe('grant','校方授【与】她名誉学位。',null,'The marked character belongs to 授与.'),
  probe('saying','他自作主张改了报价，结果【聪明反被聪明误】。','clever','The scheme backfired. Compare reminder with a gloss tied to the actor.'),
  probe('ambiguous','纸上只写了一个“【还】”字。',null,'The quoted character has no context to resolve its reading.'),
];
