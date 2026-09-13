# Diet Deck Distribution And HSK Delta Tiers

Status: **accepted design** (drafted 2026-09-09; review decisions
incorporated same day; accepted for implementation 2026-09-10). Part 2 is
the implementation contract for this deliverable; Part 1 remains a vision
sketch, explicitly subject to change. Remaining implementation defaults
(§2.11) are provisional and revisable without re-review. Schema is
implemented fresh-boot-first: baseline schema changes land now, and the
migration script for existing databases is a deliberate follow-up after
review settles the schema — the feature does not merge or release without
it.

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

# Part 1 — Vision sketch: the learner as a distribution over decks

*This part is a foundation to build against, not a contract. It will change.*

## 1.1 Decks

The corpus is partitioned into broad decks. Decks may be externally
meaningful (HSK tiers, a book's vocabulary, a theme or hobby domain) or
internal-only (a precomputed similarity/clustering signal). Decks are an
implementation abstraction expected to carry the product far; they are not
claimed as essential permanent architecture. (Naming: "deck" is chosen to
avoid collision with two existing code terms — session-composition
*buckets* and admission *pools*. No existing code terminology changes.)

Within a deck there is no load-bearing granular rank. Decks are the
largest unit the system makes promises about; word order inside them is
declared noise.

## 1.2 The learner as a distribution

Each learner is modeled as a distribution over decks, initialized at 100%
on their indicated (placed) deck. The distribution shifts over time via:

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
2. **Base distribution** over decks (the learner's current distribution).
3. **Tilts**: goals, interests, background reweight the base
   multiplicatively. A stated exam goal is a tilt toward a target deck set,
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

Legibility lives at deck level; freedom lives within decks. The system
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

# Part 2 — Deliverable: HSK delta tiers as the first deck set

## 2.1 Scope

- Mandarin only. French remains retired experimentation per the stability
  frontier.
- Applies to hosted beta, local dev, and study modes.
- Schema and corpus data-import mechanics are deliberately deferred (§2.8);
  this design settles behavior and product surface first.

## 2.2 Deck set: HSK delta tiers

- HSK word lists are cumulative; decks are the **deltas**: L1, then L2\L1,
  L3\L2, and so on, plus a beyond-HSK tail for the untagged corpus remainder.
  A learner "targeting HSK 5" wants the delta of words introduced at level 5,
  given the levels below it.
- Each word is tagged with the level at which it first appears, for **both**
  HSK 2.0 (cumulative 150 / 300 / 600 / 1,200 / 2,500 / 5,000) and HSK 3.0
  (finalized 2025-11: 300 / 500 / 1,000 / 2,000 / 3,600 / 5,400, plus a
  shared 7–9 advanced band). These are two independent attributes: 3.0 is
  not a superset of 2.0; words moved levels or were dropped between versions.
- **The v1 deck set derives from HSK 2.0** (decided, §2.11): regular exams
  still run on 2.0 lists as of 2026 (3.0 remains in pilot), and any future
  user-facing HSK reporting speaks 2.0 until the official transition. The
  3.0 tags ride along for later use.
- Delta sizes are wildly uneven (the 2.0 L6 delta is ~2,500 words; the L1
  delta is 150), so **large deltas are subdivided** into bounded strata,
  frequency-ordered within the delta (decided, §2.11). Bounded decks give
  more policy leverage later; a coarser presentation can always be layered
  on top. What makes a good deck — similarity, dissimilarity, other
  criteria, per-learner variation — is expected to be learned over time.
- The beyond-HSK tail is **one expanse** for now (decided, §2.11).
- **Within-deck order: none.** Diet draws are seeded samples from the
  active deck. SUBTLEX rank survives only as (a) an ordering aid for
  optional subdivision and (b) diagnostics — never as an admission ranking.

### Early artifact step: HSK tag ingestion

HSK tag ingestion happens **early**, ahead of the schema and admission work,
because it makes the deliverable concrete: real decks can be inspected,
sized, and sampled before any behavior changes.

- Acquire parsed HSK 2.0 and 3.0 word lists as source data under
  `data/sources/` (both are published and widely mirrored; the 3.0 list
  comes from the finalized 2025-11 syllabus).
- Extend the canonical wordlist build (or a sibling script) to join the tags
  onto canonical words. Join primarily on hanzi, using pinyin where the
  source lists provide it; the canonical primary key is
  (hanzi, pinyinNormalized), and polyphonic homographs exist — ambiguous or
  unmatched joins are recorded for review, never silently guessed.
- Output: per-word deck tags in the canonical artifact, saved locally.
  This makes deck sizes and samples eyeball-able and lets the subdivision
  question (§2.11 Q1) be answered empirically before any admission or
  schema work.
- **Hosted propagation is explicitly deferred**: whether the hosted corpus
  receives tags by replaying the build on Fly, uploading an artifact, or
  regenerating the bootstrap is a separate later decision.
- This step is independently dispatchable: it has no dependency on the diet
  profile, admission, or UI work.

## 2.3 Learner diet profile

New per-learner state: the **diet profile**. Design-level shape:

- **deck weights** — the learner's distribution over decks, initialized
  degenerate at 100% on the placed deck. A **nudge** shifts a fixed weight
  quantum (default 0.1, internal and never user-visible) toward an adjacent
  deck — e.g. (1, 0) → (0.9, 0.1) (decided, §2.11). Deck references are
  stable identities, never raw corpus ranks, so corpus rebuilds cannot
  silently reinterpret a placement;
- **provenance** — who last moved the distribution (intake answer / learner
  nudge / operator) and when. Cheap to store now, expensive to retrofit.

The representation is per-deck weights from day one — nudges need them.
What is deferred is *automatic* distribution evolution from performance
evidence (decided, §2.11).

Storage: the `learner_settings` key-value store already exists (the
`daily_new_word_limit` precedent); a versioned JSON value avoids new tables.
Final schema remains deferred with the data work (§2.8).

## 2.4 Diet admission change

- Today: the diet half of the 50/50 split fills by
  `ORDER BY words.priority DESC LIMIT n` over unstudied words with no overlay
  (`getAdmittedUnstudiedWords`, `server/db/persistence.ts`).
- Proposed: the diet half fills by **seeded sample** from the unstudied,
  non-overlay words in the learner's decks, proportional to the
  distribution weights (uniform within a deck). On exhaustion of the
  weighted set, spill into successor decks at composition time *without
  mutating the profile* (decided, §2.11 — the cleanest implementation; no
  new write path, and nudges or operator action correct residual staleness).
- Unchanged: the 50/50 stash/diet quota split, stash semantics (tops fill
  first, seeded sample of the rest), require-bypass, sunk exclusion, the 20%
  unstudied session-composition weight, covering criteria, and the frozen
  session snapshot (no re-roll on reload/undo).
- The admission seed extends to cover the diet draw, preserving replay
  guarantees.
- The split ratio becomes a learner setting (same settings store), default
  50/50, stored but **not user-visible** in v1 (decided, §2.11).

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

Visibility (decided, §2.11): the learner knows they are being assessed; the
deck machinery itself is never exposed. After intake, sessions simply
source their words.

Intake evidence, deliberately not advanced for v1 — a mix of:

- **open-ended natural-language questions** (background, goals, what they
  want to read/watch/do);
- optionally, **a few placement-exam-style recognition checks**;
- optionally, a coarse self-select fallback (complete beginner / some basics
  / intermediate / advanced or heritage background).

Judgment paths, in delivery order:

1. **Fixed mapping** or simple heuristics from answers to an initial deck.
2. **Operator-judged** during the concierge phase: the cohort is small and
   invite-only, so natural-language answers are immediately useful as a
   concierge artifact with zero automation.
3. **An agent workflow** (later, once decks exist) judging natural-language
   answers into an initial deck, following the intake-triage advisor
   precedent: explicitly invoked, bounded evidence, strict output schema,
   rationale included. Frontier invariants apply — model output remains
   untrusted input under strict validation, and placement judgment is not
   live-session grading. The new consideration: intake answers are
   learner-authored content, so provider calls must follow the beta
   disclosure and bounded-evidence contract.

The same intake is forward-compatible with the vision: answers seed not only
the deck anchor but eventually goal/interest *tilts* — "I'm preparing for
HSK 5" or "I want to read wuxia novels" compile into deck/tilt parameters
without exam vocabulary becoming UI furniture. V1 consumes only the placement
signal; raw answers are retained as profile evidence.

Set aside for now: a full **diagnostic first-session draw** (composing
session 1 as word probes sampled across decks). Recorded costs: a
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

## 2.6 Feedback surface; no settings page in v1

The deck machinery is not user-visible (decided, §2.11): no deck picker, no
distribution controls, no HSK or deck vocabulary in the UI. Consequences:

- **Nudges surface where the learner's intuition lives** — in the session or
  reflection context: an intentionally coarse, gut-level signal ("too easy /
  too hard") rather than language-learning technicalities. Specific UI is a
  provisional implementation default (§2.11).
- **No settings page in the first deliverable.** The existing session
  settings gear on Home (daily new-word limit) is a nice UI already and
  stays as-is. A profile/settings page becomes warranted only if
  longer-lived user-profile settings are ever exposed; none are in v1.
- **Disjoint jumps** (repositioning to a chosen deck) remain available as an
  **operator tool** for concierge correction, not as user UI.
- A completion-percentage / strength-heuristic presentation over a word
  group will likely come at some point, but is not critical to the app's
  overall vision and is not v1.

Keep the surface deliberately small: fewer controls to validate, clearer
product.

## 2.7 Control-surface reduction: triage retirement

Proposal: **retire the Triage subtab and the intake-triage advisor loop**
for the beta cohort.

- Rationale: triage exists to compensate for SUBTLEX ordering oddities — its
  defer / recognition-only judgments target corpus noise at the top of a
  global frequency ranking. Decked diet plus placement attacks the cause
  rather than the symptom, and every retained control is something new users
  must learn and we must validate. Product clarity wins.
- Recognition-only disposition (decided, §2.11): suppressions already
  accepted take effect at the word immediately and **persist**; the advisor
  assessment provenance may be dropped with the retired loop. No v1 surface
  creates new suppressions; a future surface can reintroduce the capability
  if evidence wants it.
- Kept: the Manage word bank (add-by-target search, top/stash, require) —
  the stash half of admission is the personal-steering pillar of the app —
  and sink/dismiss, which is cheap and a key negative signal.
- Spec impact on implementation: `intake-triage-advisor.md` moves to
  historical/archive; `study-action-model.md`'s diet description is updated.

## 2.8 Deferred

- Schema changes and corpus data-import mechanics beyond the local HSK tag
  artifact (§2.2): hosted bootstrap artifact regeneration, dev seed updates,
  DB-level propagation, and the hosted distribution decision (replay the
  build on Fly vs upload an artifact vs regenerate the bootstrap).
- Performance-driven distribution shifts; proposal-style adaptation;
  temperature and subjectivity levers; domain/theme decks;
  morpheme-aware deck refinement.
- HSK coverage dashboard; French profile behavior; generalized import for
  external learners (frontier non-goal).

## 2.9 Migration notes (design level)

- `lexical_words.priority` remains during the transition (diagnostics and
  the content-diagnostics page consume it); admission stops consuming it
  once decks land.
- Existing learners (the dogfood identity) are **operator-placed** (decided,
  §2.11): the operator sets placement from knowledge of the users, trusting
  nudges to correct placement errors.

## 2.10 Test impact (when implemented)

- `tests/unstudied-admission.test.ts` — diet fill becomes a seeded deck
  sample instead of rank-ordered fill.
- `tests/session-composition.test.ts` — deck spill, seed stability /
  no-reroll, unchanged split and bypass behavior.
- `tests/user-priority.test.ts`, `tests/priority-page-model.test.ts` —
  surface changes from §2.7.
- `tests/intake-triage.test.ts` — retirement.
- New: placement defaulting, diet-profile round-trip, nudge/jump behavior.

## 2.11 Review decisions and remaining TBDs

Decisions from the 2026-09-09 review (previously open questions):

1. **Subdivide.** Bounded decks give more policy leverage later; a coarser
   presentation can always be layered on top. What makes a good deck —
   similarity, dissimilarity, other criteria, per-learner variation — is
   expected to be learned over time. (The §2.2 tag artifact makes real
   deck sizes concrete before thresholds are chosen.)
2. **HSK 2.0** defines the v1 deck set; both versions remain tagged per
   word.
3. **Single active deck at initialization.** Automatic distribution
   evolution is a follow-up; manual nudges (below) are in v1.
4. **Nudge = fine-grained weight shift**, e.g. (1, 0) → (0.9, 0.1) toward an
   adjacent deck — a coarse deck jump labeled "nudge" would be
   misleading. UI specifics TBD (see 10).
5. **Decks are not user-visible.** The learner knows they are being
   assessed at intake; afterwards sessions source their words without
   exposing machinery. The nudge is intentionally coarse, gut-level feedback
   rather than language-learning technicalities.
6. **Triage retires.** Existing recognition-only production suppressions
   persist (they take effect at the word immediately); advisor assessment
   provenance may be dropped.
7. **Beyond-HSK tail: one expanse** for now.
8. **Existing learners are operator-placed**, from the operator's knowledge
   of the users, trusting nudges to correct errors.
9. **No settings page in v1.** The existing session-settings gear (daily
   new-word limit) is a nice UI already and stays put; a profile/settings
   page becomes warranted only if longer-lived user-profile settings are
   ever exposed.
10. **Split ratio stored, not user-visible.** Nudge feedback surfaces where
    the learner's intuition lives — the session or reflection context —
    rather than opening the app black box in settings.
11. **Deck-exhaustion spill**: no strong product opinion; take the
    cleanest implementation. Recorded choice: composition-time spill into
    successor decks without mutating the profile (no new write path);
    nudges or operator action correct residual staleness.
12. **Placement intake: simple v1** — a few open-ended questions with fixed
    or operator judgment; the natural-language deck-judgment agent
    workflow comes later, on the expectation that LLM text processing
    tolerates complexity a long quiz would try to reverse-engineer. The
    full diagnostic session draw remains set aside per §2.5.

Remaining implementation defaults (provisional; owned by implementation and
revisable without re-review):

- **Nudge UI**: a quiet too-easy / about-right / too-hard prompt at the
  session-completion / reflection moment — where gut feel is freshest and
  the reflection loop already lives. A mid-session affordance may follow if
  evidence wants it.
- **Subdivision thresholds**: target deck sizes of roughly 150–400 words;
  HSK deltas larger than ~400 split into frequency-ordered strata of ~250.
  Tuned against the §2.2 tag artifact's real sizes.
- **Intake questions**: 2–3 open-ended prompts — background with the
  language, goals ("what do you want to be able to do?") — with an optional
  coarse self-select as fallback. Wording refined at implementation.
- **Progress presentation**: a completion-percentage / strength heuristic
  over a word group is expected eventually, but is not v1 and is not
  critical to the vision.
