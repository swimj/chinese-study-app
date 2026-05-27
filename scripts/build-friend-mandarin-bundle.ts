import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import packageJson from '../package.json' with { type: 'json' };

type Options = {
  outputPath: string;
};

const repoRoot = process.cwd();
const appDirName = `chinese-study-app-mandarin-alpha-${packageJson.version}`;
const options = parseOptions(process.argv.slice(2));
const stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-study-app-friend-bundle-'));
const stageAppDir = path.join(stageRoot, appDirName);
const friendDbPath = path.resolve(repoRoot, 'data/friend-mandarin-user-data/app.db');

if (!fs.existsSync(friendDbPath)) {
  throw new Error(
    `Friend Mandarin database not found at ${friendDbPath}. Run "npm run friend:mandarin:setup-db" first.`,
  );
}

fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
fs.cpSync(repoRoot, stageAppDir, {
  recursive: true,
  filter: shouldIncludeInBundle,
});

if (fs.existsSync(options.outputPath)) {
  fs.rmSync(options.outputPath);
}

createZip(stageRoot, appDirName, options.outputPath);
fs.rmSync(stageRoot, { recursive: true, force: true });

console.log(
  JSON.stringify(
    {
      outputPath: options.outputPath,
      appDirName,
      includedDatabase: path.relative(repoRoot, friendDbPath),
    },
    null,
    2,
  ),
);

function parseOptions(args: string[]): Options {
  let outputPath = path.join(
    repoRoot,
    'friend-bundles',
    `${appDirName}.zip`,
  );

  for (const arg of args) {
    if (arg.startsWith('--output=')) {
      outputPath = path.resolve(arg.slice('--output='.length));
    } else {
      throw new Error(`Unknown argument "${arg}". Expected --output=PATH.`);
    }
  }

  return {
    outputPath,
  };
}

function shouldIncludeInBundle(sourcePath: string): boolean {
  const relativePath = toPosixPath(path.relative(repoRoot, sourcePath));

  if (relativePath === '') {
    return true;
  }

  if (relativePath === '.git' || relativePath.startsWith('.git/')) {
    return false;
  }

  if (path.basename(sourcePath) === '.DS_Store') {
    return false;
  }

  if (relativePath === 'node_modules' || relativePath.startsWith('node_modules/')) {
    return false;
  }

  if (relativePath === 'dist' || relativePath.startsWith('dist/')) {
    return false;
  }

  if (relativePath === 'friend-bundles' || relativePath.startsWith('friend-bundles/')) {
    return false;
  }

  if (relativePath === 'tmp' || relativePath.startsWith('tmp/')) {
    return false;
  }

  if (relativePath === 'data') {
    return true;
  }

  if (relativePath.startsWith('data/')) {
    return relativePath === 'data/friend-mandarin-user-data'
      || relativePath === 'data/friend-mandarin-user-data/app.db';
  }

  return true;
}

function createZip(sourceDir: string, appDirectoryName: string, outputPath: string) {
  if (process.platform === 'win32') {
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        'Compress-Archive',
        '-Path',
        appDirectoryName,
        '-DestinationPath',
        outputPath,
        '-Force',
      ],
      {
        cwd: sourceDir,
        stdio: 'inherit',
      },
    );
    assertCommandSucceeded(result.status, 'PowerShell Compress-Archive');
    return;
  }

  const dittoResult = spawnSync(
    'ditto',
    ['-c', '-k', '--sequesterRsrc', '--keepParent', appDirectoryName, outputPath],
    {
      cwd: sourceDir,
      stdio: 'inherit',
    },
  );

  if (dittoResult.status === 0) {
    return;
  }

  const zipResult = spawnSync(
    'zip',
    ['-qr', outputPath, appDirectoryName],
    {
      cwd: sourceDir,
      stdio: 'inherit',
    },
  );
  assertCommandSucceeded(zipResult.status, 'zip');
}

function assertCommandSucceeded(status: number | null, commandName: string) {
  if (status !== 0) {
    throw new Error(`${commandName} failed while creating the friend bundle.`);
  }
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}
