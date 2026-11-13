import type { DatabaseSync } from 'node:sqlite';
import type {
  RepertoireCohort, RepertoireCueRow, RepertoireCueVersion, RepertoireModel, RepertoireOutcomes,
  RepertoirePath, RepertoireQualityDetail, RepertoireRepairRow, RepertoireRepairTotals,
} from '../../src/domain/repertoire-quality.ts';
import { getEffectiveVocabularyEncounterReactions, type VocabularySessionProjection } from '../../src/domain/vocabulary-session.ts';
import type { VocabularyContentProposal } from '../../src/domain/vocabulary-reflection.ts';

export type RepertoireSnapshot = {
  capturedAt: string;
  cohorts: RepertoireCohort[];
  repairTotals: RepertoireRepairTotals;
  cueRows: RepertoireCueRow[];
  repairRows: RepertoireRepairRow[];
  cues: Map<string, RepertoireQualityDetail>;
  repairs: Map<string, RepertoireQualityDetail>;
};

type Revision = {
  contentId: string;
  version: number;
  prompt: string;
  availability: RepertoireCueVersion['availability'];
  recordedAt: string;
  target: string;
  wordId: string | null;
  answers: string | null;
  assessment: string | null;
};
type Invocation = {
  id: string;
  model: string;
  path: RepertoirePath;
  promptVersion: string | null;
  spend: number | null;
};
type Origin = {
  invocationId: string;
  contentId: string;
  version: number;
  generatedPrompt: string | null;
  publication: RepertoireQualityDetail['publication'];
};
type Application = {
  id: string;
  operation: string;
  appliedAt: string;
  strategy: 'create' | 'update_existing' | 'replace' | 'retire';
  sourceId: string | null;
  sourceVersion: number | null;
  resultId: string;
  resultVersion: number;
  outcome: string | null;
  stage: string | null;
  caseKind: string | null;
  caseContentId: string | null;
  invocationId: string | null;
  automatic: number;
  fromRepertoire: number;
  initialProposal: string | null;
  appliedProposal: string | null;
};

const emptyOutcomes = (): RepertoireOutcomes => ({
  served: 0, answered: 0, acceptedFirst: 0, unfairFirstMisses: 0, unclassifiedFirstMisses: 0,
  skipped: 0, negative: 0, comments: 0,
});
const versionKey = (contentId: string, version: number) => JSON.stringify([contentId, version]);
const modelFamily = (model: string): RepertoireModel | null => {
  if (/^gpt-6(?:\.\d+)?-sol(?:-|$)/.test(model)) return 'sol';
  if (/^gpt-(?:6(?:\.\d+)?|5\.6)-luna(?:-|$)/.test(model)) return 'luna';
  return null;
};

function applications(db: DatabaseSync): Application[] {
  return db.prepare(`
    SELECT a.application_id AS id,d.operation_key AS operation,a.applied_at AS appliedAt,
      d.write_strategy AS strategy,d.source_content_id AS sourceId,d.source_version AS sourceVersion,
      d.result_content_id AS resultId,d.result_version AS resultVersion,
      json_extract(j.result_json,'$.input.admission.outcome') AS outcome,i.step_name AS stage,
      c.kind AS caseKind,c.content_id AS caseContentId,p.invocation_id AS invocationId,
      COALESCE(json_extract(r.notes_json,'$.automatic')='repertoire_bootstrap',0) AS automatic,
      COALESCE(json_extract(h.snapshot_json,'$.body.source.kind')='vocabulary_repertoire',0) AS fromRepertoire,
      original.snapshot_json AS initialProposal,applied.snapshot_json AS appliedProposal
    FROM application_content_changes d
    JOIN proposal_applications a USING(application_id)
    JOIN content_proposals p USING(proposal_id)
    JOIN proposal_reviews r ON r.review_id=a.authorized_review_id
    LEFT JOIN reflection_cases c ON c.case_id=p.case_id
    LEFT JOIN vocabulary_reflection_jobs j ON j.job_id=p.assessment_job_id
    LEFT JOIN model_invocations i ON i.id=p.invocation_id
    JOIN content_revision_history h ON h.content_id=d.result_content_id AND h.version=d.result_version
    LEFT JOIN proposal_revision_history original ON original.proposal_id=p.proposal_id AND original.version=1
      AND json_extract(h.snapshot_json,'$.body.source.kind')='vocabulary_repertoire'
    LEFT JOIN proposal_revision_history applied ON applied.proposal_id=p.proposal_id AND applied.version=a.proposal_version
      AND original.proposal_id IS NOT NULL
    ORDER BY a.applied_at,a.application_id,d.operation_key
  `).all() as Application[];
}

function generatedPrompt(change: Application): string | null {
  if (!change.initialProposal || !change.appliedProposal) return null;
  const original = JSON.parse(change.initialProposal) as VocabularyContentProposal;
  const applied = JSON.parse(change.appliedProposal) as VocabularyContentProposal;
  const operation = original.operations.find(op => op.operationKey === change.operation);
  const published = applied.operations.find(op => op.operationKey === change.operation);
  if (!operation || !published || !operation.content.body || typeof operation.content.body !== 'object'
    || Array.isArray(operation.content.body) || typeof operation.content.body.prompt !== 'string') return null;
  return operation.content.body.prompt;
}

function isFirstRepertoire(change: Application): boolean {
  return change.fromRepertoire === 1 && change.stage === 'repertoire' &&
    (change.outcome === null || change.outcome === 'repertoire_bootstrap' || change.outcome === 'laundry_list');
}

function attribution(db: DatabaseSync, changes: Application[]): { calls: Invocation[]; origins: Origin[] } {
  const calls = db.prepare(`
    SELECT i.id,i.model,i.prompt_version AS promptVersion,i.spend_usd AS spend,
      CASE WHEN i.actor_id='vocabulary-bulk-repertoire' THEN 'bulk'
           WHEN i.step_name='repertoire' THEN 'reflection' ELSE 'practice' END AS path
    FROM model_invocations i LEFT JOIN vocabulary_reflection_jobs j ON j.job_id=i.workflow_id
    WHERE i.prompt_name='vocabulary-general-exercises' AND (
      (i.step_name='general_exercises' AND i.actor_id IN ('vocabulary-practice-authoring','vocabulary-bulk-repertoire')
       AND COALESCE(i.workflow_id,'') NOT LIKE 'vocabulary-practice:reconciliation:%')
      OR (i.step_name='repertoire' AND COALESCE(json_extract(j.result_json,'$.input.admission.outcome'),'repertoire_bootstrap')
           IN ('repertoire_bootstrap','laundry_list')))
  `).all() as Invocation[];
  const links = db.prepare(`
    SELECT l.invocation_id AS invocationId,l.content_id AS contentId,l.content_version AS version
    FROM model_invocations i JOIN invocation_content_links l ON l.invocation_id=i.id AND l.role='output'
    WHERE i.prompt_name='vocabulary-general-exercises' AND i.step_name='general_exercises'
  `).all() as Pick<Origin,'invocationId'|'contentId'|'version'>[];
  const callsById = new Map(calls.map(call => [call.id,call]));
  const origins: Origin[] = links.map(link => ({...link, generatedPrompt:null,
    publication:callsById.get(link.invocationId)?.path === 'bulk' ? 'operator' : 'automatic'}));
  for (const change of changes) {
    if (isFirstRepertoire(change) && change.invocationId && (change.strategy === 'create' || change.strategy === 'replace')) {
      origins.push({
        invocationId:change.invocationId, contentId:change.resultId, version:change.resultVersion,
        generatedPrompt:generatedPrompt(change), publication:change.automatic ? 'automatic' : 'operator',
      });
    }
  }
  return {calls,origins};
}

type Encounter = { presentedAt: string; counts: RepertoireOutcomes };

function observedEncounters(db: DatabaseSync, revisions: Set<string>, contentIds: Set<string>): Map<string, Encounter[]> {
  const unfair = new Set<string>();
  for (const row of db.prepare(`
    SELECT DISTINCT e.value AS encounterId
    FROM vocabulary_reflection_jobs j,json_each(j.result_json,'$.input.unfairEncounterIds') e
    WHERE j.kind='learner_feedback' AND j.status='succeeded' AND e.type='text'
  `).iterate()) unfair.add(String(row.encounterId));
  const byRevision = new Map<string, Encounter[]>();
  const seen = new Set<string>();
  const completions = db.prepare(`WITH relevant_sessions AS MATERIALIZED (
    SELECT DISTINCT session_id FROM exercise_encounters WHERE content_id IN (SELECT value FROM json_each(?))
  ) SELECT report_json AS report FROM vocabulary_session_completions c JOIN relevant_sessions USING(session_id)
    WHERE c.status='closed' ORDER BY c.closed_at DESC,c.through_sequence DESC`);
  for (const row of completions.iterate(JSON.stringify([...contentIds]))) {
    const report = JSON.parse(String(row.report)) as VocabularySessionProjection;
    for (const encounter of report.encounters) {
      const {contentId,contentVersion,kind,role} = encounter.snapshot;
      if (kind !== 'production' || role !== 'general' || seen.has(encounter.encounterId)) continue;
      const key = versionKey(contentId,contentVersion);
      if (!revisions.has(key)) continue;
      seen.add(encounter.encounterId);
      if (encounter.presentationUndone) continue;
      const outcome = emptyOutcomes();
      outcome.served = 1;
      const first = encounter.effectiveResponses[0];
      if (first) {
        outcome.answered = 1;
        if (first.payload.outcome === 'accepted') outcome.acceptedFirst = 1;
        else if (unfair.has(encounter.encounterId)) outcome.unfairFirstMisses = 1;
        else outcome.unclassifiedFirstMisses = 1;
      }
      outcome.skipped = Number(encounter.skipped);
      for (const reaction of getEffectiveVocabularyEncounterReactions(encounter)) {
        if (reaction.payload.feedback === 'negative') outcome.negative++;
        if (reaction.payload.comment?.trim()) outcome.comments++;
      }
      const entries = byRevision.get(key) ?? [];
      entries.push({presentedAt:encounter.presentedAt,counts:outcome});
      byRevision.set(key,entries);
    }
  }
  return byRevision;
}

function addOutcomes(total: RepertoireOutcomes, next: RepertoireOutcomes): void {
  for (const key of Object.keys(next) as (keyof RepertoireOutcomes)[]) total[key] += next[key];
}

function cueChanged(before: Revision, after: Revision): boolean {
  return before.prompt !== after.prompt || before.answers !== after.answers || before.assessment !== after.assessment;
}

/** Derived from one coherent read transaction on an isolated connection. No learner identifiers leave this function. */
export function buildRepertoireSnapshot(db: DatabaseSync, capturedAt = new Date().toISOString()): RepertoireSnapshot {
  const changes = applications(db);
  const {calls,origins} = attribution(db,changes);
  const revisionRows = db.prepare(`
    SELECT h.content_id AS contentId,h.version,h.recorded_at AS recordedAt,
      COALESCE(json_extract(h.snapshot_json,'$.body.prompt'),'') AS prompt,
      json_extract(h.snapshot_json,'$.availability') AS availability,
      json_extract(h.snapshot_json,'$.answers') AS answers,
      json_extract(h.snapshot_json,'$.assessment') AS assessment,
      COALESCE(w.hanzi,'') AS target,w.id AS wordId
    FROM content_revision_history h JOIN content_items c USING(content_id)
    LEFT JOIN lexical_words w ON w.id=(
      SELECT json_extract(item.value,'$.wordId') FROM json_each(h.snapshot_json,'$.words') item
      WHERE json_extract(item.value,'$.relation')='target' LIMIT 1
    )
    WHERE c.kind='exercise' AND c.exercise_role='general' AND c.skill='production'
      AND json_extract(h.snapshot_json,'$.accessScope')='shared'
    ORDER BY h.content_id,h.version
  `).all() as Revision[];
  const revisionByKey = new Map<string, Revision>();
  const revisionsByContent = new Map<string, Revision[]>();
  for (const row of revisionRows) {
    revisionByKey.set(versionKey(row.contentId,row.version),row);
    const sameCue = revisionsByContent.get(row.contentId) ?? [];
    sameCue.push(row);
    revisionsByContent.set(row.contentId,sameCue);
  }
  const replacements = new Map<string, Revision[]>();
  const replacementRetirements = new Set<string>();
  for (const change of changes) {
    if (change.strategy !== 'replace' || !change.sourceId || change.sourceVersion === null) continue;
    const replacement = revisionByKey.get(versionKey(change.resultId,change.resultVersion));
    if (!replacement) continue;
    const key = versionKey(change.sourceId,change.sourceVersion);
    const next = replacements.get(key) ?? [];
    next.push(replacement);
    replacements.set(key,next);
    replacementRetirements.add(versionKey(change.sourceId,change.sourceVersion + 1));
  }

  const relevantIds = new Set(origins.map(origin => origin.contentId));
  for (const change of changes) {
    if (change.sourceId) relevantIds.add(change.sourceId);
    relevantIds.add(change.resultId);
  }
  const relevantKeys = new Set(revisionRows.filter(row=>relevantIds.has(row.contentId)).map(row=>versionKey(row.contentId,row.version)));
  const byRevision = observedEncounters(db,relevantKeys,relevantIds);
  function outcomes(revision: Revision, boundary?: { before?: string; after?: string }): RepertoireOutcomes {
    const total = emptyOutcomes();
    for (const entry of byRevision.get(versionKey(revision.contentId,revision.version)) ?? []) {
      if (boundary?.before && entry.presentedAt >= boundary.before) continue;
      if (boundary?.after && entry.presentedAt < boundary.after) continue;
      addOutcomes(total,entry.counts);
    }
    return total;
  }
  function versions(start: Revision, firstChange: RepertoireCueVersion['change']): RepertoireCueVersion[] {
    const seen = new Set<string>();
    const result: RepertoireCueVersion[] = [];
    function visit(from: Revision, initialChange: RepertoireCueVersion['change']): void {
      let previous = from;
      for (const revision of revisionsByContent.get(from.contentId) ?? []) {
        if (revision.version < from.version) continue;
        const key = versionKey(revision.contentId,revision.version);
        if (seen.has(key)) continue;
        seen.add(key);
        const change = revision.version === from.version ? initialChange
          : revision.availability === 'retired' && previous.availability !== 'retired' ? 'retirement'
            : cueChanged(previous,revision) ? 'edit' : 'metadata';
        previous = revision;
        const {contentId,version,prompt,availability,recordedAt} = revision;
        result.push({contentId,version,prompt,availability,recordedAt,change,outcomes:outcomes(revision)});
        for (const replacement of replacements.get(key) ?? []) visit(replacement,'replacement');
      }
    }
    visit(start,firstChange);
    return result.sort((a,b)=>a.recordedAt.localeCompare(b.recordedAt) ||
      (a.contentId === b.contentId ? a.version-b.version : a.contentId.localeCompare(b.contentId)));
  }
  function countLaterChanges(history: RepertoireCueVersion[], start: Revision): number {
    return history.filter(entry => {
      if (entry.contentId === start.contentId && entry.version === start.version) return false;
      if (entry.change === 'metadata') return false;
      // A replacement already counts the retirement of its source cue.
      return entry.change !== 'retirement' || !replacementRetirements.has(versionKey(entry.contentId,entry.version));
    }).length;
  }

  const cohortMap = new Map<RepertoireModel, RepertoireCohort>();
  const words = new Map<RepertoireModel,Set<string>>();
  for (const model of ['sol','luna'] as const) {
    cohortMap.set(model,{model,...emptyOutcomes(),exercises:0,exercisesServed:0,wordsPublished:0,authoringSpendUsd:null,pricedCalls:0,calls:0});
    words.set(model,new Set());
  }
  const invocationById = new Map<string,Invocation>();
  for (const invocation of calls) {
    const model = modelFamily(invocation.model);
    if (!model) continue;
    invocationById.set(invocation.id,invocation);
    const cohort = cohortMap.get(model)!;
    cohort.calls++;
    if (invocation.spend !== null) {
      cohort.pricedCalls++;
      cohort.authoringSpendUsd = (cohort.authoringSpendUsd ?? 0) + invocation.spend;
    }
  }
  const cues = new Map<string, RepertoireQualityDetail>();
  const cueRows: RepertoireCueRow[] = [];
  // Each exact published cue has one identifiable author. Leave ambiguous links outside the comparison.
  const byOutput = new Map<string, Origin | null>();
  for (const origin of origins) {
    const key = versionKey(origin.contentId,origin.version);
    const prior = byOutput.get(key);
    if (prior === undefined) byOutput.set(key,origin);
    else if (prior?.invocationId !== origin.invocationId) byOutput.set(key,null);
  }
  for (const [key,origin] of byOutput) {
    const revision = revisionByKey.get(key);
    if (!origin || !revision) continue;
    const invocation = invocationById.get(origin.invocationId);
    if (!invocation) continue;
    const model = modelFamily(invocation.model)!;
    const history = versions(revision,'published');
    const first = outcomes(revision);
    const laterChanges = countLaterChanges(history,revision);
    const cohort = cohortMap.get(model)!;
    cohort.exercises++;
    cohort.exercisesServed += Number(first.served > 0);
    if (revision.wordId) words.get(model)!.add(revision.wordId);
    addOutcomes(cohort,first);
    cues.set(key,{target:revision.target,generatedPrompt:origin.generatedPrompt,publication:origin.publication,versions:history});
    cueRows.push({id:key,prompt:revision.prompt,target:revision.target,model,path:invocation.path,promptVersion:invocation.promptVersion,
      outcomes:first,laterChanges});
  }
  for (const [model,cohort] of cohortMap) cohort.wordsPublished = words.get(model)!.size;
  cueRows.sort((a,b) => b.outcomes.unfairFirstMisses-a.outcomes.unfairFirstMisses
    || b.outcomes.negative-a.outcomes.negative || b.outcomes.unclassifiedFirstMisses-a.outcomes.unclassifiedFirstMisses
    || b.outcomes.served-a.outcomes.served || a.id.localeCompare(b.id));

  const repairs = new Map<string, RepertoireQualityDetail>();
  const repairRows: RepertoireRepairRow[] = [];
  const repairTotals: RepertoireRepairTotals = {applied:0,retired:0,servedAfter:0,firstMissAfter:0,unfairAfter:0,changedAgain:0};
  for (const change of changes) {
    const {sourceId,sourceVersion,resultId,resultVersion,strategy,appliedAt} = change;
    if (!sourceId || sourceId !== change.caseContentId || sourceVersion === null || strategy === 'create'
      || change.caseKind !== 'exercise_improvement'
      || (change.outcome !== 'single_sense' && change.stage !== 'single_improvement')) continue;
    const before = revisionByKey.get(versionKey(sourceId,sourceVersion));
    const after = revisionByKey.get(versionKey(resultId,resultVersion));
    if (!before || !after) continue;
    const kind = strategy === 'retire' || after.availability === 'retired' ? 'retirement' : strategy === 'replace' ? 'replacement' : 'edit';
    if (kind === 'edit' && !cueChanged(before,after)) continue;
    // The source and result are exact revisions. Later editing of either is not a post-repair outcome.
    const beforeOutcomes = outcomes(before,{before:appliedAt});
    const afterOutcomes = kind === 'retirement' ? null : outcomes(after,{after:appliedAt});
    const afterHistory = versions(after,kind);
    const laterChanges = countLaterChanges(afterHistory,after);
    const id = JSON.stringify([change.id,change.operation]);
    const {contentId,version,prompt,availability,recordedAt} = before;
    repairs.set(id,{target:before.target,generatedPrompt:null,publication:null,versions:[
      {contentId,version,prompt,availability,recordedAt,change:'source',outcomes:beforeOutcomes},
      ...afterHistory.map(entry=>entry.contentId === resultId && entry.version === resultVersion
        ? {...entry,outcomes:afterOutcomes ?? emptyOutcomes()} : entry),
    ]});
    repairRows.push({id,prompt:before.prompt,target:before.target,appliedAt,kind,before:beforeOutcomes,after:afterOutcomes,laterChanges});
    repairTotals.applied++;
    repairTotals.retired += Number(kind === 'retirement');
    repairTotals.servedAfter += Number(Boolean(afterOutcomes?.served));
    repairTotals.firstMissAfter += Number(Boolean(afterOutcomes && afterOutcomes.answered > afterOutcomes.acceptedFirst));
    repairTotals.unfairAfter += Number(Boolean(afterOutcomes?.unfairFirstMisses));
    repairTotals.changedAgain += Number(laterChanges > 0);
  }
  repairRows.reverse();
  return {capturedAt,cohorts:[...cohortMap.values()],repairTotals,cueRows,repairRows,cues,repairs};
}
