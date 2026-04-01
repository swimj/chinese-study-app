import type { WordItem } from '../types';

type Props = {
  words: WordItem[];
  activeWordId: string;
  onSelectWord: (id: string) => void;
};

export function FlashcardViewer({ words, activeWordId, onSelectWord }: Props) {
  return (
    <ul className="word-list">
      {words.map((word) => (
        <li
          key={word.id}
          className={`word-item ${word.id === activeWordId ? 'active' : ''}`}
          onClick={() => onSelectWord(word.id)}
        >
          <div>
            <strong>{word.chinese}</strong>
            <span>{word.pinyin}</span>
          </div>
          <div className="badge">{word.category}</div>
        </li>
      ))}
    </ul>
  );
}
