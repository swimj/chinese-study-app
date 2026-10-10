import fs from 'node:fs';
import path from 'node:path';
import { readStrictArguments, requireArgument } from './lib/hosted-runtime.ts';
import { buildUiAnnotationSeed } from '../server/seeds/ui-annotation-data.ts';

const args = readStrictArguments(['data-dir']);
const dataDir = path.resolve(requireArgument(args, 'data-dir'));
// Claim a NEW directory before any database module is loaded. Never reset or
// augment an unknown database, including one selected by inherited env vars.
fs.mkdirSync(path.dirname(dataDir), { recursive: true });
fs.mkdirSync(dataDir);
const now = new Date();
const seedPath = path.join(dataDir, 'annotation-seed.json');
fs.writeFileSync(seedPath, JSON.stringify(buildUiAnnotationSeed(now), null, 2));
Object.assign(process.env, {
  APP_MODE: 'dev', APP_AUTH_MODE: 'trusted_local', APP_STUDY_PROFILE: 'mandarin',
  APP_LEARNER_ID: 'dev-learner', APP_DATA_DIR: dataDir, APP_SEED_DATA_PATH: seedPath,
  APP_INCLUDE_DEV_CONTRAST_SEED: 'true',
});
const { closeDbConnection } = await import('../server/db/connection.ts');
try {
  const { prepareUiAnnotationFixtures } = await import('../server/seeds/ui-annotations.ts');
  const manifest = prepareUiAnnotationFixtures(now);
  fs.writeFileSync(path.join(dataDir, 'fixture-manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ dataDir, ...manifest }, null, 2));
  console.log('Start this fixture with:');
  const quotedDataDir = "'" + dataDir.replaceAll("'", "'\\''") + "'";
  console.log(`npm run dev:backend -- --data-dir=${quotedDataDir} --auth-mode=trusted_local --study-profile=mandarin --learner-id=dev-learner`);
  console.log('npm run dev:frontend');
} finally {
  closeDbConnection();
}
