// Standard USD per million text tokens, verified 2026-11-24 against the model pages:
// https://developers.openai.com/api/docs/models/gpt-6-luna
// https://developers.openai.com/api/docs/models/gpt-6.2-sol
// https://developers.openai.com/api/docs/models/gpt-5.4-mini
// https://developers.openai.com/api/docs/models/gpt-5.4-nano
const rates: Record<string, { input: number; cached: number; write: number | null; output: number }> = {
  'gpt-6-luna': { input: 0.1, cached: 0.01, write: 0.125, output: 0.5 },
  'gpt-6.2-sol': { input: 2, cached: 0.1, write: 2.5, output: 10 },
  'gpt-5.4-mini': { input: 0.75, cached: 0.075, write: null, output: 4.5 },
  'gpt-5.4-nano': { input: 0.2, cached: 0.02, write: null, output: 1.25 },
};

function fields(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function tokens(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
export function meterUsage(provider: string, model: string, raw: unknown, tier?: string) {
  const usage = fields(raw);
  const input = tokens(usage.input_tokens ?? usage.prompt_tokens);
  const output = tokens(usage.output_tokens ?? usage.completion_tokens);
  const details = fields(usage.input_tokens_details ?? usage.prompt_tokens_details);
  const cached = tokens(details.cached_tokens);
  const write = tokens(details.cache_write_tokens);
  const reasoning = tokens(fields(usage.output_tokens_details ?? usage.completion_tokens_details).reasoning_tokens);
  const counts = { input, output, cached, write, reasoning };
  const unknown = { ...counts, cost: null, source: 'unknown', basis: null };
  if (provider === 'openrouter' && typeof usage.cost === 'number' && Number.isFinite(usage.cost) && usage.cost >= 0) {
    return { ...counts, cost: usage.cost, source: 'reported', basis: null };
  }
  const name = model.replace(/^(gpt-5\.4-(?:mini|nano))-2026-03-17$/, '$1');
  const rate = Object.hasOwn(rates, name) ? rates[name] : undefined;
  if (provider !== 'openai' || !rate || (tier && tier !== 'default' && tier !== 'standard')
    || input === null || output === null || (details.cached_tokens != null && cached === null)
    || (details.cache_write_tokens != null && write === null) || (cached ?? 0) + (write ?? 0) > input
    || (write && rate.write === null)) return unknown;
  const long = (name === 'gpt-6.2-sol' || name === 'gpt-6-luna') && input > 272_000;
  const retention = fields(details.cache_write_tokens_details);
  const extended = tokens(retention.ttl_12h_tokens);
  const short = tokens(retention.ttl_30m_tokens);
  if ((retention.ttl_12h_tokens != null && extended === null)
      || (retention.ttl_30m_tokens != null && short === null)
      || (extended ?? 0) + (short ?? 0) > (write ?? 0)) return unknown;
  // The journal requests default retention. Explicit 12-hour writes cost twice the 30-minute rate.
  const writeCharge = ((write ?? 0) + (extended ?? 0)) * (rate.write ?? 0);
  const inputFactor = long ? 2 : 1;
  const outputFactor = long ? 1.5 : 1;
  const cost = (((input - (cached ?? 0) - (write ?? 0)) * rate.input + (cached ?? 0) * rate.cached
      + writeCharge) * inputFactor + output * rate.output * outputFactor) / 1_000_000;
  return { ...counts, cost, source: 'estimated', basis: JSON.stringify({
    ...(extended ? { extendedWriteTokens: extended, extendedWritePerMillion: (rate.write ?? 0) * 2 * inputFactor } : {}),
    asOf: '2026-11-24', model: name, tier: 'standard', currency: 'USD', perMillion: {
      input: rate.input * inputFactor, cached: rate.cached * inputFactor,
      write: rate.write === null ? null : rate.write * inputFactor, output: rate.output * outputFactor,
    },
  }) };
}
