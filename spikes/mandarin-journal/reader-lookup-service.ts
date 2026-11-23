import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { runModel } from './lookup-experiment/models.ts';
import { characterLookup, passageLookups } from './public/reader-lookup.js';
import { createReaderCatalog, type ReaderSense } from './reader-catalog.ts';
import { loadDictionary, lookupLocal, type LookupInput, type LookupAnswer } from './reader-dictionary.ts';
import { LookupModelError, type Trace } from './reader-model.ts';
import { selectReaderSense } from './reader-sense.ts';

const dictionarySample = fileURLToPath(new URL('./lookup-experiment/reader-dictionary.sample.u8', import.meta.url));
const catalogFile = new URL('./lookup-experiment/sense-catalog.sample.json', import.meta.url);
const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

const routerPrompt = z.object({ messages: z.array(z.object({ role: z.string(), content: z.string() })) });
const usage = z.object({ usage: z.object({
  prompt_tokens: z.number().optional(), completion_tokens: z.number().optional(), cost: z.number().optional(),
  input_tokens: z.number().optional(), output_tokens: z.number().optional(),
}) });

function modelEvidence(stage: 'selector' | 'context', trace: Trace, outcome: 'selected' | 'abstained' | 'answered' | 'error') {
  const prompt = trace.provider === 'openai' ? trace.request.instructions :
    routerPrompt.parse(trace.request).messages.find(message => message.role === 'system')?.content;
  if (typeof prompt !== 'string') throw new Error('Missing reader prompt in invocation trace');
  const parsed = usage.safeParse(trace.raw);
  const counts = parsed.success ? parsed.data.usage : undefined;
  return { stage, outcome, provider: trace.provider, model: trace.model, elapsedMs: trace.elapsedMs,
    promptSha256: sha256(prompt), inputTokens: counts?.input_tokens ?? counts?.prompt_tokens ?? null,
    outputTokens: counts?.output_tokens ?? counts?.completion_tokens ?? null, costUsd: counts?.cost ?? null,
    error: trace instanceof LookupModelError ? trace.message.slice(0, 500) : null };
}

export type LookupSource = { documentId: string; blockId: string };
type Route = 'catalog' | 'dictionary' | 'selector' | 'context' | 'authored' | 'unavailable';

function authoredFallback(input: LookupInput, source?: LookupSource) {
  if (!source) return;
  for (const entry of passageLookups(source.documentId, source.blockId, input.text)) {
    const { startOffset, endOffset } = entry.anchor;
    if (input.start < startOffset || input.end > endOffset) continue;
    if (input.kind === 'tap' || (input.start === startOffset && input.end === endOffset)) return entry;
    const piece = characterLookup(entry, input.start - startOffset);
    if (piece?.anchor.endOffset === input.end) return piece;
  }
}

type ServiceOptions = {
  dictionaryPath?: string; selectorEnabled?: boolean; contextEnabled?: boolean;
  select?: typeof selectReaderSense; context?: typeof runModel;
};

export function createLookupService(options: ServiceOptions = {}) {
  const dictionaryPath = options.dictionaryPath ?? process.env.LOOKUP_DICTIONARY ?? dictionarySample;
  const dictionary = loadDictionary(dictionaryPath);
  const catalogBytes = readFileSync(catalogFile);
  const catalog = createReaderCatalog(JSON.parse(catalogBytes.toString('utf8')));
  const sources = { dictionarySource: dictionaryPath === dictionarySample ? 'sample' : 'configured',
    dictionarySha256: sha256(readFileSync(dictionaryPath)), catalogSha256: sha256(catalogBytes) };
  const demo = process.env.JOURNAL_DEMO === '1';
  const selectorKey = process.env.LOOKUP_FAST_PROVIDER === 'openai' ? process.env.OPENAI_API_KEY : process.env.OPENROUTER_API_KEY;
  const selectorEnabled = !demo && (options.selectorEnabled ?? Boolean(selectorKey));
  const contextEnabled = !demo && (options.contextEnabled ?? Boolean(process.env.OPENAI_API_KEY));
  const select = options.select ?? selectReaderSense;
  const context = options.context ?? runModel;

  async function lookup(input: LookupInput, source?: LookupSource) {
    const started = performance.now();
    const local = lookupLocal(dictionary, input);
    const occurrence = local.occurrence;
    const form = occurrence ? input.text.slice(occurrence.start, occurrence.end) : null;
    const candidates = form ? catalog.sensesFor(form) : [];
    const steps: string[] = [];
    const calls: ReturnType<typeof modelEvidence>[] = [];
    const evidence = { policyVersion: 1, ...sources, localReason: local.reason,
      localSpan: occurrence ? { start: occurrence.start, end: occurrence.end, form } : null,
      candidates, selectedSenseId: null as string | null, steps, calls };
    const finish = (route: Route, start: number, end: number, answer: LookupAnswer | null) => ({
      route, start, end, answer, evidence: { ...evidence, elapsedMs: Math.round(performance.now() - started) },
    });
    if (occurrence && form) {
      const fromSense = (route: 'catalog' | 'selector', sense: ReaderSense) => {
        evidence.selectedSenseId = sense.senseId;
        return finish(route, occurrence.start, occurrence.end, { span: form, pinyin: sense.pinyin, gloss: sense.label });
      };
      if (local.answer && candidates.length === 1) {
        steps.push('one-dictionary-reading-and-gloss-with-one-catalog-sense');
        return fromSense('catalog', candidates[0]);
      }
      if (local.answer && !candidates.length) {
        steps.push('one-dictionary-reading-and-gloss');
        return finish('dictionary', occurrence.start, occurrence.end, local.answer);
      }
      if (candidates.length && selectorEnabled) {
        let invocation: Trace | undefined;
        try {
          const sense = await select(occurrence, candidates, { onTrace: trace => { invocation = trace; } });
          if (!invocation) throw new Error('Missing selector invocation');
          calls.push(modelEvidence('selector', invocation, sense ? 'selected' : 'abstained'));
          steps.push(sense ? 'matched-catalog-sense' : 'selector-abstained');
          if (sense) return fromSense('selector', sense);
        } catch (error) {
          if (!(error instanceof LookupModelError)) throw error;
          calls.push(modelEvidence('selector', error, 'error'));
          steps.push('selector-error');
        }
      } else {
        steps.push(candidates.length ? 'selector-offline' : 'no-catalog-senses');
      }
    } else {
      steps.push('no-agreed-dictionary-entry');
    }

    if (contextEnabled) {
      try {
        const focus: LookupInput = occurrence && candidates.length ? { ...occurrence, kind: 'selection' } : input;
        const trace = await context('strong', focus);
        const start = input.text.lastIndexOf(trace.answer.span, focus.start);
        const end = start + trace.answer.span.length;
        if (start < 0 || end < focus.end || (focus.kind === 'selection' && (start !== focus.start || end !== focus.end))) {
          throw new Error('Context response does not cover the original lookup');
        }
        calls.push(modelEvidence('context', trace, 'answered'));
        steps.push('contextual-gloss');
        return finish('context', start, end, trace.answer);
      } catch (error) {
        if (!(error instanceof LookupModelError)) throw error;
        calls.push(modelEvidence('context', error, 'error'));
        steps.push('context-error');
      }
    } else {
      steps.push('context-offline');
    }

    const authored = authoredFallback(input, source);
    if (authored) {
      steps.push('authored-occurrence');
      return finish('authored', authored.anchor.startOffset, authored.anchor.endOffset, {
        span: authored.anchor.quote, pinyin: authored.pinyin, gloss: authored.gloss,
      });
    }
    return finish('unavailable', occurrence?.start ?? input.start, occurrence?.end ?? input.end, null);
  }
  return { lookup };
}

export type ReaderLookupDecision = Awaited<ReturnType<ReturnType<typeof createLookupService>['lookup']>>;
