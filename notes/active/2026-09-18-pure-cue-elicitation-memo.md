# Pure-cue elicitation (design memo)

status: active
type: research
created: 2026-09-18
retire-when: graduated into a spec/plan, or declined as a direction
related:
  - SPECS/study-action-model.md
  - SPECS/session-reflection-generation.md
  - SPECS/reflection-proposals-and-handles.md
  - STABILITY_FRONTIER.md
  - PLANS/swi-24-production-task-cue-contract.md
  - notes/active/2026-08-04-cue-first-class-brainstorm.md

This is a design inventory, not an implementation contract. Canonical specs and
the stability frontier still describe current behavior. A parked composition
patch ([PR 222](https://github.com/swimj/chinese-study-app/pull/222)) collapses
duplicate shared accepted-sets inside one session; it does not encode this
memo.

Working name: **pure cue**. Product distinction: a **word-owned cue** (subsidiary
of a word's default production task) versus a **standalone elicitation**
(first-class for scheduling and answer judgment). Keep "pure cue" until
ownership is stable enough to freeze the term.

## 1. Problem

Word-owned production still treats a card as "produce this word." Multi-answer
accepted sets and the accepted-non-anchor stopgap only mute punishment. They do
not change covering, interval growth, or the card's story.

Motivating case: 撒谎 and 说谎 are both in review, each with a nearly identical
"to lie; speak untruth" cue, each on the other's accepted list. Mixing them
does not shrink the interval, but both still get scheduled, covering still
wants the scheduled target, and growing the interval still wants a hit on that
target. That trains "which card am I on?" — a scheduler artifact, not Mandarin.

Related case: 机遇 / 契机 under "stroke of luck that is a turning point." Early
blur is a legitimate learning move. Today blur is a terminal content state:
there is no path to implicit teaching or later refinement.

## 2. Invariants (proposed)

1. If a cue cannot distinguish its accepted words, the app must not pretend it
   tested a specific one.
2. Stability and distinctness are separate sliders. The elicitation's clock
   moves stability. A later blur → exposure → probe → split ladder moves
   distinctness. Do not SRS-lapse a whole class because the learner always
   produces one member.
3. Not a migration. Word-owned production remains the default. Promotion is the
   exception.
4. If a word has no remaining distinctive production cue after promotion,
   disable production on that word (existing production suppression / skill
   relevance). Recognition stays word-based. The implicit claim: as long as the
   learner can satisfy the pure cue in any accepted form, the app does not
   require that they personally produce that specific word.
5. Model judgment does not enter live-session grading. Session-time misses stay
   recorded as they happened. Later authorized promotion may compensate
   scheduler state.

## 3. Objects

### Word-owned cue

Default mapping. Going forward, **strict unique mapping again**: the accepted
set is the anchor. Multi-answer is the **promotion criterion**, not a stable
mode of `default_production`. That reverses the SWI-24 V0 idea that
multi-answer lives on the word-owned cue.

A leftover word-owned cue with multiple accepted words is debt, cleaned by the
same reflection path, not a batch rewrite.

### Pure cue (standalone elicitation)

First-class for:

- **scheduling** — its own clock, not "due because a member word is due";
- **judgment** — any accepted member is success for this object; ratings attach
  here, not to a hidden target.

Content: stimulus, accepted word set, optional per-member usage frames and
register notes. A word may belong to more than one pure cue (different axes).

### Distinctive leftover cues

Not a new generator. Reflection already sometimes drafts a bundle: some cues
1-1 on the target, some multi-answer. Keep that.

After promotion, multi-answer drafts become or join the pure cue. 1-1 drafts
that actually elicit this word and not the other remain word-owned. If none
remain, suppress production on that word.

Later **refinement** (always-B → mint a 1-1 for A, or split the blur) is a
separate product with its own prompt. Not required for this architecture to
land.

## 4. Promotion transition

Trigger is reflection, not `acceptedWordIds.length >= 2`. Typical evidence: a
scheduled **target** and a typed **response**; the miss is judged as an
over-broad cue, not a failed 1-1.

Assume first the default initial state (no extra cues). Then, **for each of
target and response** (same policy, not necessarily the same leftovers):

1. Ask whether any natural everyday cue would elicit that word and not the
   other.
2. If yes: keep/add **those distinctive cues only** as word-owned production.
   Do not keep the over-broad gloss on the word.
3. If no: **disable production** on that word.

Existing other cues get the same filter: distinctive → keep; same over-broad
stimulus → deactivate in favor of the pure cue; unrelated → leave.

Symmetric means the **policy**, not cloned effects. 撒谎 might lose production
while 说谎 keeps a collocation only it fits. Both sit in the pure cue's
accepted set.

### Create versus set-add

Target A, response B, and B&C already form a pure cue. The right move depends
on **axis**, not on set membership alone:

- same stimulus/axis → **set-add** A to that elicitation;
- different axis → **create** a new A&B elicitation; B may belong to both.

The model needs the existing class's **stimulus text and notes**, not only
`{B, C}` ids.

Do **not** give the provider a tool loop into the database. Two pieces that
already fit this repo:

- **Evidence, possibly staged** (see §7): intersecting pure cues are supplied
  when the first judgment says they matter.
- **Handle:** one authorized intent in the spirit of "these two are equivalent
  for this stimulus." The adapter reads current membership and either set-adds
  or creates; deactivates over-broad word-owned copies; suppresses production
  when nothing distinctive remains; compensates the originating lapse.

One invocation should apply the content and scheduler effects atomically.

Three-way and N-way: grow the same elicitation's accepted set when the axis
matches; do not mint a new pair-object per confusion.

## 5. Judgment, miss, imbalance

Live matching can stay set-based (it already is). What must move onto the pure
cue is covering, interval/budget credit, and the card story.

| Event | First cut |
| --- | --- |
| Accepted member (including always-B) | Success for the elicitation |
| Empty or truly out-of-set | **Set-level miss** → SRS knockback of the elicitation |
| Always produces B, never A | Success. Do not lapse. Record the produced member (`submittedWordId` is enough). Follow-up: inspect whether unused members are actual learning loss |

Hard/Good/Easy attach to the elicitation. There is no hidden target.

## 6. Clock

SRS is a good **protection** policy (keep a fragile trace from dying) and a bad
**discovery** policy (it never learns that the learner had more margin). Time
allocation can tolerate more fading in the common correct case.

Hybrid, named but not all in the first slice:

- **Fragile elicitation:** ordinary SRS interval. Set-level miss knocks it back
  (including the usual short interval / reinforcement). This is the mistake
  recovery story; it does not need a new philosophy.
- **Strong elicitation:** a **bounded daily (or per-session) budget** among
  strong pure cues so circumstance content cannot flood the due queue. Due-ness
  becomes a weak prior, not an admission ticket.

The threshold (interval, ease, consecutive clean successes, …) is still open.
The **budget tier is not what makes current cards feel wrong**; SRS-only on the
elicitation is enough for a first dogfood. Always-B must not use the knockback
even after the budget tier exists.

Word recognition stays on the word clock.

## 7. Reflection generation: staged calls, not tools

The current lumped reflection prompt asks several kinds of judgment in one
bundle. That already shows up as inconsistency. Promotion adds another:
over-broad vs real miss, then same-axis vs other-axis versus existing classes.

Rejected: model-initiated DB tools (new interaction surface, little familiarity,
fights bounded evidence in / untrusted proposals out).

Preferred shape if a single prompt is not enough: **server-orchestrated
conditional provider calls**.

1. First call: ordinary (or slightly narrower) diagnosis. Outcomes include
   "this miss is an over-broad cue relating target A and response B" versus
   the other existing tags.
2. Backend, not the model, decides whether more state is needed. If yes, load
   intersecting pure cues and related leftover production — not a huge default
   bundle every time.
3. Second call: a **distinct, narrower** provider contract. Known outcomes
   include set-add to an existing elicitation, create a new one, keep/draft
   distinctive word-owned cues, suppress production. Not a second copy of the
   whole reflection schema.

This is still backend-owned generation, outside session correctness. It is
**not** live-session grading.

It **does** tension with the current generation spec's "one attempt = one exact
bundle = one provider invocation." If this lands, that contract needs a version
that records a short chain (each call's bundle, prompt, and result) under one
flow, with retry/idempotency defined on the chain rather than a single blob.
Do not silently reinterpret stored one-shot attempts.

A better single prompt remains an alternative if staged calls are not worth
the machinery for the first promote handle.

## 8. False-lapse compensation

Session commit already happened: Forgot, production interval 6h, ease penalty,
and often **word-level recency**, which can keep recognition out of the next
session. Hours later, authorization says the cue was the problem.

Long-term ideal (defer interval math, or inline model judgment) is parked:
changing the session model is high risk, and live-session LLM grading is not
trusted and contradicts the current grading invariant.

First-cut spec:

- Do not rewrite the attempt. It remains a session-time miss on a word-owned
  card. Append a later cue-evidence judgment plus a **compensating scheduler
  effect**.
- Compensate at least production interval/ease on the **originating target**,
  and recency/admission if that lapse set them.
- If the promote disables production on the target, still compensate recency
  (recognition) and leave production skill in a non-lie state if it can be
  re-enabled.
- Response word is usually not the scheduled row; first cut remediates the
  originating target only.

## 9. Explicitly out of this memo's first landing

- Daily/session budget for strong elicitations (named, not required to land).
- Refinement ladder as a feature (exposure, probe, split, user-requested 1-1).
- Live-session model grading or deferred interval until reflection.
- Batch migration of legacy multi-answer word-owned cues.
- Making every cue an independently scheduled SRS object.
- Time-budgeted planner for the whole session.

## 10. Frontier movement candidate

Settled today: production tasks and cues remain content beneath word-based
scheduling, not independently scheduled SRS objects.

Proposed movement, if this direction is accepted: **some** elicitations may be
session and scheduler objects, while 1-1 production and recognition stay
word-based. Promotion is how a cue crosses that line. Do not edit the frontier
until that is an explicit human decision.

Related non-goal pressure: "no broad new learning-model wave" versus this
narrow slice (only naturally multi-answer cues, via reflection). The slice is
the argument that the wave can stay small.

## 11. Open decisions (still spec-shaped)

- Exact authorized intent payload: model names create vs set-add, versus a
  single "equivalent for this stimulus" intent whose adapter infers the write.
- Threshold that graduates an elicitation from SRS to the budget tier, and
  whether the cap is daily or per-session.
- Whether one reflection item may promote more than a pair (grow `{A,B,C}` in
  one invocation).
- Distinctive-cue quality bar: "promote + suppress now, 1-1 later" is allowed
  so conversion is not blocked on optional 1-1 drafts.
- How the staged generation chain is recorded for retry and provenance.

## 12. Smallest later dogfood (not a build plan)

When implementation is wanted, the smallest slice that would change the
撒谎 / 说谎 feeling:

1. Promote via reflection (create or set-add, deactivate over-broad copies,
   distinctive leftovers or suppress production).
2. One session unit for the elicitation; any accepted member is success.
3. SRS-only clock on that unit; set-level miss knocks it back.
4. Compensate the originating target's false lapse on authorize.

Budget tier, refinement, and staged generation can follow. Staged generation
may want to travel *with* promotion if the axis judgment is unreliable in the
monolith prompt; that is an engineering fork, not a product prerequisite.
