import path from 'node:path';

type AppMode = 'dev' | 'study';

type AppConfig = {
  mode: AppMode;
  dataDir: string;
  dbPath: string;
  port: number;
  seedSampleData: boolean;
  seedDataPath: string;
};

type AppConfigOptions = {
  modeOverride?: AppMode;
};

export type { AppConfig, AppMode };

export function getAppConfig(options: AppConfigOptions = {}): AppConfig {
  const args = new Map(process.argv.slice(2).map(parseArg).filter((entry): entry is [string, string] => entry !== null));

  const mode = options.modeOverride ?? parseMode(args.get('mode') ?? process.env.APP_MODE ?? 'dev');
  const rawDataDir = args.get('data-dir') ?? process.env.APP_DATA_DIR;
  const rawSeedDataPath = args.get('seed-data') ?? process.env.APP_SEED_DATA_PATH;
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

  const dataDir = path.resolve(rawDataDir ?? path.join(process.cwd(), 'data'));

  return {
    mode,
    dataDir,
    dbPath: path.join(dataDir, 'app.db'),
    port,
    seedSampleData: mode === 'dev',
    seedDataPath: path.resolve(rawSeedDataPath ?? path.join(dataDir, 'app.json')),
  };
}

function parseMode(value: string): AppMode {
  if (value === 'dev' || value === 'study') {
    return value;
  }

  throw new Error(`Invalid mode: ${value}. Expected "dev" or "study".`);
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
