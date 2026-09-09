export type DietIntakeSubmissionPhase =
  | 'idle'
  | 'assessing'
  | 'refreshing'
  | 'assessment-error'
  | 'refresh-error';

export type DietIntakeSubmissionState = {
  phase: DietIntakeSubmissionPhase;
  error: string | null;
};

export const INITIAL_DIET_INTAKE_SUBMISSION_STATE: DietIntakeSubmissionState = {
  phase: 'idle',
  error: null,
};

export function doesDietIntakeBlockSessionStart(state: DietIntakeSubmissionState): boolean {
  return state.phase === 'assessing' || state.phase === 'refreshing' || state.phase === 'refresh-error';
}

export function isDietIntakeSubmitting(state: DietIntakeSubmissionState): boolean {
  return state.phase === 'assessing' || state.phase === 'refreshing';
}

export type DietIntakePlacementDependencies = {
  submitPlacement: () => Promise<void>;
  invalidateSessionPrefetch: () => void;
  reloadDashboard: () => Promise<void>;
  refreshSessionPrefetch: () => Promise<void>;
  onStateChange: (state: DietIntakeSubmissionState) => void;
};

/**
 * Keep the write and the future-session refresh in one ordered flow. A saved
 * placement remains saved when a later dashboard or prefetch refresh fails.
 */
export async function submitDietIntakePlacement(
  dependencies: DietIntakePlacementDependencies,
): Promise<void> {
  dependencies.onStateChange({ phase: 'assessing', error: null });
  try {
    await dependencies.submitPlacement();
  } catch (error) {
    dependencies.onStateChange({
      phase: 'assessment-error',
      error: toErrorMessage(error, 'Unable to assess and save your starting point.'),
    });
    return;
  }

  await refreshAfterSavedDietIntakePlacement(dependencies);
}

export async function retryDietIntakeRefresh(
  dependencies: Omit<DietIntakePlacementDependencies, 'submitPlacement'>,
): Promise<void> {
  await refreshAfterSavedDietIntakePlacement(dependencies);
}

async function refreshAfterSavedDietIntakePlacement(
  dependencies: Omit<DietIntakePlacementDependencies, 'submitPlacement'>,
): Promise<void> {
  dependencies.onStateChange({ phase: 'refreshing', error: null });
  dependencies.invalidateSessionPrefetch();
  try {
    await dependencies.reloadDashboard();
    await dependencies.refreshSessionPrefetch();
    dependencies.onStateChange(INITIAL_DIET_INTAKE_SUBMISSION_STATE);
  } catch (error) {
    dependencies.onStateChange({
      phase: 'refresh-error',
      error: `Your starting point was saved, but the next session could not be refreshed. ${toErrorMessage(error, 'Please retry the session refresh.')}`,
    });
  }
}

function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}
