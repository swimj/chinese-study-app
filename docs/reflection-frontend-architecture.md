# Reflection Frontend Architecture

Feature-specific navigation map for completed-session reflection and proposal
review. Product and lifecycle behavior remains authoritative in
[`SPECS/reflection-proposals-and-handles.md`](../SPECS/reflection-proposals-and-handles.md);
the general React map remains
[`SPECS/frontend-architecture-map.md`](../SPECS/frontend-architecture-map.md).

## Component hierarchy

```text
App.tsx
├─ useStudySession
│  ├─ session-reflection-evidence.ts   ephemeral capture and Undo snapshots
│  ├─ session-finalization.ts          Finish, Close, generation state
│  ├─ SessionSummaryPanel.tsx          finalization and generation feedback
│  └─ services/api.ts                  generate-session-reflection request
└─ useReflectionPageController
   ├─ ReflectionsPage.tsx              queue, history, detail, proposal cards
   ├─ reflection-page-model.ts         grouping, drafts, support, validation
   ├─ ReflectionOperationEditor.tsx    purpose-built V1 operation editors
   └─ services/api.ts                  review and authorization withdrawal
```

## Completed-session finalization

A completed session is not closed implicitly. The summary preserves the final
Undo opportunity until the user chooses **Finish session**. Finishing:

1. flushes the final deferred commit;
2. records the durable review-session summary;
3. transitions the UI to finalized; and
4. starts reflection only when qualifying evidence exists.

If the final commit fails, finalization returns to `unfinalized`, retains Undo,
and does not record the summary or generate reflection. If the later summary
write fails, finalization also returns to `unfinalized`, but the now-durable
final commit has correctly closed the Undo window; retrying Finish resumes from
that durable state.

Once finalized, **Close summary** is a separate action and remains available
while reflection is generating. Provider or validation failure is displayed as
best-effort failure without changing session correctness; the retained
supplement supports an explicit retry. Session-id guards ignore late responses
after close or after another session starts.

## Reflection evidence

`session-reflection-evidence.ts` records only the first non-empty typed mistake
for each review-phase production action. It freezes the raw response and full
definition cue as shown. Ordered attempt ids are appended only after the
deferred attempt batch is accepted durably.

Evidence is part of the Undo snapshot, restored on Undo, and removed when the
corresponding action is canceled or dismissed. Recognition, learning,
contrast-selection, no-clue, and production actions with no typed mistake are
excluded. Later accepted attempt ids for a captured mistake action remain in
the supplement only so the backend can validate the complete durable attempt
batch; attempt rows and summaries are not copied into the provider bundle.

The accumulator is ephemeral by design, remains available through
generation/retry, and is cleared when the completed session closes or a new
session starts.

## Reflection review workspace

`useReflectionPageController` loads the open queue, recent history, and the
compact concluded-generation run log in parallel, preserves the selected
artifact when possible, and loads its joined detail. Proposal review and
authorization withdrawal reload both artifact lists and detail so unresolved
queue state and persisted application results remain coherent across reloads.

`ReflectionsPage` is reachable outside an active session. It shows unresolved
artifacts separately from recent history, then joins immutable evidence and
item analysis to independent proposal cards. Questions and unhandled needs are
informational and do not receive synthetic review state.

Each proposal has a purpose-built editor for exactly one V1 operation:

- definition-production suppression;
- new contrast-cluster creation, including members, annotations, and prompts;
- production-cue repair drafts; and
- directional production alternates.

The page validates drafts locally for feedback, but the backend remains
authoritative. It labels exact versus revised acceptance and apply support
separately, then renders persisted application states, effect/satisfying
references, and safe reasons or errors. Accepted `unsupported` or `pending`
authorization may be withdrawn without rewriting the accepted proposal.

The sidebar also shows the dogfood run log. It presents each attempt's
provider/model, completion or failure state, response/finish metadata when
available, eligible/included counts, normalized token categories, and the
persisted estimated cost or an explicit unavailable state. It is observability
for the initial reflection flow, not a learner correctness signal or a
replacement for immutable artifact history.

A failed run with a retained bundle and no successful artifact exposes a small
retry action. Retrying reuses the exact backend-owned bundle, replaces the
action with a concise generating/result indicator, appends a new concluded run,
and opens the resulting artifact on success. Older run rows created before
bundle retention remain visible without a retry action.

The surface intentionally has no generic JSON editor, manual invocation
workbench, different-kind replacement flow, or top-level reflection summary.

## Ownership boundaries

- Backend/API calls stay centralized in `src/services/api.ts`.
- The frontend owns ephemeral cue/response evidence only until the generation
  request is issued; the backend validates and enriches durable truth.
- Reflection artifacts, proposal reviews, invocations, application outcomes,
  and effects are backend-owned durable records.
- Reflection operation validation and registry semantics are shared from
  `src/domain/reflection.ts`; UI editors do not infer application behavior from
  rationale or free text.
