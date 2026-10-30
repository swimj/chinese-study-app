import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { setDb } from '../server/db/connection.ts';
import { assertSchemaCurrent } from '../server/db/migrations.ts';
import { initializeDefaultUsefulBatch } from '../server/vocabulary/default-useful-selection.ts';
const args=process.argv.slice(2),allowed=new Set(['--database','--after','--limit','--apply','--include-model-selection']);
const values=new Map<string,string>();const flags=new Set<string>();
for(let i=0;i<args.length;i++){const name=args[i]!;if(!allowed.has(name)||values.has(name)||flags.has(name))throw new Error(`Unknown or repeated argument: ${name}`);if(name==='--apply'||name==='--include-model-selection')flags.add(name);else {const value=args[++i];if(!value||value.startsWith('--'))throw new Error(`Missing value for ${name}`);values.set(name,value);}}
const file=values.get('--database');if(!file)throw new Error('An explicit --database path is required. Dry-run is the default.');
if(flags.has('--include-model-selection')&&!flags.has('--apply'))throw new Error('--include-model-selection requires --apply');
const databasePath=path.resolve(file),db=new DatabaseSync(databasePath,{readOnly:!flags.has('--apply')});db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');setDb(db);
try{assertSchemaCurrent(db);const report=await initializeDefaultUsefulBatch({apply:flags.has('--apply'),includeModelSelection:flags.has('--include-model-selection'),afterWordId:values.get('--after'),limit:values.has('--limit')?Number(values.get('--limit')):100});console.log(JSON.stringify({databasePath,mode:flags.has('--apply')?'apply':'dry_run',...report},null,2));}
finally{setDb(null);db.close();}
