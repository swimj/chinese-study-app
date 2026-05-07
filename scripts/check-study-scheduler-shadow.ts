import {
  getWordSkillStates,
  validateReviewItemStudySchedulerShadow,
} from '../server/db.ts';

const mismatches = validateReviewItemStudySchedulerShadow();
const skillStates = getWordSkillStates();

if (mismatches.length === 0) {
  console.log(`Study scheduler shadow OK: ${skillStates.length} word-skill rows mirror legacy review items.`);
} else {
  console.log(`Study scheduler shadow mismatch count: ${mismatches.length}`);
  for (const mismatch of mismatches) {
    console.log(
      [
        `reviewItemId=${mismatch.reviewItemId}`,
        `wordId=${mismatch.wordId}`,
        `direction=${mismatch.direction}`,
        `skillId=${mismatch.skillId}`,
        `problem=${JSON.stringify(mismatch.problem)}`,
      ].join(' '),
    );
  }
  process.exitCode = 1;
}
