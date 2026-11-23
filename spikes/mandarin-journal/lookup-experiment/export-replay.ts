import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cases } from './cases.ts';
import type { LookupAnswer } from '../reader-dictionary.ts';

type Row = {
  id: string; arm: string; model?: string; elapsedMs: number;
  answer: LookupAnswer | null; reason?: string; error?: string;
  input: { text: string; kind: string; start: number; end: number };
};
const [directory, destination] = process.argv.slice(2);
if (!directory || !destination) throw new Error('Usage: export-replay.ts RUN_DIRECTORY RESULTS.js');
const arms = ['local', 'fast', 'strong'];
const trials = arms.map(arm => {
  const rows: Row[] = readFileSync(join(directory, arm + '.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  if (rows.length !== cases.length || new Set(rows.map(row => row.id)).size !== rows.length) {
    throw new Error('Incomplete or duplicate cases in ' + arm);
  }
  return new Map(rows.map(row => [row.id, row]));
});
const replay = cases.map(({ id, kind, text, start, end, intent, acceptableSpans }) => {
  const results = trials.map((rows, i) => {
    const row = rows.get(id);
    if (!row || row.arm !== arms[i] || row.input.text !== text || row.input.kind !== kind ||
        row.input.start !== start || row.input.end !== end) throw new Error('Fixture mismatch in ' + id);
    return {
      model: row.model ?? 'CC-CEDICT', ms: Math.round(row.elapsedMs), answer: row.answer,
      reason: row.reason, failed: row.error ? true : undefined,
    };
  });
  return { id, kind, text, start, end, intent, acceptableSpans, results };
});
// Classic external script lets the review open directly from disk, including offline.
writeFileSync(destination, 'const lookupTrials = ' + JSON.stringify(replay, null, 2) + ';\n');
