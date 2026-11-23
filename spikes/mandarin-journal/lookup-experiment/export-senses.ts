import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { senseCases } from './sense-cases.ts';
import type { LookupAnswer } from '../reader-dictionary.ts';
import type { ReaderOccurrence } from '../reader-sense.ts';

type Trial = {
  id: string; occurrence: ReaderOccurrence; arm: string; model: string; elapsedMs: number;
  answer: LookupAnswer | null; senseId?: string | null;
  request: { input?: string; messages?: { content: string }[] };
};
const [dir, destination] = process.argv.slice(2);
if (!dir || !destination) throw new Error('Usage: export-senses.ts RUN_DIR NEW_RESULTS.js');
function load(arm: string) {
  const records: Trial[] = readFileSync(join(dir, arm + '.jsonl'),'utf8').trim().split('\n').map(line => JSON.parse(line));
  const byId = new Map(records.map(r => [r.id,r]));
  if (records.length !== senseCases.length || byId.size !== records.length) throw new Error('Incomplete trial for ' + arm);
  return byId;
}
const selected = load('selector'), contextual = load('context');
const output = senseCases.map(({ id, occurrence, candidates, intent, expected, reminder }) => {
  const selector = selected.get(id), context = contextual.get(id);
  if (selector?.arm !== 'selector' || context?.arm !== 'context' ||
      !isDeepStrictEqual(selector.occurrence,occurrence) || !isDeepStrictEqual(context.occurrence,occurrence)) {
    throw new Error('Occurrence mismatch in ' + id);
  }
  const prompt = JSON.parse(selector.request.input ?? selector.request.messages![1].content);
  const choices = candidates.map(({ pinyin,label,notes },i) => ({ ref: String(i+1),pinyin,label,notes }));
  if (JSON.stringify(choices) !== JSON.stringify(prompt.candidates)) throw new Error('Sense catalog mismatch in ' + id);
  const expectedLabel = candidates.find(c => c.senseId === expected)?.label ?? 'Defer to context';
  return { id, kind:'selection', ...occurrence, intent: intent+' Expected decision: '+expectedLabel+'.',
    results: [
      { model:'Instant reminder', ms:0, answer:reminder },
      { model:'Selected label · '+selector.model, ms:selector.elapsedMs, answer:selector.answer },
      { model:'Contextual gloss · '+context.model, ms:context.elapsedMs, answer:context.answer },
    ] };
});
writeFileSync(destination, 'const senseTrials = '+JSON.stringify(output,null,2)+';\n');
