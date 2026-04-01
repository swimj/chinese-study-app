import type { WordItem } from '../types';

export const sampleWords: WordItem[] = [
  {
    id: '1',
    english: 'hello',
    chinese: '你好',
    pinyin: 'nǐ hǎo',
    category: 'Basics',
    example: '你好！你今天怎么样？',
  },
  {
    id: '2',
    english: 'thank you',
    chinese: '谢谢',
    pinyin: 'xiè xie',
    category: 'Basics',
    example: '谢谢你的帮助。',
  },
  {
    id: '3',
    english: 'to study',
    chinese: '学习',
    pinyin: 'xué xí',
    category: 'Verbs',
    example: '我每天学习汉语。',
  },
  {
    id: '4',
    english: 'friend',
    chinese: '朋友',
    pinyin: 'péng you',
    category: 'Nouns',
    example: '她是我的好朋友。',
  },
  {
    id: '5',
    english: 'to speak',
    chinese: '说',
    pinyin: 'shuō',
    category: 'Verbs',
    example: '你会说中文吗？',
  },
];
