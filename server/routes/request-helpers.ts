export function defaultErrorLogger(message: string, metadata: Record<string, string>): void {
  console.error(message, metadata);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readPositiveIntegerFromQuery(value: unknown, fallback: number): number | null {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

export function readStudyDayKeyFromQuery(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  return normalizeStudyDayKey(value);
}

export function normalizeStudyDayKey(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return null;
  }

  return trimmed;
}

export function isAttentionClientError(error: unknown): error is Error {
  return error instanceof Error && (
    error.message === 'Expected a YYYY-MM-DD whats-new date.'
    || error.message.startsWith('Expected non-empty ')
    || error.message.startsWith('Expected ') && error.message.includes('ISO-8601')
  );
}

export function isReflectionNotFoundError(error: unknown, message: string): error is Error {
  return error instanceof Error && error.message === message;
}

export function isReflectionQualityClientError(error: unknown): error is Error {
  if (!(error instanceof Error)) return false;
  return (
    error.message === 'Expected a valid reflection quality tag.'
    || error.message === 'Expected a non-empty quality tag set.'
    || error.message === 'Expected quality tags to be an array.'
    || error.message === 'other tag requires a non-empty note.'
    || error.message === 'Expected quality annotation note to be a string or null.'
    || error.message.startsWith('Expected non-empty ')
    || error.message.startsWith('Expected ')
      && error.message.includes('ISO-8601')
  );
}
