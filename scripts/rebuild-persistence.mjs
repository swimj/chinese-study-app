/**
 * Regenerate server/db/persistence.ts and server/db/types.ts from the monolithic server/db.ts.
 *
 * Usage (from repo root):
 *   node scripts/rebuild-persistence.mjs
 *   node scripts/rebuild-persistence.mjs --source=server/db.ts
 */
import fs from 'node:fs';

const sourcePath = process.argv.find((arg) => arg.startsWith('--source='))?.split('=')[1] ?? 'server/db.ts';
const lines = fs.readFileSync(sourcePath, 'utf8').split('\n');

const initLineIndex = lines.findIndex((line) => line.startsWith('function initializeDatabase()'));
if (initLineIndex < 0) {
  throw new Error(`initializeDatabase() not found in ${sourcePath}`);
}

const typesBody = lines
  .slice(35, 538)
  .join('\n')
  .replace(/^type /gm, 'export type ');

const typeExports = lines.slice(554, 588).join('\n');

let body = lines.slice(590).join('\n');
body = body
  .replace(/(?<!\.)\bdb\b/g, 'getDb()')
  .replace(/\bdb\s*=\s*openDatabase\(([^)]+)\)/g, 'setDb(openDatabase($1))')
  .replace(/\nfunction openDatabase\(targetPath: string\) \{[\s\S]*?\n\}\n/m, '\n')
  .replace(/^function initializeDatabase\(\)/m, 'export function initializeDatabase()');

const domainImports = `import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type {
  ContrastCluster,
  ContrastClusterMember,
  ContrastSelectionContent,
  ContrastSelectionCommitIntent,
  ContrastPrompt,
  ReviewCommitFields,
  SessionStudyItem,
  SessionStudyItemBuckets,
  StudyAttemptEvent,
  StudyAttemptOutcome,
  StudyActionKind,
  StudyContentRef,
  StudyEvent,
  StudyEventType,
  StudyManagementActionKind,
  StudySessionRecord,
  WordSkillRelevanceState,
} from '../../src/domain/study-actions.ts';
import { buildReviewSessionStudyItem, deriveReviewCommitFieldsFromAttemptEvents } from '../../src/domain/study-actions.ts';
import { config, getDb, dbPath, seedDataPath, dbExistedOnStartup, openDatabase, setDb } from './connection.ts';
import {
  DAILY_NEW_WORD_LIMIT,
  PRIORITY_BUMP_UNIT,
  UNSTUDIED_COUNT_BASELINE,
  PRIORITY_MAX_BASELINE,
  INITIAL_REVIEW_EASE_FACTOR,
  INITIAL_CONTEXTUAL_SELECTION_INTERVAL_HOURS,
  PRIORITY_TIER_TOP,
  PRIORITY_TIER_REGULAR,
  PRIORITY_TIER_SUNK,
  REVIEW_PHASE_RECENCY_GUARD_HOURS,
  REVIEW_SKILL_URGENCY_TIE_EPSILON,
} from './types.ts';
`;

const typesHeader = `import type {
  ContrastCluster,
  ContrastClusterMember,
  ContrastPrompt,
  SessionStudyItemBuckets,
  StudyActionKind,
  StudyManagementActionKind,
  StudySessionRecord,
  WordSkillRelevanceState,
} from '../../src/domain/study-actions.ts';

`;

fs.mkdirSync('server/db', { recursive: true });

fs.writeFileSync(
  'server/db/types.ts',
  `${typesHeader}${typesBody}

export const DAILY_NEW_WORD_LIMIT = 10;
export const PRIORITY_BUMP_UNIT = 12248;
export const UNSTUDIED_COUNT_BASELINE = 116000;
export const PRIORITY_MAX_BASELINE = PRIORITY_BUMP_UNIT * 10;
export const INITIAL_REVIEW_EASE_FACTOR = 2.5;
export const INITIAL_CONTEXTUAL_SELECTION_INTERVAL_HOURS = 6;
export const PRIORITY_TIER_TOP = 1;
export const PRIORITY_TIER_REGULAR = 0;
export const PRIORITY_TIER_SUNK = -1;
export const REVIEW_PHASE_RECENCY_GUARD_HOURS = 6;
export const REVIEW_SKILL_URGENCY_TIE_EPSILON = 0.000001;

${typeExports}
`,
);

fs.writeFileSync('server/db/persistence.ts', `${domainImports}\n${body}`);

fs.writeFileSync(
  'server/db/schema.ts',
  `export { applyProductionContrastExerciseSeed, initializeDatabase } from './persistence.ts';
`,
);

console.log(`Rebuilt from ${sourcePath}: types + persistence (${body.split('\n').length} lines)`);
