import { clerkClient } from '@clerk/express';
import { pathToFileURL } from 'node:url';
import { getDefaultSpikeDbPath, openSpikeDatabase, type SpikeDatabase } from '../src/database.ts';
import { readArgument } from './cli.ts';

export type ClerkAdminAction =
  | 'invite'
  | 'invite-and-revoke'
  | 'revoke-sessions'
  | 'ban-user'
  | 'unban-user';

type InvitationRecord = { id: string };
type SessionRecord = { id: string };

export type ClerkAdminClient = {
  invitations: {
    createInvitation(params: {
      emailAddress: string;
      notify: boolean;
      redirectUrl: string;
    }): Promise<InvitationRecord>;
    revokeInvitation(invitationId: string): Promise<unknown>;
  };
  sessions: {
    getSessionList(params: {
      userId: string;
      status: 'active';
      limit: number;
      offset: number;
    }): Promise<{ data: SessionRecord[]; totalCount: number }>;
    revokeSession(sessionId: string): Promise<unknown>;
  };
  users: {
    banUser(userId: string): Promise<unknown>;
    unbanUser(userId: string): Promise<unknown>;
  };
};

export type ClerkAdminResult = {
  action: ClerkAdminAction;
  status: 'ok';
  createdCount?: number;
  revokedCount?: number;
  affectedCount?: number;
};

export class ClerkAdminInputError extends Error {
  readonly safeCode: string;

  constructor(safeCode: string) {
    super(safeCode);
    this.safeCode = safeCode;
    this.name = 'ClerkAdminInputError';
  }
}

export async function executeClerkAdminAction(options: {
  action: ClerkAdminAction;
  client: ClerkAdminClient;
  database?: SpikeDatabase;
  emailEnvName?: string | null;
  environment?: NodeJS.ProcessEnv;
  redirectUrl?: string;
}): Promise<ClerkAdminResult> {
  const environment = options.environment ?? process.env;

  if (options.action === 'invite' || options.action === 'invite-and-revoke') {
    const emailAddress = readEmailFromNamedEnvironmentVariable(options.emailEnvName, environment);
    const redirectUrl = options.redirectUrl ?? readRedirectUrl(environment);
    const invitation = await options.client.invitations.createInvitation({
      emailAddress,
      notify: true,
      redirectUrl,
    });
    if (options.action === 'invite') {
      return { action: options.action, status: 'ok', createdCount: 1 };
    }
    await options.client.invitations.revokeInvitation(invitation.id);
    return { action: options.action, status: 'ok', createdCount: 1, revokedCount: 1 };
  }

  if (!options.database) throw new ClerkAdminInputError('DATABASE_REQUIRED');
  const providerSubject = readSoleProviderSubject(options.database);

  if (options.action === 'revoke-sessions') {
    const sessions = await listAllActiveSessions(options.client, providerSubject);
    for (const session of sessions) await options.client.sessions.revokeSession(session.id);
    return { action: options.action, status: 'ok', affectedCount: sessions.length };
  }

  if (options.action === 'ban-user') {
    await options.client.users.banUser(providerSubject);
    return { action: options.action, status: 'ok', affectedCount: 1 };
  }

  await options.client.users.unbanUser(providerSubject);
  return { action: options.action, status: 'ok', affectedCount: 1 };
}

export function parseClerkAdminAction(value: string | undefined): ClerkAdminAction {
  if (value === 'invite'
    || value === 'invite-and-revoke'
    || value === 'revoke-sessions'
    || value === 'ban-user'
    || value === 'unban-user') {
    return value;
  }
  throw new ClerkAdminInputError('INVALID_ACTION');
}

export function readSoleProviderSubject(database: SpikeDatabase): string {
  const rows = database.db.prepare('SELECT provider_subject FROM spike_accounts ORDER BY local_account_id LIMIT 2').all() as
    Array<{ provider_subject: string }>;
  if (rows.length !== 1) throw new ClerkAdminInputError('EXPECTED_EXACTLY_ONE_LOCAL_ACCOUNT');
  return rows[0].provider_subject;
}

async function listAllActiveSessions(client: ClerkAdminClient, userId: string): Promise<SessionRecord[]> {
  const sessions: SessionRecord[] = [];
  const limit = 100;
  while (true) {
    const page = await client.sessions.getSessionList({
      userId,
      status: 'active',
      limit,
      offset: sessions.length,
    });
    sessions.push(...page.data);
    if (page.data.length === 0 || sessions.length >= page.totalCount) return sessions;
  }
}

function readEmailFromNamedEnvironmentVariable(
  emailEnvName: string | null | undefined,
  environment: NodeJS.ProcessEnv,
): string {
  if (!emailEnvName || !/^[A-Z][A-Z0-9_]{0,63}$/.test(emailEnvName)) {
    throw new ClerkAdminInputError('INVALID_EMAIL_ENV_NAME');
  }
  const emailAddress = environment[emailEnvName];
  if (!emailAddress || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress)) {
    throw new ClerkAdminInputError('EMAIL_ENV_VALUE_MISSING_OR_INVALID');
  }
  return emailAddress;
}

function readRedirectUrl(environment: NodeJS.ProcessEnv): string {
  const rawValue = environment.CLERK_AUTHORIZED_PARTY;
  if (!rawValue) throw new ClerkAdminInputError('CLERK_AUTHORIZED_PARTY_MISSING');
  let url: URL;
  try {
    url = new URL(rawValue);
  } catch {
    throw new ClerkAdminInputError('CLERK_AUTHORIZED_PARTY_INVALID');
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.origin !== rawValue.replace(/\/$/, '')) {
    throw new ClerkAdminInputError('CLERK_AUTHORIZED_PARTY_INVALID');
  }
  return url.origin;
}

async function main(): Promise<void> {
  let action: ClerkAdminAction;
  try {
    action = parseClerkAdminAction(process.argv[2]);
  } catch (error) {
    reportFailure('unknown', error);
    return;
  }

  let database: SpikeDatabase | undefined;
  try {
    if (action === 'revoke-sessions' || action === 'ban-user' || action === 'unban-user') {
      database = openSpikeDatabase(getDefaultSpikeDbPath());
    }
    const result = await executeClerkAdminAction({
      action,
      client: clerkClient,
      database,
      emailEnvName: readArgument('email-env'),
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    reportFailure(action, error);
  } finally {
    database?.close();
  }
}

function reportFailure(action: ClerkAdminAction | 'unknown', error: unknown): void {
  const code = error instanceof ClerkAdminInputError ? error.safeCode : 'CLERK_ADMIN_FAILED';
  console.error(JSON.stringify({ action, status: 'failed', code }));
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
