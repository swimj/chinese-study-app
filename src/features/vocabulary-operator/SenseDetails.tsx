import { createPortal } from 'react-dom';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import './SenseDetails.css';

/** Selection stays on the chip; its adjacent control pins the hover details. */
export function SenseDetails({ label, notes, children }: { label: string; notes: string[]; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const anchor = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>();
  const hideTimer = useRef<ReturnType<typeof setTimeout>>();
  const id = useId();

  function clearTimers() {
    clearTimeout(hoverTimer.current);
    clearTimeout(hideTimer.current);
  }
  function close(restoreFocus = false) {
    clearTimers();
    setOpen(false);
    setPinned(false);
    if (restoreFocus) trigger.current?.focus();
  }
  function enter() {
    clearTimers();
    if (!open) hoverTimer.current = setTimeout(() => setOpen(true), 250);
  }
  function leave() {
    clearTimers();
    if (!pinned) hideTimer.current = setTimeout(() => setOpen(false), 200);
  }
  useEffect(() => () => clearTimers(), []);
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const rect = anchor.current?.getBoundingClientRect();
      const popup = panel.current?.getBoundingClientRect();
      if (!rect || !popup) return;
      setPosition({
        left: Math.max(12, Math.min(rect.left, window.innerWidth - popup.width - 12)),
        top: rect.bottom + popup.height + 8 <= window.innerHeight - 12
          ? rect.bottom + 8 : Math.max(12, rect.top - popup.height - 8),
      });
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, label, notes]);
  useEffect(() => {
    if (!open) return;
    function key(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(pinned);
      }
    }
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !anchor.current?.contains(event.target) && !panel.current?.contains(event.target)) close();
    }
    function focusOutside(event: FocusEvent) {
      if (pinned && event.target instanceof Node && !anchor.current?.contains(event.target) && !panel.current?.contains(event.target)) close();
    }
    window.addEventListener('keydown', key);
    window.addEventListener('pointerdown', outside);
    window.addEventListener('focusin', focusOutside);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('focusin', focusOutside);
    };
  }, [open, pinned]);
  useEffect(() => { if (pinned) closeButton.current?.focus(); }, [pinned]);

  if (!notes.length) return <>{children}</>;
  return <span className="vocabulary-sense-with-details" ref={anchor} onMouseEnter={enter} onMouseLeave={leave}>
    {children}
    <button ref={trigger} type="button" className="vocabulary-sense-info secondary-button"
      aria-label={`Details for ${label}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => { clearTimers(); if (pinned) close(); else { setOpen(true); setPinned(true); } }}>
      <span aria-hidden="true">ⓘ</span>
    </button>
    {open && createPortal(<div ref={panel} id={id} role="dialog" aria-label={label}
      className="vocabulary-sense-details" style={position} onMouseEnter={() => clearTimers()} onMouseLeave={leave}
      onKeyDown={event => {
        if (event.key === 'Tab' && pinned) {
          // Continue from the owning control, not the portal's position at the end of the page.
          close(true);
          if (event.shiftKey) event.preventDefault();
        }
      }}>
      <div className="vocabulary-sense-details-heading"><strong>{label}</strong>
        <button ref={closeButton} type="button" className="secondary-button" aria-label="Close sense details" onClick={() => close(pinned)}>×</button>
      </div>
      <ul>{notes.map((note, index) => <li key={index}>{note}</li>)}</ul>
    </div>, document.body)}
  </span>;
}
