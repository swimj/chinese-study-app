import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Operator jump for the diet profile (SPECS/diet-deck-distribution.md §2.3):
 * set a learner's deck weights to 100% on a chosen deck with provenance actor
 * 'operator'. There is deliberately no HTTP endpoint for jumps — no role
 * system exists, and concierge correction runs where the operator already
 * has database access.
 *
 * Usage:
 *   node --import tsx scripts/set-diet-deck.ts \
 *     --data-dir=/absolute/path --learner-id=<stable-id> --deck=<deckId> [--note=<note>]
 */

const args = new Map(process.argv.slice(2).map(parseArg).filter((entry): entry is [string, string] => entry !== null));
const dataDir = args.get('data-dir');
const learnerId = args.get('learner-id');
const deckId = args.get('deck');
const note = args.get('note') ?? null;

if (!dataDir) throw new Error('Expected --data-dir=/absolute/path');
if (!learnerId || learnerId.trim().length === 0) throw new Error('Expected --learner-id=<stable-id>');
if (!deckId || deckId.trim().length === 0) throw new Error('Expected --deck=<deckId>');

process.env.APP_MODE = 'study';
process.env.APP_AUTH_MODE = 'trusted_local';
process.env.APP_DATA_DIR = path.resolve(dataDir);
process.env.APP_LEARNER_ID = learnerId;

const dbModuleUrl = `${pathToFileURL(path.resolve('server/db.ts')).href}?set-diet-deck=${Date.now()}`;
const db = await import(dbModuleUrl);
const profile = db.runWithLearnerId(learnerId, () => db.setOperatorDietDeck(deckId, note));

process.stdout.write(`${JSON.stringify({ learnerId, profile }, null, 2)}\n`);

function parseArg(argument: string): [string, string] | null {
  if (!argument.startsWith('--')) return null;
  const [key, ...rest] = argument.slice(2).split('=');
  if (!key || rest.length === 0) return null;
  return [key, rest.join('=')];
}
