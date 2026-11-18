import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import { decodeInvocationPrompts, encodeInvocationPrompts } from './invocation-prompt-references.ts';

const catalog = new Set<string>(JSON.parse(fs.readFileSync(new URL('./invocation-prompt-catalog.json', import.meta.url), 'utf8')));
const gitArchive = fileURLToPath(new URL('../../artifacts/invocation-prompts/', import.meta.url));
let memoryArchive: string | undefined;

function localArchive(db: DatabaseSync): string {
  const main = db.prepare('SELECT file FROM pragma_database_list WHERE name = ?').get('main');
  if (!main) throw new Error('Cannot locate the invocation database');
  if (main.file) return path.join(path.dirname(String(main.file)), 'invocation-prompt-blobs');
  if (!memoryArchive) {
    memoryArchive = fs.mkdtempSync(path.join(os.tmpdir(), 'in-memory-invocation-prompts-'));
    const transient = memoryArchive;
    process.once('exit', () => fs.rmSync(transient, { recursive: true, force: true }));
  }
  return memoryArchive;
}

// Local experiments may supply arbitrary prompts. Publish complete files atomically
// so another writer can never observe a partial blob or overwrite a retained version.
function retainLocalBlob(directory: string, hash: string, text: string): void {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, hash + '.txt');
  const temp = file + '.' + randomUUID();
  const bytes = Buffer.from(text);
  try {
    fs.writeFileSync(temp, bytes, { flag: 'wx', mode: 0o600, flush: true });
    try { fs.linkSync(temp, file); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (!fs.readFileSync(file).equals(bytes)) throw new Error('Conflicting local invocation prompt blob: ' + hash);
    }
  } finally { fs.rmSync(temp, { force: true }); }
  const fd = fs.openSync(directory, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

export function retainInvocationPrompts(db: DatabaseSync, template: string | null, request: string | null) {
  const encoded = encodeInvocationPrompts(template, request);
  for (const [hash, text] of encoded.blobs) {
    if (catalog.has(hash)) continue;
    if (process.env.APP_DEPLOYMENT_TIER || process.env.FLY_APP_NAME) {
      throw new Error('Unregistered hosted invocation prompt ' + hash + '. Register the authored source in the Git prompt archive.');
    }
    retainLocalBlob(localArchive(db), hash, text);
  }
  return encoded;
}

/** Offline investigation. Hosted images carry the hash catalog, while investigators supply the Git archive. */
export function readInvocationPromptEvidence(db: DatabaseSync, id: string, archiveDir = gitArchive) {
  const row = db.prepare(`SELECT prompt_blob_hash,request_snapshot_json,request_prompt_refs_json
    FROM model_invocations WHERE id=?`).get(id) as {
      prompt_blob_hash: string | null; request_snapshot_json: string | null; request_prompt_refs_json: string | null;
    } | undefined;
  if (!row) throw new Error('Unknown model invocation');
  return decodeInvocationPrompts(row.prompt_blob_hash, row.request_snapshot_json, row.request_prompt_refs_json, hash => {
    const directory = catalog.has(hash) ? archiveDir : localArchive(db);
    return fs.readFileSync(path.join(directory, hash + '.txt'), 'utf8');
  });
}

/** Stage only affected rows. The existing ledger is still intact if archival or validation fails. */
export function stageInvocationPromptReferences(db: DatabaseSync): void {
  db.exec(`CREATE TEMP TABLE invocation_prompt_updates (
    id TEXT PRIMARY KEY, template_hash TEXT, request_json TEXT, references_json TEXT
  )`);
  const insert = db.prepare('INSERT INTO invocation_prompt_updates VALUES (?,?,?,?)');
  for (const row of db.prepare(`SELECT id,prompt_hash,CAST(prompt_template AS BLOB) AS template,request_snapshot_json
    FROM model_invocations WHERE prompt_template IS NOT NULL OR request_snapshot_json IS NOT NULL`).iterate()) {
    const bytes = row.template as Uint8Array | null;
    const template = bytes === null ? null : Buffer.from(bytes).toString('utf8');
    if (bytes !== null && !Buffer.from(template!).equals(bytes)) throw new Error('Invalid UTF-8 in historical invocation prompt');
    const encoded = retainInvocationPrompts(db, template, row.request_snapshot_json as string | null);
    if (encoded.templateHash !== null && row.prompt_hash !== null && encoded.templateHash !== row.prompt_hash) {
      throw new Error('Stored invocation prompt hash does not match its template');
    }
    if (encoded.templateHash !== null || encoded.referencesJson !== null) {
      insert.run(row.id, encoded.templateHash, encoded.requestJson, encoded.referencesJson);
    }
  }
}
