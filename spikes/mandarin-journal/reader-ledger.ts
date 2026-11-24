import { randomUUID } from 'node:crypto';
import { existsSync, linkSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { LookupInput, LookupAnswer } from './reader-dictionary.ts';

export const feedbackRequest = z.strictObject({ id: z.string().uuid() });

export type Decision = {
  trigger?: 'gesture' | 'check_in_context';
  previousDecisionId?: string;
  revision?: { spanChanged: boolean; readingChanged: boolean; glossChanged: boolean };
  documentId: string; blockId: string; endBlockId: string; sourceEnd: number; input: LookupInput; startedAt: string;
  result: { route: string; start: number; end: number; answer: LookupAnswer | null; evidence: object };
};

export type ReaderDecisionRow = Decision & {
  version: 1; id: string; completedAt: string;
  feedback: { type: 'marked_wrong'; at: string } | null;
};

export function compareAnswers(previous: Decision['result'], current: Decision['result']) {
  if (!previous.answer || !current.answer) throw new Error('Comparison requires two lookup answers');
  return {
    spanChanged: previous.start !== current.start || previous.end !== current.end,
    readingChanged: previous.answer.pinyin !== current.answer.pinyin,
    glossChanged: previous.answer.gloss !== current.answer.gloss,
  };
}

// Publish a complete immutable record. An exclusive link also makes simultaneous
// feedback submissions and retries preserve the first feedback timestamp.
function publish(directory: string, name: string, value: unknown) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temp = join(directory, '.' + randomUUID() + '.tmp');
  writeFileSync(temp, JSON.stringify(value) + '\n', { flag:'wx', mode:0o600, flush:true });
  try {
    linkSync(temp, join(directory, name));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  } finally { unlinkSync(temp); }
}

export function readerLedger(databasePath: string) {
  const directory = databasePath + '.lookups';
  function get(id: string): ReaderDecisionRow | null {
    feedbackRequest.parse({ id });
    const path = join(directory, id + '.json');
    if (!existsSync(path)) return null;
    const decision = JSON.parse(readFileSync(path, 'utf8'));
    const flag = join(directory, id + '.wrong.json');
    return { ...decision, feedback: existsSync(flag) ? JSON.parse(readFileSync(flag, 'utf8')) : null };
  }
  return {
    directory, get,
    record(decision: Decision) {
      const id = randomUUID();
      if (!publish(directory, id + '.json', { version:1, id, completedAt:new Date().toISOString(), ...decision })) {
        throw new Error('Duplicate reader decision ID');
      }
      return id;
    },
    flag(id: string) {
      feedbackRequest.parse({id});
      if (!existsSync(join(directory, id + '.json'))) return false;
      publish(directory, id + '.wrong.json', { type:'marked_wrong', at:new Date().toISOString() });
      return true;
    },
    *rows() {
      if (!existsSync(directory)) return;
      const files = readdirSync(directory);
      for (const name of files) {
        if (!/^[\da-f-]{36}\.json$/.test(name)) continue;
        const row = get(name.slice(0, -5));
        if (row) yield row;
      }
    },
  };
}
