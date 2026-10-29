export type ReflectionNavBadge =
  | { kind: 'none' }
  | { kind: 'count'; count: number }
  | { kind: 'generating' }
  | { kind: 'failure' };

export function isFailedReflectionRunUnseen(
  completedAt: string,
  seenThroughAt: string | null,
): boolean {
  return seenThroughAt === null || completedAt > seenThroughAt;
}

export function hasUnseenFailedReflectionRuns(
  failedCompletedAt: readonly string[],
  seenThroughAt: string | null,
): boolean {
  return failedCompletedAt.some((completedAt) => (
    isFailedReflectionRunUnseen(completedAt, seenThroughAt)
  ));
}

export function nextFailedReflectionRunsSeenThroughAt(
  current: string | null,
  seenThroughAt: string,
): string {
  return current !== null && current >= seenThroughAt ? current : seenThroughAt;
}

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
