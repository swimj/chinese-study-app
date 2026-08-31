import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  configureHostedDatabase,
  readStrictArguments,
} from './lib/hosted-runtime.ts';
import { closeDbConnection } from '../server/db/connection.ts';

const args = readStrictArguments(['data-dir', 'artifact']);
configureHostedDatabase(args);
process.env.APP_STUDY_PROFILE = 'mandarin';

const defaultArtifactPath = fileURLToPath(
  new URL('../server/bootstrap/mandarin-hosted-v1.json', import.meta.url),
);
const artifactPath = path.resolve(args.get('artifact') ?? defaultArtifactPath);
if (!fs.existsSync(artifactPath)) {
  throw new Error(`Required shared Mandarin bootstrap artifact not found: ${artifactPath}`);
}

let artifact: unknown;
try {
  artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
} catch (error) {
  throw new Error(
    `Required shared Mandarin bootstrap artifact is not valid JSON: ${artifactPath}`,
    { cause: error },
  );
}

const dbModuleUrl = `${pathToFileURL(path.resolve('server/db.ts')).href}?hosted-mandarin-bootstrap=${Date.now()}`;
const db = await import(dbModuleUrl);
try {
  const result = db.importSharedMandarinBootstrap(artifact);
  process.stdout.write(`${JSON.stringify({ artifactPath, ...result }, null, 2)}\n`);
} finally {
  closeDbConnection();
}
