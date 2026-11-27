import test from 'node:test';
import assert from 'node:assert/strict';
import { compose, learnerChosen } from './public/media-policy.js';

const NOW = Date.parse('2026-11-20T12:00:00Z');
const HOUR = 3600_000, DAY = 24 * HOUR;
const ago = (ms) => new Date(NOW - ms).toISOString();
const kiosk = { id: 'kiosk', title: '河边的报刊亭', paragraphs: [{ id: 'p1', text: '每次路过，我总觉得亭子在等什么人。' }] };
const encore = { id: 'encore', title: '散场以后', paragraphs: [{ id: 'e1', text: '演唱会散场了。' }] };
const river = { id: 'river', title: '河边', paragraphs: [{ id: 'r1', text: '河边很安静。' }] };
const note = (id, ownerId) => ({ id, anchor: { surface: 'read', ownerId, quote: '亭子' }, messages: [{ role: 'user', text: 'note' }] });

// A board with two reading clusters (one note each) and `loose` English notes under Loose ends.
function board({ loose = 16, media = [], pictures = 'normal', extraNotes = [] } = {}) {
  return {
    threads: [{ id: 'first', title: 'Conversation' }],
    activeThreadId: 'first',
    chat: [],
    reflections: [],
    annotationThreads: [note('kn', 'kiosk'), note('en', 'encore'), ...extraNotes],
    reading: { positions: {}, documents: [kiosk, encore, river] },
    saved: Array.from({ length: loose }, (_, i) => ({ id: 'l' + i, kind: 'Note', title: 'note ' + i, detail: 'x', source: '' })),
    tutor: [],
    activity: [],
    media,
    settings: { pictures },
  };
}
function item(id, anchorId, { value = 'cultural', referent = 'concrete', ceiling = 'placed', age = 2 * DAY, reactions = {}, origin = 'system' } = {}) {
  return {
    id, kind: 'image', origin, caption: id,
    anchor: { kind: anchorId.startsWith('l') ? 'word' : 'annotation', id: anchorId },
    source: { provider: 'wikidata-commons', pageUrl: 'https://commons.wikimedia.org/wiki/File:' + id },
    judgment: origin === 'system' ? { referent, senseMatch: 'entity', addedValue: value, truthfulness: 'real', tone: 'fits', reasons: {} } : undefined,
    ceiling, createdAt: ago(age), reactions,
  };
}
const levels = (out) => Object.fromEntries(Object.entries(out).map(([id, r]) => [id, r.level]));

test('deleted pictures and pieces leave their placement budget available to visible pictures', () => {
  const state = board({ loose: 0, media: [item('first', 'kn'), item('second', 'en', { value: 'memory' })] });
  assert.equal(compose(state, NOW).second.level, 'latent');
  state.board = { deletedPieces: [{ kind: 'media', pieceId: 'first' }] };
  assert.deepEqual(compose(state, NOW).first, { level: 'none', reasons: ['deleted'] });
  assert.equal(compose(state, NOW).second.level, 'placed');
  state.board.deletedPieces = [{ kind: 'annotation', pieceId: 'kn' }];
  assert.deepEqual(compose(state, NOW).first, { level: 'none', reasons: ['no-anchor'] });
});

test('ceilings pass through when no rule applies; latent is never raised', () => {
  const out = compose(board({ media: [item('a', 'kn'), item('b', 'en', { ceiling: 'latent' })] }), NOW);
  assert.deepEqual(out, { a: { level: 'placed', reasons: [] }, b: { level: 'latent', reasons: [] } });
});

test('the pictures setting: off hides system media, quiet keeps it latent, learner media is untouched', () => {
  const media = [item('a', 'kn'), item('b', 'en', { ceiling: 'latent' }), item('mine', 'l0', { origin: 'learner', ceiling: 'placed' }), item('kept', 'l1', { reactions: { kept: ago(HOUR) } })];
  assert.deepEqual(compose(board({ media, pictures: 'off' }), NOW), {
    a: { level: 'none', reasons: ['setting'] },
    b: { level: 'none', reasons: ['setting'] },
    mine: { level: 'placed', reasons: [] },
    kept: { level: 'placed', reasons: [] },
  });
  assert.deepEqual(levels(compose(board({ media, pictures: 'quiet' }), NOW)), { a: 'latent', b: 'latent', mine: 'placed', kept: 'placed' });
  assert.deepEqual(compose(board({ media, pictures: 'quiet' }), NOW).a.reasons, ['setting']);
});

test('one system image per cluster keeps placed: higher added value first, then the newer anchor', () => {
  const extra = [note('kn2', 'kiosk'), note('kn3', 'kiosk')];
  const out = compose(board({ extraNotes: extra, media: [item('memory', 'kn', { value: 'memory' }), item('cultural', 'kn2', { value: 'cultural', age: 3 * DAY }), item('older', 'kn3', { value: 'cultural', age: 4 * DAY })] }), NOW);
  assert.deepEqual(levels(out), { memory: 'latent', cultural: 'placed', older: 'latent' });
  assert.deepEqual(out.older.reasons, ['cluster-cap']);
  const tie = compose(board({ extraNotes: extra, media: [item('old', 'kn', { age: 3 * DAY }), item('new', 'kn2', { age: 2 * DAY })] }), NOW);
  assert.deepEqual(levels(tie), { old: 'latent', new: 'placed' });
});

test('placed system images stay within one per six placed text pieces, rounded up', () => {
  // 2 reading notes + 4 loose notes = 6 text pieces → 1 image.
  const media = [item('a', 'kn', { value: 'interest' }), item('b', 'en', { value: 'cultural' }), item('c', 'l0', { value: 'recognition' })];
  const out = compose(board({ loose: 4, media }), NOW);
  assert.deepEqual(levels(out), { a: 'latent', b: 'placed', c: 'latent' });
  assert.deepEqual(out.a.reasons, ['mix-ratio']);
  // 7 pieces → 2 images.
  assert.deepEqual(levels(compose(board({ loose: 5, media }), NOW)), { a: 'placed', b: 'placed', c: 'latent' });
});

test('pacing allows two newly placed system images per rolling day; older placements stay', () => {
  const media = [item('n1', 'kn', { age: HOUR }), item('n2', 'en', { age: 2 * HOUR }), item('n3', 'l0', { age: 3 * HOUR }), item('old', 'rn', { age: 2 * DAY })];
  const extraNotes = [note('rn', 'river')];
  const out = compose(board({ loose: 30, media, extraNotes }), NOW);
  assert.deepEqual(levels(out), { n1: 'placed', n2: 'placed', n3: 'latent', old: 'placed' });
  assert.deepEqual(out.n3.reasons, ['pacing']);
  // A day later the third is no longer new and takes its place.
  assert.equal(compose(board({ loose: 30, media, extraNotes }), NOW + DAY).n3.level, 'placed');
});

test('two dismissals in one referent category within 14 days cap it at latent for 30 days', () => {
  const dismissed = (id, anchor, days) => item(id, anchor, { reactions: { notForMe: ago(days * DAY) } });
  const media = [dismissed('d1', 'l0', 10), dismissed('d2', 'l1', 1), item('concrete', 'kn'), item('named', 'en', { referent: 'named' })];
  const out = compose(board({ media }), NOW);
  assert.deepEqual(levels(out), { d1: 'none', d2: 'none', concrete: 'latent', named: 'placed' });
  assert.deepEqual(out.d1.reasons, ['not-for-me']);
  assert.deepEqual(out.concrete.reasons, ['taste']);
  // The cap runs 30 days from the second dismissal.
  assert.equal(compose(board({ media }), NOW + 28 * DAY).concrete.level, 'latent');
  assert.equal(compose(board({ media }), NOW + 30 * DAY).concrete.level, 'placed');
  // Dismissals further apart than 14 days do not form a pattern.
  const apart = [dismissed('d1', 'l0', 20), dismissed('d2', 'l1', 1), item('concrete', 'kn')];
  assert.equal(compose(board({ media: apart }), NOW).concrete.level, 'placed');
  // A dismissal the learner later reversed by keeping does not count.
  const reversed = [item('d1', 'l0', { reactions: { notForMe: ago(3 * DAY), kept: ago(2 * DAY) } }), dismissed('d2', 'l1', 1), item('concrete', 'kn')];
  assert.equal(compose(board({ media: reversed }), NOW).concrete.level, 'placed');
});

test('the latest reaction wins, and keeping is exempt from every cap', () => {
  const kept = item('k', 'kn', { ceiling: 'latent', reactions: { notForMe: ago(2 * HOUR), kept: ago(HOUR) } });
  const extra = [item('k2', 'kn', { reactions: { kept: ago(HOUR) } })];
  assert.ok(learnerChosen(kept));
  assert.deepEqual(levels(compose(board({ loose: 0, media: [kept, ...extra] }), NOW)), { k: 'placed', k2: 'placed' });
  const undone = item('u', 'kn', { reactions: { kept: ago(2 * HOUR), notForMe: ago(HOUR) } });
  assert.deepEqual(compose(board({ media: [undone] }), NOW).u, { level: 'none', reasons: ['not-for-me'] });
});

test('an item whose piece left the board is not shown', () => {
  assert.deepEqual(compose(board({ media: [item('gone', 'missing')] }), NOW).gone, { level: 'none', reasons: ['no-anchor'] });
});

test('composition only demotes and is independent of item order', () => {
  const values = ['cultural', 'interest', 'recognition', 'memory', 'none'];
  const anchors = ['kn', 'en', 'l0', 'l1', 'l2', 'l3'];
  const media = [];
  for (let i = 0; i < 24; i++) {
    media.push(item('m' + i, anchors[i % anchors.length], {
      value: values[i % values.length],
      referent: i % 3 ? 'concrete' : 'named',
      ceiling: i % 4 ? 'placed' : 'latent',
      age: (i % 5) * 7 * HOUR,
      origin: i % 11 === 0 ? 'learner' : 'system',
      reactions: i % 7 === 3 ? { notForMe: ago(i * HOUR) } : i % 9 === 2 ? { kept: ago(HOUR) } : {},
    }));
  }
  const rank = { none: 0, latent: 1, placed: 2 };
  for (const pictures of ['normal', 'quiet', 'off']) {
    const out = compose(board({ loose: 9, media, pictures }), NOW);
    for (const m of media) {
      if (learnerChosen(m)) assert.equal(out[m.id].level, 'placed');
      else assert.ok(rank[out[m.id].level] <= rank[m.ceiling], m.id + ' was raised');
    }
    assert.deepEqual(compose(board({ loose: 9, media: media.toReversed(), pictures }), NOW), out);
  }
});
