# Cue as a first-class learning unit — brainstorm

status: active
type: research
created: 2026-08-04
retire-by: TBD (this is a brainstorm, not a task-spec)
related:
  - SWI-24 (Linear) — design the initial production-task and cue contract
  - SPECS/study-action-model.md (production task / cue boundary)
  - SPECS/reflection-proposals-and-handles.md (repair_production_cue)
  - STABILITY_FRONTIER.md (cue-repair loop near-term outcome)
  - notes/active/2026-07-06-session-reflection-workflow.md (cue-as-broader-than-gloss intuition)

## Purpose

Disorganized running capture for the cue-brainstorm branch. Not a task-spec, not
exhaustive, not a checklist. The SWI-24 questions were prompts to elicit concern
areas, not an enumeration. Use this doc to gather findings as they come and let
structure emerge.

## Orientation snapshot (2026-08-04)

- Today's production "cue" is not an entity. Served prompt = visible
  `word_meanings` rows (filtered by `show_on_production_prompt`) with a
  `word.meaning` fallback. No durable cue id, no task id. `bad_prompt` is a
  per-word flag, not cue identity.
- Reflection steel thread (SWI-16) is done; `repair_production_cue@1` proposals
  can be generated and reviewed but application is `unsupported` (no cue model /
  no faithful adapter).
- SWI-24 is the design gate (Focus, In Progress, design-only). Frontier
  near-term outcome: dogfood one learner-approved cue-repair loop where a later
  production action presents the repaired cue and attempt evidence preserves
  the exact task/cue used.

## Decisions tentatively landed

- Ship a new `set_production_cue` v2 as the faithful replace/activate operation.
  V1 stays `unsupported` for automatic application.
- V1 drafts brought into v2 via *supersession*, not reinterpretation: one-off
  script pre-fills a v2 editor from an accepted V1 draft; on approval a
  user-replacement v2 invocation supersedes the V1 proposal (§7 already defines
  this). V1 invocations stay historically `unsupported`. Lower priority,
  scriptable, dogfood-useful.
- Cue cardinality: ordered cue list per task, first active wins. Leaves room
  to layer gloss + cloze + anchor later without schema change.
- Task granularity: DEFERRED — gated on the case analysis (SWI-24 deliverable
  #5). Do not decide one-task-per-word vs sense-split a priori.

## Strawman v2 contract (to pressure-test, not commit)

```ts
type SetProductionCueOperationV2 = {
  kind: 'set_production_cue';
  version: 2;
  wordId: string;
  taskId: string;            // 'default_production' in V0
  cues: Array<{
    cueType: 'definition_gloss' | 'cloze' | 'minimal_context' | 'register_or_domain_hint';
    text: string;
  }>;
  mode: 'replace_active';
};
```

Effect: deactivate existing active cues for (wordId, taskId), insert new
active cues in order, attribute to invocation. Selection: first active cue,
else gloss fallback. Non-effects: no meaning mutation, no scheduling change,
no answer-class, no history rewrite. Reversal = forward operation with empty
cues (re-exposes fallback) or later `deactivate`; no destructive delete in V0.

`StudyContentRef` gains `{ type: 'production_cue'; taskId; cueId }`; attempt
event snapshots cue text (already has `contentRef` + `metadata`).

## Higher-level thread: cue as a top-level learning unit (2026-08-04)

Captured from user, loosely:

- Maybe cue deserves to be elevated to a top-level learning unit, not
  subordinate to word. Word is still important: drives recognition and is an
  example unit for *patchwork learning with emergent structure* (bottom-up
  vector the product already does well).
- There is a separate *top-down* learning vector mentioned in the past, far
  off and not concrete yet. First-class cues are a small representative of it.
- Top-down framing: language growth = ability to, given a scenario /
  circumstance, find the right words for it. May be 1-to-1 with vocabulary but
  importantly does not have to be.
- SRS / due-workload orientation made first-class cues infeasible (state
  explosion of review load). Budget-based / minimal-effective-dose workload
  relaxes that constraint.
- Deep growth is not increasing memorized load; it is intuiting the language
  so deeply that a random cue elicits an appropriate word / saying (perhaps
  one among many).
- Agent judgment unlocks this — otherwise deterministic grading would be a
  nightmare.

Open / to pressure-test:
- "First-class" along which axis? Content identity / authoring target vs
  scheduling object. The spec already says cues are not independently
  scheduled. So first-class content ≠ first-class scheduling. Which does the
  user mean?
- Two vectors may have *opposite primary keys*: bottom-up is word → cue;
  top-down is cue → answer space (words as members). Do they share
  infrastructure or fork?
- Evidence attribution: if a cue elicits "one among many" acceptable words,
  which word's production skill does the attempt update? Strains the current
  per-word-skill projection.
- Trust boundary: agent judgment for *grading* (real-time, affects scheduling)
  is a bigger lift than agent judgment for *repair proposals* (async, learner
  authorizes). Distinct decision.

## Case analysis candidates (to draft later)

From the 2026-07-06 exemplars, picking ones that stress the contract:
- 给(jǐ) / 供应 — polyphonic + broad-vs-provisioning. Task granularity + cue split.
- 商标 / 标志 — multi-gloss, one fragment invites wrong word. Cue anchor vs answer class.
- 难怪 / 怪不得 — near-interchangeable. Answer class vs cue repair (is this a cue problem?).
- 落成 / 建成 — formal vs ordinary completion, near-valid alternate. Task/sense split + answer class.
- 熏制 / 烤制 — legitimate lapse, prompt should stay unchanged. "Do nothing" boundary.

## Loose log

(dated entries as we go)

### 2026-08-04 — facade-first strategy for the top-down vector

User clarified: cue-as-top-level-unit is *vision-level*, not near-term. Values
incremental building + dogfooding; steps toward the vision may be temporarily
divergent *so long as we understand and acknowledge that*. Short term stays
word-keyed (cues as content, no scheduling change). The scrutiny point: is
this a useful intermediate step toward the top-down vector, or just a better
bottom-up thing relabeled?

On 难怪/怪不得: short term it's "word owns an answer class" (bottom-up) due to
building inertia. The hope is that *to the user* it can begin to *appear as*
"cue owns the answer space" (top-down), proving the product idea, then we
rearchitect the modeling underneath.

Pressure-test notes:
- Facade holds at presentation layer (learner sees a cue accepting multiple
  words). Leaks at evidence/scheduling layer (which word's skill advances) —
  invisible to learner short term, so OK for "prove to user."
- Visible crack: directional asymmetry. `accept_production_alternate` is
  directional (§5). Cue-first answer spaces are symmetric. If the same cue
  targets 怪不得 and 难怪 is *not* accepted, the facade cracks. Cheap to paper
  over for pairs (duplicate the relation), explodes for bigger answer spaces.
- Sharper divergence to acknowledge: cue repair's typical move is *narrowing*
  (overloaded gloss → one learner-relevant sense → one word). The top-down
  vector's move is *widening* (cue owns a multi-word answer space). Same cue
  abstraction, opposite cardinality direction. So cue repair proves the cue
  *abstraction* but may not prove the top-down *idea* unless the dogfood set
  deliberately includes widening cases.

### 2026-08-04 — cue types as the bridge, not split-brain

User's unifying move: cues can legitimately be of different *types*, and type
is the bridge between bottom-up and top-down rather than a split. The spec
already hints at this (cloze / definition_gloss / register_or_domain_hint).

- Bottom-up cue type: most/all native speakers would 1-1 map the cue to the
  target word. "What's the word for aerobic exercise." Answer space = 1.
- Top-down cue type: a broad circumstance where various answers a native
  speaker would find acceptable — not necessarily equivalent. "No wonder!"
  Answer space = many; the refinement (which answer fits which nuance) can
  itself be a later-added dimension to cues.

So cue *type* carries answer-space cardinality and grading shape. Same
abstraction, shared infrastructure, no split-brain. The cardinality-direction
tension from earlier dissolves: narrowing and widening are both legitimate
cue types, not competing vectors.

### 2026-08-04 — catalog of things we could be doing (zoom-out, pre-scope)

Multiple outcomes possible from this discussion: dev-cycle direction +
strategic/probing + experimental. Gather first, scope later.

Dev-cycle (closes the frontier loop):
- SWI-24 design memo + spec edits (v2 contract, task granularity, provenance,
  legacy compat).
- Cue-repair vertical implementation (cue row, set_production_cue v2 adapter,
  served-action contentRef extension, attempt snapshot).
- V1-draft migration script (supersession to v2).
- Case analysis (SWI-24 deliverable 5).

Cue-type / abstraction work:
- Cue type as first-class attribute carrying answer-space cardinality + grading
  shape (the bridge).
- Answer-space modeling for multi-answer cues (accepted set + per-word nuance
  as a later dimension).
- Grading trust boundary: deterministic exact-match for 1-1 cues; agent judgment
  for "acceptable expression for this circumstance." Real-time grading is a
  bigger trust lift than async repair proposals.

Top-down vector (strategic / probing):
- Deliberate top-down prototype: a cue whose answer space is 2+ distinct words
  (not near-synonyms) to actually test the idea.
- Scenario-cue authoring origin (reflection? separate surface? curated?).
- Probe what "the top-down thing mentioned in the past" actually is.

Workload / scheduling model:
- Budget-based / minimal-effective-dose workload — the enabler for first-class
  cues without state explosion. Prerequisite or parallel?
- Evidence attribution for multi-answer cues: which word's skill advances?
  Strains per-word-skill projection; may need a cue-elicitation skill or
  many-to-many projection.

Cross-cutting / experimental:
- Facade-first dogfood: present word-keyed model as cue-first to learner,
  measure feel before rearchitecting.
- Cue-as-content vs cue-as-scheduling: keep the split explicit; cues may never
  become due cards even in the top-down end state.
- Agent-judgment infrastructure: async repair-proposal boundary vs real-time
  grading boundary are distinct trust lifts.

### 2026-08-04 — the feeling of cues (exploration, pre-planning)

Stepping back from work planning. Exploring what cue-based drills *do* in
language learning, what skills they strengthen. Mandarin-specific where
useful. Goal: get the feeling before planning, gather belief in the stakes.

A gradient of skills cue types can train, from form toward use:
- retrieve form (gloss → hanzi): form-meaning binding, production direction.
  Current app lives here.
- pick the right sense (anchored gloss → one sense of a polysemous word):
  sense selection, a first step into lexical depth.
- fit a syntactic slot (minimal context / frame): collocational/syntactic
  competence — where the word *goes*, not just what it means.
- match register/domain (register hint): sociolinguistic competence — *when*
  the word is appropriate. This is the layer that separates "I know it" from
  "I can deploy it."
- say something for a situation (circumstance cue, multi-answer): pragmatic /
  expressive competence — reach for *an* appropriate expression, not *the*
  word. Nuance refinement is a later skill on top.

This maps onto form / meaning / use (Hymes/Canale-Swain): current app is at
form/meaning; cues are the vehicle into *use* without abandoning form/meaning.

The stake in the ground, sharpened: the goal of vocabulary study is not to
know more words but to have the lexicon *available to the world's situations*.
Cues are the drill family that trains that availability. "Deep growth" =
use-availability, measured by cue-based drills, not by recognition or
gloss-retrieval.

Mandarin-specific color:
- Hanzi form vs sound: production currently tests typed hanzi. Cues could
  separate pinyin-retrieval from form-retrieval, or test phonological
  disambiguation (给 jǐ/gěi).
- Near-homophones (考查/考察, 必需/必须): sound doesn't disambiguate, so
  context-cues carry the load — a Mandarin-specific sweet spot for context cues.
- 成语 / four-character idioms: almost defined by the situations they fit —
  a natural home for top-down circumstance cues.
- Functional items (classifiers, aspect particles, sentence-final particles,
  conjunctions): the cue is a *slot/function*, the answer is the item that
  fills it. A different family — functional cues, not lexical ones. This is
  where grammar drills could live.

Affective tension to sit with: top-down multi-answer cues may be *less
satisfying* as SRS items because the "right answer" is fuzzier. The reward
loop of "I got it right" is cleaner with one answer. Budget-based workload
partly addresses this (not every cue is a due card), but the *does the
learner feel progress* dimension is real for top-down cues and worth feeling
into, not solving yet.

### 2026-08-04 — reframe: the unit of value is the instinct, not the cue

User's reframe: app practice is useful insofar as it builds *instincts* —
fast, reasoning-bypassing responses correlated to real language usage. Most
language needs to short-circuit reasoning; even reasoning with language needs
a robust underlying linguistic network.

- Recognition is low-hanging fruit: you go from "paging in the word" to
  seeing the word and having a sense/picture flash. The stimulus (hanzi)
  resembles what you encounter in real usage, so the trained instinct transfers.
- Production *can* be that, but current glosses often force a reasoning loop
  (long gloss, many fragments) or train an instinct coupled to visual
  artifacts of the cue (order of English letters/words), so correlation to
  real usage is muddied.

"Everything actually is a cue" in the semantic sense — a cue is anything that
elicits a response in the receiver. So cue is a *role*, not a unit. The
thing that's first-class is the instinct (the instinct-formation loop); cues
are the eliciting stimuli.

Sharpened criterion — cue quality = ecological validity of the stimulus +
transferability of the trained instinct:
- A good cue is one whose stimulus resembles something the learner will
  actually encounter in real usage, so the instinct transfers.
- A bad cue (long English gloss) is ecologically invalid — you never
  encounter English glosses when using Mandarin — so the instinct couples to
  the cue artifact, not the concept.

What this does to earlier threads:
- The cue-type gradient (form → meaning → use) becomes a gradient of
  *ecological validity*. Retrieve-form (gloss → hanzi) is low-correlation
  because the stimulus is ecologically invalid. Situated-expression
  (circumstance → expression) is high-correlation because the stimulus is
  real-usage-shaped. Top-down is the instinct-formation sweet spot not because
  it's "deeper" but because its stimulus is ecologically valid.
- Recognition's success and production's failure are the *same* criterion:
  hanzi is an ecologically valid stimulus; English gloss is not.
- Cue repair's point = shift the trained instinct from cue-artifact-coupled
  to concept-coupled, so it transfers. A cue is worth repairing when its
  stimulus is ecologically invalid and a repair can make it more valid.

Two layers of practice:
1. Artificial overtraining that reshapes raw mental conditions (poetry
   recitation, pattern drills). Low transfer, ground-prep — grooves pathways
   that later leak into real language.
2. Ecologically-valid drills that wire transferable instincts.

Tension within the two-layer model: overtraining (layer 1) can *undermine*
transfer (layer 2) if the overtrained pattern couples to an artifact — that
is exactly the current production failure, not a separate thing. Rote poetry
may groove transferable/neutral pathways (good); rote gloss-to-hanzi grooves
pathways coupled to English strings (bad). So layer 1 needs a quality
criterion too: overtraining is valuable when the pattern is transferable or
neutral, harmful when it couples to artifacts.

### 2026-08-04 — coming back to the present: initial wedges

User's constraints for near-term:
- Don't scrap what we have; add learning-pathway experiences to generate
  info on what works / how to balance modes, in light of the instinct vision.
- Don't immediately reorient near-term architecture around "everything is a
  cue"; keep the term narrower for upcoming dev.
- Some artifact-coupling is acceptable (100% efficiency is impossible in L2
  adult learning; the activity is artificial by nature). Manage it, don't
  eliminate it.
- Grander vision: "learner evaluation" — square drill-strength against actual
  language ability; a system that *learns* what works for whom rather than
  prescribes. Wedges should generate evaluable signal, not just be features.
- Recognition is easier to supplement with reading than production is with
  speaking/writing — so the ecological-validity gap is harder to close for
  production, which is why production is the more valuable problem.

Wedge candidates along the ecological-validity gradient (cues stay narrow;
vision is the evaluation lens, not the architectural commitment):

- W1 cue-repair vertical (SWI-24 frontier loop): ship set_production_cue v2,
  apply repaired cue, serve next session, record on attempt. Narrow cue
  meaning; closes the frontier loop; directly improves the muddied-instinct
  problem for existing production. Baseline, committed.
- W2 minimal-context cue type: short frame constraining answer to one word
  ("人们站在房子___" → 四周). Cheap on top of W1 (another cueType in the
  same cue row). Tests the ecological-validity gradient *within* the narrow
  cue meaning — does a context-cue feel more transferable than a gloss-cue?
  High signal-to-cost, no architectural divergence.
- W3 register/domain-hint cue type: "职场管理语境下，形容做事干练的能力" → 才干.
  Tests the sociolinguistic/appropriateness layer. Cheap on top of W1 but
  needs the learner to have some register sense already.
- W4 circumstance/expression cue (first top-down wedge): cue owns a
  genuinely multi-word answer space ("no wonder!" → {难怪, 怪不得}),
  agent- or self-graded. Most ecologically valid stimulus; the only wedge
  that tests the top-down vision. But most architecturally divergent (breaks
  word-keyed assumption, needs agent grading) — the user said keep cue narrow
  for near-term dev. Hold as second wave.
- W5 functional/slot cues (classifiers, particles): cue = grammatical slot,
  answer = item that fills it. Opens grammar pathway but the stimulus is
  metalinguistic (a description of the function), which is itself somewhat
  ecologically invalid. Later.
- W6 decontextualized-vs-contextual recognition A/B: cheap throwaway
  experiment testing whether isolated-hanzi recognition trains a less
  transferable instinct than in-context recognition. Side-experiment, not a
  pathway addition.

Recommended sequencing: W1 (committed baseline) → W2 (cheap probe of the
ecological-validity gradient within narrow cue) → decide from W2 signal
whether W4 (the divergent top-down wedge) is worth the architectural cost.
W2 is the keystone: if context-cues feel meaningfully more transferable than
gloss-cues, that's evidence the vision is right and W4's divergence is
justified; if W2 feels the same as gloss, the vision is weaker and W4
should wait. The instinct vision becomes the *evaluation lens* for the
wedges rather than the architectural commitment, matching the user's
constraint.

### 2026-08-04 — W1-4 as one shot; W2 forces W4

User's convergence: W1-4 can be done in one shot if specced well.
Reversibility is low concern — scheduling stays word-based, so W1-4 is
*additive content persistence* layered on top of the existing word-based
scheduling, not an architecture change. Unlinking is easy.

Key insight: W4 is *forced* by W2, not a separate decision. MCP (minimal
context production) cues will often admit multiple reasonable answers; being
overly strict on them recreates the overtraining/artifact-coupling problem.
So the W2→W4 boundary isn't a decision gate; W2's natural evolution pushes
into W4. This dissolves the "architecturally divergent" worry: if
scheduling stays word-based, a cue owning a multi-word answer space is a
*content-layer* change, not an architecture change. The only real remaining
cost is agent grading, which can be staged (self-grade now, agent-assist
later).

Unified spec shape implied by W1-4-as-one-shot:
- Cue content layer (not scheduling): cue rows with { cueId, cueType, text,
  active, attribution, answerSpace, schedulingAnchorWordId }.
- Scheduling unchanged: word/word-skill state drives admission. Cue rows
  are content.
- Cue type → grading policy: 1-1 cues (W1/W2/W3) deterministic exact-match;
  multi-answer cues (W4) agent/self judgment.
- Answer space cardinality: 1 for narrow cues, ≥2 for circumstance cues —
  same content row, different cardinality.
- Served action + attempt: contentRef gains production_cue; attempt
  snapshots cue text + answer space + accepted answer.
- Legacy: gloss fallback for words without cue rows; bad_prompt remains;
  no auto-migration.
- V1→v2 supersession script (lower priority).

One real spec tension: scheduling attribution for multi-answer cues — which
word gets skill credit when a W4 cue accepts one-of-many?
- (i) cue served because an answer-space word is due; the accepted answer
  gets credit (principled, the due word is the one trained).
- (ii) cue has a primary anchor word for scheduling; anchor gets credit on
  any accepted answer (simpler, slightly artificial).
- (iii) all answer-space words get partial credit (many-to-many projection,
  more complex).

Frontier movement candidate: SWI-24 was scoped as the *smallest* contract for
the cue-repair vertical (W1). The W2-forces-W4 insight shows that cue-type,
answer-space cardinality, and grading policy are not separable from the
cue-repair contract in practice — the "smallest contract" framing
under-scopes the real boundary. SWI-24's scope should expand to settle the
cue-type/answer-space/grading contract together, or a sibling design task
should settle it. Flag for human resolution per STABILITY_FRONTIER §12.

### 2026-08-04 — convergence: scopes settled

User decisions:
- "We shift the undo complexity to the scheduling response" — the
  multi-answer attribution complexity isn't eliminated, it's moved to the
  scheduling layer. Acknowledged, not hidden.
- Scheduling attribution: base on (ii) — primary anchor word gets credit
  on any accepted answer. Becomes its own small design issue, not folded
  into SWI-24. Many short-term things can work with known deficiencies
  because session composition itself will eventually change (explicit
  scheduling becomes more of an indirect lever — ties to budget-based
  workload vision).
- SWI-24 scope: expanded to settle the unified cue content-layer contract
  (cue-type, answer-space cardinality, grading policy, served-action
  provenance, legacy compat). "Smallest" is relative to how the feature
  sits between short-term proof and long-term orientation; the line was
  unclear before this discussion. Human accepted the expansion.

Sibling scheduling-attribution design issue — initial goals:
- Don't false-punish the anchor word: accepted answer (in answer space) →
  anchor gets credit, not punished; rejected answer → anchor punished as
  normal. That's the (ii) semantics.
- Track the cue-to-submitted relationship: persist what was submitted
  against each cue, for later analysis / cue improvement (data layer for the
  learner-evaluation vision).
- Propose another cue: persistent cue-to-submitted-non-anchor pattern →
  reflection hook to propose re-anchor or split.
- Word-to-cue affinity as a factor in cue selection when scheduling: when a
  word is due, prefer cues where that word is the anchor (or in the answer
  space). The scheduling-side lever that makes the content layer get used.

Two scopes now settled:
- SWI-24 (expanded): unified cue content-layer contract — cue row shape,
  cue-type → grading policy, answer-space cardinality, served-action
  contentRef + attempt snapshot, legacy gloss fallback, V1→v2 supersession.
- Sibling issue (new): scheduling attribution for multi-answer cues — (ii)
  base + the four goals above.

### 2026-08-04 — supersessions during memo tidy-up

Two brainstorm tentative decisions were superseded while writing the
SWI-24 memo, per the human's 2026-08-04 direction:
- Selection policy: "first active wins" → multi-active cues with
  round-robin/random selection (leverages reflection already drafting
  multiple cues; scheduling-independent).
- Scheduling attribution: "(ii) anchor gets credit" → "no false-punish,
  no false-strengthen"; detailed attribution deferred to a sub design item
  owned by the human.
- Task granularity: one-default-task-per-word now resolves the earlier
  deferral for V0 only; sense-specific tasks remain an explicit seam.
- accept_production_alternate: stays unsupported; alternates grow via
  set_production_cue v2 answer-space edits only (symmetric, cue-scoped),
  not via the directional non-cue-scoped V1 operation.
- Agent-assist near-miss grading: in scope immediately (not staged), but
  requires a frontier movement (promote out of study-action-model §13
  non-goal) the human will handle.

The memo (`PLANS/swi-24-production-task-cue-contract.md`) is the current
authority; this note's earlier "tentatively landed" and "convergence" entries
are chronology only.
