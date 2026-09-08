import { spawnSync } from 'node:child_process';

/** Build the frozen baseline without applying later migrations or seeding data. */
export function createBaselineFixture(dataDir: string): void {
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    const connection = await import('./server/db/connection.ts');
    const { installLearnerContextSqlFunction } = await import('./server/db/learner-context.ts');
    const { createBaselineSchema } = await import('./server/db/persistence.ts');
    const { migrateDatabase } = await import('./server/db/migrations.ts');
    connection.initDbConnection();
    installLearnerContextSqlFunction();
    createBaselineSchema();
    migrateDatabase(connection.getDb(), []);
    connection.closeDbConnection();
  `], {
    encoding: 'utf8',
    env: { ...process.env, APP_MODE: 'study', APP_AUTH_MODE: 'clerk', APP_DATA_DIR: dataDir },
  });
  if (result.status !== 0) throw new Error(`Baseline fixture failed: ${result.stderr}`);
}
