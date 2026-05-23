import {
  dbConfig,
  getContrastCandidateIntake,
  getStudyContentFeedback,
  getWords,
  getWordSkillRelevanceRows,
} from '../server/db.ts';

const wordsById = new Map(getWords().map((word) => [word.id, word]));
const relevanceRows = getWordSkillRelevanceRows();
const contrastCandidates = getContrastCandidateIntake();
const contentFeedback = getStudyContentFeedback();

console.log(`Study management state for ${dbConfig.dbPath}`);
console.log(`Word-skill relevance rows: ${relevanceRows.length}`);

for (const row of relevanceRows) {
  const word = wordsById.get(row.wordId);
  const label = word ? `${word.hanzi} [${row.wordId}]` : `[missing word ${row.wordId}]`;
  const source = row.sourceEventId ? ` sourceEvent=${row.sourceEventId}` : '';
  console.log(`  - ${row.updatedAt} ${label} ${row.skillId}=${row.relevanceState}${source}`);
}

console.log(`Contrast candidate intake rows: ${contrastCandidates.length}`);

for (const candidate of contrastCandidates) {
  const target = wordsById.get(candidate.targetWordId);
  const targetLabel = target ? `${target.hanzi} [${candidate.targetWordId}]` : `[missing word ${candidate.targetWordId}]`;
  const matched = candidate.matchedWordId ? ` matched=${candidate.matchedWordId}` : ' matched=none';
  const candidateText = candidate.candidateText ? ` candidate=${JSON.stringify(candidate.candidateText)}` : '';
  const source = candidate.sourceEventId ? ` sourceEvent=${candidate.sourceEventId}` : '';
  const note = candidate.note.length > 0 ? ` note=${JSON.stringify(candidate.note)}` : '';
  console.log(
    `  - ${candidate.createdAt} target=${targetLabel}${candidateText}${matched} status=${candidate.status}${source}${note}`,
  );
}

console.log(`Content feedback rows: ${contentFeedback.length}`);

for (const feedback of contentFeedback) {
  const word = wordsById.get(feedback.targetWordId);
  const wordLabel = word ? `${word.hanzi} [${feedback.targetWordId}]` : `[missing word ${feedback.targetWordId}]`;
  const source = feedback.sourceEventId ? ` sourceEvent=${feedback.sourceEventId}` : '';
  const note = feedback.note.length > 0 ? ` note=${JSON.stringify(feedback.note)}` : '';
  console.log(
    `  - ${feedback.createdAt} target=${wordLabel} action=${feedback.actionKind} ${feedback.targetType}=${feedback.targetId}${source}${note}`,
  );
}

if (relevanceRows.length === 0 && contrastCandidates.length === 0 && contentFeedback.length === 0) {
  console.log('No persisted study management state found yet.');
}
