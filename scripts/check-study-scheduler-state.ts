import {
  getWordSkillStates,
  validateStudySchedulerStateInvariants,
} from '../server/db.ts';

const violations = validateStudySchedulerStateInvariants();
const skillStates = getWordSkillStates();

if (violations.length === 0) {
  console.log(`Study scheduler state OK: ${skillStates.length} word-skill rows validated.`);
} else {
  console.log(`Study scheduler state invariant violation count: ${violations.length}`);
  for (const violation of violations) {
    console.log(
      [
        `wordId=${violation.wordId}`,
        `skillId=${violation.skillId ?? 'word'}`,
        `problem=${JSON.stringify(violation.problem)}`,
      ].join(' '),
    );
  }
  process.exitCode = 1;
}
