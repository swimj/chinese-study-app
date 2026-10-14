# Reflection evidence items, batches, and recovery

status: active
type: research
created: 2026-09-30
retire-when: consolidated into an accepted implementation spec, or declined
related:
  - SPECS/session-reflection-generation.md
  - SPECS/reflection-proposals-and-handles.md
  - SPECS/pure-cue-elicitation.md
  - docs/reflection-frontend-architecture.md

## Purpose and direction

Research toward a streamlined implementation spec. This note preserves the
discussion and open decisions; it does not authorize implementation or replace
the canonical specs. It is not a portfolio backlog or a dispatch packet.

The user endorsed two concepts on 2026-09-30:

- **Evidence item as the boundary** for reflection work and failure isolation.
- **Grouping as a batch** for provider execution, rather than making the group
  the semantic unit that must succeed or fail together.

The user also identified removing the then-25-item session-level cap as a promising
consequence. This is a design opportunity, not yet a settled resource policy.
Cross-session analysis is not expected to be a high-priority feature now or
later; it should not drive this design. That does not remove the existing
ability to select evidence from different sessions for second opinion.

Motivation: a user-reported single-word bundle failed because the model wrapped
its output in Markdown backticks. The incident has not been independently
inspected here. It highlights how presentation mistakes can discard otherwise
useful work, alongside the broader problem of one bad item losing its siblings.

## Current implementation findings

Initially inspected at Git revision `118297a`; the relevant boundaries below
were refreshed against main at `03dfce1` on 2026-10-14. These are implementation
constraints to design around, not reasons to preserve every existing boundary.

| Area | Current behavior | Design implication |
| --- | --- | --- |
| Provider parsing | Diagnosis and promotion decode the entire response, validate its entire schema, then validate its domain contract. | Item validation alone cannot recover a fenced or syntactically broken outer response. |
| Item coverage | Validators require every input item exactly once, without unknown or duplicate IDs. | Partial results need explicit coverage accounting; missing output cannot mean successful omission. |
| Stage progress | Diagnosis and exact enriched promotion input are saved before promotion. | Reuse this checkpoint principle at item granularity. |
| Persistence | One immutable diagnosis/final-evidence/promotion triple is saved per continuation. | Incremental progress requires a revised durable representation. |
| Publication | One final artifact completes the continuation; an artifact blocks further retry. | Publishing successes while failures remain requires a new completion contract. |
| Second opinion | Selected original evidence is deduplicated, remapped, and run through the same staged flow. | Subset execution is established, but deliberate reassessment differs from recovery. |
| Initial admission | Word-overlap filtering precedes taking the first 50 admitted items. | Removing the numeric cap does not itself resolve overlapping evidence. |
| Second-opinion admission | More than 50 distinct selected evidence items is rejected. | Decide separately whether the same batching policy replaces this bound. |
| Reference handling | Stage one derives served-cue identity; stage two still selects durable cue IDs. Provider item IDs have a bounded canonicalization path. | Prevent cue-reference copying errors without weakening exact operation targeting. |
| Rejected output | Ordinary diagnostics retain a 4,000-character excerpt; private failure files can retain full output and evidence, with seven-day cleanup. | Diagnostic files are useful evidence, not a durable item-repair lifecycle. |

Code anchors:

- [`luna-provider.ts`](../../server/reflection/luna-provider.ts):
  `generateDiagnosis`, `generatePromotion`.
- [`reflection.ts`](../../src/domain/reflection.ts):
  `validateStagedReflectionDiagnosisResultV3`,
  `validatePureCuePromotionResultV2`, `validateV8BundleWideProposalConflicts`.
- [`generation.ts`](../../server/reflection/generation.ts):
  `runStagedContinuation`, `runProviderStage`, `materializeStagedResult`.
- [`reflections.ts`](../../server/db/reflections.ts):
  `prepareReflectionGenerationPromotion`,
  `getReflectionGenerationContinuationRetrySource`,
  `buildStagedDeferredSecondOpinionBundle`, `materializeReflectionArtifact`.
- [`evidence.ts`](../../server/reflection/evidence.ts):
  `INITIAL_REFLECTION_MAX_EVIDENCE_ITEMS`, initial bundle admission.

The cap has increased from 25 to 50; the completeness problem remains. Newer
generation paths also include bootstrap requests and standalone pure-cue
reflection. The initial design concerns the staged diagnosis/cleanup path;
inventory adjacent paths and decide applicability explicitly before defining a
shared execution abstraction.

## Reconciliation with cue-reference research

The related chat,
[the exact cueId copying required by current reflection vali…](thread://01a0e636-4fa1-7c60-872e-1e0c8c097422?hostId=local),
was read on 2026-10-14. Its user reported useful linguistic proposals becoming
unusable because exact cue-ID copying fails. The assistant proposed local
references, item-level acceptance, and repairable drafts. Those proposals remain
design candidates; the request to consolidate the research does not accept all
of their policy details.

The two discussions address complementary boundaries:

- **Prevent avoidable reference failures.** The model should choose which cue
  changes, while the server resolves the exact durable target. Candidate labels
  such as `T1`, `R2`, and `P1` could identify supplied target, response, and shared
  cues. Persist their mapping with frozen stage evidence. With batching, scope
  each reference to its evidence item and stage snapshot, so rebatching cannot
  accidentally resolve `T1` against another item. A per-cue keep/retire assessment
  is an alternative wire contract to evaluate, not an additional requirement.
- **Preserve useful output without granting authority.** A validated item can
  complete independently. An invalid coordinated cleanup remains invalid as a
  whole; dropping one bad retirement may change the plan's meaning. A saved
  failed draft can support repair without creating executable proposals.
- **Separate validation from learner disposition.** “Needs repair” would
  describe incomplete generation, whereas deferred describes a learner's
  treatment of a valid result. Sharing a recovery UI is an option, not a reason
  to manufacture deferred proposal rows for invalid output.

Recovery has three distinct intents:

| Intent | Inputs | Meaning |
| --- | --- | --- |
| Retry a failed stage | Frozen stage evidence and exact reference mapping | Produce a valid stage result without repeating completed upstream work. |
| Repair a saved result | Frozen evidence/mapping, saved output, validation issues | Correct a broken contract while preserving the original recommendation where possible. |
| Fresh second opinion | Original diagnosis evidence, without prior proposal text | Obtain independent judgment under the existing reassessment semantics. |

Repair needs an explicit policy for permitted changes: a corrected reference
must not quietly rewrite a linguistic recommendation. All repaired output still
passes full validation. Fuzzy or semantic cue matching must not silently choose
an executable target. Even an exact text match requires uniqueness within the
frozen item; whether to use it automatically or only suggest it remains open.

The earlier chat's statement that only a 4,000-character excerpt survives is
historical. Main now supports private full-output failure files through
[`failure-artifacts.ts`](../../server/reflection/failure-artifacts.ts). Durable
repair still needs explicit ownership, retention, size bounds, and item/run
lineage; an expiring operator file is not that contract. Whether learners see
unvalidated explanations is also an open product decision.

## Working model to investigate

An **evidence item** represents one source event/context requiring judgment,
not merely a word ID or one proposal. An ambiguous target/response pair and its
coordinated cleanup remain within that item. Multiple proposals can still be
independently reviewable where the existing product contract allows it.

A **stage** performs one bounded kind of judgment on an item. The existing
diagnosis -> optional promotion/cleanup path supplies the initial graph; a
general-purpose workflow engine is not a prerequisite.

A **batch** groups items ready for a compatible stage into one provider call.
Batch size is an execution choice, not a requirement for shared completion.
One API call per evidence item is not required for item-level failure isolation.

A **request** groups the work the learner initiated (for example, reflection
after a session). It supplies progress and provenance across batches without
forcing one all-or-nothing result. Exact storage and artifact boundaries remain
open; these concepts are not a proposed table schema.

Candidate flow:

```text
request -> retained evidence items
            -> batches of ready diagnosis work
                -> validated ordinary item -> publication
                -> validated handoff -> frozen cleanup input
                    -> batches of ready cleanup work -> publication
                -> failed item/stage -> bounded retry or visible failure
```

Publication timing in this sketch is provisional. Preserve completed work and
its lineage even if the first implementation chooses to delay visible results.

## Parsing and recovery are separate layers

1. **Envelope decoding:** accept an unambiguous whole-response Markdown wrapper
   around otherwise valid JSON without another model call. Keep original output
   for diagnostics under existing retention rules. Do not infer missing content.
2. **Item validation:** validate each identifiable item structurally and against
   its exact evidence. Track missing, duplicate, unknown, and invalid IDs
   explicitly. Preserve valid siblings without relaxing operation authority.
3. **Stage recovery:** retain valid results and retry only incomplete work, with
   a new attempt record for every provider call.

These are candidate policies. Extracting objects from malformed/truncated JSON
is a separate decision: item-level validation cannot by itself recover them.
An initial cut could retry the affected batch when no trustworthy envelope can
be decoded, while preserving successes already saved from other calls. More
ambitious salvage requires explicit framing and evidence that it is reliable.

## Removing the session cap without unbounded execution

The promising change is to separate **coverage** from **call size**: retain the
eligible work for a request, then process bounded batches. Fifty could
remain a provisional per-call limit without being a permanent session cutoff;
item count alone may still be an inadequate token bound for large items.

Decisions needed before promising full coverage:

- How are all eligible items retained, including work awaiting later batches?
- What bounds input/output size, concurrent calls, retries, and total request
  spend? The current daily spend rule routes/refuses some model choices while
  leaving Luna available; it is not a hard total-execution budget.
- When a budget is exhausted, is remaining work paused, manually resumable, or
  explicitly excluded? Never silently report full completion.
- Does work survive a browser disconnect and server restart, and who resumes it?
  Larger requests make an explicit durable execution policy more important.
- Does overlap admission remain exclusion, become serialization, or require
  consolidation? Moving conflicting items into separate batches does not remove
  their semantic conflict.

Coverage should distinguish successful work, active/pending work, exhausted
failures, and policy omissions. The exact fields and UI copy remain open.

## Decisions to work through

| Decision | Starting preference, not yet accepted | Main question |
| --- | --- | --- |
| Visible partial success | Publish completed items while others recover. | How do Help, history, and run logs represent an incomplete request without duplicate proposals? |
| Retry identity | Same item, frozen failed-stage input, new provider attempt. | What identity and transaction boundaries prevent duplicate completion under retries/restarts? |
| Output checkpoints | Save validated stage output before publication. | Can persistence recovery finish without purchasing another model response? |
| Retry policy | Bounded transient retries; one focused retry for invalid output, then manual recovery. | Which failures qualify, what feedback is sent, and what are the time/cost/model limits? |
| Model choice | Preserve selected model by default. | Is automatic fallback ever permitted, and how is it exposed? |
| Recovery vs second opinion | Share execution machinery, retain distinct intent. | Recovery resumes exact work; reassessment deliberately starts new judgment and may enrich fresh downstream context. |
| Conflicting outputs | Preserve cross-item validation and application preconditions. | Which items wait or fail when affected words or shared destinations conflict across batches? |
| Truncated or malformed response | No speculative object salvage in the first cut. | Is independently framed output worth a later wire-contract change? |
| Historical compatibility | Keep old artifacts readable. | Which old failed runs remain retryable, and does the new contract require explicit version separation? |
| Model-facing references | Resolve short item/stage-local references against frozen server mappings. | Which fields can be derived, and how are mappings versioned and preserved across rebatching? |
| Saved-output repair | Distinguish contract repair from retry and fresh opinion. | What may change, how long are drafts retained, and can learners inspect unvalidated explanations? |

Second-opinion retirement needs particular care: only successfully published
replacement items should retire their selected originals, atomically. Failed,
pending, or omitted selections must remain available. Original selection
provenance must survive batching and remapped provider IDs.

## Invariants to carry forward

- Reflection failure never changes session correctness or repeats study commits.
- No generated proposal authorizes or applies itself.
- Every published item passes strict structural and domain validation against
  retained evidence; malformed siblings confer no authority.
- A retry never silently replaces an already completed result or repeats its
  review rows/effects. Deliberate new assessment has separate lineage.
- Coordinated content changes keep their existing dependency and stale-state
  checks even when different items complete at different times.
- Every provider call retains model, prompt, usage, and failure provenance.
  A result assembled across calls must not imply one model produced everything.
- Coverage and resource limits remain inspectable; no silent loss beyond a cap.

Current canonical specs explicitly describe deliberate retry, whole-result
validation, and final-only artifact publication. Changing those contracts needs
an accepted spec update, not an interpretation that they already permit partial
completion. Nothing here changes the stability frontier.

## Path to a concise implementation spec

Next, work through three concrete scenarios: (1) a fenced but valid response;
(2) ten diagnosis items with one invalid item and two cleanup handoffs, one of
which fails; (3) a request exceeding the current 50-item cap that is interrupted after some
results become visible. Add an overlapping-word/shared-destination case so batch
partitioning cannot hide a conflict. Include partial second-opinion replacement,
an unresolved cue reference, two batched items both using `T1`, and a repair
attempt that changes more than the permitted fields.

Use those cases to settle, in order:

1. Item/request identities, completion meaning, and publication timing.
2. Durable stage checkpoints, retry classification, and restart ownership.
3. Batch/resource limits, coverage accounting, and overlap handling.
4. Artifact/provenance representation, UI behavior, and compatibility boundary.

Then consolidate only the accepted decisions into a short implementation
contract: outcome and non-goals; state transitions; persistence/API changes;
retry/resource policy; migration/versioning; and scenario-based acceptance
tests. Keep this research trail out of the final spec unless it explains an
important tradeoff. Do not turn every possibility above into required scope.

Likely verification owners are `reflection-provider.test.ts`,
`reflection-generation.test.ts`, `reflection-generation-isolation.test.ts`,
`reflection-store.test.ts`, the second-opinion tests, and the reflection run-log
UI tests. Implementation sizing and PR boundaries should follow the settled
contract, rather than committing now to a generalized workflow system.

## Relationship to existing work

[SWI-23](https://linear.app/swimj/issue/SWI-23/replace-the-fixed-reflection-bundle-cap-with-bounded-complete)
already owns bounded complete processing. Keep that outcome there rather than
opening another cap-removal task. Item-level completion/recovery is the proposed
foundation; cap removal follows once the accounting and resource contract are
settled. Designing both together avoids baking the current cap into the new
item lifecycle, but does not require implementing both in one release.

[SWI-32](https://linear.app/swimj/issue/SWI-32/audit-and-reground-reflection-schema-versioning)
owns the wider versioning audit. Coordinate the wire/canonical/reference-map
and retry compatibility decisions with it; do not turn the entire audit into
an automatic prerequisite for this narrower work.

[SWI-27](https://linear.app/swimj/issue/SWI-27/expose-actionable-schema-validation-diagnostics-for-failed-reflections)
and [SWI-55](https://linear.app/swimj/issue/SWI-55/let-learners-re-reflect-on-a-curated-batch-of-deferred-items)
provide existing diagnostics and second-opinion context. Their implementation
is a substrate to inspect, not work to recreate. Linear owns current ordering
and readiness; this note retains the design rationale only.
