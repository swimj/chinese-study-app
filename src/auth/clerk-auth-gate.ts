export type ClerkAuthGatePhase = 'app' | 'loading' | 'sign-in' | 'sign-up';
export type ClerkAuthMountedComponent = 'sign-in' | 'sign-up';

export const CLERK_INVITATION_TICKET_PARAM = '__clerk_ticket';

export function hasClerkInvitationTicket(location: { search: string; hash?: string }): boolean {
  if (new URLSearchParams(location.search).has(CLERK_INVITATION_TICKET_PARAM)) return true;
  const hash = location.hash ?? '';
  const query = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : hash.replace(/^#/, '');
  return new URLSearchParams(query).has(CLERK_INVITATION_TICKET_PARAM);
}

export function resolveClerkAuthMountedComponent(invitationTicket: boolean): ClerkAuthMountedComponent {
  return invitationTicket ? 'sign-up' : 'sign-in';
}

export function resolveClerkAuthGatePhase(input: {
  enabled: boolean;
  clerkReady: boolean;
  signedIn: boolean;
  error: string | null;
  invitationTicket?: boolean;
}): ClerkAuthGatePhase {
  if (!input.enabled || input.signedIn) return 'app';
  if (!input.clerkReady && !input.error) return 'loading';
  if (input.invitationTicket) return 'sign-up';
  return 'sign-in';
}
