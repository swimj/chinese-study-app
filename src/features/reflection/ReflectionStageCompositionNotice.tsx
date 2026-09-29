import type { ReflectionItemResult } from '../../domain/reflection';

/** These model suggestions are retained for inspection, never as proposal controls. */
export function ReflectionStageCompositionNotice({ result }: { result: ReflectionItemResult }) {
  if (!('targetSuppression' in result) || result.targetSuppression === undefined) return null;
  const withheld = result.withheldTargetChanges;
  return (
    <section className="reflection-stage-composition" aria-label="Target production recommendation">
      <p><strong>Target production suppression recommended</strong></p>
      <p>{result.targetSuppression.reason}</p>
      {withheld === undefined ? null : (
        <details className="reflection-withheld-target-changes">
          <summary>{withheld.dependentResponsePlan === undefined
            ? 'Stage conflict · target cue suggestions withheld'
            : 'Stage conflict · entire cue plan withheld'}</summary>
          <p>Content review suggested target changes despite the suppression recommendation. These suggestions are informational and cannot be applied.</p>
          {withheld.dependentResponsePlan === undefined ? null : (
            <p>The response-word plan removes existing cues and may rely on the withheld shared cue to replace them. The entire content-review plan is withheld so those cues remain available.</p>
          )}
          <p><strong>Content review explanation:</strong> {withheld.learnerExplanation}</p>
          <p><strong>Content review rationale:</strong> {withheld.rationale}</p>
          {withheld.wordPlan.deactivateCueIds.length > 0 ? (
            <p>Suggested cue deactivations: {withheld.wordPlan.deactivateCueIds.join(', ')}</p>
          ) : null}
          {withheld.wordPlan.distinctiveCueDrafts.length > 0 ? (
            <ul>{withheld.wordPlan.distinctiveCueDrafts.map((draft, index) => (
              <li key={index}>{draft.cueType.replaceAll('_', ' ')}: {draft.text}</li>
            ))}</ul>
          ) : null}
          {withheld.dependentResponsePlan === undefined ? null : (
            <section aria-label="Withheld response-word plan">
              <p><strong>Response-word suggestions also withheld:</strong></p>
              <p>Suggested cue deactivations: {withheld.dependentResponsePlan.deactivateCueIds.join(', ')}</p>
              {withheld.dependentResponsePlan.distinctiveCueDrafts.length > 0 ? (
                <ul>{withheld.dependentResponsePlan.distinctiveCueDrafts.map((draft, index) => (
                  <li key={index}>{draft.cueType.replaceAll('_', ' ')}: {draft.text}</li>
                ))}</ul>
              ) : null}
            </section>
          )}
          {withheld.destination === null ? null : (
            <div>
              <p><strong>Suggested shared cue:</strong> {withheld.destination.kind === 'create'
                ? withheld.destination.stimulus : withheld.destination.pureCueId}</p>
              {withheld.destination.kind === 'create' ? <p>{withheld.destination.axisNote}</p> : null}
              <p>{withheld.destination.teachingNote}</p>
            </div>
          )}
        </details>
      )}
    </section>
  );
}
