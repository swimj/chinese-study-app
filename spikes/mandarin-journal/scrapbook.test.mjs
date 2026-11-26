import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScrapbook, wallOffers } from './public/scrapbook.js';
import { isReadingFinished } from './public/reading.js';

const readingLabel = (state, id) => state.reading.documents.find((d) => d.id === id)?.title || id;
const kiosk = { id: 'kiosk', title: '河边的报刊亭', paragraphs: [{ id: 'p1', text: '每次路过，我总觉得亭子在等什么人。' }, { id: 'p2', text: '窗台上搁着半杯茶。' }, { id: 'p3', text: '窗子还开着。' }] };
const encore = { id: 'encore', title: '散场以后', paragraphs: [{ id: 'e1', text: '演唱会散场了。' }] };

function journal(overrides = {}) {
  return {
    threads: [{ id: 'birds', title: 'Birdwatching' }, { id: 'library', title: '在图书馆' }],
    activeThreadId: 'library',
    chat: [{ id: 'm1', role: 'user', text: '我想去外面透透气。' }],
    reflections: [{
      id: 'r1', threadId: 'birds', overview: 'You talked about watching birds.', end: 4,
      takeaways: [{ annotationId: 'r1-takeaway-0', messageId: 'b1', quote: '等着鸟来喂', text: 'Try 等着鸟来吃鸟食.' }],
    }],
    annotationThreads: [
      { id: 'r1-takeaway-0', anchor: { surface: 'chat', ownerId: 'birds', quote: '等着鸟来喂' }, messages: [{ role: 'assistant', text: 'Try 等着鸟来吃鸟食.' }] },
      { id: 'n1', anchor: { surface: 'read', ownerId: 'kiosk', quote: '等什么人' }, messages: [{ role: 'user', text: 'Why 什么人?' }, { role: 'assistant', text: 'It stays open.' }] },
    ],
    reading: { documentId: 'kiosk', positions: { kiosk: 'p2' }, documents: [kiosk, encore] },
    saved: [
      { id: 'w1', kind: 'Word', title: '透透气', source: '图书馆太闷了', word: { pinyin: 'tòu tou qì', meaning: 'Get some air.' } },
      { id: 'w2', kind: 'Word', title: '报备', source: '', word: { pinyin: 'bàobèi', meaning: 'Notify.' } },
      { id: 'w3', kind: 'Word', title: '等', source: '', word: { pinyin: 'děng', meaning: 'Wait.' } },
    ],
    tutor: [],
    activity: [],
    practice: { mode: 'Daily mix', card: null, result: null, done: true },
    ...overrides,
  };
}
const byKey = (clusters) => Object.fromEntries(clusters.map((c) => [c.key, c]));

test('board edits hide groups and pieces in place while keeping their sources available', () => {
  const state = journal({ board: {
    archivedGroups: ['read:kiosk'], deletedGroups: ['chat:library'], deletedPieces: [{ kind: 'annotation', pieceId: 'r1-takeaway-0' }],
  } });
  const visible = byKey(buildScrapbook(state, { readingLabel }));
  assert.deepEqual(Object.keys(visible).sort(), ['chat:birds', 'loose', 'read:encore']);
  assert.deepEqual(visible['chat:birds'].scraps.map(s => [s.title, s.also]), [['等', []]]);
  assert.deepEqual(visible.loose.scraps.map(s => s.title), ['报备']);
  assert.equal(state.saved.length, 3);
  assert.equal(state.reflections[0].takeaways.length, 1);
  assert.equal(wallOffers(state, Object.values(visible)).reading, undefined);
  state.board.archivedGroups = [];
  const restored = byKey(buildScrapbook(state, { readingLabel }))['read:kiosk'];
  assert.equal(restored.scraps[0].id, 'n1');
  assert.equal(restored.progress.at, 2);
});

test('material clusters by what it is about, takeaways once, words where they appeared', () => {
  const clusters = buildScrapbook(journal(), { readingLabel });
  const c = byKey(clusters);
  assert.deepEqual(c['chat:birds'].scraps.map((s) => s.kind), ['takeaway', 'word']);
  assert.equal(c['chat:birds'].overview, 'You talked about watching birds.');
  assert.equal(c['chat:birds'].scraps[0].href, '#chat/reflection/r1');
  assert.equal(c['read:encore'].title, '散场以后', 'unopened stories stay reachable from the table');
  const note = c['read:kiosk'].scraps.find((s) => s.kind === 'note');
  assert.deepEqual([note.quote, note.voice, note.replies], ['等什么人', 'yours', 1]);
  assert.deepEqual(c['read:kiosk'].progress, { at: 2, of: 3 });
  assert.equal(c['chat:library'].scraps.find((s) => s.title === '透透气')?.context, '图书馆太闷了');
  assert.deepEqual(c.loose.scraps.map((s) => s.title), ['报备']);
  // 等 shows up in a conversation takeaway and in the reading: one home, one link.
  const deng = clusters.flatMap((x) => x.scraps).filter((s) => s.title === '等');
  assert.equal(deng.length, 1);
  assert.equal(deng[0].also.length, 1);
  assert.equal(clusters.at(-1).key, 'loose', 'loose ends sort last');
  assert.equal(clusters[0].key, 'chat:library', 'the open conversation sorts first');
});

test('a fresh journal still offers its readings and nothing else', () => {
  const clusters = buildScrapbook(journal({
    threads: [{ id: 'first', title: 'Conversation' }], activeThreadId: 'first', chat: [],
    reflections: [], annotationThreads: [], saved: [], reading: { documentId: 'kiosk', positions: {}, documents: [kiosk, encore] },
  }), { readingLabel });
  assert.deepEqual(clusters.map((c) => c.key), ['read:kiosk', 'read:encore']);
  assert.ok(clusters.every((c) => !c.scraps.length));
});

test('an unreflected conversation restored while another thread is open has a board entry', () => {
  const state = journal();
  state.threads.push({ id: 'other', title: 'Another topic', hasTurns: true });
  state.board = { archivedGroups: ['chat:other'] };
  assert.equal(byKey(buildScrapbook(state, { readingLabel }))['chat:other'], undefined);
  state.board.archivedGroups = [];
  assert.deepEqual(byKey(buildScrapbook(state, { readingLabel }))['chat:other'].scraps, []);
});

function offers(state) {
  return wallOffers(state, buildScrapbook(state, { readingLabel }));
}

test('wall offers point to the current session, exact paragraph, conversation and visible piece', () => {
  const state = journal({
    practice: { card: { id: 'c1' }, done: false, session: { spentMinutes: 2, budgetMinutes: 10 } },
    activity: [{ text: 'Queued practice · An older exercise' }],
  });
  const wall = offers(state);
  assert.equal(wall.practice, 'Resume practice');
  assert.equal(wall.practiceTime, '≈ 8 min');
  assert.equal(wall.reading.href, '#read/source/kiosk%2Fp2');
  assert.equal(wall.reading.excerpt, kiosk.paragraphs[1].text);
  assert.equal(wall.reading.bookmark, '← left off at ¶ 2 of 3');
  assert.equal(wall.conversation.id, 'library');
  assert.equal(wall.piece.href, '#scrapbook/piece/annotation%3An1');
  state.saved.at(-1).savedAt = '2026-11-25T01:23:00Z';
  assert.equal(offers(state).piece.href, '#scrapbook/piece/saved%3Aw3');
  state.practice.result = { feedback: 'Try again' };
  assert.equal(offers(state).practice, 'Continue after feedback');
});

test('only a saved last paragraph finishes a reading, including a one-paragraph piece', () => {
  assert.equal(isReadingFinished(kiosk, 'p3'), true);
  assert.equal(isReadingFinished(kiosk, 'p2'), false);
  assert.equal(isReadingFinished(kiosk, 'missing'), false);
  assert.equal(isReadingFinished(encore, undefined), false);
  assert.equal(isReadingFinished(encore, 'e1'), true);
});

test('the wall passes over a recently finished reading and follows an earlier bookmark on reread', () => {
  const state = journal();
  state.reading.documentId = 'encore';
  state.reading.positions.encore = 'e1';
  assert.equal(offers(state).reading.title, kiosk.title);

  state.reading.positions.kiosk = 'p3';
  const finished = byKey(buildScrapbook(state, { readingLabel }))['read:kiosk'];
  assert.equal(finished.finished, true);
  assert.equal(finished.progress, undefined);
  assert.equal(offers(state).reading, undefined);

  state.reading.positions.kiosk = 'p1';
  const reread = byKey(buildScrapbook(state, { readingLabel }))['read:kiosk'];
  assert.ok(!reread.finished);
  assert.deepEqual(reread.progress, { at: 1, of: 3 });
  assert.equal(offers(state).reading.href, '#read/source/kiosk%2Fp1');
});

test('wall skips hidden pieces and invalid bookmarks and can open on a fresh journal', () => {
  const state = journal({ board: { archivedGroups: ['chat:library', 'chat:birds'], deletedPieces: [{ kind: 'annotation', pieceId: 'n1' }] } });
  state.reading.positions.kiosk = 'missing';
  const wall = offers(state);
  assert.equal(wall.reading, undefined);
  assert.equal(wall.conversation, undefined);
  assert.equal(wall.piece.href, '#scrapbook/piece/saved%3Aw2');
  const fresh = offers(journal({ threads: [], chat: [], reflections: [], annotationThreads: [], saved: [],
    practice: { card: null, done: false }, reading: { positions: {}, documents: [] } }));
  assert.equal(fresh.practice, 'Start a session');
  assert.equal(fresh.reading, undefined);
  assert.equal(fresh.conversation, undefined);
  assert.ok(!fresh.piece);
  assert.equal(fresh.pieceCount, 0);
});

test('placed pictures become clippings beside their piece; latent ones wait on it, in table and list alike', () => {
  const picture = (id, anchorId, ceiling) => ({
    id, kind: 'image', origin: 'system', caption: id, anchor: { kind: 'annotation', id: anchorId }, ceiling,
    source: { provider: 'wikidata-commons', pageUrl: 'https://commons.wikimedia.org/wiki/File:' + id, thumbUrl: 'https://upload.wikimedia.org/' + id },
    createdAt: '2026-11-01T00:00:00Z', reactions: {},
  });
  const state = journal({ media: [picture('kiosk-photo', 'n1', 'placed'), picture('word-photo', 'w2', 'latent'), picture('hidden', 'n1', 'latent')] });
  state.media[1].anchor = { kind: 'word', id: 'w2' };
  const levels = { 'kiosk-photo': { level: 'placed', reasons: [] }, 'word-photo': { level: 'latent', reasons: [] }, hidden: { level: 'none', reasons: ['setting'] } };
  const c = byKey(buildScrapbook(state, { readingLabel, media: levels }));
  const kiosk = c['read:kiosk'].scraps;
  const at = kiosk.findIndex((s) => s.id === 'n1');
  assert.equal(kiosk[at + 1].kind, 'media');
  assert.equal(kiosk[at + 1].item.id, 'kiosk-photo');
  assert.equal(kiosk[at].latent, undefined, 'a hidden item leaves no cue');
  assert.deepEqual(c.loose.scraps.find((s) => s.id === 'w2').latent.map((m) => m.id), ['word-photo']);
  // Without a verdict, the board is text only, as composition sees it.
  assert.ok(!buildScrapbook(state, { readingLabel }).flatMap((x) => x.scraps).some((s) => s.kind === 'media' || s.latent));
});
