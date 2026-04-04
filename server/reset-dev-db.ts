import fs from 'node:fs';
import { getAppConfig } from './config.ts';

const config = getAppConfig({ modeOverride: 'dev' });

if (fs.existsSync(config.dbPath)) {
  fs.rmSync(config.dbPath);
  console.log(`Deleted dev database at ${config.dbPath}`);
} else {
  console.log(`No dev database found at ${config.dbPath}`);
}
