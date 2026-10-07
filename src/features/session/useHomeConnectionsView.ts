import { useEffect, useState } from 'react';
import type { SessionDebrief } from '../../domain/session-debrief';
import { beginHomeConnectionsVisit, readHomeConnectionsPreference, receiveHomeConnections,
  toggleHomeConnections, type HomeConnectionsView } from './home-connections-state';

// Route changes and settings are part of the same visit. Only a document reload
// makes an unseen batch eligible for its deferred introduction again.
const visitViews = new Map<string, HomeConnectionsView>();
const storageKey = (id: string) => `home-connections:v1:${id}`;

function restore(id: string): HomeConnectionsView {
  const existing = visitViews.get(id);
  if (existing) return existing;
  try {
    return beginHomeConnectionsVisit(readHomeConnectionsPreference(window.localStorage.getItem(storageKey(id))));
  } catch { return beginHomeConnectionsVisit(null); }
}

export function useHomeConnectionsView(debrief: SessionDebrief | null, visible: boolean) {
  const [entry, setEntry] = useState<{ id: string; view: HomeConnectionsView } | null>(null);
  let current = entry;
  if (debrief && current?.id !== debrief.sessionId) {
    current = { id: debrief.sessionId, view: restore(debrief.sessionId) };
    setEntry(current);
  }
  if (debrief && current && visible) {
    const received = receiveHomeConnections(current.view, debrief);
    if (received !== current.view) {
      current = { ...current, view: received };
      setEntry(current);
    }
  }
  useEffect(() => {
    if (!entry) return;
    visitViews.set(entry.id, entry.view);
    try {
      const { expanded, introduced } = entry.view;
      window.localStorage.setItem(storageKey(entry.id), JSON.stringify({ expanded, introduced }));
    } catch { /* Private browsing/storage limits must not prevent using Home. */ }
  }, [entry]);
  const hasContent = debrief !== null && (debrief.status !== 'ready' || !!debrief.notes?.length);
  return {
    expanded: hasContent && !!current?.view.expanded,
    acknowledge: () => {
      if (!current) throw new Error('Cannot acknowledge connections without a session.');
      setEntry({ ...current, view: { ...current.view, introduced: true, promoteWhenReady: false } });
    },
    toggle: () => {
      if (!debrief || !current || current.id !== debrief.sessionId) throw new Error('Cannot toggle connections without a session.');
      setEntry({ ...current, view: toggleHomeConnections(current.view, debrief.status === 'ready' && !!debrief.notes?.length) });
    },
  };
}
