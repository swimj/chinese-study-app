import type { ReactNode } from 'react';
import { ShortcutHint } from './ShortcutHint';

/** Pager and card chrome; callers retain identity, read state and mutation semantics. */
export function CardInbox({ count, index, itemLabel, metadata, children, emptyCopy, onSelect,
  busy = false, className = '', sessionButtons = false, keyboardNavigation = false }: {
  count: number; index: number; itemLabel: string; metadata?: ReactNode; children?: ReactNode;
  emptyCopy: string; onSelect: (index: number) => void; busy?: boolean; className?: string; sessionButtons?: boolean; keyboardNavigation?: boolean;
}) {
  return <main className={`reflection-help-shell${className ? ` ${className}` : ''}${count ? '' : ' is-empty'}`}>
    {count ? <>
      <header className="reflection-help-chrome">
        <nav className="reflection-help-pager" aria-label={`${itemLabel[0].toUpperCase()}${itemLabel.slice(1)} navigation`}>
          <button type="button" className={`${sessionButtons ? 'vocab-secondary' : 'secondary-button'} reflection-help-pager-button`}
            disabled={busy || index === 0} aria-label={`Previous ${itemLabel}`}
            aria-keyshortcuts={sessionButtons || keyboardNavigation ? 'ArrowLeft' : undefined}
            title={sessionButtons || keyboardNavigation ? `Previous ${itemLabel} (←)` : undefined} onClick={() => onSelect(index - 1)}>
            ‹{(sessionButtons || keyboardNavigation) && <ShortcutHint shortcut="←" />}
          </button>
          <span className="reflection-help-pager-index" aria-live="polite">{index + 1} / {count}</span>
          <button type="button" className={`${sessionButtons ? 'vocab-secondary' : 'secondary-button'} reflection-help-pager-button`}
            disabled={busy || index >= count - 1} aria-label={`Next ${itemLabel}`}
            aria-keyshortcuts={sessionButtons || keyboardNavigation ? 'ArrowRight' : undefined}
            title={sessionButtons || keyboardNavigation ? `Next ${itemLabel} (→)` : undefined} onClick={() => onSelect(index + 1)}>
            ›{(sessionButtons || keyboardNavigation) && <ShortcutHint shortcut="→" />}
          </button>
        </nav>
        <div className="reflection-help-chrome-meta">{metadata}</div>
      </header>
      {children}
    </> : <section className="panel reflection-empty-state"><p className="notes">{emptyCopy}</p></section>}
  </main>;
}
