import type { VocabularyMode, VocabularyWordDisplay } from '../../src/features/vocabulary-ui/types';

/** Deterministic lab interactions only; production policy belongs to the session controller. */
export const labWords: Array<VocabularyWordDisplay & { prompts: string[] }> = [
  { id: 'reluctant', hanzi: '舍不得', pinyin: 'shě bu de', meaning: 'reluctant to part with, use up, or leave something', prompts: [
    'The trip is over, but you wish you could stay a little longer.\nHow do you say you’re reluctant to leave?',
    '这是奶奶留给我的，我一直____扔掉。',
    'You have one last piece of your favourite chocolate.\nYou don’t quite want to eat it yet.',
  ] },
  { id: 'unexpected', hanzi: '竟然', pinyin: 'jìngrán', meaning: 'unexpectedly; to one’s surprise', prompts: [
    'You expected the restaurant to be quiet, but there’s a queue down the street.\nWhich expression marks your surprise?',
    '这么冷的天，他____穿着短袖就出门了。',
  ] },
  { id: 'overall', hanzi: '总的来说', pinyin: 'zǒng de lái shuō', meaning: 'generally speaking; overall', prompts: [
    'There were a few small problems, but you want to give your overall impression.\nHow would you introduce it?',
    '____，这次旅行还是很愉快的。',
  ] },
  { id: 'maybe', hanzi: '说不定', pinyin: 'shuō bu dìng', meaning: 'perhaps; you never know', prompts: [
    'They haven’t replied yet. Maybe they’re just busy.\nHow would you express that possibility?',
    '先别走，____他马上就来了。',
  ] },
];
const longSessionVocabulary = [
  ['after-all', '毕竟', 'bìjìng', 'after all'],
  ['no-wonder', '难怪', 'nánguài', 'no wonder'],
  ['instead', '反而', "fǎn’ér", 'instead; contrary to expectations'],
  ['perversely', '偏偏', 'piānpiān', 'just at the wrong time; against expectations'],
  ['turns-out', '原来', 'yuánlái', 'as it turns out'],
  ['whatever', '随便', 'suíbiàn', 'as one pleases'],
  ['as-for', '至于', 'zhìyú', 'as for'],
  ['anyway', '反正', 'fǎnzhèng', 'anyway'],
  ['since', '既然', 'jìrán', 'since; given that'],
  ['although', '尽管', 'jǐnguǎn', 'although'],
  ['even', '甚至', 'shènzhì', 'even'],
  ['rather', '宁可', 'nìngkě', 'would rather'],
  ['not-necessarily', '未必', 'wèibì', 'not necessarily'],
  ['simply', '干脆', 'gāncuì', 'simply; without hesitation'],
  ['all-along', '一向', 'yīxiàng', 'all along; consistently'],
  ['might-as-well', '索性', 'suǒxìng', 'might as well'],
  ['in-short', '总之', 'zǒngzhī', 'in short'],
  ['as-if', '仿佛', 'fǎngfú', 'as if'],
  ['gradually', '逐渐', 'zhújiàn', 'gradually'],
  ['occasionally', '偶尔', "ǒu’ěr", 'occasionally'],
  ['especially', '尤其', 'yóuqí', 'especially'],
  ['while-at-it', '顺便', 'shùnbiàn', 'while one is at it'],
  ['unavoidable', '难免', 'nánmiǎn', 'hard to avoid'],
  ['in-the-end', '到底', 'dàodǐ', 'in the end; after all'],
  ['better-to', '不如', 'bùrú', 'it would be better to'],
  ['opportunity', '趁机', 'chènjī', 'take the opportunity'],
];
labWords.push(...longSessionVocabulary.map(([id, hanzi, pinyin, meaning]) => ({
  id, hanzi, pinyin, meaning, prompts: [`Which Mandarin expression means “${meaning}”?`],
})), { id: 'arrival', hanzi: '碰巧', pinyin: 'pèngqiǎo', meaning: 'coincidentally', prompts: ['Which Mandarin expression means “coincidentally”?'] });

export type LabWordStatus = 'open' | 'covered' | 'left';
export type LabState = {
  activeWordId: string;
  returnWordId: string | null;
  marks: Record<string, LabWordStatus>;
  modes: Record<string, VocabularyMode>;
  seen: string[];
  extra: boolean;
  value: string;
  revealed: boolean;
  assessment: 'accepted' | 'rejected' | 'unassessed';
  promptIndex: number;
  phase: 'active' | 'finishing' | 'summary';
};
export function initialLabState(): LabState {
  return {
    activeWordId: 'reluctant', returnWordId: null,
    marks: { reluctant: 'open', unexpected: 'covered', overall: 'left', maybe: 'open' },
    modes: { reluctant: 'practice', unexpected: 'practice', overall: 'solidify', maybe: 'practice' },
    seen: ['unexpected', 'overall'], extra: false, value: '', revealed: false,
    assessment: 'unassessed', promptIndex: 0, phase: 'active',
  };
}
export function currentLabWord(state: LabState) {
  const word = labWords.find((entry) => entry.id === state.activeWordId);
  if (!word) throw new Error('Unknown lab word');
  return word;
}
export function resetLabExercise(state: LabState): LabState {
  return { ...state, value: '', revealed: false, assessment: 'unassessed', promptIndex: state.promptIndex + 1 };
}
export function checkLabAnswer(state: LabState): LabState {
  const normal = (value: string) => value.normalize('NFKC').replace(/[\s，。！？、!?.,]/gu, '');
  const accepted = normal(state.value) === normal(currentLabWord(state).hanzi);
  return {
    ...state, revealed: true, assessment: accepted ? 'accepted' : 'rejected',
    marks: accepted ? { ...state.marks, [state.activeWordId]: 'covered' } : state.marks,
    seen: [...state.seen.filter((id) => id !== state.activeWordId), state.activeWordId],
  };
}
export function advanceLabWord(state: LabState, mark: LabWordStatus): LabState {
  const marks = { ...state.marks, [state.activeWordId]: mark };
  const seen = [...state.seen.filter((id) => id !== state.activeWordId), state.activeWordId];
  const returnTo = state.returnWordId && marks[state.returnWordId] === 'open' ? state.returnWordId : null;
  const next = returnTo ?? (state.phase === 'finishing' ? null : ['reluctant', 'maybe'].find((id) => marks[id] === 'open'));
  return resetLabExercise({ ...state, marks, seen, activeWordId: next ?? state.activeWordId, returnWordId: null, extra: false,
    phase: next ? state.phase : 'summary' });
}
export function bringBackLabWord(state: LabState, wordId: string): LabState {
  if (!labWords.some((entry) => entry.id === wordId)) throw new Error('Unknown lab word');
  return resetLabExercise({ ...state, activeWordId: wordId, extra: true, phase: 'active',
    seen: [...state.seen.filter((id) => id !== wordId), wordId],
    returnWordId: state.phase !== 'summary' && state.activeWordId !== wordId && state.marks[state.activeWordId] === 'open' ? state.activeWordId : null });
}

export function longSessionLabState(): LabState {
  const state = initialLabState();
  const earlier = longSessionVocabulary.map(([id]) => id);
  state.seen = [...earlier, ...state.seen];
  earlier.forEach((id, index) => { state.marks[id] = index % 9 === 0 ? 'left' : 'covered'; state.modes[id] = 'practice'; });
  return state;
}
