import fs from 'node:fs';
import { getAppConfig } from './config.ts';

const config = getAppConfig({ modeOverride: 'dev' });

if (fs.existsSync(config.dbPath)) {
  fs.rmSync(config.dbPath);
  console.log(`Deleted dev database at ${config.dbPath}`);
} else {
  console.log(`No dev database found at ${config.dbPath}`);
}

const { applyProductionContrastExerciseSeed } = await import('./db.ts');
applyProductionContrastExerciseSeed();
console.log(`Rebuilt dev database at ${config.dbPath}`);

if (config.studyProfile === 'mandarin') {
  console.log('Applied production contrast exercise seed data.');
}
