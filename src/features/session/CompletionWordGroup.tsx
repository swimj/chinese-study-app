import type { ReactNode } from 'react';

/** A bounded summary disclosure, shared independently of each runtime's word actions. */
export function CompletionWordGroup({ title, count, children, variant, onExpand }: {
  title: string; count: number; children: ReactNode;
  variant: 'session' | 'vocabulary'; onExpand?: () => void;
}) {
  if (!count) return null;
  const vocabulary = variant === 'vocabulary';
  const Heading = vocabulary ? 'h2' : 'h3';
  return <section className={vocabulary ? 'vocab-outcomes' : 'session-completion-word-group'} aria-label={title}>
    <Heading>{title} <span className={vocabulary ? 'vocab-summary-count' : 'session-completion-count'}>{count}</span></Heading>
    {count > 6 ? <details className={vocabulary ? 'vocab-summary-word-disclosure' : undefined}
      onToggle={onExpand ? event => { if (event.currentTarget.open) onExpand(); } : undefined}>
      <summary>View words</summary>{children}
    </details> : children}
  </section>;
}
