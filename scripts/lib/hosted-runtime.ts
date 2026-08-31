import path from 'node:path';

export function readStrictArguments(allowedKeys: readonly string[]): Map<string, string> {
  const allowed = new Set(allowedKeys);
  const args = new Map<string, string>();
  for (const argument of process.argv.slice(2)) {
    if (!argument.startsWith('--') || !argument.includes('=')) {
      throw new Error(`Expected --key=value argument, received "${argument}".`);
    }
    const [rawKey, ...rest] = argument.slice(2).split('=');
    const key = rawKey.trim();
    if (!allowed.has(key)) throw new Error(`Unsupported argument --${key}.`);
    if (args.has(key)) throw new Error(`Duplicate argument --${key}.`);
    args.set(key, rest.join('='));
  }
  return args;
}

export function configureHostedDatabase(args: Map<string, string>): string {
  const rawDataDir = requireArgument(args, 'data-dir');
  if (!path.isAbsolute(rawDataDir)) throw new Error('--data-dir must be an absolute path.');
  const dataDir = path.resolve(rawDataDir);
  process.env.APP_MODE = 'study';
  process.env.APP_AUTH_MODE = 'clerk';
  process.env.APP_DATA_DIR = dataDir;
  delete process.env.APP_LEARNER_ID;
  delete process.env.APP_SEED_DATA_PATH;
  return dataDir;
}

export function requireArgument(args: Map<string, string>, key: string): string {
  const value = args.get(key)?.trim();
  if (!value) throw new Error(`Missing required --${key}=... argument.`);
  return value;
}

export function readBooleanArgument(args: Map<string, string>, key: string): boolean {
  const value = requireArgument(args, key);
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`--${key} must be true or false.`);
}

export function readNonNegativeIntegerArgument(
  args: Map<string, string>,
  key: string,
  defaultValue: number,
): number {
  const raw = args.get(key);
  if (raw === undefined) return defaultValue;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`--${key} must be a non-negative integer.`);
  return value;
}
