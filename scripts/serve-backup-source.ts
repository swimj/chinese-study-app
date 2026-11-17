import { startConfiguredBackupSource } from '../server/backups/source.ts';
const server = startConfiguredBackupSource();
if (!server) throw new Error('APP_BACKUP_SOURCE_TOKEN is required');
const stop = () => server.close();
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
