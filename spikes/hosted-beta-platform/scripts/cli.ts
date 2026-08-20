export function readArgument(name: string): string | null {
  const prefix = `--${name}=`;
  const argument = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : null;
}

export function requireArgument(name: string): string {
  const value = readArgument(name);
  if (!value) throw new Error(`Missing required --${name}=... argument.`);
  return value;
}

export function parseBooleanArgument(name: string): boolean {
  const value = requireArgument(name);
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Expected --${name}=true or --${name}=false.`);
}
