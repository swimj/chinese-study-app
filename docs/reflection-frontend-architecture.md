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

`session-reflection-evidence.ts` records the first failed recall for each
review-phase production action: either a non-empty typed mistake or an explicit
no-clue action. The backend is the authoritative reflection-eligibility
boundary: it excludes learner-rated pronunciation lapses where the response is
the target word itself, while preserving the study mistake. The accumulator
freezes the nullable raw response, explicit response kind, and full production
cue as shown. Ordered attempt ids are appended only after the deferred attempt
batch is accepted durably.

Failure evidence is part of the Undo snapshot, restored on Undo, and removed when the
corresponding action is canceled or dismissed. Recognition, learning,
contrast-selection, and production actions without a typed mistake or explicit
no-clue response are excluded. Later accepted attempt ids for a captured action remain in
the supplement only so the backend can validate the complete durable attempt
batch; attempt rows and summaries are not copied into the provider bundle.

The accumulator is ephemeral by design, remains available through
generation/retry, and is cleared when the completed session closes or a new
session starts.

A separate learner-request accumulator backs the **Ask reflection to review**
toggle on review production cards, including the frozen post-answer card. It
captures the cue at marking time, is deliberately outside the Undo snapshot,
and can be unmarked explicitly. At the deferred commit boundary it receives
the same complete accepted attempt batch as failure evidence. Finalization
merges both accumulators into the V3 evidence supplement by action, so a marked
mistake becomes one item and a marked correct response can still enter
reflection. Cancellation, dismissal, and management remove the request.

## Reflection review workspace

`useReflectionPageController` loads the capped open and recent artifact lists,
the Help inbox, their joined details, and the concluded-generation run log,
preserves the selected artifact when possible, and reuses already loaded
details. Help membership is the union of pending proposal reviews and open
explanation inbox rows; artifact JSON is fetched to render those cards.
Proposal review, authorization withdrawal, and Help Done reload the affected
artifact plus both lists so queues remain coherent without a manual refresh.

Artifact reconstruction is isolated per record. The backend lists unreadable
artifact metadata explicitly instead of aborting the whole list, and the
controller settles detail loads independently. The page excludes unreadable
details from proposal queues, keeps readable artifacts and generation runs
available, and shows a persistent unreadable-artifact notice without rewriting
the stored payload.

`ReflectionsPage` is reachable outside an active session. Its default view is a
cross-session **Help** pager: one card at a time for pending proposals and for
explanation-only items still in Help. The grain is one proposal per card;
empty proposal lists produce one explanation card while that item remains in
Help. Accept, Dismiss, Defer, and Done are durable and advance the pager; Done
leaves Help with no learner-facing undo. Prev/Next are ephemeral. The help
shell keeps pager chrome and those actions stable while evidence, explanation,
questions, rationale, and the operation editor scroll. Separate convenience
views show deferred proposals and accepted authorizations whose application is
pending or unsupported, while **By session** retains the artifact-oriented
dogfood view, including explanation items already marked Done. In that view,
items whose results carry no proposals are summarized in a compact **No durable
change** gist derived from the persisted evidence and result (word, diagnosis
tags, cue/response, learner feedback), so ordinary forgetting and other
no-action judgments stay visible without opening every item card. Reviewing a
proposal removes it from the current queue when its new lifecycle state no
longer matches that filter. Questions remain informational and do not receive
synthetic review state. Finish session returns Home; there is no post-session
jump or Open-reflection deep link.

Each proposal has a purpose-built editor for each registered operation family:

- definition-production suppression;
- new contrast-cluster creation, including members, annotations, and prompts;
- production-cue repair drafts; and
- directional production alternates.

The page validates drafts locally for feedback, but the backend remains
authoritative. Local validation uses the evidence-scoped allowed word set so
Accept stays disabled for illegal word ids. It labels exact versus revised
acceptance and apply support separately, then renders persisted application
states, effect/satisfying references, and safe reasons or errors. Accepted
`unsupported` or `pending` authorization may be withdrawn without rewriting the
accepted proposal. Word fields are evidence comboboxes showing profile-aware
`hanzi · pinyin` surface labels; they do not offer global content-diagnostics
search. V2 cue repair hides source-attempt judgments, production task ids, and
raw cue ids everywhere, including the post-accept original operation, while
keeping those values in the Accept payload.

The **Token usage** view shows aggregate token and priced-run totals followed by
a compact per-run table. It presents each attempt's provider/model, completion
or failure state, response/finish metadata when available, eligible/included
counts, normalized token categories, and the persisted estimated cost or an
explicit unavailable state. Successful and failed states use compact icons;
every retained bundle has an interactive retry control. Clicking the compact
retry icon opens a confirmation menu defaulting to the source model when that
model is still a configured comparison arm; arrow keys move the highlight, and
Enter or a click starts the retry (including an explicit comparison-arm model
when selected). If the source model is no longer configured, same-model retry
is refused with a notice and the operator must choose a current model.
This remains
observability for the initial reflection flow, not a learner correctness signal
or a replacement for immutable artifact history.

The **Quality** view shows server-side model-arm rates derived from terminal
proposal reviews plus item quality-tag overlays. Capture is a single tag-chip
row on each reflection item, placed immediately above accept/dismiss on proposal
cards (and on no-proposal surfaces). Saved notes render as committed text and
become editable on click. The Quality table defaults to the current reflection
prompt version and can group by model, prompt, or both. Tags never rewrite
disposition or application and are not required to review.

Failed runs with diagnostics have an expandable developer-facing detail showing
the validation phase, bounded issue paths/rules/messages, schema provenance,
provider request correlation, and capped rejected-output context. The current
dogfood surface intentionally shows that bounded output verbatim; missing detail
is rendered as unavailable rather than inferred for legacy rows.

A failed run with a retained bundle and no successful artifact exposes a small
retry action. Retrying reuses the exact backend-owned bundle, replaces the
action with a concise generating/result indicator, appends a new concluded run,
and opens the resulting artifact on success. Older run rows created before
bundle retention remain visible without a retry action.

The surface intentionally has no generic JSON editor, manual invocation
workbench, or different-kind replacement flow. By session may show a compact
no-durable-change gist for observability; that is not a learner correctness
score or a replacement for immutable artifact history.

## Ownership boundaries

- Backend/API calls stay centralized in `src/services/api.ts`.
- The frontend owns ephemeral cue/response evidence only until the generation
  request is issued; the backend validates and enriches durable truth.
- Reflection artifacts, proposal reviews, invocations, application outcomes,
  and effects are backend-owned durable records.
- Reflection operation validation and registry semantics are shared from
  `src/domain/reflection.ts`; UI editors do not infer application behavior from
  rationale or free text.
