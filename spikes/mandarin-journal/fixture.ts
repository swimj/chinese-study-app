// The default journal for development: a short, realistic week replayed through
// the offline tutor, so the fixture always matches the current journal shape.
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { openJournal } from './journal.ts';
import { demoFriend, demoTutor } from './practice.ts';
import type { TurnContext } from './tutor.ts';

const offline = {
  mode: 'demo' as const,
  tutor: async (ctx: TurnContext) => demoTutor(ctx),
  friend: async (ctx: TurnContext) => demoFriend(ctx),
};

type Journal = ReturnType<typeof openJournal>;
type State = Awaited<ReturnType<Journal['act']>>;

async function settleWords(j: Journal) {
  for (let i = 0; i < 100; i++) {
    if (!j.get().wordIntakes.some((w: { status: string }) => w.status === 'pending')) return;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error('Fixture words did not finish preparing.');
}

export async function buildFixture(path: string) {
  if (existsSync(path)) rmSync(path);
  mkdirSync(dirname(path), { recursive: true });
  const j = openJournal(path, offline);
  const act = (a: Record<string, unknown>) => j.act({ id: randomUUID(), ...a } as Parameters<Journal['act']>[0]);
  try {
    for (const message of ['我最近在阳台上放了一些鸟食。', '每天早上我都等着鸟来喂，但是它们很小心。', '我只在早上等，因为下午太热了。', '昨天来了两只麻雀，我很开心！'])
      await act({ type: 'chat', message, source: '', threadId: 'first' });
    await act({ type: 'reflect', source: '', threadId: 'first' });
    await act({ type: 'tutor', message: 'Can you queue some practice for 只 and 只是 for later?', surface: 'home', source: '' });

    let s: State = await act({ type: 'newThread', title: '在图书馆' });
    const library = s.threads.find((t: { title: string }) => t.title === '在图书馆')!.id;
    for (const message of ['今天我去图书馆学习，可是我老是 get distracted。', '我看着看着手机就过了一个小时。', '我想去外面透透气。'])
      await act({ type: 'chat', message, source: '', threadId: library });
    await act({ type: 'reflect', source: '', threadId: library });

    for (const [text, context] of [['透透气', '图书馆太闷了'], ['报备', '朋友说出去玩要跟男朋友报备'], ['分心', '']]) {
      await act({ type: 'addWord', text, ...(context ? { context } : {}) });
      await settleWords(j);
    }

    s = j.get();
    const doc = s.reading.documents[0];
    const first = doc.paragraphs[0];
    await act({ type: 'readingPosition', documentId: doc.id, paragraphId: doc.paragraphs[1].id });
    for (const [quote, message, askTutor] of [['青绿色的铁皮被雨冲得发白', '冲得发白 — washed pale by rain. 得 + result, nice image', false], ['我总觉得亭子在等什么人', 'Why 什么人 and not 谁 here?', true]] as const) {
      const start = first.text.indexOf(quote);
      const anchor = { surface: 'read', ownerId: doc.id, startId: first.id, endId: first.id, startOffset: start, endOffset: start + quote.length, quote };
      await act({ type: 'annotationPost', anchor, message, askTutor });
    }
    await act({ type: 'practice', mode: 'Daily mix' });
    return j.get();
  } finally {
    j.close();
  }
}
