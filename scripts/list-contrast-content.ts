import {
  getContrastClusterMembers,
  getContrastClusters,
  getContrastPromptsForCluster,
  getWords,
} from '../server/db.ts';

const wordsById = new Map(getWords().map((word) => [word.id, word]));
const clusters = getContrastClusters();

if (clusters.length === 0) {
  console.log('No contrast clusters found.');
} else {
  console.log(`Contrast clusters: ${clusters.length}`);

  for (const cluster of clusters) {
    const members = getContrastClusterMembers(cluster.id);
    const prompts = getContrastPromptsForCluster(cluster.id);

    console.log('');
    console.log(`${cluster.title} (${cluster.id})`);
    if (cluster.note.length > 0) {
      console.log(`  note: ${cluster.note}`);
    }

    console.log(`  members: ${members.length}`);
    for (const member of members) {
      const word = wordsById.get(member.wordId);
      const label = word ? `${word.hanzi} [${member.wordId}]` : `[missing word ${member.wordId}]`;
      const nuance = member.nuanceNote.length > 0 ? ` - ${member.nuanceNote}` : '';
      console.log(`    - ${label}${nuance}`);
    }

    console.log(`  prompts: ${prompts.length}`);
    for (const prompt of prompts) {
      const target = wordsById.get(prompt.targetWordId);
      const targetLabel = target ? `${target.hanzi} [${prompt.targetWordId}]` : `[missing word ${prompt.targetWordId}]`;
      console.log(`    - target=${targetLabel} prompt=${JSON.stringify(prompt.promptText)}`);
      if (prompt.explanation.length > 0) {
        console.log(`      explanation=${JSON.stringify(prompt.explanation)}`);
      }
    }
  }
}
