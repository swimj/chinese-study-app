# Preparing and publishing shared repertoire

This guide explains the reusable generation and application mechanisms behind
operator-driven repertoire preparation. It is for contributors adapting that
capability to another content-preparation scenario: what can be reused, which
input and output policies the current command implements, and where a different
policy would require code. The [bulk runbook](../ops/bulk-repertoire.md) explains
how to operate the existing missing-repertoire workflow.

## Capability and scenario

A general repertoire is a collection of standalone production exercises for a
word's selected senses. Different exercises can offer different ways to recall
the same use; a repertoire is not a lesson sequence or a promise to cover every
sense with an exercise. The authoring contract can return no exercises when it
cannot produce faithful practice. That result does not change the selected
learning coverage.

The reusable capability takes lexical evidence, generates and retains validated
candidate material, and publishes it with source checks and attributable evidence.
Preparing shared content is separate from teaching a learner, scheduling practice,
awarding progress, or deciding which content to serve. Publication makes content
available to subsequent session composition under its existing eligibility rules;
it does not rewrite retained sessions.

The current `content:bulk-repertoire` command supplies one scenario around that
capability: fill missing general repertoires for words tracked by enabled learners.
Its cohort allocation, default-sense selection, additive publication and offline
operating procedure are policies for that scenario. A particular cohort size,
model comparison or concurrency setting is an operating choice, not the meaning
of repertoire generation.

## Generate, retain, then apply

The batch workflow has two separate state-changing boundaries: paid provider
work produces retained artifacts, and an authorized application imports those
artifacts into the target database. Generation alone publishes nothing.

1. **Capture inputs.** A manifest records the cohort and a coherent per-word
   snapshot of lexical data, canonical inventory, default selection and fallback
   content. Learner allocation metadata explains the cohort; it is not supplied
   to the authoring model. Fallback snapshots support later drift checks, rather
   than acting as the repertoire prompt.
2. **Generate.** `generateBulkWord` reuses an established inventory and selection,
   or runs their ordinary providers when they are unknown. Partial inventory
   requires operator review. An explicit empty selection is preserved. The
   selected active senses become a canonical authoring source, and the general
   exercise provider produces sense-bound cues using the shared contract.
3. **Retain and inspect.** The run stores requests, raw responses, validated
   stage results, timing, costs and per-word outcomes. Successful work can be
   replayed; uncertain provider attempts require explicit disposition before
   another dispatch of that request. Structural validation does not establish
   linguistic or pedagogical quality. Operators inspect representative material
   before application; the command does not create individual review proposals.
4. **Apply.** `applyBulkRepertoireWord` verifies a retained result and, within a
   per-word transaction, checks eligibility and the exact source snapshot.
   Retained prerequisite responses pass through ordinary inventory/selection
   publication without network calls. Generated sense references are rebound to
   canonical identities, and the shared materializer creates the exercises.
   Invocation evidence, sense/content links and an operator-attributed receipt
   commit with the content. Exact replay returns that receipt rather than
   publishing again.

`verifyBulkWord` reproduces generation using retained responses and the current
prompt builders and validators. It checks requests, raw-response projections and
the resulting source/status, rather than trusting a previously written `ready`
label. A changed contract or source can therefore prevent reuse. The bundle
contains only nonempty `ready` results; empty outcomes do not publish their
generated prerequisites either.

## Reuse boundaries in the code

| Responsibility | Implementation |
| --- | --- |
| CLI orchestration, manifest/run/bundle formats and artifact storage | [`scripts/bulk-repertoire.ts`](../../scripts/bulk-repertoire.ts) |
| Cohort eligibility and allocation | [`bulk-repertoire-selection.ts`](../../server/db/bulk-repertoire-selection.ts) |
| Coherent per-word input snapshot | [`bulk-repertoire-snapshot.ts`](../../server/db/bulk-repertoire-snapshot.ts) |
| Per-word generation and deterministic retained-response verification | [`bulk-repertoire.ts`](../../server/vocabulary/bulk-repertoire.ts) |
| Canonical source projection and shared authoring contract | [`canonical-exercise-source.ts`](../../server/vocabulary/canonical-exercise-source.ts), [`general-exercise-authoring.ts`](../../server/vocabulary/general-exercise-authoring.ts) |
| Provider pacing, attempt evidence and cost reporting | [`bulk-repertoire-dispatch.ts`](../../scripts/lib/bulk-repertoire-dispatch.ts), [`bulk-repertoire-report.ts`](../../scripts/lib/bulk-repertoire-report.ts) |
| Transactional application, imported provenance and idempotency | [`bulk-repertoire-apply.ts`](../../server/db/bulk-repertoire-apply.ts) |
| Shared exercise materialization | [`general-exercise-content.ts`](../../server/vocabulary/general-exercise-content.ts) |

The conceptual distinction between mechanism and policy is not a configurable
policy interface. Eligibility is called by both planning and application;
application also contains the shared, additive publication rules. Reusing the
engine for another scenario can require changing those functions, not merely
supplying different command-line arguments.

The authoring contract and materializer are also shared with ordinary preparation.
The [post-teaching path](../vocabulary-learning.md#post-teaching-practice-preparation)
uses a retained teaching source with verified canonical mappings, while bulk and
[reconciliation preparation](vocabulary-content-improvement.md#sensecontent-reconciliation)
use canonical sense evidence. Sharing the authoring machinery does not make
these inputs or their authorization lifecycles identical. Reflection creates
reviewable proposals; this batch path applies an operator-attributed maintenance
bundle. The [architecture contract](../../SPECS/vocabulary-architecture.md#generation-review-and-application-authority)
explains preparation and proposal authority.

### Automatic authoring model

The first general practice pool after teaching and an unassigned first
repertoire job in reflection share a word-level allocation: two buckets use
GPT-6 Sol high and one uses GPT-6 Luna high. A word stays in its bucket across
entry points and retries. The allocation applies to general exercise authoring;
inventory, useful-sense selection, and other reflection steps keep their own
routes. The exercise brief and validation are shared across model arms.

Saved reflection choices take precedence, including operator-selected models
and routes saved before this policy. Existing published pools are reused;
queued post-teaching work binds the current authoring brief when claimed.
Reconciliation replacements and operator bulk runs retain their separate model
policies. The invocation ledger records the model that actually authored each
result.

## Adapting the scenario policies

Prefer reusing generation, verification, evidence retention and transactional
application over creating another prompt or import pipeline. Start by identifying
which decision the new scenario changes:

| Decision | Current policy | Where a different scenario needs work |
| --- | --- | --- |
| Which words qualify? | Tracked words with no authored general repertoire, excluding conflicting editorial/preparation work | Change selection and the application-time eligibility check together. Changing only the manifest cannot make an untracked word applicable. |
| Which words go first? | Due-first within each learner, round-robin unique words across learners | Change cohort construction. Limit, model, effort and concurrency are CLI options; arbitrary filters and allocation strategies are not. |
| Which senses supply the repertoire? | Shared default-useful selection, preserving unknown versus explicitly empty selection | Change source construction and the corresponding publication/rebinding checks if another selected scope is intended. Do not reinterpret an empty result as a new coverage decision. |
| What content changes on publication? | Add shared active exercises; preserve existing content, fallback identities and learner history | Enrichment, replacement, retirement or another publication scope needs an explicit authority and effect policy, plus application changes and tests. The current command rejects any existing authored repertoire, including private or retired content. |
| When and where can application run? | An existing schema-current database, maintenance enabled, provider work disabled and all application writers stopped | Online application would need its own concurrency and authorization design. Removing the stopped-writer check is not sufficient. |

The automatic-preparation guard answers a different question from bulk
eligibility: active shared authored repertoire satisfies ordinary automatic
demand. Bulk eligibility conservatively excludes authored repertoire in any
scope or availability. Neither predicate measures whether an existing pool is
complete or good enough. Explicit approved reconciliation replacement retains
its separate authority even when exercises exist.

For a new scenario, preserve source freshness, canonical binding, attributable
invocations, atomic effects and idempotent replay. Review how its output interacts
with ordinary preparation and serving before widening eligibility. Extend
[selection tests](../../tests/bulk-repertoire-selection.test.ts),
[generation/resume tests](../../tests/bulk-repertoire-resume.test.ts) and
[application tests](../../tests/bulk-repertoire-apply.test.ts) around the changed
policy. Those tests cover the current mechanism with fixtures; they do not certify
generated content quality or a future policy's suitability.
