import { initDbConnection } from './db/connection.ts';
import { initializeDatabase } from './db/schema.ts';

initDbConnection();
initializeDatabase();

export * from './db/index.ts';
export type { ReviewAttemptCommitIntent } from './db/types.ts';
