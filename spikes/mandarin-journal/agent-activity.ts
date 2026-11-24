import { AsyncLocalStorage } from 'node:async_hooks';
import OpenAI from 'openai';
import { isOpenAIResponsesRawModelStreamEvent, OpenAIProvider, Runner, type RunStreamEvent } from '@openai/agents';
import { activityEnabled, activityStep, recordProviderUsage, startActivityStep } from './activity.ts';

type Attempt = ReturnType<typeof startActivityStep>;
type AgentActivity = {
  label: string;
  model: string;
  requestedTools: Map<string, { label: string; source: string }>;
  preceding: string[];
  stream?: Attempt;
};
const activeRun = new AsyncLocalStorage<AgentActivity>();
let warned = false;

function warnOnObserverFailure() {
  if (warned) return;
  warned = true;
  console.warn('Journal provider activity could not be recorded.');
}

// An accounting error must never escape into the HTTP client, which would
// interpret it as a transport failure and retry a possibly billable request.
function observe<T>(work: () => T): T | undefined {
  try { return work(); } catch { warnOnObserverFailure(); }
}

function object(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
}

function finishResponse(run: AgentActivity, span: Attempt, raw: unknown, httpError?: number) {
  observe(() => recordProviderUsage(span, raw));
  const response = object(raw);
  for (const item of Array.isArray(response?.output) ? response.output : []) {
    const call = object(item);
    if (call?.type === 'function_call' && typeof call.call_id === 'string' && typeof call.name === 'string' && span.id) {
      run.requestedTools.set(call.call_id, { label: call.name, source: span.id });
    }
  }
  if (httpError) span.outcome('HTTP ' + httpError);
  else if (response?.status === 'incomplete' || response?.status === 'failed' || response?.status === 'cancelled') {
    span.outcome(response.status);
  } else if (response) {
    span.finish();
    return;
  }
  span.finish('error');
}

function linkToolResult(run: AgentActivity, source: string | undefined, span: Attempt) {
  if (source) run.preceding = run.preceding.filter(id => id !== source);
  if (span.id) run.preceding.push(span.id);
}

function recordUnexecutedResults(run: AgentActivity, body: BodyInit | null | undefined) {
  if (!run.requestedTools.size || typeof body !== 'string') return;
  // An invalid argument can produce an SDK error result before execute() or the
  // tool lifecycle hooks run. Match the result actually supplied to the next
  // turn. Unanswered or abandoned requests have no such result.
  const request = object(JSON.parse(body));
  for (const entry of Array.isArray(request?.input) ? request.input : []) {
    const result = object(entry);
    if (result?.type !== 'function_call_output' || typeof result.call_id !== 'string') continue;
    const call = run.requestedTools.get(result.call_id);
    if (!call) continue;
    const span = startActivityStep('tool', call.label, { reference: result.call_id, dependsOn: [call.source] });
    span.outcome('Rejected before execution');
    span.finish('error');
    linkToolResult(run, call.source, span);
    run.requestedTools.delete(result.call_id);
  }
}

// One fetch is one provider attempt, including automatic HTTP retries inside the SDK.
// Only timing, usage and correlation IDs leave this boundary.
const observedFetch: typeof globalThis.fetch = async (input, init) => {
  const run = activeRun.getStore();
  if (!run) return globalThis.fetch(input, init);
  const span = observe(() => {
    recordUnexecutedResults(run, init?.body);
    const span = startActivityStep('model', run.label, { provider: 'openai', model: run.model, dependsOn: run.preceding });
    run.preceding = span.id ? [span.id] : [];
    return span;
  });
  let response: Response;
  try {
    response = await globalThis.fetch(input, init);
  } catch (error) {
    observe(() => span?.finish('error'));
    throw error;
  }
  if (!span) return response;
  try {
    if (response.ok && response.headers.get('content-type')?.includes('text/event-stream')) {
      // The SDK owns the stream. Observe its parsed terminal event without delaying text delivery.
      run.stream = span;
    } else {
      const raw: unknown = await response.clone().json().catch(() => null);
      finishResponse(run, span, raw, response.ok ? undefined : response.status);
    }
  } catch {
    warnOnObserverFailure();
    observe(() => span.finish('error'));
  }
  return response;
};

let provider: OpenAIProvider | undefined;
export const journalRunner = new Runner({
  tracingDisabled: true,
  modelProvider: {
    getModel(name) {
      // Offline fixture startup must work without an API key.
      provider ??= new OpenAIProvider({ openAIClient: new OpenAI({ fetch: observedFetch }) });
      return provider.getModel(name);
    },
  },
});

export function agentRun<T>(label: string, model: string, work: () => Promise<T>): Promise<T> {
  if (!activityEnabled()) return work();
  return activityStep('run', label, async () => {
    const run: AgentActivity = { label, model, requestedTools: new Map(), preceding: [] };
    try {
      return await activeRun.run(run, work);
    } finally {
      // EOF, cancellation or a transport error before the terminal event.
      observe(() => run.stream?.finish('error'));
    }
  });
}

export function observeStreamEvent(event: RunStreamEvent) {
  const run = activeRun.getStore();
  if (!run?.stream || !isOpenAIResponsesRawModelStreamEvent(event)) return;
  const raw = event.data.event;
  if (raw.type === 'response.completed' || raw.type === 'response.failed' || raw.type === 'response.incomplete') {
    const span = run.stream;
    run.stream = undefined;
    observe(() => finishResponse(run, span, raw.response));
  }
}

export function agentTool<T>(label: string, callId: string | undefined, work: () => T | Promise<T>): Promise<T> {
  const run = activeRun.getStore();
  const call = callId ? run?.requestedTools.get(callId) : undefined;
  if (callId) run?.requestedTools.delete(callId);
  return activityStep('tool', label, async span => {
    if (run) linkToolResult(run, call?.source, span);
    return work();
  }, { reference: callId, dependsOn: call ? [call.source] : [] });
}
