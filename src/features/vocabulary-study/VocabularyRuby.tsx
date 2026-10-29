import type { ReactNode } from 'react';

const syllables = new Set(`a ai an ang ao ba bai ban bang bao bei ben beng bi bian biao bie bin bing bo bu ca cai can cang cao ce cen ceng cha chai chan chang chao che chen cheng chi chong chou chu chua chuai chuan chuang chui chun chuo ci cong cou cu cuan cui cun cuo da dai dan dang dao de dei den deng di dia dian diao die ding diu dong dou du duan dui dun duo e ei en eng er fa fan fang fei fen feng fo fou fu ga gai gan gang gao ge gei gen geng gong gou gu gua guai guan guang gui gun guo ha hai han hang hao he hei hen heng hong hou hu hua huai huan huang hui hun huo ji jia jian jiang jiao jie jin jing jiong jiu ju juan jue jun ka kai kan kang kao ke kei ken keng kong kou ku kua kuai kuan kuang kui kun kuo la lai lan lang lao le lei leng li lia lian liang liao lie lin ling liu lo long lou lu luan lun luo lü lüe ma mai man mang mao me mei men meng mi mian miao mie min ming miu mo mou mu na nai nan nang nao ne nei nen neng ni nian niang niao nie nin ning niu nong nou nu nuan nuo nü nüe o ou pa pai pan pang pao pei pen peng pi pian piao pie pin ping po pou pu qi qia qian qiang qiao qie qin qing qiong qiu qu quan que qun ran rang rao re ren reng ri rong rou ru ruan rui run ruo sa sai san sang sao se sen seng sha shai shan shang shao she shei shen sheng shi shou shu shua shuai shuan shuang shui shun shuo si song sou su suan sui sun suo ta tai tan tang tao te teng ti tian tiao tie ting tong tou tu tuan tui tun tuo wa wai wan wang wei wen weng wo wu xi xia xian xiang xiao xie xin xing xiong xiu xu xuan xue xun ya yan yang yao ye yi yin ying yo yong you yu yuan yue yun za zai zan zang zao ze zei zen zeng zha zhai zhan zhang zhao zhe zhei zhen zheng zhi zhong zhou zhu zhua zhuai zhuan zhuang zhui zhun zhuo zi zong zou zu zuan zui zun zuo`.split(' '));
const tones = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/gu;
function plain(value: string): string { return value.toLowerCase().normalize('NFD').replace(/[\u0300\u0301\u0304\u030c]/g, '').normalize('NFC'); }

/** Refuse ambiguous boundaries instead of assigning a guessed reading to a character. */
export function alignVocabularyPinyin(pinyin: string, count: number): string[] | null {
  const normalized = pinyin.normalize('NFC').trim();
  if (!count || !normalized || !/^[a-züāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ\s'’.,!?;:，。！？；：、-]+$/iu.test(normalized)) return null;
  const tokens = normalized.split(/[\s'’.,!?;:，。！？；：、-]+/u).filter(Boolean);
  const memo = new Map<string, string[][]>();
  function split(token: string, needed: number): string[][] {
    const key = `${token}:${needed}`;
    const cached = memo.get(key); if (cached) return cached;
    if (!token) return needed === 0 ? [[]] : [];
    if (needed <= 0 || token.length > needed * 6) return [];
    const results: string[][] = [];
    for (let end = 1; end <= Math.min(6, token.length); end++) {
      const head = token.slice(0, end);
      if (!syllables.has(plain(head)) || [...head.matchAll(tones)].length > 1) continue;
      for (const tail of split(token.slice(end), needed - 1)) {
        results.push([head, ...tail]); if (results.length > 1) break;
      }
      if (results.length > 1) break;
    }
    memo.set(key, results); return results;
  }
  const combined = new Map<string, string[][]>();
  function combine(index: number, needed: number): string[][] {
    const key = `${index}:${needed}`;
    const cached = combined.get(key); if (cached) return cached;
    if (index === tokens.length) return needed === 0 ? [[]] : [];
    const results: string[][] = [];
    for (let size = 1; size <= needed - (tokens.length - index - 1); size++) {
      for (const head of split(tokens[index]!, size)) for (const tail of combine(index + 1, needed - size)) {
        results.push([...head, ...tail]); if (results.length > 1) { combined.set(key, results); return results; }
      }
    }
    combined.set(key, results); return results;
  }
  const found = combine(0, count);
  return found.length === 1 ? found[0]! : null;
}

export function VocabularyCharacterRuby({ text, pinyin, target = false, readingVisible = true }: { text: string; pinyin: string; target?: boolean; readingVisible?: boolean }) {
  const characters = [...text];
  const aligned = characters.every((character) => /\p{Script=Han}/u.test(character)) ? alignVocabularyPinyin(pinyin, characters.length) : null;
  return aligned ? <span className={target ? 'vocab-ruby-target' : undefined}>{characters.map((character, index) => <ruby className="vocab-character-ruby" key={index}>{character}{readingVisible && <><rp>(</rp><rt lang="zh-Latn">{aligned[index]}</rt><rp>)</rp></>}</ruby>)}</span>
    : <ruby className={`vocab-character-ruby${target ? ' vocab-ruby-target' : ''}`}>{text}{readingVisible && <><rp>(</rp><rt lang="zh-Latn">{pinyin}</rt><rp>)</rp></>}</ruby>;
}

export function vocabularySentenceRuby(sentence: string, pinyin: string | null, target: string, targetPinyin: string): ReactNode | null {
  if (!pinyin || !target || !sentence.includes(target)) return null;
  const chars = [...sentence];
  if (chars.some((character) => !/[\p{Script=Han}\p{P}\p{Z}\s]/u.test(character))) return null;
  const aligned = alignVocabularyPinyin(pinyin, chars.filter((character) => /\p{Script=Han}/u.test(character)).length);
  const targetReadings = alignVocabularyPinyin(targetPinyin, [...target].length);
  if (!aligned || !targetReadings) return null;
  const targetFlags = chars.map(() => false);
  for (let offset = sentence.indexOf(target); offset >= 0; offset = sentence.indexOf(target, offset + target.length)) {
    const start = [...sentence.slice(0, offset)].length;
    for (let index = 0; index < [...target].length; index++) targetFlags[start + index] = true;
  }
  let spoken = 0, targetIndex = 0;
  for (let index = 0; index < chars.length; index++) {
    if (!/\p{Script=Han}/u.test(chars[index]!)) continue;
    if (targetFlags[index] && aligned[spoken]!.toLowerCase() !== targetReadings[targetIndex++ % targetReadings.length]!.toLowerCase()) return null;
    spoken++;
  }
  spoken = 0;
  return chars.map((character, index) => /\p{Script=Han}/u.test(character) ? <ruby key={index} tabIndex={targetFlags[index] ? undefined : 0}
    className={`vocab-character-ruby ${targetFlags[index] ? 'vocab-ruby-target' : 'vocab-ruby-on-demand'}`}>{character}<rp>(</rp><rt lang="zh-Latn">{aligned[spoken++]}</rt><rp>)</rp></ruby> : character);
}
