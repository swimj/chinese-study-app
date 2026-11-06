// The normal HTTP application and real approval worker, without provider runtimes.
import { createApp, startServer } from '../../server/index.ts';
import { getVocabularyApprovalRequests } from '../../server/vocabulary/approval-requests.ts';
import { getHostedServiceControls } from '../../server/db/hosted-operations.ts';
import { closeDbConnection } from '../../server/db/connection.ts';
if (getHostedServiceControls().providerWorkEnabled) throw new Error('Testbed requires provider work disabled');
const approvals = getVocabularyApprovalRequests();
approvals.wake();
startServer({app:createApp(),stopBackgroundWork:async()=>{approvals.stop();},closeDatabase:closeDbConnection});
