/** Linguistic evidence sent to models; persistence identity stays with the caller. */
export type ModelLexicalWord = {
  hanzi: string;
  pinyin: string;
  meanings: string[];
};

export function modelLexicalWord(word: ModelLexicalWord): ModelLexicalWord {
  return { hanzi: word.hanzi, pinyin: word.pinyin, meanings: word.meanings };
}
