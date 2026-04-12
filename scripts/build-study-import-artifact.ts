import fs from 'node:fs';
import path from 'node:path';

type CanonicalWord = {
  id: string;
  hanzi: string;
  traditional: string | null;
  pinyinDisplay: string;
  meaning: string;
  meanings: string[];
  priority: number | null;
};

type CanonicalCorpus = {
  words: CanonicalWord[];
};

const cwd = process.cwd();
const inputPath = path.resolve(cwd, process.argv[2] ?? 'data/canonical-corpus.json');
const outputPath = path.resolve(cwd, process.argv[3] ?? 'data/canonical-study-import.json');
const createdAt = new Date().toISOString();

const corpus = JSON.parse(fs.readFileSync(inputPath, 'utf8')) as CanonicalCorpus;

const words = corpus.words.map((word) => ({
  id: word.id,
  hanzi: word.hanzi,
  traditional: word.traditional,
  pinyin: word.pinyinDisplay,
  meaning: word.meaning,
  examples: [],
  status: 'unstudied',
  priority: word.priority ?? 1,
  createdAt,
  learningStreak: 0,
  lastLearningSuccessOn: null,
  lastLearningCoveredOn: null,
}));

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(
  outputPath,
  JSON.stringify(
    {
      meta: {
        generatedAt: createdAt,
        source: inputPath,
        wordCount: words.length,
        reviewItemDefaults: {
          directions: ['forward', 'reverse'],
          intervalHours: 24,
          lastReviewedAt: null,
          nextDueAt: null,
          easeFactor: 2.5,
        },
      },
      words,
    },
    null,
    2,
  ),
);

console.log(
  JSON.stringify(
    {
      outputPath,
      wordCount: words.length,
      sample: words.slice(0, 5),
    },
    null,
    2,
  ),
);
