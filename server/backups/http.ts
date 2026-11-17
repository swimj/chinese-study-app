import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export function authorized(request: IncomingMessage, token: string): boolean {
  const actual = request.headers.authorization ?? '';
  return timingSafeEqual(createHash('sha256').update(actual).digest(),
    createHash('sha256').update(`Bearer ${token}`).digest());
}
export function requireBackupToken(token: string | undefined): string {
  if (!token || token.length < 32) throw new Error('Backup authentication requires a token of at least 32 characters');
  return token;
}
export async function readBackupJson(request: IncomingMessage): Promise<unknown> {
  let body = '';
  for await (const chunk of request) {
    body += String(chunk);
    if (body.length > 4096) throw new Error('Request too large');
  }
  return JSON.parse(body);
}
export function jsonResponse(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}
export function backupId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(value);
}
