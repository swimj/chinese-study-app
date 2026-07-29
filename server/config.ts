import path from 'node:path';

type AppMode = 'dev' | 'study';
type StudyProfile = 'mandarin' | 'french';

type AppConfig = {
  mode: AppMode;
  studyProfile: StudyProfile;
  dataDir: string;
  dbPath: string;
  port: number;
  seedSampleData: boolean;
  seedDataPath: string;
  includeDevContrastSeed: boolean;
};

type AppConfigOptions = {
  modeOverride?: AppMode;
};

export type { AppConfig, AppMode, StudyProfile };

export function getAppConfig(options: AppConfigOptions = {}): AppConfig {
  const args = new Map(process.argv.slice(2).map(parseArg).filter((entry): entry is [string, string] => entry !== null));

  const mode = options.modeOverride ?? parseMode(args.get('mode') ?? process.env.APP_MODE ?? 'dev');
  const studyProfile = parseStudyProfile(args.get('study-profile') ?? process.env.APP_STUDY_PROFILE ?? 'mandarin');
  const rawDataDir = args.get('data-dir') ?? process.env.APP_DATA_DIR;
  const rawSeedDataPath = args.get('seed-data') ?? process.env.APP_SEED_DATA_PATH;
  const includeDevContrastSeed = parseBoolean(
    args.get('include-dev-contrast-seed') ?? process.env.APP_INCLUDE_DEV_CONTRAST_SEED ?? 'true',
    'include dev contrast seed',
  );
  const rawPort = args.get('port') ?? process.env.PORT ?? '5174';
  const port = Number(rawPort);

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid port: ${rawPort}`);
  }

  if (mode === 'study' && !rawDataDir) {
    throw new Error(
      'Study mode requires an explicit data directory. Pass --data-dir=/absolute/path or set APP_DATA_DIR.',
    );
  }

  if (mode === 'dev' && !rawSeedDataPath) {
    throw new Error(
      [
        'Dev mode requires an explicit seed data file. Pass --seed-data=/path/to/seed.json or set APP_SEED_DATA_PATH.',
        'For default mandarin dev behavior use: npm run dev:backend.',
        'For default french dev behavior use: npm run dev:french:backend.',
        'To reset the mandarin dev database use: npm run reset:dev-data.',
      ].join(' '),
    );
  }

  const dataDir = path.resolve(rawDataDir ?? path.join(process.cwd(), 'data'));

  return {
    mode,
    studyProfile,
    dataDir,
    dbPath: path.join(dataDir, 'app.db'),
    port,
    seedSampleData: mode === 'dev',
    seedDataPath: rawSeedDataPath ? path.resolve(rawSeedDataPath) : '',
    includeDevContrastSeed,
  };
}

function parseMode(value: string): AppMode {
  if (value === 'dev' || value === 'study') {
    return value;
  }

  throw new Error(`Invalid mode: ${value}. Expected "dev" or "study".`);
}

function parseStudyProfile(value: string): StudyProfile {
  if (value === 'mandarin' || value === 'french') {
    return value;
  }

  throw new Error(`Invalid study profile: ${value}. Expected "mandarin" or "french".`);
}

function parseBoolean(value: string, label: string): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Invalid ${label}: ${value}. Expected "true" or "false".`);
}

function parseArg(argument: string): [string, string] | null {
  if (!argument.startsWith('--')) {
    return null;
  }

  const [key, ...rest] = argument.slice(2).split('=');
  if (!key || rest.length === 0) {
    return null;
  }

  return [key, rest.join('=')];
}
