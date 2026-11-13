import { createRoot } from 'react-dom/client';
import App from '../../src/App';
import type {
  RepertoireCohort, RepertoireCueRow, RepertoireOutcomes, RepertoireQualityDetail,
  RepertoireQualityPage, RepertoireRepairRow,
} from '../../src/domain/repertoire-quality';
import '../../src/styles.css';

const options = new URLSearchParams(location.search);
const root = document.getElementById('root')!;
if (options.has('narrow')) root.style.maxWidth = '480px';
if (options.has('largeText')) document.documentElement.style.fontSize = '135%';

const capturedAt = '2026-11-13T14:00:00.000Z';
const publishedAt = '2026-10-28T11:00:00.000Z';
const appliedAt = '2026-11-07T11:00:00.000Z';
const noUse = {
  served: 0, answered: 0, acceptedFirst: 0, unfairFirstMisses: 0,
  unclassifiedFirstMisses: 0, skipped: 0, negative: 0, comments: 0,
} satisfies RepertoireOutcomes;
const before: RepertoireOutcomes = {
  served: 16, answered: 14, acceptedFirst: 5, unfairFirstMisses: 5,
  unclassifiedFirstMisses: 4, skipped: 2, negative: 2, comments: 1,
};
const after: RepertoireOutcomes = {
  served: 9, answered: 8, acceptedFirst: 6, unfairFirstMisses: 1,
  unclassifiedFirstMisses: 1, skipped: 1, negative: 0, comments: 0,
};
const sol: RepertoireCohort = {
  ...noUse, model: 'sol', exercises: 1384, exercisesServed: 372, served: 825,
  answered: 743, acceptedFirst: 624, unfairFirstMisses: 20, unclassifiedFirstMisses: 99,
  wordsPublished: 361, authoringSpendUsd: 5.39, pricedCalls: 361, calls: 363,
};
const luna: RepertoireCohort = {
  ...noUse, model: 'luna', exercises: 714, exercisesServed: 234, served: 565,
  answered: 519, acceptedFirst: 408, unfairFirstMisses: 25, unclassifiedFirstMisses: 86,
  wordsPublished: 191, authoringSpendUsd: 1.29, pricedCalls: 191, calls: 191,
};
const cues: RepertoireCueRow[] = [
  { id: 'zhenzhuo', target: '斟酌', prompt: '做决定之前，我们还需要仔细____一下。', model: 'luna',
    path: 'reflection', promptVersion: 'v5.1', outcomes: before, laterChanges: 1 },
  { id: 'shiying', target: '适应', prompt: '刚搬来时他总是睡不着，过了几周才____这里的生活节奏。', model: 'sol',
    path: 'bulk', promptVersion: null, outcomes: noUse, laterChanges: 0 },
  { id: 'zhaoying', target: '照应', prompt: '最后一段的内容____了前面。', model: 'luna',
    path: 'practice', promptVersion: 'v5.1', outcomes: before, laterChanges: 1 },
];
const repairedPrompt = '这句外交声明的措辞还要再____一下，别让人误以为我们已经同意了。';
const repairs: RepertoireRepairRow[] = [
  { id: 'repair-zhenzhuo', target: cues[0].target, prompt: cues[0].prompt, appliedAt, kind: 'edit',
    before, after, laterChanges: 1 },
  { id: 'repair-zhaoying', target: cues[2].target, prompt: cues[2].prompt, appliedAt, kind: 'replacement',
    before, after: noUse, laterChanges: 0 },
  { id: 'repair-nanmian', target: '难免', prompt: '准备得再充分，第一次带团也____会出点小差错。', appliedAt,
    kind: 'retirement', before, after: null, laterChanges: 0 },
];
const cueHistory: RepertoireQualityDetail = {
  target: '斟酌', generatedPrompt: '发表声明之前，有几件事还需要仔细____一下。', publication: 'operator',
  versions: [
    { contentId: 'zhenzhuo', version: 1, prompt: cues[0].prompt, availability: 'active',
      recordedAt: publishedAt, change: 'published', outcomes: before },
    { contentId: 'zhenzhuo', version: 2, prompt: repairedPrompt, availability: 'active',
      recordedAt: appliedAt, change: 'edit', outcomes: after },
  ],
};
const repairHistory: RepertoireQualityDetail = {
  ...cueHistory,
  generatedPrompt: null,
  publication: null,
  versions: [{ ...cueHistory.versions[0], change: 'source' }, cueHistory.versions[1],
    { contentId: 'zhenzhuo', version: 3, prompt: '出席记者会前，还得把这个问题的答法再____一下。',
      availability: 'active', recordedAt: '2026-11-12T18:00:00.000Z', change: 'edit', outcomes: noUse },
  ],
};
const histories: Record<string, RepertoireQualityDetail> = {
  zhenzhuo: cueHistory,
  'repair-zhenzhuo': repairHistory,
  shiying: {
    target: '适应', generatedPrompt: null, publication: 'automatic',
    versions: [{ contentId: 'shiying', version: 1, prompt: cues[1].prompt, availability: 'active',
      recordedAt: publishedAt, change: 'published', outcomes: noUse }],
  },
  zhaoying: {
    target: '照应', generatedPrompt: cues[2].prompt, publication: 'automatic',
    versions: [{ contentId: 'zhaoying', version: 1, prompt: cues[2].prompt, availability: 'active',
      recordedAt: publishedAt, change: 'published', outcomes: before }],
  },
  'repair-zhaoying': {
    target: '照应', generatedPrompt: null, publication: null,
    versions: [
      { contentId: 'zhaoying', version: 1, prompt: cues[2].prompt, availability: 'active',
        recordedAt: publishedAt, change: 'source', outcomes: before },
      { contentId: 'replacement-zhaoying', version: 1, prompt: '结尾再次写到那把红伞，____了开头的细节。',
        availability: 'active', recordedAt: appliedAt, change: 'replacement', outcomes: noUse },
    ],
  },
  'repair-nanmian': {
    target: '难免', generatedPrompt: null, publication: null,
    versions: [
      { contentId: 'nanmian', version: 1, prompt: repairs[2].prompt, availability: 'active',
        recordedAt: publishedAt, change: 'source', outcomes: before },
      { contentId: 'nanmian', version: 2, prompt: repairs[2].prompt, availability: 'retired',
        recordedAt: appliedAt, change: 'retirement', outcomes: noUse },
    ],
  },
};

let detailFailed = false;
window.fetch = async input => {
  const url = new URL(String(input), location.origin);
  if (url.pathname === '/api/operator/repertoire-quality/detail') {
    if (options.has('failDetail') && !detailFailed) {
      detailFailed = true;
      return Response.json({ error: 'Simulated network failure' }, { status: 503 });
    }
    const detail = histories[url.searchParams.get('id') ?? ''];
    return detail ? Response.json(detail) : Response.json({ error: 'Unknown cue' }, { status: 404 });
  }
  if (url.pathname === '/api/operator/repertoire-quality') {
    const repairView = url.searchParams.get('view') === 'repairs';
    const model = url.searchParams.get('model');
    const pageSize = 2;
    const page = Number(url.searchParams.get('page'));
    const start = (page - 1) * pageSize;
    const cueRows = options.has('empty') || repairView ? [] : cues.filter(row => !model || row.model === model);
    const repairRows = options.has('empty') || !repairView ? [] : repairs;
    const payload: RepertoireQualityPage = {
      capturedAt, page, pageSize, total: cueRows.length + repairRows.length,
      cohorts: options.has('empty') ? [] : [sol, luna],
      repairTotals: options.has('empty') ? { applied: 0, retired: 0, servedAfter: 0, firstMissAfter: 0, unfairAfter: 0, changedAgain: 0 }
        : { applied: 3, retired: 1, servedAfter: 1, firstMissAfter: 1, unfairAfter: 1, changedAgain: 1 },
      cueRows: cueRows.slice(start, start + pageSize), repairRows: repairRows.slice(start, start + pageSize),
    };
    return Response.json(payload);
  }
  return Response.json({ error: 'Unavailable in repertoire quality fixture' }, { status: 503 });
};

history.replaceState(null, '', '/operator/repertoire-quality');
createRoot(root).render(<App />);
