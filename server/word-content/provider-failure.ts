import { ProviderHttpError } from '../llm/types.ts';

export const PREPARATION_PROVIDER_BACKOFF_MS = 60_000;

/** Safe dispatch metadata: never retain provider bodies or arbitrary transport messages. */
export class WordPreparationProviderError extends Error {
  constructor(message: string, readonly providerWide: boolean) { super(message); }
}
export function preparationProviderFailure(error: unknown): WordPreparationProviderError {
  if (error instanceof WordPreparationProviderError) return error;
  const safeMessages = new Set([
    'Vocabulary practice output is invalid or incomplete',
    'Introduction generation output was truncated.',
    'Introduction generation returned invalid JSON.',
    'Introduction generation returned an invalid structure.',
  ]);
  if (error instanceof Error && safeMessages.has(error.message)) {
    return new WordPreparationProviderError(error.message, false);
  }
  if (error instanceof ProviderHttpError) {
    return new WordPreparationProviderError(`Provider returned HTTP ${error.status}.`,
      error.status === 401 || error.status === 403 || error.status === 429 || error.status >= 500);
  }
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return new WordPreparationProviderError('Provider request timed out or was interrupted.', true);
  }
  return new WordPreparationProviderError('Provider request failed (transport or response error).', true);
}
