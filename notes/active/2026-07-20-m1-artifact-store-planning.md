# M1 artifact store — planning memory

status: active
type: planning
created: 2026-07-20
retire-by: 2026-09-20
related:
  - PLANS/agentic-roadmap-glm-5.2.md (M1 — Reflection Artifact Store And Handle Registry)
  - notes/active/2026-07-20-llm-provider-spike-summary.md (provider decision, integration posture)
  - notes/active/2026-07-10-session-evidence-bundle-design.md
  - SPECS/reflection-proposals-and-handles.md
  - PLANS/initial-reflection-steel-thread.md

Working memory for M1 planning. Append observations as they surface; collate into
a work order later. Not a spec. Durable conclusions graduate to `SPECS/` or a
milestone plan once the design stabilizes.

## Purpose of this note

Capture the scattered thinking from the M1 artifact-store conversation so it
survives the session. The handle-registry half of M1 is not covered here yet.

## Framing: reflection artifact as durable carrier of disposition

Initial gut instinct was "reflection is a consumable log — materialize once into
an in-memory representation, then discard after the user works through it." The
only obvious need for persistence was bridging the time gap between session
completion and reflection consumption.

Reframe: the roadmap treats the artifact as a **durable carrier of disposition**,
not a consumable. The artifact isn't done when the user works through its
suggestions — it's done when downstream consumers (planner, evaluation,
extraction) have read its dispositions. "Discard after consumption" silently
assumes the only consumer is the user, in the moment.

### Purposes persistence serves, in rough order of becoming load-bearing

1. **Time-gap bridge** — session done → reflection consumed later. (The obvious one.)
2. **Disposition lifecycle** — proposed / accepted / applied / dismissed / deferred
   / superseded / marked-wrong. The user's response is *recorded onto* the artifact,
   not consumed. Dismiss-today-reopen-tomorrow only works with mutable state.
   **Near-term value:** enables different UI flows over the same core reflection
   data without re-deriving it. This is the one with near-term dogfooding value.
3. Inter-milestone interface to the planner (M5) — durable, addressable
   dispositions read weeks later.
4. Legibility across layers — "why was this in my session" rationale cites
   reflection dispositions by id.
5. Cross-artifact analysis (M6 extraction + developer-facing backlog).
6. Evaluation attribution (M6) — "did this intervention help?"
7. Provenance / versioning — model/prompt/schema version per artifact; re-run
   when prompts improve; API-decision reconsider bar; "why did the agent say X"
   support at M4.

**Scope decision:** only #1 and #2 are load-bearing for the first dogfood. #3–#7
are real but their consumers land in M4/M5/M6. Keep the store cheap now, as long
as we don't make structural choices that block #3–#7 later.

### Stickiness observation

The sticky part is the **handle payload schema**, not the storage substrate.
M1's own risk note says "handle schema design is sticky," not "artifact table
design is sticky." So the artifact store can be naive without being
architecturally risky, provided:

- each artifact has a stable id (planner/legibility can address it),
- the body is a versioned blob (provenance survives),
- disposition is a first-class mutable field, not baked into the body,
- handle payload validation is not skimped on (separate workstream — the registry).

## Scope reduction: developer-facing artifacts out of M1

The spike changed the read on developer-facing reflection:

- Writing a user-facing reflection prompt felt natural — it roots in general
  study and language principles.
- A developer-facing prompt would effectively need to be a very good
  architecture doc, which is a different and harder authoring problem.
- The developer-facing artifact may actually be a *function of* the user-facing
  reflection output (among other inputs). Future direction: both user-facing and
  developer-facing reflection are projections of a more fundamental "linguistic
  analysis" pass. Explicitly future — do not let it expand M1 scope.

Consequence: M1's artifact store is **learner-facing only**. The roadmap's
"typed outputs but not handles… keeping them distinct prevents over-engineering"
dual-concern is dropped for M1. Simpler.

Side benefit surfaced by the spike: user-facing reflection emphasized the need to
get the schema right in model evaluation. That schema work is the dependency that
gates the store design (see below).

## Superseded storage shape — retained for planning history

The shape below was superseded by the accepted canonical contract and steel
thread during Slice 0. It is retained only to preserve the design trail; do not
implement it. The current shape is:

- one immutable artifact provenance/blob row;
- one seeded mutable review row per proposal, keyed by artifact, item, and
  proposal index; and
- one immutable authorized operation invocation with a mutable application
  projection for each accepted or user-authored operation.

The artifact body remains the source for original proposal content. Proposal
reviews do not duplicate operation payloads, and informational item results
with no proposals receive no lifecycle row. See
[`SPECS/reflection-proposals-and-handles.md`](../../SPECS/reflection-proposals-and-handles.md)
and [`PLANS/initial-reflection-steel-thread.md`](../../PLANS/initial-reflection-steel-thread.md).

## Historical storage shape — superseded

- **One DB table for the artifact** (provenance anchor, not lifecycle):
  artifactId, session id (forensics-only, not load-bearing), generated-at,
  model/prompt/schema version, and the full raw blob in a column for long-term
  analysis.
- **A per-item table** (seeded projection, mutable): keyed by (artifactId,
  itemId), duplicates handle kind + payload into the row, owns the disposition
  lifecycle. Seeded once at materialization, never recomputed.
- **No artifact-level lifecycle state** for now — just provenance. Per-item
  state only. If "artifact archived" is ever needed, derive it from per-item
  states.
- **Thin store interface seam** kept anyway (cheap; preserves a future
  object-storage swap even though V0 backing is a DB column).

### Confirmed distinctions

- **Blob = immutable content + provenance; per-item table = mutable lifecycle,
  seeded once from the blob, then owned by the DB.** Not a "materialized view" —
  a materialized view is recomputable, and recomputing would clobber
  dispositions. Vocabulary matters here: seeded projection, not view.
- **No artifact-level *lifecycle* state**, but the artifact-level *provenance*
  row is kept (versions, session backlink for forensics, generated-at) — that's
  provenance, not lifecycle. Confirmed.
- **Duplicating the small handle payload into the per-item row is fine.** The
  blob is there so long-term general analysis has a raw thing to work from. Thin
  row, fat blob.

### Storage substrate choice

- "Blobs outside the DB" was framed architecturally, but DB perf is immaterial
  for V0 (reflection artifacts are tens of KB; SQLite handles that fine). So
  **no separate blob artifact store to start** — keep the blob in a DB column.
  Tooling can make DB calls.
- Trade acknowledged: setting aside file-based tooling consistency means the
  spike's viewer / fixture-diff mindset won't carry over directly; reflection
  artifacts get inspected via DB queries. Accepted.
- Reversibility: DB-column → external-blob-store later is the cheap direction
  via the seam. The harder-to-reverse decision is the per-item schema / item-id
  contract — which is the spike's schema work, not the storage choice.

### Inversion worth remembering

**Dispositions are the precious, irrecoverable part — not the blobs.** A
reflection can be (roughly) regenerated by re-running the agent; a user's
"dismissed Tuesday, reopened Thursday, marked wrong Friday" history cannot. DB
backups matter more than blob backups. Don't let the "blobs are the big files"
intuition make the DB look disposable.

## Dependency direction

The historical per-item disposition table depended on **stable item ids**
emitted by the model. The accepted design instead assigns durable proposal ids
at materialization and locates each original proposal by artifact, item id, and
proposal index. The store design remains **downstream of the spike's output
contract**, not standalone, but model-generated proposal keys are no longer a
durable dependency.

This honors the roadmap's "schema-first before the agent" decision: the store
is designed against the fixed contract, not retrofitted to whatever the model
emits.

## Open / deferred (not forgotten)

- Per-item vs per-artifact disposition: confirmed per-item only for now.
  Artifact-level state deferred; derive later if needed.
- Blob location (filesystem subdir, gitignore, etc.): deferred — still at a
  higher level of abstraction. Figure out when the storage substrate choice
  actually needs to harden.
- Handle registry workstream: **not covered yet.** This is the other half of M1
  and, per the roadmap, the genuinely sticky part. Next conversation.

## Intake thoughts

Append new observations here without rearranging the main note.

- (none yet)
