import { closeSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { cases } from './cases.ts';
import { loadDictionary, lookupLocal } from '../reader-dictionary.ts';
import { LookupModelError, runModel } from './models.ts';

const [arm, destination, onlyCase] = process.argv.slice(2);
if (!destination || !['local', 'fast', 'strong'].includes(arm)) {
  throw new Error('Usage: run.ts local|fast|strong NEW_OUTPUT.jsonl [case-id]');
}
const selected = cases.filter(item => !onlyCase || item.id === onlyCase);
if (!selected.length) throw new Error('Unknown case id');
const dictionaryPath = process.env.LOOKUP_DICTIONARY;
if (arm === 'local' && !dictionaryPath) throw new Error('Set LOOKUP_DICTIONARY to a CC-CEDICT v1 file');
const dictionary = arm === 'local' ? loadDictionary(dictionaryPath!) : undefined;
const dictionaryHash = dictionary && createHash('sha256').update(readFileSync(dictionaryPath!)).digest('hex');
mkdirSync(dirname(destination), { recursive: true });
const file = openSync(destination, 'wx', 0o600);
try {
  for (const { id, kind, text, start, end, acceptableSpans } of selected) {
    const input = { kind, text, start, end };
    const at = new Date().toISOString();
    const started = performance.now();
    let result;
    if (dictionary) {
      const local = lookupLocal(dictionary, input);
      result = { ...local, elapsedMs: performance.now() - started, dictionaryHash };
    } else {
      try {
        result = await runModel(arm === 'fast' ? 'fast' : 'strong', input);
      } catch (error) {
        if (!(error instanceof LookupModelError)) throw error;
        const { provider, model, request, raw, elapsedMs } = error;
        result = { answer: null, error: error.message, provider, model, request, raw, elapsedMs };
        process.exitCode = 1;
      }
    }
    const boundary = result.answer ? acceptableSpans.includes(result.answer.span) : null;
    writeSync(file, JSON.stringify({ id, arm, at, input, boundary, ...result }) + '\n');
    console.log(id, result.answer?.span ?? ('error' in result ? result.error : 'deferred'), Math.round(result.elapsedMs) + ' ms');
    // A provider-wide configuration error makes the rest of this run uninformative.
    if ('error' in result && /Missing |HTTP (?:401|402|403|404)/.test(result.error)) break;
  }
} finally {
  closeSync(file);
}
