# Diet Bucket Distribution And HSK Delta Tiers

Status: **draft design for review** (2026-09-09). Not yet an implementation
contract. Part 1 is a brief long-term vision sketch and is explicitly subject
to change; Part 2 is the proposed concrete deliverable. Open questions
(§2.11) block implementation, not review of this document.

Related authority:

- [`study-action-model.md`](./study-action-model.md) — dual-pool unstudied
  admission (the current diet behavior this redesign modifies)
- [`intake-triage-advisor.md`](./intake-triage-advisor.md) — accepted V1
  triage contract this design proposes retiring (§2.7)
- [`adaptive_vocabulary_training_product_notes.md`](./adaptive_vocabulary_training_product_notes.md) —
  long-term vision; per-word action distributions (continuity in §1.5)
- [`STABILITY_FRONTIER.md`](../STABILITY_FRONTIER.md) — cohort, onboarding,
  and control-surface boundaries (§2.5)

## 1. Background

The current new-word diet is the full CC-CEDICT corpus globally ranked by
SUBTLEX subtitle frequency, admitted rank-first. This has not proven to be a
productive default:

- Frequency is not learnability or utility. Top-frequency words skew toward
  function words, abstract terms, and subtitle/drama vocabulary.
- Past roughly 2–3k words, adjacent frequency ranks are Zipf noise; a granular
  global ranking converts corpus noise into *systematic, permanent* error for
  every learner.
- Dogfooding only worked because heavy manual overlay correction (the stash)
  compensated. New users arrive with an empty stash, and the dual-pool
  admission split still feeds half of their new-word quota from the diet pool.
- The target beta cohort is intermediate-or-beyond, for whom *where on the
  ladder to start* matters as much as the ordering itself.

The redesign has two goals: a default diet that is defensible without manual
correction, and a small, honest control surface for placing and adjusting it.

---

# Part 1 — Vision sketch: the learner as a distribution over buckets

*This part is a foundation to build against, not a contract. It will change.*

## 1.1 Buckets

The corpus is partitioned into broad buckets. Buckets may be externally
meaningful (HSK tiers, a book's vocabulary, a theme or hobby domain) or
internal-only (a precomputed similarity/clustering signal). Buckets are an
implementation abstraction expected to carry the product far; they are not
claimed as essential permanent architecture.

Within a bucket there is no load-bearing granular rank. Buckets are the
largest unit the system makes promises about; word order inside them is
declared noise.

## 1.2 The learner as a distribution

Each learner is modeled as a distribution over buckets, initialized at 100%
on their indicated (placed) bucket. The distribution shifts over time via:

- **explicit learner nudges** (near-term, disjoint jumps);
- **performance evidence** (later, gradual; per this app's consent culture,
  preferably shaped as proposals the learner authorizes rather than silent
  drift);
- **subjective preference** (eventually; post-session reflections are the
  natural elicitation surface — the channel through which taste, interest,
  and mood legitimately steer what gets studied).

## 1.3 Selection pipeline

New-word and session selection, conceptually:

1. **Eligibility mask** (hard, deterministic): unstudied, not sunk, daily
   caps, require-bypass. Constraints zero out mass.
2. **Base distribution** over buckets (the learner's current distribution).
3. **Tilts**: goals, interests, background reweight the base
   multiplicatively. A stated exam goal is a tilt toward a target bucket set,
   not a queue.
4. **Seeded sampling** within the tilted distribution.
5. **Structure**: session composition policies shape the drawn set.

Sampling uses recorded seeds — the pattern already exists for stash sampling
(`unstudied-admission:{studyDayKey}:{remainingQuota}`) — so any served set is
replayable and "why did I get this word?" always has an answer.

Randomness throughout is a feature, not a compromise: it is robust to
ordering error (noise becomes variance instead of bias), it adds flavor
inside an otherwise drilled practice, and its temperature is an eventual
fuzzy lever for learner subjectivity.

## 1.4 Legibility

Legibility lives at bucket level; freedom lives within buckets. The system
can always tell the learner which territory they are in and how much of it
they have covered, while which specific word surfaces today is allowed to be
arbitrary. A sampled diet the system can narrate ("mostly your current band,
two stretch picks") reads as personality; one it cannot narrate reads as
chaos.

## 1.5 Relationship to existing models

This is a generalization, not a departure. The product vision notes already
model each *word* as carrying a probability distribution over study actions
that feedback updates; this sketch makes the same move at *session-content*
granularity: the learner is a distribution over content, the scheduler
samples it, feedback alters it.

Two separations remain load-bearing:

- **Per-item memory state stays per-item.** SRS intervals, due dates, and
  per-skill strengths remain deterministic per word-skill. The distribution
  governs composition among eligible items; it does not replace the memory
  model.
- **Performance feedback and preference feedback are distinct channels** and
  may shift the distribution on different timescales and with different
  consent requirements.

---

# Part 2 — Deliverable: HSK delta tiers as the first bucket set

## 2.1 Scope

- Mandarin only. French remains retired experimentation per the stability
  frontier.
- Applies to hosted beta, local dev, and study modes.
- Schema and corpus data-import mechanics are deliberately deferred (§2.8);
  this design settles behavior and product surface first.

## 2.2 Bucket set: HSK delta tiers

- HSK word lists are cumulative; buckets are the **deltas**: L1, then L2\L1,
  L3\L2, and so on, plus a beyond-HSK tail for the untagged corpus remainder.
  A learner "targeting HSK 5" wants the delta of words introduced at level 5,
  given the levels below it.
- Each word is tagged with the level at which it first appears, for **both**
  HSK 2.0 (cumulative 150 / 300 / 600 / 1,200 / 2,500 / 5,000) and HSK 3.0
  (finalized 2025-11: 300 / 500 / 1,000 / 2,000 / 3,600 / 5,400, plus a
  shared 7–9 advanced band). These are two independent attributes: 3.0 is
  not a superset of 2.0; words moved levels or were dropped between versions.
- Regular HSK exams still run on 2.0 lists as of 2026 (3.0 remains in pilot).
  Any user-facing HSK labeling speaks 2.0 until the official transition.
- Delta sizes are wildly uneven (the 2.0 L6 delta is ~2,500 words; the L1
  delta is 150). Optionally, large deltas are subdivided into fixed-size
  strata, frequency-ordered within the delta, so buckets stay digestible.
  Open question (§2.11).
- **Within-bucket order: none.** Diet draws are seeded samples from the
  active bucket. SUBTLEX rank survives only as (a) an ordering aid for
  optional subdivision and (b) diagnostics — never as an admission ranking.

## 2.3 Learner diet profile

New per-learner state: the **diet profile**. Design-level shape:

- **active bucket anchor** — a stable bucket identity, never a raw corpus
  rank, so corpus rebuilds cannot silently reinterpret a placement;
- **nudge offset** — accumulated learner adjustments relative to the anchor;
- **provenance** — who last moved it (onboarding answer / learner control /
  system proposal) and when. Cheap to store now, expensive to retrofit.

The v1 distribution is degenerate (100% on the active bucket), but the
representation must admit future per-bucket weights without a painful
migration.

Storage: the `learner_settings` key-value store already exists (the
`daily_new_word_limit` precedent); a versioned JSON value avoids new tables.
Final schema remains deferred with the data work (§2.8).

## 2.4 Diet admission change

- Today: the diet half of the 50/50 split fills by
  `ORDER BY words.priority DESC LIMIT n` over unstudied words with no overlay
  (`getAdmittedUnstudiedWords`, `server/db/persistence.ts`).
- Proposed: the diet half fills by **seeded uniform sample** from the
  unstudied, non-overlay words in the learner's active bucket. On bucket
  exhaustion, spill into the next bucket.
- Unchanged: the 50/50 stash/diet quota split, stash semantics (tops fill
  first, seeded sample of the rest), require-bypass, sunk exclusion, the 20%
  unstudied session bucket weight, covering criteria, and the frozen session
  snapshot (no re-roll on reload/undo).
- The admission seed extends to cover the diet draw, preserving replay
  guarantees.
- The split ratio becomes a learner setting (same settings store), default
  50/50. Whether v1 exposes it in the UI is an open question; bias toward
  hidden.

## 2.5 New-user placement intake

There is currently no new-user flow: hosted Clerk bootstrap creates a learner
with defaults, and local bootstrap does the same. This deliverable adds a
placement intake, delivered **through the session interface** rather than a
separate form: the app's one well-developed interaction surface (card-style
prompts, typed input) is reused as the channel through which the user gives
the system input.

Design line: overload the session's *interaction grammar*, not its
*machinery*. Intake responses are profile evidence, not study actions — they
never enter the study-action pipeline (no attempt events, no covering, no
commits). They land as diet-profile provenance (§2.3).

Intake evidence, deliberately not advanced for v1 — a mix of:

- **open-ended natural-language questions** (background, goals, what they
  want to read/watch/do);
- optionally, **a few placement-exam-style recognition checks**;
- optionally, a coarse self-select fallback (complete beginner / some basics
  / intermediate / advanced or heritage background).

Judgment paths, in delivery order:

1. **Fixed mapping** or simple heuristics from answers to an initial bucket.
2. **Operator-judged** during the concierge phase: the cohort is small and
   invite-only, so natural-language answers are immediately useful as a
   concierge artifact with zero automation.
3. **An agent workflow** (later, once buckets exist) judging natural-language
   answers into an initial bucket, following the intake-triage advisor
   precedent: explicitly invoked, bounded evidence, strict output schema,
   rationale included. Frontier invariants apply — model output remains
   untrusted input under strict validation, and placement judgment is not
   live-session grading. The new consideration: intake answers are
   learner-authored content, so provider calls must follow the beta
   disclosure and bounded-evidence contract.

The same intake is forward-compatible with the vision: answers seed not only
the bucket anchor but eventually goal/interest *tilts* — "I'm preparing for
HSK 5" or "I want to read wuxia novels" compile into bucket/tilt parameters
without exam vocabulary becoming UI furniture. V1 consumes only the placement
signal; raw answers are retained as profile evidence.

Set aside for now: a full **diagnostic first-session draw** (composing
session 1 as word probes sampled across buckets). Recorded costs: a
diagnostic composition mode; probe interaction with the daily new-word cap
and covering/commit semantics; "known on probe" lifecycle transitions are a
`learning-review-model` question, not a diet question; and probe signal
choice is fraught (typed production places readers and heritage speakers too
low; self-rated recognition is the soft signal the vision notes already list
as an open question). The light recognition checks above capture most of the
value without the composition machinery.

Framing note: natural-language intake sets the product's register from the
first minute — the system listens before it drills — and mirrors the
reflection loop (the learner expresses; the system responds). This is a
feature of the approach, not just its packaging.

Placement is realized as the initial diet profile, so it needs the §2.3
setting to exist; the flow lands with the data work, not before.

Frontier note: the frontier defers a *polished self-service onboarding
system* and permits concierge-assisted onboarding. This intake is a minimal
step in service of the first cohort, not an onboarding system — flagged for
explicit human confirmation that it stays inside the boundary.

## 2.6 Diet and settings surface

A new profile/settings page (an incremental nav addition; the broad page
model is preserved):

- shows the current bucket in legible, plain-language terms;
- offers a **disjoint jump** (pick a bucket) and a **nudge**
  (adjacent-bucket move);
- becomes the natural home for learner settings (daily new-word limit is a
  relocation candidate; display name a possibility).

Keep the surface deliberately small: fewer controls to validate, clearer
product. An optional later addition is HSK coverage reporting as a dashboard
— order adaptively, report in exam terms — decoupling the progress narrative
from the acquisition order. Not v1.

## 2.7 Control-surface reduction: triage retirement

Proposal: **retire the Triage subtab and the intake-triage advisor loop**
for the beta cohort.

- Rationale: triage exists to compensate for SUBTLEX ordering oddities — its
  defer / recognition-only judgments target corpus noise at the top of a
  global frequency ranking. Bucketed diet plus placement attacks the cause
  rather than the symptom, and every retained control is something new users
  must learn and we must validate. Product clarity wins.
- One behavior needs an explicit decision: accepted `recognition_only`
  assessments durably suppress definition production for specific words.
  Options: (a) retires with triage; (b) survives as a word-level control
  elsewhere; (c) is re-derived from bucket placement. Flagged in §2.11.
- Kept: the Manage word bank (add-by-target search, top/stash, require) —
  the stash half of admission is the personal-steering pillar of the app —
  and sink/dismiss, which is cheap and a key negative signal.
- Spec impact on implementation: `intake-triage-advisor.md` moves to
  historical/archive; `study-action-model.md`'s diet description is updated.

## 2.8 Deferred

- Schema changes and corpus data-import mechanics: HSK tag ingestion, hosted
  bootstrap artifact regeneration, canonical-pipeline changes, dev seed
  updates.
- Performance-driven distribution shifts; proposal-style adaptation;
  temperature and subjectivity levers; domain/theme buckets;
  morpheme-aware bucket refinement.
- HSK coverage dashboard; French profile behavior; generalized import for
  external learners (frontier non-goal).

## 2.9 Migration notes (design level)

- `lexical_words.priority` remains during the transition (diagnostics and
  the content-diagnostics page consume it); admission stops consuming it
  once buckets land.
- Existing learners (the dogfood identity) need a one-time placement:
  operator-set or derived from study history. Decision deferred with the
  data work.

## 2.10 Test impact (when implemented)

- `tests/unstudied-admission.test.ts` — diet fill becomes a seeded bucket
  sample instead of rank-ordered fill.
- `tests/session-composition.test.ts` — bucket spill, seed stability /
  no-reroll, unchanged split and bypass behavior.
- `tests/user-priority.test.ts`, `tests/priority-page-model.test.ts` —
  surface changes from §2.7.
- `tests/intake-triage.test.ts` — retirement.
- New: placement defaulting, diet-profile round-trip, nudge/jump behavior.

## 2.11 Open questions

Blocking implementation, not review of this document. Current leans noted
where one exists.

1. **Bucket granularity**: raw HSK deltas, or subdivide large deltas into
   fixed-size strata? (Lean: subdivide above a size threshold.)
2. **Scaffold source**: which HSK version defines the buckets? (Lean: 2.0,
   while tagging both versions per word.)
3. **v1 distribution shape**: strictly one active bucket, or a small fixed
   spread into the next bucket for "stretch" flavor? (Lean: single bucket;
   within-bucket sampling already supplies randomness.)
4. **Nudge semantics**: adjacent-bucket jumps only, or finer-grained moves?
   (Lean: bucket-granular disjoint jumps.)
5. **Placement wording and labeling**: do the words "HSK" appear anywhere in
   v1 UI? (Emotional-vision concern. Lean: plain-language bucket
   descriptions by default; exam-labeled goal mode as an opt-in later.)
6. **Triage disposition**: full removal vs parked/hidden; and what happens
   to recognition-only production suppression (§2.7).
7. **Beyond-HSK tail**: one expanse, or frequency-deciled buckets?
8. **Existing-learner placement**: operator-set vs derived from study
   history.
9. **Settings-page scope**: does the daily new-word limit move there?
   Display-name editing?
10. **Split-ratio setting**: stored-only or user-visible?
11. **Bucket-exhaustion spill**: automatic advance (and does that move the
    profile anchor with `system` provenance?) vs mixing the exhausted bucket
    with its successor.
12. **Placement intake content and judgment path**: which questions (and
    whether any recognition checks or a self-select fallback) ship in v1;
    fixed mapping vs operator judgment during the concierge phase; and when
    the natural-language bucket-judgment agent workflow is worth building.
    (Lean: 2–3 open-ended questions plus an optional coarse self-select;
    simple/operator judgment v1; agent workflow after buckets land.) The
    full diagnostic session draw remains set aside per §2.5.
