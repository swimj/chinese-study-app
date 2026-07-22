# LLM provider spike summary and initial integration posture

status: winding-down
type: research
created: 2026-07-20
retire-by: 2026-09-20
related:
  - TASKS.md
  - PLANS/agentic-roadmap-glm-5.2.md (M0 provider decision and developer-facing reflection prototype)
  - notes/active/2026-07-10-session-evidence-bundle-design.md
  - SPECS/reflection-handle-registry-v0.md
  - spikes/llm-provider/README.md

## Authority and purpose

This is a provisional spike conclusion and integration handoff for the next
one to two months. It records the provider choice, evaluation observations,
and the intended initial reflection-agent boundary. It does not replace the
reflection-handle spec, session-evidence bundle design, durable architecture
documentation, or future product decisions.

Graduate durable conclusions into `SPECS/`, `docs/`, or a milestone plan once
the initial integration proves them stable. Retire this note when that work has
either happened or the integration direction changes materially.

## Decision

Use **`gpt-5.6-luna-high`** as the initial reflection model and keep the first
reflection flow as a **single monolithic agent call**.

The initial product value is an approximately "80% saving" assistant: Luna
produces a grounded reflection and proposal set, while the learner/developer
makes the final judgment, accepts or rejects individual actions, and may edit
proposals arbitrarily. Proposal-only authority remains a product invariant;
the model must not mutate durable learner or content state directly.

This is the preferred order of operations:

1. Integrate the monolithic Luna reflection agent behind the existing bounded
   bundle and handle contracts.
2. Improve its prompt against failures observed in real use.
3. Persist adjudication and edit outcomes, producing real-use fixtures.
4. Add observability around run and proposal behavior.
5. Only then test decomposition if a recurring, independently measurable
   failure seam warrants its added complexity.

The current candidate seam is content authoring: a later specialist could
draft contrast-selection prompts or cue improvements after the primary agent
has already made and frozen the diagnosis plus intervention decision. Do not
introduce a planner/debate/multi-agent architecture before evidence justifies
it.

## Compared configurations

The final narrowed comparison set was:

- `glm-5.2-high`
- `glm-5.2-max`
- `gpt-5.6-luna-high`

All runs used `spikes/llm-provider/prompts/reflection-v0.md` and the structured
reflection contract. Raw artifacts live under `artifacts/llm-provider/runs/`;
they can contain study evidence and are intentionally gitignored.

## Quality observations

Across the successful planned runs, Luna and GLM High agreed on the core
Mandarin judgments:

- `难怪` / `怪不得`: the English definition cue is underdetermined; the submitted
  response is a creditworthy alternate, while register/discourse contrast is
  worth preserving.
- `舍不得` / `恨不得`: this is meaningful form/sound interference with near-opposed
  meanings; contrast practice is the appropriate durable response, not
  alternate credit.
- `四周` / `四处`: the bare English cue is ambiguous; the useful distinction is
  static surrounding area versus distributed/action-oriented location.

Luna was materially faster in the successful side-by-side runs while retaining
the needed diagnosis quality. Its generated contrast and cue-repair content
looked weaker than the competing outputs. That is acceptable for the initial
choice: content quality is a more localized and tractable failure mode than
language-aware judgment, latency, and cost together. The first response should
still be reviewed and editable; later real-use data will determine whether the
prompt alone suffices or a content-authoring specialist earns its keep.

This is a small calibration corpus derived from reverse-engineered and partly
speculative cases, not a statistically decisive benchmark. Treat its results
as a directionally useful provider-selection decision, then replace or augment
it with adjudicated real-use fixtures.

## Integration posture

The M0 bundle decision remains unchanged:

```text
completed session
  -> bounded session-evidence bundle
  -> backend Luna call with server-side credentials
  -> structured, locally validated reflection result
  -> proposal review/edit/disposition UI
  -> validated application of explicitly accepted operations
```

The LLM must be post-session, best-effort, and outside the correctness path for
study commits and scheduling. The backend owns provider credentials and all
validation. The UI must make it possible to inspect, reject, edit, defer, or
apply proposals rather than presenting model output as an authority.

## Real-use learning loop

The initial UI should capture enough information to turn normal use into better
fixtures:

```text
session evidence
  -> Luna draft
  -> proposal-level accept / reject / edit / defer
  -> optional rationale and final applied operation
  -> curated regression fixture or prompt-improvement evidence
```

Persist the original evidence bundle, model and prompt/version metadata,
validated model output, each proposal-level disposition, edit history or final
edited operation, and optional human rationale. Distinguish at least:

- wrong diagnosis;
- right diagnosis but wrong intervention;
- right intervention but weak drafted content;
- accepted unchanged;
- accepted after edit; and
- deferred or no action.

The data should serve two different purposes without conflating them:

1. **Fixture curation and prompt improvement:** deliberately selected,
   adjudicated examples with clear expected behavior.
2. **Operational observability:** aggregate run volume, latency, token/cost
   estimates, validation failures, proposal/action mix, and
   acceptance/edit/rejection rates.

## Intake thoughts

Append new observations here without rearranging the main note. Integrate them
into the appropriate decision or design section only when explicitly asked.

- The `valid_alternate` judgment needs reconsideration: clarify its actual
  representational purpose and, if it has one, the conditions under which the
  reflection agent should select it.
- The current reflection path does not incorporate user history. Later context
  engineering work should decide whether history is useful here, which history
  is relevant, and how to supply it without diluting the grounded local
  evidence.

## Near-term follow-ups

`TASKS.md` contains parked tasks for:

- reflection adjudication tracking as part of initial Luna integration; and
- reflection observability as a separate operational concern.

Before ending the spike, review whether this note's provider decision and the
runner's configuration contract need a durable architecture/API record. Do not
promote the provider decision to a canonical spec until the initial integration
has exercised it on real session data.
