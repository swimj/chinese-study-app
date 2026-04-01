import type { WordItem } from '../types';

type Props = {
  word: WordItem;
  prompt: string;
  aiResponse: string;
  onGenerate: () => void;
};

export function PracticePanel({ word, prompt, aiResponse, onGenerate }: Props) {
  return (
    <div className="word-details">
      <div>
        <p className="badge">Current word</p>
        <h3>{word.english}</h3>
        <p className="notes">
          {word.chinese} · {word.pinyin}
        </p>
      </div>

      <div>
        <p className="badge">Example sentence</p>
        <p className="notes">{word.example}</p>
      </div>

      <div>
        <p className="badge">AI practice prompt</p>
        <textarea readOnly value={prompt} />
      </div>

      <div>
        <button type="button" onClick={onGenerate}>
          Show practice sentence
        </button>
      </div>

      {aiResponse ? (
        <div>
          <p className="badge">Practice output</p>
          <p className="notes">{aiResponse}</p>
        </div>
      ) : null}
    </div>
  );
}
