import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dataDir = readRequiredDataDir();
const dbPath = path.join(dataDir, 'app.db');

if (!fs.existsSync(dbPath)) {
  throw new Error(`Database not found at ${dbPath}. Start or seed the fixture first.`);
}

const db = new DatabaseSync(dbPath, { readOnly: true });

try {
  const artifacts = db.prepare(`
    SELECT
      artifact_id,
      source_session_id,
      generated_at,
      provider,
      model,
      prompt_version
    FROM reflection_artifacts
    ORDER BY generated_at DESC, artifact_id ASC
  `).all() as ArtifactRow[];
  const proposals = db.prepare(`
    SELECT
      proposal_id,
      artifact_id,
      item_id,
      proposal_index,
      disposition,
      acceptance_mode,
      accepted_invocation_id
    FROM reflection_proposal_reviews
    ORDER BY artifact_id ASC, item_id ASC, proposal_index ASC
  `).all() as ProposalRow[];
  const invocations = db.prepare(`
    SELECT
      invocation_id,
      operation_kind,
      operation_version,
      application_state,
      effect_refs_json,
      satisfying_effect_refs_json
    FROM reflection_operation_invocations
    ORDER BY created_at ASC, invocation_id ASC
  `).all() as InvocationRow[];
  const suppressedProduction = db.prepare(`
    SELECT
      words.id AS word_id,
      words.hanzi,
      word_skill_relevance.updated_at
    FROM word_skill_relevance
    JOIN words ON words.id = word_skill_relevance.word_id
    WHERE word_skill_relevance.skill_id = 'production'
      AND word_skill_relevance.relevance_state = 'suppressed'
    ORDER BY words.hanzi ASC, words.id ASC
  `).all();
  const contrastClusters = db.prepare(`
    SELECT
      id,
      title
    FROM contrast_clusters
    ORDER BY title ASC, id ASC
  `).all() as Array<{ id: string; title: string }>;

  const invocationsById = new Map(invocations.map((invocation) => [invocation.invocation_id, {
    operation: `${invocation.operation_kind}@${invocation.operation_version}`,
    applicationState: invocation.application_state,
    effectRefs: parseJsonArray(invocation.effect_refs_json),
    satisfyingEffectRefs: parseJsonArray(invocation.satisfying_effect_refs_json),
  }]));

  const proposalsByArtifact = new Map<string, Array<unknown>>();
  for (const proposal of proposals) {
    const rows = proposalsByArtifact.get(proposal.artifact_id) ?? [];
    rows.push({
      proposalId: proposal.proposal_id,
      itemId: proposal.item_id,
      proposalIndex: proposal.proposal_index,
      disposition: proposal.disposition,
      acceptanceMode: proposal.acceptance_mode,
      invocation: proposal.accepted_invocation_id
        ? invocationsById.get(proposal.accepted_invocation_id) ?? null
        : null,
    });
    proposalsByArtifact.set(proposal.artifact_id, rows);
  }

  console.log(JSON.stringify({
    dbPath,
    artifactCount: artifacts.length,
    artifacts: artifacts.map((artifact) => ({
      artifactId: artifact.artifact_id,
      sourceSessionId: artifact.source_session_id,
      generatedAt: artifact.generated_at,
      provider: artifact.provider,
      model: artifact.model,
      promptVersion: artifact.prompt_version,
      proposals: proposalsByArtifact.get(artifact.artifact_id) ?? [],
    })),
    suppressedDefinitionProduction: suppressedProduction,
    contrastClusters,
  }, null, 2));
} finally {
  db.close();
}

function readRequiredDataDir(): string {
  const argument = process.argv.find((value) => value.startsWith('--data-dir='));
  const rawDataDir = argument?.slice('--data-dir='.length);
  if (!rawDataDir) {
    throw new Error('Expected --data-dir=/absolute/path for the reflection state report.');
  }

  return path.resolve(rawDataDir);
}

function parseJsonArray(value: string): unknown[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('Reflection persistence is corrupt: expected an effect-reference array.');
  }
  return parsed;
}

type ArtifactRow = {
  artifact_id: string;
  source_session_id: string;
  generated_at: string;
  provider: string;
  model: string;
  prompt_version: string;
};

type ProposalRow = {
  proposal_id: string;
  artifact_id: string;
  item_id: string;
  proposal_index: number;
  disposition: string;
  acceptance_mode: string | null;
  accepted_invocation_id: string | null;
};

type InvocationRow = {
  invocation_id: string;
  operation_kind: string;
  operation_version: number;
  application_state: string;
  effect_refs_json: string;
  satisfying_effect_refs_json: string;
};
