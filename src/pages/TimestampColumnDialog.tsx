import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { TimestampDisplayControl } from './TimestampDisplayControl';
import type { TimestampDisplay } from './operator-timestamps';

export function TimestampColumnDialog({ title, display, onDisplay, sorted, direction, onSort, onClose }: {
  title: string; display: TimestampDisplay; onDisplay: (display: TimestampDisplay) => void;
  sorted: boolean; direction: 'asc' | 'desc'; onSort: (direction: 'asc' | 'desc') => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, []);
  const close = () => ref.current?.close();
  return createPortal(<dialog ref={ref} className="operator-column-dialog" aria-labelledby="timestamp-column-title"
    onClose={(event) => { if (!event.currentTarget.open) onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
    <div className="operator-column-dialog-body">
      <div className="operator-column-title"><h3 id="timestamp-column-title">{title}</h3><button type="button" className="secondary-button" onClick={close} aria-label="Close column controls">Close</button></div>
      <fieldset><legend>Display</legend><TimestampDisplayControl value={display} onChange={onDisplay} /></fieldset>
      <fieldset><legend>Sort</legend><div className="operator-column-actions">
        <button type="button" className="secondary-button" aria-pressed={sorted && direction === 'asc'} onClick={() => onSort('asc')}>Ascending ↑</button>
        <button type="button" className="secondary-button" aria-pressed={sorted && direction === 'desc'} onClick={() => onSort('desc')}>Descending ↓</button>
      </div></fieldset>
    </div>
  </dialog>, document.body);
}
