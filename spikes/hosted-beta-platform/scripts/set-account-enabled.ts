import { getDefaultSpikeDbPath, openSpikeDatabase } from '../src/database.ts';
import { parseBooleanArgument, readArgument } from './cli.ts';

const enabled = parseBooleanArgument('enabled');
const database = openSpikeDatabase(getDefaultSpikeDbPath());
try {
  const requestedProviderSubject = readArgument('provider-subject');
  const providerSubject = requestedProviderSubject ?? readSoleProviderSubject();
  const account = database.setAccountEnabled(providerSubject, enabled);
  console.log(JSON.stringify({
    status: 'updated',
    localAccountId: account.localAccountId,
    enabled: account.enabled,
  }));
} finally {
  database.close();
}

function readSoleProviderSubject(): string {
  const rows = database.db.prepare('SELECT provider_subject FROM spike_accounts ORDER BY local_account_id LIMIT 2').all() as
    Array<{ provider_subject: string }>;
  if (rows.length !== 1) throw new Error('Expected exactly one local spike account.');
  return rows[0].provider_subject;
}
