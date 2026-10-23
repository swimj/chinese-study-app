import type { ServiceBannerContent } from '../../domain/service-banner';

export function formatBannerTimestamp(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(new Date(timestamp));
}

export function serviceBannerMessage(banner: ServiceBannerContent): string {
  return banner.kickoffAt
    ? `A service update is planned to start around ${formatBannerTimestamp(banner.kickoffAt)}. The app may be briefly unavailable. Please finish your study session before then.`
    : banner.message;
}

/** datetime-local values use the selected operator perspective; storage uses UTC. */
export function buildUpdateNotice(value: string, now = Date.now(), perspective: 'local' | 'utc' = 'local'): { kickoffAt: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const kickoff = new Date(perspective === 'utc' ? `${value}Z` : value);
  if (!Number.isFinite(kickoff.getTime()) || kickoff.getTime() <= now) return null;
  // Reject normalized invalid calendar dates and local times skipped by a DST jump.
  const parts = perspective === 'utc'
    ? [kickoff.getUTCFullYear(), kickoff.getUTCMonth() + 1, kickoff.getUTCDate(), kickoff.getUTCHours(), kickoff.getUTCMinutes()]
    : [kickoff.getFullYear(), kickoff.getMonth() + 1, kickoff.getDate(), kickoff.getHours(), kickoff.getMinutes()];
  if (parts.join(',') !== value.split(/[-T:]/).map(Number).join(',')) return null;
  return { kickoffAt: kickoff.toISOString() };
}
