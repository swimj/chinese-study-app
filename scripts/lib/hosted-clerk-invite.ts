export type HostedClerkInviteClient = {
  invitations: {
    createInvitation(params: {
      emailAddress: string;
      notify: boolean;
      redirectUrl: string;
    }): Promise<{ id: string }>;
  };
};

export type HostedClerkInviteResult = {
  status: 'ok';
  createdCount: 1;
};

export class HostedClerkInviteError extends Error {
  readonly safeCode: string;

  constructor(safeCode: string) {
    super(safeCode);
    this.safeCode = safeCode;
    this.name = 'HostedClerkInviteError';
  }
}

export async function inviteHostedLearner(options: {
  client: HostedClerkInviteClient;
  emailEnvName: string | null | undefined;
  environment?: NodeJS.ProcessEnv;
  redirectUrl?: string;
}): Promise<HostedClerkInviteResult> {
  const environment = options.environment ?? process.env;
  const emailAddress = readEmailFromNamedEnvironmentVariable(options.emailEnvName, environment);
  const redirectUrl = options.redirectUrl ?? readInviteRedirectUrl(environment);
  try {
    await options.client.invitations.createInvitation({
      emailAddress,
      notify: true,
      redirectUrl,
    });
  } catch (error) {
    if (error instanceof HostedClerkInviteError) throw error;
    throw new HostedClerkInviteError('CLERK_INVITE_FAILED');
  }
  return { status: 'ok', createdCount: 1 };
}

export function readEmailFromNamedEnvironmentVariable(
  emailEnvName: string | null | undefined,
  environment: NodeJS.ProcessEnv,
): string {
  if (!emailEnvName || !/^[A-Z][A-Z0-9_]{0,63}$/.test(emailEnvName)) {
    throw new HostedClerkInviteError('INVALID_EMAIL_ENV_NAME');
  }
  const emailAddress = environment[emailEnvName];
  if (!emailAddress || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress)) {
    throw new HostedClerkInviteError('EMAIL_ENV_VALUE_MISSING_OR_INVALID');
  }
  return emailAddress;
}

export function readInviteRedirectUrl(environment: NodeJS.ProcessEnv): string {
  const rawValue = environment.CLERK_AUTHORIZED_PARTY;
  if (!rawValue) throw new HostedClerkInviteError('CLERK_AUTHORIZED_PARTY_MISSING');
  let url: URL;
  try {
    url = new URL(rawValue);
  } catch {
    throw new HostedClerkInviteError('CLERK_AUTHORIZED_PARTY_INVALID');
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.origin !== rawValue.replace(/\/$/, '')) {
    throw new HostedClerkInviteError('CLERK_AUTHORIZED_PARTY_INVALID');
  }
  return url.origin;
}
