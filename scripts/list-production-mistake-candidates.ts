import { getProductionMistakeCandidates } from '../server/db.ts';

const candidates = getProductionMistakeCandidates();

if (candidates.length === 0) {
  console.log('No production mistake candidates captured yet.');
} else {
  for (const candidate of candidates) {
    const matched = candidate.matchedWordId ? `matched=${candidate.matchedWordId}` : 'matched=none';
    const note = candidate.note.length > 0 ? ` note=${JSON.stringify(candidate.note)}` : '';
    console.log(
      [
        candidate.createdAt,
        `target=${candidate.targetHanzi}`,
        `attempted=${candidate.attemptedHanzi}`,
        `targetWordId=${candidate.targetWordId}`,
        matched,
        `id=${candidate.id}`,
      ].join(' ') + note,
    );
  }
}
