import { getDefaultSpikeDbPath, openSpikeDatabase } from '../src/database.ts';
import { parseBooleanArgument } from './cli.ts';

const enabled = parseBooleanArgument('enabled');
const database = openSpikeDatabase(getDefaultSpikeDbPath());
try {
  database.setMaintenanceMode(enabled);
  console.log(JSON.stringify({ status: 'updated', maintenanceMode: database.isMaintenanceMode() }));
} finally {
  database.close();
}
