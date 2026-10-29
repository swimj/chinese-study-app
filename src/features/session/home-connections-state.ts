import type { SessionDebrief } from '../../domain/session-debrief';

export type HomeConnectionsPreference = { expanded: boolean; introduced: boolean };
export type HomeConnectionsView = HomeConnectionsPreference & { promoteWhenReady: boolean };

export function readHomeConnectionsPreference(raw: string | null): HomeConnectionsPreference | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value === 'object' && value !== null && 'expanded' in value && 'introduced' in value
      && typeof value.expanded === 'boolean' && typeof value.introduced === 'boolean') {
      return { expanded: value.expanded, introduced: value.introduced };
    }
  } catch { /* Browser storage is optional and may contain an older value. */ }
  return null;
}

export function beginHomeConnectionsVisit(saved: HomeConnectionsPreference | null): HomeConnectionsView {
  return { expanded: saved?.expanded ?? true, introduced: saved?.introduced ?? false,
    promoteWhenReady: !(saved?.introduced ?? false) };
}

export function receiveHomeConnections(view: HomeConnectionsView, debrief: SessionDebrief): HomeConnectionsView {
  if (debrief.status !== 'ready' || !debrief.notes?.length || view.introduced) return view;
  if (view.expanded || view.promoteWhenReady) {
    return { expanded: true, introduced: true, promoteWhenReady: false };
  }
  return view;
}

export function toggleHomeConnections(view: HomeConnectionsView, ready: boolean): HomeConnectionsView {
  const expanded = !view.expanded;
  return { expanded, introduced: view.introduced || expanded || ready, promoteWhenReady: false };
}

/** At most two neighbors, including unique neighbors for a two-note result. */
export function homeConnectionNeighbors(index: number, count: number): Array<{ index: number; side: 'previous' | 'next' }> {
  if (!Number.isInteger(count) || count < 1 || !Number.isInteger(index) || index < 0 || index >= count) {
    throw new Error('Expected an active connection within a nonempty result.');
  }
  if (count === 1) return [];
  return [
    ...(count > 2 ? [{ index: (index + count - 1) % count, side: 'previous' as const }] : []),
    { index: (index + 1) % count, side: 'next' as const },
  ];
}

export function connectionExcerpt(text: string, limit = 200): string {
  const characters = Array.from(text);
  return characters.length > limit ? `${characters.slice(0, limit).join('').trimEnd()}…` : text;
}
