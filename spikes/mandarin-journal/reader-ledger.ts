import { randomUUID } from 'node:crypto';
import { existsSync, linkSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { LookupInput, LookupAnswer } from './reader-dictionary.ts';

export const feedbackRequest = z.strictObject({ id: z.string().uuid() });

type Decision = {
  documentId: string; blockId: string; endBlockId: string; sourceEnd: number; input: LookupInput; startedAt: string;
  result: { route: string; start: number; end: number; answer: LookupAnswer | null; evidence: object };
};

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
  return {
    directory,
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
        const decision = JSON.parse(readFileSync(join(directory, name), 'utf8')) as Decision & { version:1; id:string; completedAt:string };
        const flag = join(directory, name.slice(0,-5) + '.wrong.json');
        const feedback = existsSync(flag) ? JSON.parse(readFileSync(flag,'utf8')) as { type:'marked_wrong'; at:string } : null;
        yield { ...decision, feedback };
      }
    },
  };
}
