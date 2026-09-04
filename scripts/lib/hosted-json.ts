export function parseJsonValue(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === '') throw new Error('Expected JSON output, received an empty command result.');
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.lastIndexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error('Expected JSON output from hosted command.');
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function sanitizeHostedOutput(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
    .replace(/sk_(?:live|test)_[A-Za-z0-9]+/g, '[redacted-clerk-secret]')
    .replace(/s3:\/\/[^\s"'\\]+/gi, 's3://[redacted]');
}
