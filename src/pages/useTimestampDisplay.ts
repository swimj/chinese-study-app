import { useState } from 'react';
import { defaultTimestampDisplay, timestampZoneOptions, type TimestampDisplay } from './operator-timestamps';

type TimestampView = 'model-invocations' | 'content-quality';

function storageKey(view: TimestampView): string {
  return `operator.${view}.timestamp-display`;
}

export function readTimestampDisplay(view: TimestampView): TimestampDisplay {
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(storageKey(view)) ?? 'null');
    if (typeof saved !== 'object' || saved === null || !('mode' in saved) || !('zone' in saved)) {
      return defaultTimestampDisplay;
    }
    if ((saved.mode === 'utc' || saved.mode === 'local' || saved.mode === 'zone')
      && typeof saved.zone === 'string' && timestampZoneOptions().includes(saved.zone)) {
      return { mode: saved.mode, zone: saved.zone };
    }
  } catch {
    // Browser storage can be blocked or contain malformed data; use the UTC default.
  }
  return defaultTimestampDisplay;
}

export function writeTimestampDisplay(view: TimestampView, display: TimestampDisplay): void {
  try {
    window.localStorage.setItem(storageKey(view), JSON.stringify(display));
  } catch {
    // The current selection remains usable even when it cannot be remembered.
  }
}

export function useTimestampDisplay(view: TimestampView): [TimestampDisplay, (display: TimestampDisplay) => void] {
  const [display, setDisplay] = useState(() => readTimestampDisplay(view));
  return [display, (next) => {
    setDisplay(next);
    writeTimestampDisplay(view, next);
  }];
}
