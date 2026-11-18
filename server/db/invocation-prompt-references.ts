import { createHash } from 'node:crypto';
import type { JsonValue } from '../llm/types.ts';

const schemaSuffix = '\n\nReturn exactly one JSON object matching the following JSON Schema. Do not add prose or Markdown outside the object.\n';

type JsonObject = { [key: string]: JsonValue };
const object = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function promptHash(text: string): string {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.toString('utf8') !== text) throw new Error('Cannot archive a prompt with invalid Unicode');
  return createHash('sha256').update(bytes).digest('hex');
}

/** This traversal order is part of the version 1 persisted format. Only authored instruction fields are eligible. */
function replaceInstructionText(request: JsonValue, replace: (text: string) => string): void {
  if (!object(request)) return;
  if (typeof request.instructions === 'string') request.instructions = replace(request.instructions);
  for (const field of ['messages', 'input']) {
    const messages = request[field];
    if (!Array.isArray(messages)) continue;
    for (const message of messages) {
      if (!object(message) || (message.role !== 'system' && message.role !== 'developer')) continue;
      if (typeof message.content === 'string') {
        message.content = replace(message.content);
      } else if (Array.isArray(message.content)) {
        for (const part of message.content) {
          if (object(part) && (part.type === 'text' || part.type === 'input_text') && typeof part.text === 'string') {
            part.text = replace(part.text);
          }
        }
      }
    }
  }
}

export function encodeInvocationPrompts(promptTemplate: string | null, requestJson: string | null) {
  const blobs = new Map<string, string>();
  function retain(text: string): string {
    const hash = promptHash(text);
    if (blobs.has(hash) && blobs.get(hash) !== text) throw new Error('Invocation prompt hash collision');
    blobs.set(hash, text);
    return hash;
  }
  const templateHash = promptTemplate === null ? null : retain(promptTemplate);
  const hashes: string[] = [];
  if (requestJson !== null) {
    const request: JsonValue = JSON.parse(requestJson);
    const canonical = JSON.stringify(request);
    replaceInstructionText(request, text => {
      // json_object adapters append the per-call output schema to the supplied system prompt.
      if (templateHash !== null && promptTemplate !== null && (text === promptTemplate || text.startsWith(promptTemplate + schemaSuffix))) {
        hashes.push(templateHash);
        return text.slice(promptTemplate.length);
      }
      hashes.push(retain(text));
      return '';
    });
    if (hashes.length > 0) {
      if (canonical !== requestJson) throw new Error('Cannot transform a noncanonical invocation request losslessly');
      requestJson = JSON.stringify(request);
    }
  }
  // Separate metadata allows the provider to use arbitrary strings and objects, including reference lookalikes.
  const referencesJson = hashes.length > 0 ? JSON.stringify({ version: 1, hashes }) : null;
  return { templateHash, requestJson, referencesJson, blobs };
}

export function decodeInvocationPrompts(templateHash: string | null, requestJson: string | null,
  referencesJson: string | null, resolve: (hash: string) => string): { promptTemplate: string | null; requestJson: string | null } {
  function read(hash: string): string {
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('Invalid invocation prompt hash');
    const text = resolve(hash);
    if (typeof text !== 'string' || promptHash(text) !== hash) throw new Error('Missing or corrupted invocation prompt blob');
    return text;
  }
  const promptTemplate = templateHash === null ? null : read(templateHash);
  if (referencesJson !== null) {
    const references: JsonValue = JSON.parse(referencesJson);
    if (!object(references) || references.version !== 1 || !Array.isArray(references.hashes) || !references.hashes.length || requestJson === null) {
      throw new Error('Invalid invocation request prompt references');
    }
    const hashes = references.hashes;
    let index = 0;
    const request: JsonValue = JSON.parse(requestJson);
    replaceInstructionText(request, suffix => {
      const hash = hashes[index++];
      if (typeof hash !== 'string') throw new Error('Missing invocation request prompt reference');
      return read(hash) + suffix;
    });
    if (index !== hashes.length) throw new Error('Unused invocation request prompt reference');
    requestJson = JSON.stringify(request);
  }
  return { promptTemplate, requestJson };
}
