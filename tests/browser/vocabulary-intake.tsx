import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../../src/App';
import type {
  VocabularyIntakeCard as Card,
  VocabularyIntakeCommandRequest,
  VocabularyIntakeHistory,
  VocabularyIntakeSense as Sense,
  VocabularyIntakeStreamEvent,
  VocabularyIntakeTurn,
} from '../../src/domain/vocabulary-intake';
import type { VocabularyCollectionWord } from '../../src/domain/vocabulary-words';
import type { PriorityWord, Word } from '../../src/types';
import '../../src/styles.css';
import './vocabulary-intake.css';

function sense(senseId: string, label: string, isDefault = true, notes: string[] = []): Sense {
  return { senseId, label, notes, isDefault, disposition: 'default' };
}

const stashChoices = new Map([
  ['xing', { hanzi: '行', pinyin: 'xíng', meaning: 'to walk' }],
  ['hang', { hanzi: '行', pinyin: 'háng', meaning: 'a row; a trade' }],
]);

const examples = {
  纠结: {
    pinyin: 'jiūjié', state: 'ready', text: '纠结 describes being torn about a choice. It can also mean tangled or knotted.',
    senses: [sense('torn', 'torn or conflicted about a choice'), sense('tangled', 'tangled, knotted'), sense('band', 'to band together (dated)', false)],
  },
  帮派: {
    pinyin: 'bāngpài', state: 'added', text: '帮派 is the gang itself. It can also mean a faction inside a larger group.',
    senses: [sense('gang', 'a gang, usually criminal', true, ['黑帮 is more specifically a criminal organization.']),
      sense('faction', 'a faction or clique inside a larger organization')],
    target: 'gang',
  },
  接发球: {
    pinyin: 'jiēfāqiú', state: 'proposed', text: '接发 is short for 接发球, the return of serve. The player receiving is the 接发球方.',
    senses: [sense('return', 'to return a serve in a racket sport')],
  },
  绵长: {
    pinyin: 'miáncháng', state: 'preparing', text: 'In your sentence, 绵长 describes a lingering tenderness. I kept the sentence while the senses are prepared.',
    senses: [],
  },
  宠溺: {
    pinyin: 'chǒngnì', state: 'already-studying', text: 'You’re already studying 宠溺. You can also study its adjectival use.',
    senses: [sense('indulge', 'to spoil, dote on or indulge someone'), sense('doting', 'doting, of a look or expression', false)],
  },
  蒸馏: {
    pinyin: 'zhēngliú', state: 'proposed',
    text: 'Chinese uses 蒸馏 in 模型蒸馏. The learner can use the verb in 把大模型蒸馏成小模型.',
    senses: [sense('liquid', 'to distil liquids')],
    proposedSense: {
      label: 'to distil a model, training a smaller model to approximate a larger model’s behavior',
      notes: ['Used in 知识蒸馏 (knowledge distillation) and 模型蒸馏 (model distillation).'],
    },
  },
  打: {
    pinyin: 'dǎ', state: 'proposed', text: '打 has many distinct uses. This card shows a long inventory for comparison.',
    senses: [
      'to hit or strike with the hand or a held object', 'to play a sport or game', 'to make a telephone call',
      'to take a taxi', 'to type or print', 'to tie or fasten', 'to run off a copy', 'to fetch water',
      'to engage in combat or a contest', 'to give an injection', 'to draw up a plan or draft',
      'to buy unpackaged food or drink', 'to open or unlock', 'to mark a document', 'to send a telegram',
      'from, since a specified point of departure',
    ].map((label, index) => sense(`long-${index}`, `${label}. `
      + 'The meaning depends on what follows the verb and whether the sentence reports a deliberate action, describes a routine, or sets a starting point. '.repeat(3),
    index < 3, ['Compare the object in each example before choosing a meaning. '.repeat(24)])),
  },
  扮演: {
    pinyin: 'bànyǎn', state: 'preparing', text: '扮演 means to play a character or take on a role.',
    senses: [sense('play', 'to play a character or fulfill a role')],
  },
} satisfies Record<string, {
  pinyin: string;
  state: Card['state'];
  text: string;
  senses: Sense[];
  target?: string;
  proposedSense?: Card['proposedSense'];
}>;
type ExampleWord = keyof typeof examples;
const params = new URLSearchParams(location.search);
const cards = new Map<string, Card>();
const turns = new Map<string, VocabularyIntakeTurn>();
const sharedSenses = new Map<string, Sense[]>();
const commandResults = new Map<string, Card>();
const stash = new Set<string>(['sample-stash']);
const studyingDistil = params.has('existingSense');
let nextSave: 'failed' | 'stale' | 'lost-ack' | null = null;
let loseTurnReply = false;
let failNextTurn = false;
const failedTurnIds = new Set<string>();
let commandWrites = 0;

function newCard(word: ExampleWord, id: string): Card {
  const entry: (typeof examples)[ExampleWord] & { target?: string; proposedSense?: Card['proposedSense'] } = examples[word];
  const senses = sharedSenses.get(word) ?? entry.senses;
  const state = word === '蒸馏' && studyingDistil && !senses.some(s => s.senseId === 'model') ? 'sense-proposed'
    : word === '蒸馏' && studyingDistil ? 'already-studying' : entry.state !== 'already-studying' && stash.has(word) ? 'added' : entry.state;
  const proposedSense = senses.some(item => item.senseId === 'model') ? null : entry.proposedSense ?? null;
  const selection = {
    senseIds: senses.filter(item => item.isDefault || entry.target === item.senseId).map(item => item.senseId),
    includeProposedSense: Boolean(proposedSense),
    targetSenseId: entry.target ?? null,
  };
  const actions: Card['actions'] = state === 'sense-proposed' ? ['add_sense'] : state === 'proposed' ? ['add']
    : state === 'already-studying' ? ['change_senses']
      : senses.length ? ['undo', 'change_senses'] : ['undo'];
  if (state !== 'proposed' && state !== 'sense-proposed' && state !== 'already-studying') stash.add(word);
  return {
    id, version: 1, wordId: word, hanzi: word, pinyin: entry.pinyin, state, senses, selection,
    defaultsEstablished: senses.length > 0, proposedSense,
    versions: { learner: state === 'proposed' ? null : 1, catalog: 1, selection: 1 },
    actions,
    presets: state === 'sense-proposed' ? [] : word === '帮派' ? [{
      label: 'Only the gang sense', selection: { ...selection, senseIds: ['gang'] },
    }] : word === '蒸馏' && proposedSense ? [{
      label: 'Only the AI sense', selection: { ...selection, senseIds: [] },
    }] : [],
    attention: null,
  };
}

if (params.has('failure')) {
  const card = newCard('扮演', 'earlier-failure');
  card.attention = 'The lesson couldn’t be prepared. Review the selected senses or undo the addition.';
  cards.set(card.id, card);
  turns.set('earlier-failure', { id: 'earlier-failure', userText: '扮演', assistantText: examples.扮演.text, status: 'complete', cardIds: [card.id] });
}
if (params.has('history')) {
  for (let i = 1; i <= 24; i++) {
    turns.set(`past-${i}`, {
      id: `past-${i}`, userText: `Earlier word ${i}`, assistantText: 'An earlier conversation about a Mandarin expression.',
      status: 'complete', cardIds: [],
    });
  }
}

function setCard(card: Card, patch: Partial<Card>) {
  const next = { ...card, ...patch, version: card.version + 1 };
  cards.set(next.id, next);
  return next;
}

function updateCard(card: Card, request: VocabularyIntakeCommandRequest): Card {
  const command = request.command;
  ++commandWrites;
  if (command.type === 'undo') {
    stash.delete(card.wordId);
    return setCard(card, {
      state: 'proposed', actions: ['add'], attention: null, versions: { ...card.versions, learner: null },
    });
  }
  if (command.type === 'add_sense') {
    if (!card.proposedSense) throw Error('Missing proposed sense');
    const senses = [...card.senses, sense('model',card.proposedSense.label,false,card.proposedSense.notes)];
    sharedSenses.set(card.wordId,senses);
    return setCard(card,{senses,proposedSense:null,addedSenseId:'model',state:'already-studying',actions:['change_senses'],presets:[],
      selection:{senseIds:[...card.selection.senseIds,'model'],targetSenseId:null,includeProposedSense:false},
      versions:{...card.versions,learner:(card.versions.learner??0)+1,catalog:card.versions.catalog+1}});
  }
  if (command.type === 'add') stash.add(card.wordId);
  const createSense = command.selection.includeProposedSense && card.proposedSense;
  const senses = createSense
    ? [...card.senses, sense('model', createSense.label, false, createSense.notes)]
    : card.senses;
  if (createSense) sharedSenses.set(card.wordId, senses);
  const selection = createSense ? {
    senseIds: [...command.selection.senseIds, 'model'],
    targetSenseId: 'model',
    includeProposedSense: false,
  } : command.selection;
  return setCard(card, {
    senses, selection, proposedSense: createSense ? null : card.proposedSense,
    state: card.state === 'already-studying' ? card.state : command.type === 'add' ? 'preparing' : 'ready',
    actions: card.state === 'already-studying' ? ['change_senses'] : ['undo', 'change_senses'],
    attention: null,
    versions: { ...card.versions, learner: (card.versions.learner ?? 0) + 1 },
    presets: createSense ? [] : card.presets,
  });
}

function finishPreparation() {
  for (const card of cards.values()) {
    if (card.state !== 'preparing') continue;
    if (card.wordId === '绵长' && !card.senses.length) {
      const senses = [
        sense('lasting', 'lasting for a long time', true),
        sense('lingering', 'continuous and lingering, often of emotion, sound, or flavor', false),
      ];
      setCard(card, {
        senses, defaultsEstablished: true, actions: ['change_senses', 'undo'],
        selection: { ...card.selection, senseIds: ['lasting'] },
        attention: 'Two senses fit the saved sentence. Choose the sense you want to study.',
      });
    } else if (!card.attention) {
      setCard(card, { state: 'ready' });
    }
  }
  document.dispatchEvent(new Event('visibilitychange'));
}

function wordOf(id: string): Word {
  const entry = examples[id as ExampleWord];
  const hanzi = entry ? id : '散步';
  const meaning = stashChoices.get(id)?.meaning ?? entry?.senses[0]?.label ?? (entry ? 'long and unbroken' : 'take a walk');
  return {
    id, hanzi, pinyin: entry?.pinyin ?? 'sànbù', status: 'unstudied', meaning, meanings: [meaning],
    ...stashChoices.get(id), examples: [], traditional: null, personalNotes: '', priority: 0, createdAt: '2026-11-15T15:00:00.000Z',
    learningStreak: 0, lastLearningSuccessOn: null, lastLearningCoveredOn: null,
  };
}

function stashRow(id: string): PriorityWord {
  return { word: wordOf(id), bumpCount: 0, forceTop: false, requiredForNextSession: false, overlayUpdatedAt: '2026-11-15T15:00:00.000Z' };
}

function wordCollection(view: string | null): VocabularyCollectionWord[] {
  const ids = view === 'recent' ? ['宠溺'] : [...stash];
  return ids.map(id => {
    const card = [...cards.values()].reverse().find(item => item.wordId === id);
    const preparationStatus = card?.attention ? 'needs-attention'
      : card?.state === 'ready' ? 'ready' : card?.state === 'preparing' ? 'preparing' : undefined;
    return {
      word: { ...wordOf(id), status: id === '宠溺' ? 'practice' : 'unstudied' },
      lastStudiedAt: id === '宠溺' ? '2026-11-13T15:00:00.000Z' : null,
      personalUpdatedAt: null, stateVersion: 1, nextEligibleAt: null, refreshUntil: null, preparationStatus,
    };
  });
}

function answerTurn(clientTurnId: string, text: string, signal?: AbortSignal | null) {
  if (failNextTurn || failedTurnIds.has(clientTurnId)) {
    failNextTurn = false;
    failedTurnIds.add(clientTurnId);
    return new Response(`data: ${JSON.stringify({type:'progress',stage:'checking'})}\n\ndata: ${JSON.stringify({type:'error',message:'This message could not be completed. Try again.',retryWithNewId:true})}\n\n`,{headers:{'Content-Type':'text/event-stream'}});
  }
  const previous = turns.get(clientTurnId);
  const input = text.includes('接发') ? '接发球' : Object.keys(examples).find(word => text.includes(word)) as ExampleWord | undefined;
  const latest = [...cards.values()].at(-1);
  let card = !previous && input ? newCard(input, `card-${clientTurnId}`) : null;
  let reply = input ? examples[input].text : 'Which word or expression would you like to study?';
  if (!previous && latest && /^only the second/i.test(text) && latest.senses[1]) {
    card = setCard(latest, { selection: { senseIds: [latest.senses[1].senseId], targetSenseId: null, includeProposedSense: false },
      actions: latest.state === 'proposed' ? ['add'] : ['change_senses'] });
    reply = 'I’ll keep only the second sense.';
  } else if (!previous && latest && /^only the ai/i.test(text) && latest.proposedSense) {
    card = setCard(latest, { selection: { senseIds: [], targetSenseId: null, includeProposedSense: true } });
    reply = 'Only the AI meaning is selected. The proposal still awaits Add.';
  } else if (!previous && latest && /^undo that add/i.test(text) && latest.actions.includes('undo')) {
    card = updateCard(latest, { clientActionId: clientTurnId, expectedVersion: latest.version, versions: latest.versions, command: { type: 'undo' } });
    reply = 'I’ll undo that add.';
  } else if (!previous && latest && /^why/i.test(text)) {
    card = null;
    reply = 'The other meaning is an independent use of this word. You can choose which senses to study.';
  } else if (!previous && /mastered/i.test(text)) {
    card = null;
    reply = 'This chat cannot change mastery or the study schedule.';
  }
  if (card) cards.set(card.id, card);
  const turn = previous ?? {
    id: clientTurnId, userText: text, assistantText: reply, status: 'complete',
    cardIds: card ? [card.id] : [],
  } satisfies VocabularyIntakeTurn;
  turns.set(clientTurnId, turn);
  const events: VocabularyIntakeStreamEvent[] = [
    { type: 'progress', stage: 'checking' },
    { type: 'progress', stage: 'looking_up' },
    { type: 'progress', stage: 'preparing_reply' },
    { type: 'completion', assistantText: turn.assistantText, cards: turn.cardIds.map(id => cards.get(id)!) },
  ];
  if (!loseTurnReply) events.push({ type: 'done', turnId: turn.id });
  loseTurnReply = false;
  let cancelled = false;
  return new Response(new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      for (const event of events) {
        await new Promise(resolve => setTimeout(resolve, new URLSearchParams(location.search).has('slowChat') ? 650 : 90));
        if (cancelled || signal?.aborted) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.close();
    },
    cancel() { cancelled = true; },
  }), { headers: { 'Content-Type': 'text/event-stream' } });
}

function outstanding() {
  return [...cards.values()].filter(card => card.state === 'proposed' || card.state === 'sense-proposed' || card.attention);
}

window.fetch = async (input, init) => {
  const url = new URL(String(input), location.origin);
  const { pathname: path, searchParams } = url;
  const intake = '/api/vocabulary/intake';
  if (path === intake) {
    const all = [...turns.values()];
    const end = searchParams.has('before') ? Number(searchParams.get('before')) : all.length;
    const start = Math.max(0, end - 12);
    const page = all.slice(start, end);
    const result: VocabularyIntakeHistory = {
      conversationId: 'preview', turns: page,
      cards: page.flatMap(turn => turn.cardIds.map(id => cards.get(id)!)),
      before: start === 0 ? null : String(start),
    };
    return Response.json(result);
  }
  if (path === `${intake}/attention`) return Response.json({ count: outstanding().length });
  if (path === `${intake}/cards`) return Response.json({ cards: outstanding() });
  if (path === `${intake}/turns` && typeof init?.body === 'string') {
    const { clientTurnId, text } = JSON.parse(init.body) as { clientTurnId: string; text: string };
    return answerTurn(clientTurnId, text, init.signal);
  }
  if (path.startsWith(`${intake}/cards/`)) {
    const id = decodeURIComponent(path.slice(`${intake}/cards/`.length).split('/')[0]!);
    const card = cards.get(id);
    if (!card) return Response.json({ error: 'Card unavailable' }, { status: 404 });
    if (init?.method !== 'POST' || typeof init.body !== 'string') return Response.json(card);
    const request: VocabularyIntakeCommandRequest = JSON.parse(init.body);
    const previous = commandResults.get(request.clientActionId);
    if (previous) return Response.json(previous);
    const outcome = nextSave;
    nextSave = null;
    if (outcome === 'stale') {
      setCard(card, request.command.type === 'undo' ? { state: 'already-studying', actions: ['change_senses'] } : {});
      return Response.json({ error: 'This card changed' }, { status: 409 });
    }
    if (request.expectedVersion !== card.version) return Response.json({ error: 'This card changed' }, { status: 409 });
    if (outcome === 'failed') return Response.json({ error: 'Save unavailable' }, { status: 502 });
    const updated = updateCard(card, request);
    commandResults.set(request.clientActionId, updated);
    return outcome === 'lost-ack' ? Response.json({ error: 'Save acknowledgement lost' }, { status: 502 }) : Response.json(updated);
  }
  if (path === '/api/priority/unstudied') return Response.json({ words: [...stash].map(stashRow) });
  if (path === '/api/priority/unstudied/add-by-hanzi' && typeof init?.body === 'string') {
    const { hanzi, wordIds } = JSON.parse(init.body) as { hanzi: string; wordIds?: string[] };
    if (hanzi === '行' && !wordIds) {
      return Response.json({ needsSelection: true, query: hanzi, matches: [...stashChoices.keys()].map(wordOf) });
    }
    const added = wordIds ?? (hanzi in examples ? [hanzi] : []);
    for (const id of added) stash.add(id);
    return Response.json({ needsSelection: false, query: hanzi, words: added.map(stashRow), addedCount: added.length });
  }
  if (path === '/api/vocabulary/word-collection') {
    const words = wordCollection(searchParams.get('view'));
    return Response.json({ words, total: words.length, hasMore: false, currentDeck: null });
  }
  if (path === '/api/status') return Response.json({ dailyNewWordLimit: 10, unstudiedAdmissionSource: 'stash_then_deck' });
  if (path.endsWith('/completion/current') || path.endsWith('/session-debriefs/latest')) return Response.json(null);
  if (path.endsWith('/feedback/attention')) return Response.json({ unseenCount: 0, hasFailure: false, generating: false });
  if (path.endsWith('/attention-badges')) return Response.json({ reflectionUnseenCount: 0, failedReflectionRunIds: [] });
  if (path.endsWith('/whats-new-attention')) return Response.json({ serverNow: new Date().toISOString(), items: [], unseenPostIds: [] });
  if (path.endsWith('/whats-new')) return Response.json({ posts: [] });
  if (path.endsWith('/content-reactions')) return Response.json({ reactions: [] });
  return Response.json({ error: 'Unavailable in intake preview' }, { status: 404 });
};

function Preview() {
  const [controlStatus, setControlStatus] = useState('');
  return (
    <div className={`intake-preview${params.has('narrow') ? ' intake-preview-narrow' : ''}`}>
      {!params.has('clean') && <aside className="intake-preview-controls" aria-label="Preview controls">
        <button type="button" onClick={() => { finishPreparation(); setControlStatus('Preparation responded'); }}>Finish preparation</button>
        <button type="button" onClick={() => { nextSave = 'failed'; setControlStatus('Next save will fail'); }}>Fail next save</button>
        <button type="button" onClick={() => { nextSave = 'stale'; setControlStatus('Next save will be stale'); }}>Make next save stale</button>
        <button type="button" onClick={() => { nextSave = 'lost-ack'; setControlStatus('Next save reply will be lost'); }}>Lose next save reply</button>
        <button type="button" onClick={() => { failNextTurn = true; setControlStatus('Next message will fail'); }}>Fail next message</button>
        <button type="button" onClick={() => { loseTurnReply = true; setControlStatus('Next chat reply will be interrupted'); }}>Interrupt next reply</button>
        <output aria-live="polite">{controlStatus}</output>
        <button type="button" onClick={() => setControlStatus(`${commandWrites} applied card commands`)}>Count applied saves</button>
      </aside>}
      <App />
    </div>
  );
}

if (params.has('largeText')) document.documentElement.style.fontSize = '125%';
createRoot(document.getElementById('root')!).render(<Preview />);
