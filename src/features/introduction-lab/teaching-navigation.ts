import { introductionPlayerKeyAction, type IntroductionPlayerState } from './player';

/** Browsing is presentation state only: returning to the current beat never reveals another. */
export function teachingNavigationKeyAction(
  event: Parameters<typeof introductionPlayerKeyAction>[0],
  phase: IntroductionPlayerState['phase'],
  browsing: boolean,
) {
  const action = introductionPlayerKeyAction(event, phase);
  if (browsing && phase === 'introduction' && action?.type === 'advance') {
    return { type: 'focus-current' } as const;
  }
  return action;
}
