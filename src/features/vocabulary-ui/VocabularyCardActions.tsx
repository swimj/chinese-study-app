import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Session-owned footer destination; standalone teaching previews keep inline controls. */
export const VocabularyCardActionTarget = createContext<HTMLElement | null | undefined>(undefined);

export function VocabularyCardActions({ children }: { children: ReactNode }) {
  const target = useContext(VocabularyCardActionTarget);
  if (target === undefined) return <>{children}</>;
  return target ? createPortal(children, target) : null;
}
