import { createOpenAiCompatibleAdapter } from '../../server/llm/openai-compatible.ts';
import { fetchImplementationForProvider } from '../../server/llm/proxy-fetch.ts';
import { ProviderHttpError, type ProviderAdapter, type ProviderRawResult, type ProviderRunRequest } from '../../server/llm/types.ts';
import type { FetchImplementation } from '../../server/llm/http.ts';
import { randomUUID } from 'node:crypto';

export type BulkStart = { attemptId: string; request: ProviderRunRequest; attempt: number; startedAt: string };
export type BulkAttempt = BulkStart & {
  finishedAt: string; latencyMs: number;
} & ({ result: ProviderRawResult; error?: never } | { result?: never; error: { name: string; httpStatus: number | null; outcomeUnknown: boolean } });
export type BulkResponse = BulkStart & { receivedAt: string; responseStatus: number; body: unknown };
type Budget = { remaining: number | null; resetsAt: number };
type ModelBudget = { requests: Budget; tokens: Budget; blockedUntil: number; observed: boolean; inFlight: number };

/** Header durations use values such as 1m2.5s, rather than ISO timestamps. */
export function rateLimitDurationMs(value: string | null): number | null {
  if (value === null) return null;
  const text = value.trim();
  if (!text) return null;
  const matches = [...text.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)];
  if (!matches.length || matches.map(match => match[0]).join('') !== text) return null;
  const units: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };
  return matches.reduce((total, match) => total + Number(match[1]) * units[match[2]!]!, 0);
}

/** A rolling dispatcher: completion immediately opens a slot; calls never wait on sibling results.
 * Header budgets are conservative hints, not a claim to know the organization's other traffic.
 * Unknown-outcome transport errors are retained for operator disposition, never retried automatically. */
export function createBulkDispatcher(options: {
  concurrency?: number; maxRetries?: number; fetchImplementation?: FetchImplementation; probeLimits?: boolean;
  /** Commit this record before dispatch so crashes during retries retain an uncertain-attempt marker. */
  onStart?: (start: BulkStart) => void | Promise<void>;
  onAttempt?: (attempt: BulkAttempt) => void | Promise<void>;
  /** Retain the provider body before transport/schema parsing can reject it. Never receives headers or credentials. */
  onResponse?: (response: BulkResponse) => void | Promise<void>;
  now?: () => number; random?: () => number;
} = {}): { adapter: ProviderAdapter; stats(): { active: number; queued: number; attempts: number; retries: number } } {
  const concurrency = options.concurrency ?? 100, maxRetries = options.maxRetries ?? 3;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 1000) throw new Error('Invalid bulk concurrency');
  if (!Number.isSafeInteger(maxRetries) || maxRetries < 0 || maxRetries > 10) throw new Error('Invalid retry limit');
  const now = options.now ?? Date.now, random = options.random ?? Math.random;
  const fetchImplementation = options.fetchImplementation ?? fetchImplementationForProvider('openai', 900_000);
  const budgets = new Map<string, ModelBudget>();
  const pending: Array<{ model: string; tokens: number; resolve(): void }> = [];
  let active = 0, attempts = 0, retries = 0, timer: ReturnType<typeof setTimeout> | undefined;
  function modelBudget(model: string): ModelBudget {
    let budget = budgets.get(model);
    if (!budget) { budget = { requests: { remaining: null, resetsAt: 0 }, tokens: { remaining: null, resetsAt: 0 }, blockedUntil: 0, observed: !options.probeLimits, inFlight: 0 }; budgets.set(model, budget); }
    return budget;
  }
  function waitUntil(model: string, tokens: number): number {
    const budget = modelBudget(model), timestamp = now();
    for (const bucket of [budget.requests, budget.tokens]) if (bucket.resetsAt <= timestamp) bucket.remaining = null;
    return Math.max(budget.blockedUntil,
      budget.requests.remaining !== null && budget.requests.remaining < 1 ? budget.requests.resetsAt : 0,
      budget.tokens.remaining !== null && budget.tokens.remaining < tokens ? budget.tokens.resetsAt : 0);
  }
  function pump(): void {
    if (timer) clearTimeout(timer); timer = undefined;
    let next = Infinity;
    for (let index = 0; index < pending.length && active < concurrency;) {
      const item = pending[index]!, until = waitUntil(item.model, item.tokens);
      if(!modelBudget(item.model).observed&&modelBudget(item.model).inFlight>0){index++;continue;}
      if (until > now()) { next = Math.min(next, until); index++; continue; }
      pending.splice(index, 1); active++;
      const budget = modelBudget(item.model);
      budget.inFlight++;
      if (budget.requests.remaining !== null) budget.requests.remaining--;
      if (budget.tokens.remaining !== null) budget.tokens.remaining -= item.tokens;
      item.resolve();
    }
    if (pending.length && active < concurrency && Number.isFinite(next)) timer = setTimeout(pump, Math.max(1, next - now()));
  }
  function observe(model: string, response: Response): void {
    const budget = modelBudget(model), timestamp = now();
    budget.observed=true;
    for (const [name, bucket] of [['requests', budget.requests], ['tokens', budget.tokens]] as const) {
      const header = response.headers.get(`x-ratelimit-remaining-${name}`);
      const remaining = header === null ? NaN : Number(header);
      if (!Number.isFinite(remaining) || remaining < 0) continue;
      if (bucket.resetsAt <= timestamp) bucket.remaining = null;
      // Out-of-order responses must not refill a locally reserved budget.
      bucket.remaining = bucket.remaining === null ? remaining : Math.min(bucket.remaining, remaining);
      bucket.resetsAt = Math.max(bucket.resetsAt, timestamp + (rateLimitDurationMs(response.headers.get(`x-ratelimit-reset-${name}`)) ?? 60_000));
    }
    if (response.status === 429 || response.status === 503) {
      const header = response.headers.get('retry-after');
      const seconds = header === null ? NaN : Number(header);
      const delay = Number.isFinite(seconds) ? seconds * 1000 : header ? Date.parse(header) - timestamp : 0;
      if (Number.isFinite(delay) && delay > 0) budget.blockedUntil = Math.max(budget.blockedUntil, timestamp + delay);
    }
  }
  const metadata = { id: 'openai', defaultBaseUrl: 'https://api.openai.com/v1', apiKeyEnvironmentVariable: 'OPENAI_API_KEY', structuredOutputMode: 'json_schema' as const };
  const adapter: ProviderAdapter = { ...metadata, async run(request, config) {
    // A conservative character estimate plus maximum completion tokens reserves capacity.
    const tokens = Math.ceil((request.systemPrompt.length + request.userPrompt.length + JSON.stringify(request.outputSchema).length) / 3) + request.maxOutputTokens;
    for (let attempt = 1; ; attempt++) {
      await new Promise<void>(resolve => { pending.push({ model: request.model, tokens, resolve }); pump(); });
      const started = now(), startedAt = new Date(started).toISOString();
      const startRecord: BulkStart = { attemptId: randomUUID(), request, attempt, startedAt };
      try { await options.onStart?.(startRecord); }
      catch (error) { active--; modelBudget(request.model).inFlight--; pump(); throw error; }
      attempts++;
      let responseStatus: number | null = null, bodyRead = false, responsePersistenceFailed = false;
      const transport = createOpenAiCompatibleAdapter({ ...metadata, maxTokensField: 'max_completion_tokens', fetchImplementation: (async (input, init) => {
        const response = await fetchImplementation(input, init); responseStatus = response.status; observe(request.model, response);
        if (options.onResponse) {
          const text = await response.clone().text(); bodyRead = true;
          let body: unknown = text;
          try { body = JSON.parse(text) as unknown; } catch { /* Non-JSON payload is retained verbatim. */ }
          try { await options.onResponse({ ...startRecord, receivedAt: new Date(now()).toISOString(), responseStatus: response.status, body }); }
          catch (error) { responsePersistenceFailed = true; throw error; }
        }
        return response;
      }) as FetchImplementation });
      let result: ProviderRawResult | undefined, failure: unknown;
      try { result = await transport.run(request, config); } catch (error) { failure = error; }
      const finished = now();
      const httpStatus = failure instanceof ProviderHttpError ? failure.status : responseStatus;
      const retryable = !responsePersistenceFailed && (httpStatus === 429 || (httpStatus !== null && httpStatus >= 500 && httpStatus < 600));
      if (retryable) {
        const budget = modelBudget(request.model);
        budget.blockedUntil = Math.max(budget.blockedUntil, now() + Math.min(60_000, 1000 * 2 ** (attempt - 1)) * (0.75 + random() * 0.5));
      }
      active--; modelBudget(request.model).inFlight--; pump();
      const timing = { ...startRecord, finishedAt: new Date(finished).toISOString(), latencyMs: Math.max(0, finished - started) };
      if (result) {
        // Persistence failure must not cause another paid request.
        await options.onAttempt?.({ ...timing, result }); return result;
      }
      await options.onAttempt?.({ ...timing, error: { name: failure instanceof Error ? failure.name : 'UnknownError', httpStatus,
        outcomeUnknown: responsePersistenceFailed || httpStatus === null || (options.onResponse !== undefined && !bodyRead) } });
      if (attempt > maxRetries || !retryable) throw failure;
      retries++;
    }
  } };
  return { adapter, stats: () => ({ active, queued: pending.length, attempts, retries }) };
}

export { costForBulkResult, costForBulkResponse } from '../../server/llm/bulk-repertoire-pricing.ts';
