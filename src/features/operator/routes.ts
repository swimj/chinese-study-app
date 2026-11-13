export const OPERATOR_TABS = [
  { id: 'usage', label: 'Usage' },
  { id: 'invocations', label: 'Model invocations' },
  { id: 'sharing', label: 'Content sharing' },
  { id: 'quality', label: 'Content quality' },
  { id: 'repertoire-quality', label: 'Repertoire quality' },
  { id: 'improvement', label: 'Content improvement' },
  { id: 'failures', label: 'Preparation failures' },
  { id: 'reactions', label: 'Learner reactions' },
  { id: 'whats-new', label: 'What’s new' },
  { id: 'banner', label: 'Service banner' },
] as const;
export type OperatorTab = typeof OPERATOR_TABS[number]['id'];
export function isOperatorPath(pathname: string): boolean {
  return pathname === '/operator' || pathname.startsWith('/operator/');
}
export function operatorTabFromPath(pathname: string): OperatorTab | null {
  if (pathname === '/operator/reconciliation') return 'improvement';
  if (pathname === '/operator' || pathname === '/operator/') return 'usage';
  return OPERATOR_TABS.find(tab => pathname === `/operator/${tab.id}`)?.id ?? null;
}
export function operatorPath(tab: OperatorTab): string { return `/operator/${tab}`; }
