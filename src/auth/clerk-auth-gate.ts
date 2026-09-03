export type ClerkAuthGatePhase = 'app' | 'loading' | 'sign-in';

export function resolveClerkAuthGatePhase(input: {
  enabled: boolean;
  clerkReady: boolean;
  signedIn: boolean;
  error: string | null;
}): ClerkAuthGatePhase {
  if (!input.enabled || input.signedIn) return 'app';
  if (!input.clerkReady && !input.error) return 'loading';
  return 'sign-in';
}
