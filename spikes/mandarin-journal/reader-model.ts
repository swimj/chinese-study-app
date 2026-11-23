import { z } from 'zod';
export type Arm = 'fast' | 'strong';
type Provider = 'openai' | 'openrouter';

const fastProvider = process.env.LOOKUP_FAST_PROVIDER || 'openrouter';
if (fastProvider !== 'openrouter' && fastProvider !== 'openai') throw new Error('Unknown LOOKUP_FAST_PROVIDER');
export const modelIds = {
  fast: process.env.LOOKUP_FAST_MODEL || (fastProvider === 'openai' ? 'gpt-5.4-nano' : 'google/gemini-3.5-flash-lite'),
  strong: process.env.LOOKUP_STRONG_MODEL || 'gpt-6.2-sol',
};

const openRouterEnvelope = z.object({ choices: z.tuple([z.object({
  finish_reason: z.literal('stop'), message: z.object({ content: z.string(), refusal: z.null().optional() }),
})]) });
const openAiEnvelope = z.object({ status: z.literal('completed'), output: z.array(z.discriminatedUnion('type', [
  z.object({ type: z.literal('reasoning') }),
  z.object({ type: z.literal('message'), content: z.array(z.object({ type: z.literal('output_text'), text: z.string() })) }),
])) });
function outputText(provider: Provider, raw: unknown) {
  if (provider === 'openrouter') return openRouterEnvelope.parse(raw).choices[0].message.content;
  const messages = openAiEnvelope.parse(raw).output.filter(item => item.type === 'message');
  if (messages.length !== 1 || messages[0].content.length !== 1) throw new Error('Expected one lookup result');
  return messages[0].content[0].text;
}

export type Trace = {
  model: string; provider: Provider; request: Record<string, unknown>; raw: unknown; elapsedMs: number;
};
export class LookupModelError extends Error implements Trace {
  readonly model: string;
  readonly provider: Provider;
  readonly request: Record<string, unknown>;
  readonly raw: unknown;
  readonly elapsedMs: number;
  constructor(message: string, trace: Trace) {
    super(message);
    this.name = 'LookupModelError';
    this.model = trace.model;
    this.provider = trace.provider;
    this.request = trace.request;
    this.raw = trace.raw;
    this.elapsedMs = trace.elapsedMs;
  }
}

export async function runReaderModel<T>(arm: Arm, options: {
  prompt: string; message: string; format: { name: string; strict: boolean; schema: Record<string, unknown> };
  parse: (output: string) => T; maxTokens: number; signal?: AbortSignal;
}): Promise<Trace & { answer: T }> {
  const { prompt, message, format, parse, maxTokens, signal } = options;
  const provider: Provider = arm === 'strong' ? 'openai' : fastProvider as Provider;
  const model = modelIds[arm];
  const router = provider === 'openrouter';
  const request = router ? {
    model, messages: [{ role: 'system', content: prompt }, { role: 'user', content: message }],
    response_format: { type: 'json_schema', json_schema: format },
    provider: { sort: 'latency', require_parameters: true },
    reasoning: { effort: 'minimal' }, max_tokens: maxTokens,
  } : {
    model, instructions: prompt, input: message, text: { format: { type: 'json_schema', ...format } },
    reasoning: { effort: arm === 'fast' ? 'low' : 'medium' }, max_output_tokens: maxTokens, store: false,
  };
  const keyName = router ? 'OPENROUTER_API_KEY' : 'OPENAI_API_KEY';
  const key = process.env[keyName];
  const started = performance.now();
  let raw: unknown = null;
  const trace = (): Trace => ({ provider, model, request, raw, elapsedMs: Math.round(performance.now() - started) });
  try {
    if (!key) throw new Error(`Missing ${keyName}`);
    const url = router ? 'https://openrouter.ai/api/v1/chat/completions' : 'https://api.openai.com/v1/responses';
    const response = await fetch(url, {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(request), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    });
    const body = (await response.text()).replaceAll(key, '[redacted]');
    raw = body;
    try { raw = JSON.parse(body); } catch { /* Retain a non-JSON provider error as text. */ }
    if (!response.ok) throw new Error(`${provider} lookup returned HTTP ${response.status}`);
    const answer = parse(outputText(provider, raw));
    return { ...trace(), answer };
  } catch (error) {
    throw new LookupModelError(error instanceof Error ? error.message : 'Lookup failed', trace());
  }
}
