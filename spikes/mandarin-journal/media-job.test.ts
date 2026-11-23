import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { openJournal } from './journal.ts';
import type { Candidate } from './media/find-image.ts';
import type { Judgment } from './media/judgment.ts';
import { DAILY_LIMIT } from './media/job.ts';
import { demoFriend, demoTutor } from './practice.ts';
import { instructionsFor, validateTurn, voice } from './situations/index.ts';
import type { MediaRequest } from './situations/media.ts';
import type { TurnContext, TutorResult } from './tutor.ts';

const demo = {
  mode: 'demo' as const,
  tutor: async (ctx: TurnContext) => demoTutor(ctx),
  friend: async (ctx: TurnContext) => demoFriend(ctx),
};
type Journal = ReturnType<typeof openJournal>;
async function idle(j: Journal) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (!j.busy()) return j.get();
    await delay(5);
  }
  throw new Error('Background work did not finish');
}

const image: Candidate = {
  kind: 'image', entityId: 'Q1528905', label: '報攤', description: 'newsstand', title: 'File:Kiosk.jpg',
  pageUrl: 'https://commons.wikimedia.org/wiki/File:Kiosk.jpg', thumbUrl: 'https://upload.wikimedia.org/k.jpg',
  license: { code: 'CC-BY', url: 'https://creativecommons.org/licenses/by/4.0' }, credit: { author: 'A', text: 'A · CC BY 4.0 · Wikimedia Commons' },
};
const judgment: Judgment = {
  referent: 'concrete', senseMatch: 'entity', addedValue: 'cultural', truthfulness: 'real', tone: 'fits',
  reasons: { referent: 'r', senseMatch: 's', addedValue: 'a', truthfulness: 't', tone: 'o' },
};
function considering(candidates: Candidate[]): TurnContext {
  const media: MediaRequest = { anchor: { kind: 'annotation', id: 'n1' }, term: '报刊亭', candidates };
  return { trigger: 'mediaConsider', message: '报刊亭', surface: 'media', source: '', tutorHistory: [], chatHistory: [], saved: [], media };
}

test('mediaConsider accepts a licensed real photograph and turns its judgment into a ceiling', () => {
  const ctx = considering([image]);
  const outcome = validateTurn('mediaConsider', { media: { pick: 0, judgment } }, ctx);
  assert.equal(outcome.ceiling, 'placed');
  assert.equal(outcome.candidate, image);
  const nothing = validateTurn('mediaConsider', { media: { pick: null, judgment: { ...judgment, referent: 'abstract', senseMatch: 'none' } } }, ctx);
  assert.deepEqual([nothing.pick, nothing.ceiling, nothing.candidate], [null, 'none', undefined]);
});

test('mediaConsider rejects an unlisted license, an entity match without an item, an illustration, and other effects', () => {
  const nc = { ...image, license: { code: 'CC-BY-NC', url: 'https://x' } } as unknown as Candidate;
  assert.throws(() => validateTurn('mediaConsider', { media: { pick: 0, judgment } }, considering([nc])), /license allowlist/);
  const noEntity = { ...image, entityId: '' };
  assert.throws(() => validateTurn('mediaConsider', { media: { pick: 0, judgment } }, considering([noEntity])), /Wikidata item/);
  // The same candidate is fine when the model only claims a search match.
  assert.equal(validateTurn('mediaConsider', { media: { pick: 0, judgment: { ...judgment, senseMatch: 'search' } } }, considering([noEntity])).ceiling, 'latent');
  assert.throws(() => validateTurn('mediaConsider', { media: { pick: 0, judgment: { ...judgment, truthfulness: 'illustration' } } }, considering([image])), /real photographs/);
  assert.throws(() => validateTurn('mediaConsider', { media: { pick: 2, judgment } }, considering([image])), /not offered/);
  assert.throws(() => validateTurn('mediaConsider', { media: { pick: 0, judgment: { ...judgment, tone: 'loud' } } } as unknown as TutorResult, considering([image])));
  assert.throws(() => validateTurn('mediaConsider', { reply: 'Here is a picture!', media: { pick: 0, judgment } }, considering([image])), /cannot address the learner/);
  assert.throws(() => validateTurn('mediaConsider', { action: { kind: 'note', title: 'x', detail: 'y', exercise: null }, media: { pick: 0, judgment } }, considering([image])), /cannot change the journal/);
  // No other situation may return a media judgment.
  assert.throws(() => validateTurn('ask', { reply: 'Hi.', action: null, media: { pick: null, judgment } }, { ...considering([]), trigger: 'ask' }), /Only media consideration/);
});

test('the back office does not speak as the tutor', () => {
  assert.ok(!instructionsFor('mediaConsider').includes(voice));
  assert.match(instructionsFor('mediaConsider'), /never speak to the learner/);
  assert.ok(instructionsFor('ask').startsWith(voice));
});

test('a saved word queues one consideration, and the demo provider attaches a latent picture', async () => {
  const seen: TurnContext[] = [];
  const j = openJournal(':memory:', {
    ...demo,
    async tutor(ctx) {
      if (ctx.trigger === 'mediaConsider') seen.push(structuredClone({ ...ctx, media: { ...ctx.media! } }));
      return demoTutor(ctx);
    },
  });
  try {
    const first = await j.act({ type: 'addWord', id: randomUUID(), text: '鸟食', context: '我最近在阳台上放了一些鸟食。' });
    assert.equal(first.media.length, 0, 'nothing is attached in the learner’s request');
    const s = await idle(j);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].media!.term, '鸟食');
    assert.equal(seen[0].media!.context, '我最近在阳台上放了一些鸟食。');
    const word = s.saved.find((w) => w.title === '鸟食')!;
    assert.equal(s.media.length, 1);
    assert.deepEqual(
      [s.media[0].origin, s.media[0].ceiling, s.media[0].anchor, s.media[0].caption, s.media[0].license?.code, s.media[0].credit?.author],
      ['system', 'latent', { kind: 'word', id: word.id }, '鸟食', 'CC-BY-SA', 'Luc Viatour'],
    );
    // Saving the same word again reuses it and queues nothing new.
    await j.act({ type: 'addWord', id: randomUUID(), text: '鸟食', context: '我最近在阳台上放了一些鸟食。' });
    await idle(j);
    assert.equal(seen.length, 1);
  } finally {
    j.close();
  }
});

test('a reading note queues a consideration; abstract words are decided without attaching anything', async () => {
  const j = openJournal(':memory:', demo);
  try {
    const doc = j.get().reading.documents.find((d: { title: string }) => d.title === '河边的报刊亭')!;
    const p = doc.paragraphs[0];
    const quote = '旧报刊亭';
    const start = p.text.indexOf(quote);
    await j.act({
      type: 'annotationPost', id: randomUUID(), message: 'The green kiosks by the road', askTutor: false,
      anchor: { surface: 'read', ownerId: doc.id, startId: p.id, endId: p.id, startOffset: start, endOffset: start + quote.length, quote },
    });
    await j.act({ type: 'addWord', id: randomUUID(), text: '分心' });
    const s = await idle(j);
    assert.deepEqual(s.media.map((m) => [m.caption, m.ceiling, m.anchor.kind]), [['旧报刊亭', 'placed', 'annotation']]);
  } finally {
    j.close();
  }
});

test('considerations stop at the daily limit', async () => {
  let turns = 0;
  const backend = {
    ...demo,
    async tutor(ctx: TurnContext): Promise<TutorResult> {
      if (ctx.trigger !== 'mediaConsider') return demoTutor(ctx);
      turns++;
      return { media: { pick: null, judgment: { ...judgment, referent: 'abstract', senseMatch: 'none' } } };
    },
  };
  const j = openJournal(':memory:', backend);
  try {
    // A note with no tutor turn is the cheapest way to create anchor pieces.
    const doc = j.get().reading.documents[0];
    const p = doc.paragraphs[0];
    for (let i = 0; i < DAILY_LIMIT + 2; i++) {
      const quote = Array.from(p.text)[i];
      const start = p.text.indexOf(quote);
      await j.act({
        type: 'annotationPost', id: randomUUID(), message: 'note ' + i, askTutor: false,
        anchor: { surface: 'read', ownerId: doc.id, startId: p.id, endId: p.id, startOffset: start, endOffset: start + quote.length, quote },
      });
    }
    await idle(j);
    assert.equal(turns, DAILY_LIMIT);
    assert.equal(j.get().media.length, 0);
  } finally {
    j.close();
  }
});

test('reactions and the pictures setting persist, and pictures off skips considerations', async () => {
  let turns = 0;
  const j = openJournal(':memory:', {
    ...demo,
    async tutor(ctx) {
      if (ctx.trigger === 'mediaConsider') turns++;
      return demoTutor(ctx);
    },
  });
  try {
    await j.act({ type: 'addWord', id: randomUUID(), text: '鸟食' });
    const [item] = (await idle(j)).media;
    await j.act({ type: 'mediaReaction', id: randomUUID(), mediaId: item.id, reaction: 'keep' });
    await j.act({ type: 'mediaReaction', id: randomUUID(), mediaId: item.id, reaction: 'notForMe' });
    const reacted = j.get().media[0].reactions;
    assert.ok(reacted.kept && reacted.notForMe && reacted.notForMe >= reacted.kept);
    await assert.rejects(j.act({ type: 'mediaReaction', id: randomUUID(), mediaId: 'gone', reaction: 'keep' }), /no longer on the board/);
    await j.act({ type: 'settings', id: randomUUID(), pictures: 'off' });
    assert.deepEqual(j.get().settings, { pictures: 'off' });
    await j.act({ type: 'addWord', id: randomUUID(), text: '分心' });
    await idle(j);
    assert.equal(turns, 1, 'no model turn while pictures are off');
  } finally {
    j.close();
  }
});
