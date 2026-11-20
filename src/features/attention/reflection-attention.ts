export type ReflectionNavBadge =
  | { kind: 'none' }
  | { kind: 'count'; count: number }
  | { kind: 'generating' }
  | { kind: 'failure' };

export function reflectionNavBadge({
  tabActive,
  unseenCount,
  hasUnseenFailure,
  isGenerating,
}: {
  tabActive: boolean;
  unseenCount: number;
  hasUnseenFailure: boolean;
  isGenerating: boolean;
}): ReflectionNavBadge {
  if (tabActive) return { kind: 'none' };
  if (hasUnseenFailure) return { kind: 'failure' };
  if (isGenerating) return { kind: 'generating' };
  if (unseenCount > 0) return { kind: 'count', count: unseenCount };
  return { kind: 'none' };
}
