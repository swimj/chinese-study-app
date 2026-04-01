import { useMemo, useState } from 'react';
import { FlashcardViewer } from './components/FlashcardViewer';
import { PracticePanel } from './components/PracticePanel';
import { sampleWords } from './data/words';
import type { WordItem } from './types';
import { buildPracticePrompt } from './lib/ai';

const categories = ['All', ...Array.from(new Set(sampleWords.map((word) => word.category)))];

function App() {
  const [activeWordId, setActiveWordId] = useState(sampleWords[0].id);
  const [category, setCategory] = useState('All');
  const [aiResponse, setAIResponse] = useState('');
  const activeWord = sampleWords.find((word) => word.id === activeWordId) as WordItem;

  const filteredWords = useMemo(
    () => sampleWords.filter((word) => category === 'All' || word.category === category),
    [category],
  );

  return (
    <div className="container">
      <header className="header">
        <div>
          <h1 className="title">Chinese Study App</h1>
          <p className="subtitle">Practice vocabulary, review flashcards, and build AI-powered language prompts.</p>
        </div>
        <div>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            {categories.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      </header>

      <div className="grid">
        <div className="panel">
          <h2>Vocabulary</h2>
          <FlashcardViewer
            words={filteredWords}
            activeWordId={activeWordId}
            onSelectWord={setActiveWordId}
          />
        </div>

        <div className="panel">
          <h2>Study Hub</h2>
          <PracticePanel
            word={activeWord}
            prompt={buildPracticePrompt(activeWord)}
            aiResponse={aiResponse}
            onGenerate={() => {
              setAIResponse(`Practice sentence for ${activeWord.chinese}: ${activeWord.example}`);
            }}
          />
        </div>
      </div>

      <footer className="footer">
        Tip: add your own word list in <code>src/data/words.ts</code> and hook an OpenAI or local LLM endpoint in <code>src/lib/ai.ts</code>.
      </footer>
    </div>
  );
}

export default App;
