import { DatabaseSync } from 'node:sqlite';
import { readStrictArguments } from './lib/hosted-runtime.ts';

const args=readStrictArguments(['database','limit']);
const database=args.get('database');
if(!database)throw new Error('Supply --database=/absolute/path/app.db');
const limit=Number(args.get('limit')??20);
if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error('Limit must be 1–100');
const db=new DatabaseSync(database,{readOnly:true});
try {
  const findings=db.prepare(`SELECT occurred_at AS observedAt,learner_id AS learnerId,entity_id AS wordId,
    json_extract(data_json,'$.readyAt') AS readyAt,json_extract(data_json,'$.addedAt') AS admittedAt,
    json_extract(data_json,'$.reason') AS reason
    FROM backend_events WHERE name='vocabulary.reserve.stale_hint'
    ORDER BY occurred_at DESC,event_id DESC LIMIT ?`).all(limit);
  console.log(JSON.stringify({findings},null,2));
} finally {db.close();}
