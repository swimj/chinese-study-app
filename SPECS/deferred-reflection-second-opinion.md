# Second opinions on deferred reflection items

Status: implemented first-cut feature specification, based on the 2026-09-07
product discussion.

Origin: [SWI-55 — Let learners re-reflect on a curated batch of deferred items](https://linear.app/swimj/issue/SWI-55).
Related: [SWI-52 — Let learners request a second opinion on a reflection proposal](https://linear.app/swimj/issue/SWI-52).

## Product intent

Let the learner move on from an uncertain reflection without losing the
opportunity to get useful help later. They can defer proposals, select some or
all of them across sessions, and request another reflection using a chosen
model without regenerating the unrelated items in the original bundles.

The primary question is “what would help me with this word?” Assessing whether
an earlier recommendation was good can serve that goal, but is not the default
task given to the model. A clearer explanation, a different intervention, or
the conclusion that no intervention is needed can all be useful outcomes.

Deferral means “I may want to revisit this.” It does not schedule provider work,
require an explanation, or create an obligation to empty the deferred queue.

Dogfood evidence suggests that one deliberate pass with the learner's preferred
stronger model often supplies enough help to move on. This motivates selective
model expenditure; it does not establish that a stronger model is an authority
or that an automated cheaper-first policy will save total cost.

## First-cut scope

The first cut adds a manual product flow using the existing reflection prompt
and ordinary result validation. It supports:

- selection of one, several, or all eligible deferred proposals across sessions;
- a fresh bounded reflection request containing their original evidence items;
- explicit selection from available compatible models, with the learner's last
  choice remembered where practical. After the daily spend cap, only Luna
  remains selectable until the next UTC day;
- ordinary review of fresh results;
- automatic retirement of the selected originals from active review after
  successful generation, without requiring proposal-by-proposal reconciliation.

Personal notes, guidance, and supplying an earlier recommendation for evaluation
are important extensions, but are excluded from the first cut. Product-flow work
must not depend on new pedagogical prompt engineering.

## Learner flow

1. The learner defers a proposal using the existing review action.
2. In deferred review, they select eligible proposals. Selection can span source
   sessions. Word and cue context must make the selection understandable.
3. They choose “Get a second opinion” (working copy), inspect the selected scope,
   choose an available model, and initiate the request. The interface explains
   that this reflects again on the original study evidence and that successful
   results will replace the selected originals in active review.
4. During generation, the selected originals remain available and are visibly
   associated with the in-progress request. Accidental repeat submission must
   not create duplicate work.
5. On success, fresh results enter normal review and the selected originals
   leave the active deferred queue. The new result is the primary reading
   surface; comparing old and new answers is not a required step.
6. On failure, the selected originals remain deferred. The failure is visible
   and another attempt remains deliberate.

Fresh proposals use existing accept, edit, dismiss, and defer controls.
Explanation-only results use the existing completion flow. New results can be
deferred and reconsidered again later. This is not an automatic retry loop.

## Selection and evidence semantics

The learner's purpose is progress on a word. The generation unit remains an
existing cue-specific evidence item; this feature does not introduce a new
word-level learning case or merge all evidence about a word.

- Only unresolved deferred proposals are selectable in the first cut.
  Selecting pending proposals or explanation-only items is a later extension.
- The backend retrieves original evidence from retained, learner-owned source
  snapshots. The client supplies selection identity, not enriched evidence.
- Several selected proposals derived from the same original evidence item
  cause that evidence to be included once. Do not collapse distinct attempts
  or cues solely because they concern the same word or have similar text.
- Selecting an item does not include the other evidence items from its source
  bundle. Existing context already attached to the selected evidence is retained.
- The new model receives neither earlier proposals nor review dispositions,
  notes, retry instructions, subsequent study attempts, or refreshed word/cue
  state in this cut.
- Evidence identity may be remapped to avoid collisions in the composed input,
  with a simple source mapping retained. Its substantive historical content
  must not be silently reconstructed from current state.
- Items without usable retained evidence are visibly unavailable; they are not
  silently skipped or retired.

A selected proposal may share its evidence item with an unselected proposal.
The ordinary prompt can generate overlapping advice when reflecting on that
evidence again. The first cut does not suppress such output or add instructions
to preserve particular previous judgments. Only selected originals are retired.

### Study during deferral

Given this sequence:

1. A mistake on word w1 produces proposal p1.
2. The learner defers p1.
3. A later mistake on w1 produces p2, which the learner accepts.
4. The learner requests a second opinion on deferred p1.

The new reflection uses p1's original evidence. It does not include p2 or
refresh the input to reflect p2's effects. Accepting p2 does not itself make p1
ineligible. The learner may dismiss p1 themselves or have a reason to revisit
it. Existing ownership, evidence-availability, authorization, and apply-time
checks still hold; historical evidence does not authorize a stale change.

## Successful replacement and closure

Success means the full bounded request has a validated, durably available new
reflection result. It does not require the learner to accept a proposal, and a
valid result recommending no intervention still counts as success.

Only the explicitly selected originals are retired. There is no automatic
cleanup of all proposals for the same word, no matching of old and new
recommendations, and no attribution of agreement or model credit.

Retirement and durable result availability must remain consistent across errors
and refreshes. Do not lose the originals from active review without a usable
result, or repeat generation merely to finish bookkeeping. If the learner
resolves an original while generation is running, completion must not overwrite
that newer disposition.

Preferred historical copy is “Requested second opinion.” This describes why
the original left active review; it does not claim the advice was wrong. The
disposition is applied on successful replacement, not merely on request submission.

The learner loosely uses dismissal as a poor-quality signal, but also uses it
to remove advice they no longer need. Second-opinion retirement is a distinct
terminal review kind, not a dismissal reason, so learner undo of dismiss does
not treat it as an explicit reject. Quality rates include it in the terminal
denominator without counting it as a dismiss.

Original artifacts remain stored under existing history behavior. A simple link
from a new request to its selected sources is sufficient. No proposal ancestry
graph, endorsement record, consensus score, or credit-transfer mechanism is
required. The generation source is a curated batch, not a fabricated session.

## Generation boundaries

The composed input is a new request, not an exact retry of an original bundle.
Keep normal model/provider identity, input/output versions, run outcome, usage,
and failure records. A transport/schema adaptation to represent the new source
is allowed; it must preserve the existing reflection task and evidence meaning.

Use existing resource bounds and strict validation. The first cut does not
salvage individual proposals from an invalid response or automatically escalate
failures. Prefer one bounded request. If the entire selection exceeds supported
limits, show the limit and require a smaller selection before starting; do not
silently truncate “all” or introduce automatic multi-batch processing.

No selected original is retired on invalid output or provider failure. No
generation outcome accepts, authorizes, or applies new advice. Existing study
behavior remains independent of reflection success, and all source/result
access and provider work remain learner-scoped.

## Deferred potential

These are possible follow-on capabilities, not dependencies or dispatched work:

- Optional personal guidance about what would help, without a chat interface.
- Explicit evaluation of an earlier recommendation alongside its source evidence.
- Independently validated result salvage and focused retries of failed portions.
- Deliberate or bounded automatic model escalation, informed by actual cost and
  human review effort rather than an assumption that cheaper-first is cheaper.
- Reflection informed by subsequent study or current content, if separately
  wanted and specified. Soak time alone does not require this input expansion.

Cross-item synthesis, model debate, automatic periodic reprocessing, exhaustive
provenance, and general workflow-engine infrastructure are outside this cut.

## Acceptance scenarios

| Scenario | Required outcome |
| --- | --- |
| Select deferred proposals from different sessions | New non-session request includes only their original evidence items |
| Select several proposals from one original evidence item | Evidence is sent once; only selected proposals are retired |
| Select different cues or attempts for one word | Distinct evidence remains distinct |
| Accept p2 after deferring p1, then reconsider p1 | Input remains p1's original evidence; p2 is not supplied or changed |
| New answer agrees with the original | Normal fresh review; no agreement bookkeeping or old-proposal cleanup task |
| Valid result recommends no intervention | Selected originals retire; learner can finish through ordinary review |
| Provider or validation failure | Selected originals remain deferred; no partial result salvage |
| Selection exceeds the supported bound | Explain the bound before generation; no silent exclusion |
| An original is resolved during generation | Completion preserves its newer disposition |
| Refresh or repeat submission | No duplicate generation or inconsistent retirement |
| Source evidence is unavailable or belongs to another learner | No provider work on that evidence and no retirement |

Dogfood success means one additional pass often helps the learner comfortably
accept, revise, dismiss, or finish with an item, with less consideration effort
than whole-bundle retries. Token savings are useful but secondary. No new
evaluation dashboard is required to assess the first cut.

## Implementation planning handoff

This specification defines the implemented first cut. It fits one cohesive PR
across the existing generation and review boundaries.

The implementation uses a versioned curated-source envelope, the existing
twenty-five-item bound, and the `requested_second_opinion` review disposition
for closure. It preserves the current prompt's evidence-item
semantics and needs no broader lifecycle model.

Implementation must extend these canonical contracts together with code/tests:

- [Session reflection generation](./session-reflection-generation.md): curated
  source inputs, resource limits, idempotency, and failure isolation.
- [Reflection proposals and handles](./reflection-proposals-and-handles.md):
  selected-original retirement and its distinction from authorization.

The earlier SWI-55 framing kept old and new proposals independently unresolved;
this discussion instead chooses automatic retirement of selected originals
after success. SWI-52's critique-oriented flow remains related future scope,
not a prerequisite. The issue descriptions have not been updated by this file.
No portfolio priority, dispatch state, or stability-frontier classification is
changed here.
