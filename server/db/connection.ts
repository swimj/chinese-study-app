import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { AppConfig } from '../config.ts';
import { getAppConfig } from '../config.ts';

let configCache: AppConfig | null = null;
let dbInstance: DatabaseSync | null = null;

export let dbPath = '';
export let seedDataPath = '';
export let dbExistedOnStartup = false;

export function getConfig(): AppConfig {
  return configCache ?? getAppConfig();
}

/** Resolved on each `initDbConnection()` from current env/argv. */
export const config: AppConfig = new Proxy({} as AppConfig, {
  get(_target, prop) {
    return getConfig()[prop as keyof AppConfig];
  },
});

export function openDatabase(targetPath: string): DatabaseSync {
  const database = new DatabaseSync(targetPath);
  database.exec('PRAGMA foreign_keys = ON;');
  return database;
}

export function getDb(): DatabaseSync {
  if (!dbInstance) {
    throw new Error('Database not initialized');
  }
  return dbInstance;
}

export function setDb(database: DatabaseSync): void {
  dbInstance = database;
}

export function initDbConnection(): void {
  configCache = getAppConfig();
  dbPath = configCache.dbPath;
  seedDataPath = configCache.seedDataPath;
  dbExistedOnStartup = fs.existsSync(dbPath);

  if (!fs.existsSync(configCache.dataDir)) {
    fs.mkdirSync(configCache.dataDir, { recursive: true });
  }

  setDb(openDatabase(dbPath));
}
