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
   ├─ ReflectionOperationEditor.tsx    versioned operation and coordinated cleanup editors
   └─ services/api.ts                  review and authorization withdrawal
```

## Completed-session finalization

The summary preserves the final Undo opportunity until the session is finished.
Finish is the **Finish session** control, Space on that surface, or in-app
navigation away from the completed summary (another primary page or sign-out).
The live session still hides primary nav during active/draining study; nav
returns on the completed summary so leaving is possible. Mid-session leave is
unchanged and does not finish. Tab close and refresh are not treated as finish.

All of those finish entries call the same `finishCompletedSession` path.
Overlapping Finish and leave share one in-flight run. Finishing:

1. flushes the final deferred commit;
2. records the durable review-session summary;
3. transitions the UI to finalized; and
4. starts reflection only when qualifying evidence exists.

If the final commit fails, finalization returns to `unfinalized`, retains Undo,
and does not record the summary or generate reflection. If the later summary
write fails, finalization also returns to `unfinalized`, but the now-durable
final commit has correctly closed the Undo window; retrying Finish resumes from
that durable state. Failed implicit finish stays on the summary so the learner
can retry rather than navigating away with an unfinished persist.

Once finalized, **Close summary** is a separate action and remains available
while reflection is generating. Provider or validation failure is displayed as
best-effort failure without changing session correctness; the retained
supplement supports an explicit retry. Session-id guards ignore late summary-UI
updates after close or after another session starts. Same-tab in-flight
generation still keeps the Reflections spinner until that request settles, then
refreshes attention. Generation continues in the session controller even if Home
is unmounted, so a later Reflections visit can see the artifact or its
failed/retry state.

## Staged generation

New initial reflections and new second opinions run server-owned diagnosis and
conditional production-cue cleanup stages. The client receives only the final V9
artifact, never an intermediate diagnosis artifact. The run log retains each
provider call separately; retry resolves its durable continuation and reuses
saved diagnosis/promotion input within the current contract. Stored legacy
artifacts remain readable, but obsolete retries, second opinions, authorization,
and application are rejected. No live session grading uses this pipeline.

Diagnosis explicitly chooses ordinary feedback/proposals or a best-effort
ambiguous-pair handoff with no ordinary interventions. Routed items use stage
two's final explanation and either coordinated cleanup or explanation only.
Cleanup without a pure destination remains a normal actionable proposal.
Historical V8 disagreements remain non-actionable, without a manual override.
Unrelated ordinary items retain stage one's feedback/proposals, including
contrast authoring in its separate content space.

Bundle admission excludes overlapping target/response pairs in stable order
before diagnosis. Omitted second-opinion originals remain deferred; only
included originals retire after successful artifact materialization.

The cleanup editor presents the optional shared stimulus/axis, holistic teaching
note, source-fairness judgment, and both words' cue plans as compact expandable
rows. Extension keeps stimulus/axis fixed while editing reveal teaching for the
whole resulting membership. Application outcomes include explicit restored,
already-restored, or unavailable compensation feedback when an unfair source
exercise is remedied. A non-lapse pair-cleanup source is invalid.
Pure-cue membership is
not a word-scheduler projection.

Pure-cue card reveal reads the frozen snapshot's teaching note, not the semantic
axis. Blank notes on pre-migration content stay blank pending separate operator
cleanup. A later extension cannot change teaching text on an already served card.

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

The durable attempt snapshot also preserves the nullable post-reveal
production supplement separately from the pre-reveal cue. New provider bundles
include that exact snapshot so reflection does not propose a second V1
supplement for content the learner already saw.

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
details for ordinary navigation. Help membership is the union of pending
proposal reviews and open explanation inbox rows; artifact JSON is fetched to
render those cards. Proposal review, authorization withdrawal, and Help Done
reload the affected artifact plus both lists so queues remain coherent without
a manual refresh. Successful deferred second opinion patches selected deferred
proposals out of the client detail cache (matching durable
`requested_second_opinion` retirement) and reloads lists plus the new result
artifact, so the chip bank and deferred counts update without refetching those
known source dispositions.

**Refresh** is a full coherent reread of the reflection workspace from the
backend. It reloads open/history summaries, generation runs, quality stats,
the Help inbox, **and every currently scoped artifact detail**, bypassing the
client detail cache. Selection is preserved when that artifact remains readable.
Refresh does not start generation or mutate review state. Use it when durable
state may have changed outside this page's mutations (another tab, another
device, or a stale cache after an incomplete local update).

Artifact reconstruction is isolated per record. The backend lists unreadable
artifact metadata explicitly instead of aborting the whole list, and the
controller settles detail loads independently. The page excludes unreadable
details from proposal queues, keeps readable artifacts and generation runs
available, and shows a persistent unreadable-artifact notice without rewriting
the stored payload.

`ReflectionsPage` is reachable outside an active session. The page's view rail
(Proposals, Second opinion, By session, Run meta, Quality) nests under
the app-chrome **Reflections** item in the persistent left gutter, so the
default **Proposals** workspace can give most of the viewport to the current card.
A refresh control overlays the active **Reflections** primary tab (gear-style
affordance) for a full workspace reread. Help is a cross-session pager:
one card at a time for pending proposals and for explanation-only items still
in Help. The grain is one proposal per card; empty proposal lists produce one
explanation card while that item remains in Help. The current pager card is
stamped `inbox_seen_at` so the primary Reflections badge can decrement without
leaving `pending`. The primary count is hidden while Reflections is the current
page. Same-tab generation (post-session, retry, or second opinion) can show a
spinner on the tab instead of the count. A failed concluded generation run
still takes priority over both until Run meta is opened, which
durably acknowledges it and also marks the Run meta rail. Accept, Dismiss, Defer, and
Done are durable and advance the pager; Done leaves Help with no learner-facing
undo. Prev/Next are ephemeral. Compact pager chrome stays above the reading
pane with the target / typed-response identity line. Item quality chips, handle
selection, reset, and Accept / Defer / Dismiss sit together below the
pane. Explanation-only cards use that same toolbar. Handle is enabled so the
learner can pick a registered operation and edit it in place; Reset clears that
draft; Defer stays disabled; Accept authorizes the draft when one is present
and otherwise marks the Help inbox item Done; Dismiss marks Done without
applying a draft. Help does not show diagnosis tags or a dedicated dismissal-note field;
dismiss records a null reason and the quality note remains the single note
surface. Evidence, explanation, questions, rationale, and the operation editor
scroll inside the pane. Production evidence is a quiet tested-cue line
(truncated, expandable) rather than a second identity card. **Second opinion**
is a packaging surface, not a second Help pager: compact selected-by-default
chips occupy the main viewport, drill-in details stay secondary, and Select all /
Clear / model / Get a second opinion sit on a Help-style bottom rail.
When the daily spend cap has been surpassed, non-Luna model options are
disabled and a tip names the next UTC reset in the browser timezone.
**By session** retains the artifact-oriented dogfood view, including
explanation items already marked Done. In that view, items whose results carry no proposals are summarized in a
compact **No durable change** gist derived from the persisted evidence and
result (word, diagnosis tags, cue/response, learner feedback), so ordinary
forgetting and other no-action judgments stay visible without opening every
item card. Reviewing a
proposal removes it from the current queue when its new lifecycle state no
longer matches that filter. By session can restore a learner-dismissed proposal
to pending with **Undo dismiss**; second-opinion retirement cannot be undone.
Questions remain informational and do not receive
synthetic review state. Finish session returns Home; there is no post-session
jump or Open-reflection deep link.

Each proposal has a purpose-built editor for each registered operation family:

- definition-production suppression;
- new contrast-cluster creation, including members, annotations, and prompts;
- production-cue repair drafts;
- post-reveal production-cue supplements, with editable English frame, complete
  target-language example, and English translation; and
- directional production alternates.

The page validates drafts locally for feedback, but the backend remains
authoritative. Local validation uses the evidence-scoped allowed word set so
Accept stays disabled for illegal word ids. It labels exact versus revised
acceptance and apply support separately, then renders persisted application
states, effect/satisfying references, and safe reasons or errors. Accepted
`unsupported` or `pending` authorization may be withdrawn without rewriting the
accepted proposal. Word fields for contrast members and suppression/alternate
targets remain evidence comboboxes showing `hanzi · pinyin` surface labels; they
do not offer global content-diagnostics search. V2 cue accepted words are
toggle chips for the attempt's visible words, populated from the proposal and
green when accepted. Clearing a submitted-response chip from every created or
replacement accepted set drops a hidden `accepted_answer_space_omission`
judgment so the target-only cue remains authorizable. V2 cue repair hides the restated target-word field, source-attempt
judgments, production task ids, and raw cue ids. Cue lifecycle changes render
as a compact list of cue texts (kind via color); a row expands for editing,
replace's cue-to-be-replaced appears only in that detail, and rows can be
added or deleted without expanding. Switching a change to replace or deactivate
stamps the evidence served-cue id into that hidden payload field so a learner
can authorize terminal deactivation without typing a raw id. Those hidden
identifiers remain in the Accept payload.

The **Token usage** view shows aggregate token and priced-run totals followed by
a compact per-run table. It presents each attempt's provider/model, completion
or failure state, response/finish metadata when available, eligible/included
counts, normalized token categories, and the persisted estimated cost or an
explicit unavailable state. Successful and failed states use compact icons;
only retained current-contract bundles have an interactive retry control. Clicking the compact
retry icon opens a confirmation menu defaulting to the source model when that
model is still a configured comparison arm; arrow keys move the highlight, and
Enter or a click starts the retry (including an explicit comparison-arm model
when selected). If the source model is no longer configured, same-model retry
is refused with a notice and the operator must choose a current model.
This remains
observability for the initial reflection flow, not a learner correctness signal
or a replacement for immutable artifact history.

The **Quality** view shows server-side model-arm rates derived from terminal
proposal reviews plus item quality-tag overlays. Second-opinion retirement
counts in the terminal total but is not a dismiss. Capture is a single tag-chip
row on each reflection item. In Help and Deferred that row sits below the
reading pane with the review actions; on other proposal cards it remains
immediately above accept/dismiss (and on no-proposal surfaces). Saved notes render as committed text and become editable
on click. The Quality table defaults to the current reflection
prompt version and can group by model, prompt, or both. Tags never rewrite
disposition or application and are not required to review.

Failed runs with diagnostics have an expandable developer-facing detail showing
the validation phase, bounded issue paths/rules/messages, schema provenance,
provider request correlation, and capped rejected-output context. The current
dogfood surface intentionally shows that bounded output verbatim; missing detail
is rendered as unavailable rather than inferred for legacy rows.

A failed current-contract run with a retained bundle and no successful artifact exposes a small
retry action. Retrying reuses the exact backend-owned bundle, replaces the
action with a concise generating/result indicator, appends a new concluded run,
and opens the resulting artifact on success. Older run rows created before
bundle retention remain visible without a retry action.

The surface intentionally has no generic JSON editor or standalone manual
workbench. Explanation-only Help cards can still select a registered handle and
authorize a `manual` invocation against that item's evidence, using the same
editors as proposal review. Different-kind replacement remains available on
proposal cards. By session may show a compact no-durable-change gist for
observability; that is not a learner correctness score or a replacement for
immutable artifact history.

## Ownership boundaries

- Backend/API calls stay centralized in `src/services/api.ts`.
- The frontend owns ephemeral cue/response evidence only until the generation
  request is issued; the backend validates and enriches durable truth.
- Reflection artifacts, proposal reviews, invocations, application outcomes,
  and effects are backend-owned durable records.
- Reflection operation validation and registry semantics are shared from
  `src/domain/reflection.ts`; UI editors do not infer application behavior from
  rationale or free text.
