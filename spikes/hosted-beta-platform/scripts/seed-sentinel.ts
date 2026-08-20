import { getDefaultSpikeDbPath, openSpikeDatabase } from '../src/database.ts';
import { readArgument } from './cli.ts';

const database = openSpikeDatabase(getDefaultSpikeDbPath());
try {
  const sentinel = database.createSentinel(readArgument('sentinel-id') ?? undefined);
  console.log(JSON.stringify({ status: 'created', ...sentinel }));
} finally {
  database.close();
}
