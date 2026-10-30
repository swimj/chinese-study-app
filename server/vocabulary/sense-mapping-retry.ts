import { ProviderHttpError, ProviderTimeoutError } from '../llm/types.ts';

/** Only transport availability failures unlock automatic mapping retries. */
export class VocabularySenseMappingUnavailable extends Error {
  constructor() { super('Sense mapping provider is unavailable'); }
}
export function isSenseMappingAvailabilityFailure(error: unknown): boolean {
  if (error instanceof ProviderTimeoutError) return true;
  if (error instanceof ProviderHttpError) {
    return [401,403,408,429].includes(error.status) || error.status >= 500;
  }
  // Fetch rejects network failures with TypeError; inspect known transport codes
  // too, without treating arbitrary application or response errors as outages.
  if (error instanceof TypeError && error.message === 'fetch failed') return true;
  const seen = new Set<unknown>();
  while (error instanceof Error && !seen.has(error)) {
    seen.add(error);
    if ('code' in error && ['ECONNRESET','ECONNREFUSED','ENOTFOUND','EAI_AGAIN','EPIPE',
      'ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET'].includes(String(error.code))) return true;
    error = error.cause;
  }
  return false;
}
