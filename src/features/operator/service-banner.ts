const UPDATE_NOTICE_TTL_MS = 24 * 60 * 60 * 1000;

/** datetime-local values are interpreted in the operator's local timezone. */
export function buildUpdateNotice(localKickoff: string, now = Date.now()): { message: string; expiresAt: string } | null {
  if (!localKickoff) return null;
  const kickoff = new Date(localKickoff);
  if (!Number.isFinite(kickoff.getTime()) || kickoff.getTime() <= now) return null;
  const time = new Intl.DateTimeFormat('en', {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(kickoff);
  return {
    message: `A service update is planned to start around ${time}. The app may be briefly unavailable. Please finish your study session before then.`,
    expiresAt: new Date(kickoff.getTime() + UPDATE_NOTICE_TTL_MS).toISOString(),
  };
}
