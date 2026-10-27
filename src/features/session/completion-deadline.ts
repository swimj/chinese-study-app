/** Translate a server-relative window to this browser's clock, avoiding clock skew. */
export function completionDeadline(completion: { closeAt: string; serverNow: string }, receivedAt = Date.now()): number {
  return receivedAt + Math.max(0, Date.parse(completion.closeAt) - Date.parse(completion.serverNow));
}
