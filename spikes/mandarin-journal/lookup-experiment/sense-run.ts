import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { selectReaderSense } from '../reader-sense.ts';
import { type Trace } from '../reader-model.ts';
import { runModel } from './models.ts';
import { senseCases } from './sense-cases.ts';

const [arm, destination] = process.argv.slice(2);
if (!destination || !['selector','context'].includes(arm)) throw new Error('Usage: sense-run.ts selector|context NEW_OUTPUT.jsonl');
mkdirSync(dirname(destination), { recursive: true });
const out = openSync(destination, 'wx', 0o600);
try {
  for (const { id, occurrence, candidates, expected } of senseCases) {
    let trace: Trace | undefined;
    let result;
    if (arm === 'selector') {
      const selected = await selectReaderSense(occurrence, candidates, { onTrace: t => { trace = t; } });
      const senseId = selected?.senseId ?? null;
      result = { senseId, correct: senseId === expected, answer: selected && {
        span: occurrence.text.slice(occurrence.start,occurrence.end), pinyin: selected.pinyin, gloss: selected.label,
      } };
    } else {
      const { answer, ...call } = await runModel('strong', { ...occurrence, kind: 'selection' });
      trace = call;
      result = { answer };
    }
    writeSync(out, JSON.stringify({ id, arm, occurrence, ...trace, ...result }) + '\n');
    console.log(id, 'senseId' in result ? result.senseId : result.answer?.gloss, trace?.elapsedMs);
  }
} finally { closeSync(out); }
