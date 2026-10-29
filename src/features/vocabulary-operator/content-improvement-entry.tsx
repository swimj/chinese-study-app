import type { ReactNode } from 'react';
import type { VocabularyJson } from '../../domain/vocabulary-content';
import type { VocabularyEncounterEvidence, VocabularyEncounterSnapshot } from '../../domain/vocabulary-session';

type ReadableValue = VocabularyJson;

/** Encounter snapshots are the served content. A missing case or snapshot stays unavailable. */
export function proposalServedEvidence(
  proposalCaseId: string | null | undefined,
  workspace: { caseId: string; evidence: readonly VocabularyEncounterEvidence[] } | null,
): readonly VocabularyEncounterEvidence[] | null {
  if (!proposalCaseId || workspace?.caseId !== proposalCaseId) return null;
  return workspace.evidence;
}

export type ServedContentLeadModel =
  | { status: 'unavailable' }
  | { status: 'served'; items: Array<{ encounterId: string; snapshot: VocabularyEncounterSnapshot } | { encounterId: string; missing: true }> };

export function servedContentLead(evidence: readonly VocabularyEncounterEvidence[] | null | undefined): ServedContentLeadModel {
  if (!evidence?.length) return { status: 'unavailable' };
  const items = evidence.map(encounter => {
    const snapshot = encounter.snapshot;
    return snapshot && typeof snapshot.body?.prompt === 'string'
      ? { encounterId: encounter.encounterId, snapshot }
      : { encounterId: encounter.encounterId, missing: true as const };
  });
  return items.some(item => 'snapshot' in item) ? { status: 'served', items } : { status: 'unavailable' };
}

export function ReadableJson({ value }: { value: ReadableValue }) {
  if (value === null) return null;
  if (typeof value !== 'object') return <span>{String(value)}</span>;
  if (Array.isArray(value)) return <ul>{value.map((entry, index) => <li key={index}><ReadableJson value={entry} /></li>)}</ul>;
  return <dl>{Object.entries(value).filter(([key]) => !['source', 'id', 'exampleId', 'wordId', 'contentId'].includes(key)).map(([key, entry]) => <div key={key}><dt>{key.replace(/([A-Z])/g, ' $1').replace(/^./, letter => letter.toUpperCase())}</dt><dd><ReadableJson value={entry} /></dd></div>)}</dl>;
}

function ServedSnapshot({ snapshot }: { snapshot: VocabularyEncounterSnapshot }) {
  const choices = snapshot.body.choices ?? [];
  return <article>
    <p className="vocabulary-operator-meta">{snapshot.role} · {snapshot.kind} · content version {snapshot.contentVersion}</p>
    <p className="vocabulary-operator-cue">{snapshot.body.prompt}</p>
    {choices.length > 0 && <ol className="vocabulary-served-choices">{choices.map(choice => <li key={choice.id}>{choice.text}</li>)}</ol>}
    {snapshot.kind === 'introduction' && snapshot.body.material !== undefined && <ReadableJson value={snapshot.body.material as ReadableValue} />}
    {snapshot.assessment && <p><strong>Expected answers:</strong> {snapshot.assessment.acceptedAnswers.join(' / ')}</p>}
  </article>;
}

export function ServedContentLead({ evidence, historical=false }: { evidence: readonly VocabularyEncounterEvidence[] | null; historical?:boolean }) {
  const lead = servedContentLead(evidence);
  return <div className="vocabulary-served-lead" aria-label={historical?"Historical session content":"Original served content"}>
    <p className="vocabulary-served-label">{historical?"Historical session content":"Original served content"}</p>
    {lead.status === 'unavailable'
      ? <p>The original served content is not available for this entry.</p>
      : lead.items.map(item => 'missing' in item
        ? <p key={item.encounterId}>The original served snapshot is not available for this encounter.</p>
        : <ServedSnapshot key={item.encounterId} snapshot={item.snapshot} />)}
  </div>;
}

/** The served snapshot is the first content. Diagnosis, current content, and proposals stay in the body. */
export function ContentImprovementEntry({ evidence, label, children, assessedVersion }: {
  evidence: readonly VocabularyEncounterEvidence[] | null; label: string; children?: ReactNode; assessedVersion?:number;
}) {
  return <section aria-label={label} className="vocabulary-improvement-entry">
    <ServedContentLead evidence={evidence} historical={assessedVersion!==undefined} />
    {assessedVersion!==undefined&&<p className="vocabulary-operator-meta">Operator reassessment · source v{assessedVersion}</p>}
    <div className="vocabulary-improvement-entry-body">{children}</div>
  </section>;
}
