import { initDbConnection } from './db/connection.ts';
import { installLearnerContextSqlFunction } from './db/learner-context.ts';
import { initializeDatabase } from './db/schema.ts';

initDbConnection();
installLearnerContextSqlFunction();
initializeDatabase();

export * from './db/index.ts';
export type { ReviewAttemptCommitIntent } from './db/types.ts';
