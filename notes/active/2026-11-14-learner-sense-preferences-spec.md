# Learner sense preferences — build spec

status: active
type: handoff
created: 2026-11-14
retire-when: the decisions below are settled and the first PR is open, or the design is declined
related:
  - SPECS/vocabulary-learning.md
  - SPECS/vocabulary-architecture.md
  - STABILITY_FRONTIER.md
  - notes/active/2026-10-15-vocabulary-model-whiteboard.md

Build spec for letting a learner choose which senses of a word they study. It
is a setup deliverable ahead of the reading interface: a learner who adds a
word because of one sentence should be able to confirm the senses they want,
with the sense they met highlighted. It is also useful alone, because today
every learner studies the same shared selection.

Three points of direction are [settled](#settled-with-justin-2026-11-14). The
[decisions](#decisions-for-justin) section lists what Justin still needs to
choose; where a section depends on an open decision it says so. No application
code has been written.

## Goal and stance

- A learner can take up or exclude senses of a word. Their choice changes which
  sense-mapped work they are served; it changes nothing for other learners.
- Shared content stays shared. The canonical inventory and the default useful
  selection keep their current operator authority. A learner choice is private
  state layered on the shared default.
- Adding a word never waits on a model. The confirmation refines an add that
  has already happened.
- Scheduling and mode stay at word level in this deliverable.
- Retained sessions and history are untouched.

## Settled with Justin (2026-11-14)

1. **Teaching is authored per sense set.** A teaching package covers a word and
   a specific set of senses, and is shared by every learner with that set. The
   default set keeps today's package. A learner-chosen sense is never tacked on
   to another set's package as a bare definition, and an excluded default sense
   is not taught, because it is not in the learner's set. One coherent package
   per set keeps the bridging between senses that current teaching does well.
2. **Repertoire bootstrap looks for missing senses across sets.** Demand for
   general exercises covers senses that learners have taken up, not only the
   shared defaults. A learner excluding a sense never deletes or retires an
   exercise, because content is shared.
3. **Session composition considers the learner's sense set** as well as the
   shared default. Composition is expected to move toward working from a
   snapshot of learner state, so finer-grained reasoning there is acceptable.

Further answers from Justin on 2026-11-15:

4. A confirmation stores only deviations from the defaults, plus the target
   sense as taken up even when it is a default.
5. When shared defaults are unknown, the app waits for the existing
   default-selection call. The latency has to be made to work in the product;
   see [the add flow](#add-flow-two-entry-points).
6. A learner cannot exclude every sense. A learner who wants to has a sense in
   mind that the inventory lacks, and the app should support that on a best
   effort, rejecting a proposal that is off base. A chat-like exchange may be
   the right surface. See [decision A](#decisions-for-justin).
7. Nothing learner-visible ships before per-set teaching.
8. A sense taken up on a word that has already been taught gets no re-teaching
   and no sense-based exercise weighting. The only follow-through is
   bootstrapping exercises for that sense when none exist.
9. No migration for the scope model alone; timestamps and resolution records
   can ride with the per-set teaching migration.
10. Packages are authored for any distinct set, with count and cost reported
    to the operator.

Per-learner generated teaching, which could use what is known about the
learner, was considered and set aside for now. It would be the first
learner-private authored content, it cannot be improved by other learners'
reactions or operator repair, and it would test two changes at once.

## Current state (verified in code on 2026-11-14)

### What exists for learner scope

| Fact | Evidence |
| --- | --- |
| `learner_senses` holds one row per learner and sense with `disposition` `active` or `excluded`. Its key is `(learner_id, sense_id)`; it references `learner_words` and `senses`. It has no timestamps, source or history. | `server/db/migrations/0041_vocabulary_learner_state.sql:15-24` |
| No runtime code reads or writes `learner_senses`. The only references are a reconciliation dependency report, the ownership manifest, and tests that insert rows to prove they are preserved. | `server/db/sense-inventory-reconciliation-report.ts:120`; `server/db/ownership-manifest.ts:85`; `tests/bulk-repertoire-apply.test.ts:198-209`; `tests/sense-inventory-reconciliation-apply.test.ts:48,278` |
| `learner_words.scope_established_at` is read into the learner word record and never written. | `server/db/migrations/0041_vocabulary_learner_state.sql:11`; `server/db/vocabulary-learners.ts:59` |
| `addVocabularyWord` accepts an `intendedUseText` and stores it, but neither caller passes one. | `server/db/vocabulary-learners.ts:73-91`; `server/vocabulary/study-routes.ts:105`; `server/db/vocabulary-stash.ts:13-20` |
| Sense reconciliation treats learner sense rows as preserved history and does not block on them. | `server/db/sense-inventory-reconciliation-apply.ts:58`; `server/db/sense-content-reconciliation.ts:52` |
| The whiteboard describes the intended model: learning scope as learner–sense relationships, a stash entry with optional intended senses, and sense-specific overrides. It leaves open what scheduling belongs at sense level and what overrides specify. | `notes/active/2026-10-15-vocabulary-model-whiteboard.md:104-131,397-398` |

### How shared sense selection works today

| Fact | Evidence |
| --- | --- |
| Three shared records: the canonical inventory, the default useful selection (null means unknown, `[]` means explicitly none), and a per-call invocation scope. | `SPECS/vocabulary-architecture.md:197-212` |
| The selection is stored per word in `vocabulary_word_sense_coverage` with a version and immutable history. Only operator or service actors can write it. | `server/db/migrations/0062_vocabulary_sense_coverage.sql:1-25`; `server/db/vocabulary-sense-coverage.ts:44-61` |
| `resolveVocabularySenseCoverage` returns the active senses in the selection, and `selectionEstablished` is false while defaults are unknown. | `server/db/vocabulary-sense-coverage.ts:21-28` |
| General practice serving filters sense-mapped production exercises by that shared selection. Unmapped exercises and non-production skills pass through. | `server/db/vocabulary-content.ts:276-288` |
| Production proxy coverage and pure-cue maintenance also read the shared selection. | `server/vocabulary/production-coverage.ts:30-34`; `server/db/pure-cue-maintenance.ts:124-130` |
| Recognition selection, composition and contrast use only the empty-inventory eligibility rule; they have no other sense awareness. | `server/vocabulary/review-selection.ts:1`; `server/vocabulary/composition.ts:1`; `server/db/vocabulary-sense-eligibility.ts:3-16` |
| A teaching introduction is one shared document authored against the selection captured at preparation. Later selection changes do not retarget it. | `server/word-content/shared-preparation.ts:37-50`; `SPECS/vocabulary-architecture.md:233-240` |
| The introduction renders its uses as a list, one block per use. | `src/features/word-introduction/WordIntroductionExperience.tsx:160` |
| Each served encounter retains the sense its exercise was mapped to. | `server/vocabulary/study.ts:141` |
| The answer reveal shows the mapped sense when there is one. This is the only place a learner sees a sense today. | `SPECS/vocabulary-learning.md:231-234`; `server/vocabulary/reveal-snapshot.ts:28-30` |

### How teaching is keyed today

| Fact | Evidence |
| --- | --- |
| A word has exactly one current bootstrap document and teaching package: `word_introduction_preparation` is keyed by `word_id` alone. | `server/db/migrations/0016_word_introduction_content.sql:96-110` |
| Preparation work is unique per word and stage. | `server/db/migrations/0018_word_preparation_work.sql:2-15` |
| Several documents and packages per word can be stored; only one is current. | `server/db/migrations/0016_word_introduction_content.sql:68-87`; `server/db/word-introductions.ts:577-581` |
| The bootstrap document is authored against the shared selection captured at that moment. | `server/word-content/shared-preparation.ts:37-50` |
| Teaching readiness is resolved from the word alone, for the reserve and for composition. | `server/vocabulary/teaching-readiness.ts:35-47`; `server/vocabulary/preparation-reserve.ts:28-31`; `server/vocabulary/study.ts:233` |
| Repertoire demand computes missing senses from the shared selection only. | `server/db/proactive-repertoire.ts:59-90` |
| Coverage changes never imply retiring an exercise. | `SPECS/vocabulary-architecture.md:280` |

### How an inventory comes to exist

| Fact | Evidence |
| --- | --- |
| `ensureVocabularySenses` establishes an inventory with one model call: `gpt-6-luna`, high reasoning effort, 8,000 output tokens, a 180-second timeout. | `server/vocabulary/sense-readiness.ts:20-22,53-55` |
| The call runs under a five-minute lease with at most three attempts per cycle, retrying after 30 and 60 seconds. | `server/vocabulary/sense-readiness.ts:98,122-123` |
| The same call returns `defaultUseful` per sense, and those become the shared defaults when none exist. | `server/vocabulary/sense-inventory-contract.ts:5-13`; `server/vocabulary/sense-readiness.ts:157-164` |
| An inventory holds at most 16 senses; a label can be 600 characters and a note 1,600. | `server/vocabulary/sense-inventory-contract.ts:7,22-24` |
| A partial, unestablished inventory raises an operator-review error instead of generating. | `server/vocabulary/sense-readiness.ts:94,110` |
| Only teaching-reserve members request bootstrap work. The reserve holds about twice the daily new-word limit, capped at 40. A word stashed outside the reserve has no inventory until it nears admission. | `docs/vocabulary-learning.md:508-511,531-532` |
| Unknown defaults for an established inventory are resolved by a second model call with the same model and timeout. | `server/vocabulary/default-useful-selection.ts:22,31,52` |
| A sense-mapping prompt already exists for binding exercises to senses. | `server/vocabulary/reflection-prompts/sense-mapping.md`; `server/vocabulary/sense-mapping-retry.ts` |

### The add flow today

| Fact | Evidence |
| --- | --- |
| Stash search posts hanzi to `add-by-hanzi`, which adds matching unstudied words and creates learner word state in one transaction. | `server/index.ts:634-678`; `server/db/vocabulary-stash.ts:13-20` |
| When several lexical words match, the client asks the learner to choose among them before adding. | `src/features/priority/usePriorityPageController.ts:30,61,147-191` |
| Learner word writes carry a `state_version` and reject a stale expected version. | `server/db/vocabulary-learners.ts:125-128` |

## Learner-visible model

For each word a learner studies, every active sense is in one of three states:

| State | Meaning | Stored as |
| --- | --- | --- |
| Following the default | The learner has not chosen. The sense is studied if the shared selection includes it. | No row |
| Taken up | The learner wants it, whatever the shared selection says. | `active` |
| Excluded | The learner does not want it, whatever the shared selection says. | `excluded` |

The learner's **effective scope** is: active senses that are taken up, plus
active senses in the shared selection that are not excluded.

What the learner can do:

- See the word's senses (label and notes) with the effective scope marked.
- Take up a sense outside the shared selection.
- Exclude a sense inside it.
- Return a sense to following the default.

Consequences of later shared changes:

| Shared change | Effect on a learner |
| --- | --- |
| A sense is added to the inventory | Follows the default until the learner chooses. |
| A sense is retired | Leaves every effective scope. The row is kept as history. |
| The default selection changes | Applies to senses the learner is following; taken-up and excluded senses keep the learner's choice. |
| A sense is replaced by reconciliation | The choice does not move to the replacement. The frontier requires that identity-bound relationships do not silently transfer (`STABILITY_FRONTIER.md:86-90`). |
| The inventory becomes empty | The word is ineligible for sessions for everyone, as today (`SPECS/vocabulary-learning.md:20-25`). |

A confirmation stores only deviations from the defaults, plus the target sense.
A learner cannot exclude every sense.

## Add flow: two entry points

Justin is not yet satisfied with the add flow and expects to need a prototype
before giving firm feedback. This section is a proposal to prototype, not a
design to build.

There are two mindsets, and one confirmation step does not serve both:

| | Word-centric | Scenario-centric |
| --- | --- | --- |
| The learner | Wants the word, with all its usual senses | Met a use, or wants to say something, and the word and sense follow from that |
| Starts from | Stash search | A sentence in the reader, or a free-form description |
| Should feel like | One action, no customisation step | The app meets them in their situation and proposes the word and sense |
| Customisation | Available on the word, never required | Shown alongside: the other senses included by default, adjustable |

A custom sense is one of two kinds, and the flow branches on which:

| What the learner wants | Where it is | Path |
| --- | --- | --- |
| A sense in the inventory but outside the defaults | Listed | Taken up; the set becomes defaults plus that sense |
| A sense not in the inventory | Not listed | A proposal to add a sense; see [decision A](#decisions-for-justin) |
| No listed sense at all | Not listed | The same proposal path, since excluding every sense is not allowed |

The learner's intent can arrive as nothing (word-centric), as a context
sentence with the word's span, or as a free-form description.

### Proposed shape: the add never asks, the word reports back

- Every add is one action and completes immediately, carrying the intent if
  there is one.
- The learner's set starts as the shared defaults, plus the target sense once
  it is resolved. No confirmation is required.
- Resolution runs in the background: establish the inventory if needed, wait
  for defaults if unknown, map the intent to a sense. Per-set teaching is
  prepared before admission in any case, so this adds no wait the learner
  would otherwise not have.
- The word's row shows the outcome when it is ready: which senses it will
  teach, with the met sense marked. The learner can adjust there.
- If the intent matches no listed sense, the row says so and opens the
  exchange described under decision A.

This removes the latency problem from the add itself: no screen waits on a
model. It replaces "bootstrap briefly, show options, confirm", which Justin
described earlier as the ideal feel, so it needs his judgment on a prototype.
The panel states below describe the review surface on the word's row under
either shape.

## Sense panel

The add itself is unchanged and immediate. The panel is attached to the word.

### States of the panel

| Word's shared state | What the learner sees | What happens |
| --- | --- | --- |
| Inventory and defaults established | The senses, with defaults selected and the target sense highlighted and selected | Confirm writes the scope. |
| Inventory established, defaults unknown | A pending state | The existing default-selection call runs; the panel fills when it lands. |
| No inventory | The dictionary gloss and a pending state | Sense bootstrap is requested for this word ahead of the reserve order. |
| Inventory established and empty | The existing ineligible state | No panel. |
| Bootstrap failed or needs operator review | The word stays stashed and follows defaults | Nothing blocks. The choice is offered once the inventory exists. |

"Briefly bootstrap" depends on a call configured for high reasoning effort with
a 180-second timeout. Its real latency has not been measured for this spec. The
flow therefore never waits for it:

- The learner can leave at any point. The word is already stashed.
- The same panel is reachable later from the word's row in the stash and in My
  Words, so a choice missed at add time is not lost.
- While the panel is open the client polls. How long it shows the pending state
  before settling into "available later" should be set from measured latency.

Which adds trigger a bootstrap is [decision D](#decisions-for-justin).

### Target sense from a caller

A caller such as the reader supplies the sentence and the span of the word in
it. The add stores the sentence in `intended_use_text`, the column that already
exists for this.

Resolving the sentence to a canonical sense needs the inventory, so it runs
after bootstrap. It is one small model call over the word's senses and the
sentence, with three outcomes:

| Outcome | Panel | Record |
| --- | --- | --- |
| Matches a sense | That sense is highlighted and selected, in addition to the defaults | Written as taken up on confirm |
| Matches no listed sense | Defaults selected, nothing highlighted | See [decision A](#decisions-for-justin) |
| Unclear | Defaults selected, nothing highlighted | The sentence is kept |

The prompt should descend from the existing sense-mapping prompt and follow
[prompt development](../../docs/prompt-development.md). Model output is
untrusted: the returned sense must be an active sense of that word or the
result is discarded.

### From stash search

The same panel with no target. Defaults are selected and nothing is
highlighted. When several lexical words match, the existing word choice comes
first and the panel applies to each chosen word. Whether the panel opens by
itself is [decision E](#decisions-for-justin).

### Writing the scope

- Confirm sends the chosen sense IDs with the learner word's `state_version`
  and the catalog and selection versions the panel showed.
- A stale version is rejected and the panel reloads.
- The write sets `scope_established_at` and emits a backend event carrying the
  before and after scope and the surface it came from.
- Every sense ID must be an active sense of that word. A violation is a client
  contract error and fails loudly.

## Downstream effects

| Consumer | Today | This deliverable | Why |
| --- | --- | --- | --- |
| Mapped general production serving | Shared selection | **Uses effective scope** | This is where a learner's choice is felt. |
| Teaching package | One current package per word, over the shared selection | **One package per word and sense set; a learner is taught from their set's package** | Settled point 1. |
| Teaching readiness, reserve and composition | Resolved from the word | **Resolved from the word and the learner's set** | Settled point 3. |
| General exercise authoring demand | Missing senses within the shared selection | **Missing senses across the shared selection and every taken-up sense** | Settled point 2. |
| Exercise retirement | Never implied by coverage changes | Unchanged; a learner exclusion never retires content | Settled point 2. |
| Unmapped and fallback production exercises | Served regardless of sense | Unchanged | They carry no sense to filter on. |
| Answer reveal | Shows mapped sense | Unchanged | It already shows the right thing. |
| Recognition | Word level | Deferred | It has no sense binding today. |
| Contrast | Word level | Deferred | Same. |
| Pure cues | Shared selection | Deferred | Accepted answers are shared content; per-learner qualification is a separate policy. |
| Production proxy coverage | Shared selection | Deferred | The contract derives it from the shared repertoire (`SPECS/vocabulary-learning.md:97-101`). |
| Scheduling and mode | Word level | Unchanged | The whiteboard leaves sense-level scheduling open. |
| Retained sessions | Frozen | Unchanged | Required by the architecture contract. |

One known edge from deferring proxy coverage: if a learner excludes the only
sense that has targeted cues, their cues are filtered while the word is still
treated as covered by targeted content. The scope-model PR needs a test that
shows what the learner is then served.

### Teaching per sense set

- A set is the learner's effective scope for the word at the time teaching is
  prepared: a sorted list of active sense IDs.
- The default set is the shared selection. Its package is today's package, and
  learners who follow the defaults see no change.
- A learner whose set differs is taught from a package authored for that set.
  The first learner with a given set causes it to be authored; later learners
  with the same set reuse it.
- Each package is authored as a whole, with its own bootstrap document,
  introduction and teaching exercises, so it can bridge its senses.
- Packages are shared content. They carry no learner reference, and they stay
  inside the existing publication, reaction and repair paths.
- A word with a non-default set is not teaching-ready for that learner until
  its package exists. It waits in the stash, as any unprepared word does.
- Teaching completion stays all-or-nothing, and teaching history records which
  package was used, as it does today.

What must change in the code to support this:

- Preparation state and work are keyed by word today. They need a set
  dimension, which is a schema change.
- The bootstrap step captures the shared selection. It needs to accept a
  requested set.
- Teaching readiness, the reserve and composition take the learner's set.
- Compatibility checks that ask "is this the word's current package" become
  "is this the current package for this set".

What stays as it is: the beat sequence, back-navigation and recap; the
authoring prompts, apart from receiving a different set of senses; the rule
that a package needs at least one production and one recognition exercise.

### A sense changed after the word has been taught

Settled: no re-teaching and no sense-based exercise weighting.

- Taking up a sense makes its mapped exercises eligible and records authoring
  demand when none exist. The word's mode, schedule and teaching history are
  unchanged.
- Excluding a sense stops its mapped production practice. Nothing is retired.

## Data and migration

The work splits in two.

**Scope model, panel and add-time flow need no migration.** `learner_senses`
stores exactly the two dispositions the model needs, and "no row" carries the
third. Its gaps can be covered with what exists:

| Gap | Cover |
| --- | --- |
| When and where a choice was made | Backend events, the pattern `addVocabularyWord` already uses (`server/db/vocabulary-learners.ts:90-91`) |
| History of changes | The same events |
| Whether the learner has reviewed the word at all | `learner_words.scope_established_at`, already present |
| The context sentence | `learner_words.intended_use_text`, already present |
| Bootstrap requested by an add | A queued row in the existing `vocabulary_sense_readiness` table |
| The resolved target sense | Computed when the panel opens and written only on confirm |

That part can ship on the application-only upgrade route
(`docs/ops/hosted-beta-deployment.md:85`).

**Per-set teaching needs a migration.** Preparation state and work gain a set
key, and existing rows become the default set for their word. This is a
schema-changing release with the quiesce, recovery-point and rehearsal
procedure. It must preserve every existing package, its publication record and
all teaching history.

Timestamps on `learner_senses` and a record of each intent resolution can be
added in that same migration. The background resolution proposed under
[the add flow](#add-flow-two-entry-points) needs somewhere to keep its pending,
resolved or unmatched state, which `intended_use_text` alone cannot hold.

Ownership: `learner_senses` is already registered as learner-private
(`server/db/ownership-manifest.ts:85`). New reads and writes must go through the
learner context and be covered by an isolation test.

## Delivery

Nothing learner-visible ships before per-set teaching, so the stack is ordered
to land the migration first as a behaviour-neutral change.

| PR | Contents | Learner-visible | Migration |
| --- | --- | --- | --- |
| 1. Set-keyed teaching, default sets only | Preparation state, work, readiness and composition keyed by word and set; every existing package becomes its word's default set | No | Yes |
| 2. Scope model | Contract text; effective-scope resolver; read and write commands with version checks; general serving filter switched to effective scope | No | No |
| 3. Repertoire demand across sets | Missing-sense demand includes taken-up senses; no retirement from exclusion | No | No |
| 4. Teaching for custom sets | Authoring for a requested set; a learner is taught from their set's package | Yes, once a set can be chosen | No |
| 5. Sense panel and add flow | The review surface on the word; add with intent; background resolution and its prompt | Yes | No |

PRs 1 to 4 can merge without changing what any learner sees, because no
learner can have a custom set until PR 5. PR 5's design waits on the prototype.

Contract changes land with the PR that makes them true: the per-set teaching
rule and frontier assumption with PR 1, the learner-scope section in
`SPECS/vocabulary-learning.md` and a fourth record in
`SPECS/vocabulary-architecture.md` with PR 2.

### Tests

- Resolver: unknown defaults, explicit none, a selected set; each crossed with
  no rows, taken-up, excluded, and a retired sense.
- Serving: an excluded sense's mapped production exercise is not served; a
  taken-up sense's is; unmapped exercises are unaffected.
- The proxy-coverage edge described above.
- A retained session composed before a scope change is unchanged.
- Isolation: one learner's scope is invisible to another and does not change
  what the other is served.
- Version conflicts on confirm.
- Reconciliation still preserves learner sense rows.
- Add with a context stores the sentence; a failed bootstrap leaves the word
  stashed and following defaults.
- Target resolution rejects a sense that is not an active sense of the word.
- Demand: a taken-up sense with no exercise creates demand; an exclusion
  creates none and retires nothing.
- Per-set teaching: two learners with the same set share one package; a
  learner on the default set is unaffected by another learner's set; a word
  whose set package is missing is not admitted; the migration preserves
  existing packages and history.
- Composition and completion coverage, per the testing map, for PR 5.

### Evaluation

- A preview-testbed scenario with words in each panel state.
- Independent UI evaluation of the two flows: add from search, and add with a
  target sense.
- Rendered checks: a one-sense word, a 16-sense word, labels and notes at their
  length limits, the pending and failed states, a narrow panel, enlarged text,
  and keyboard-only use.
- A prompt comparison for target resolution on real sentences, including
  sentences that match no listed sense.
- A comparison of packages authored for a default set and for a custom set of
  the same word, judged for whether the custom package still bridges its
  senses.

## Decisions for Justin

Settled answers are recorded [above](#settled-with-justin-2026-11-14). What
remains open:

| # | Decision | Options | Evidence | Recommendation |
| --- | --- | --- | --- | --- |
| A | Who can add a learner-proposed sense to an established inventory | (a) A model judges the proposal; a valid one is added as a non-default canonical sense under service authority, with an operator finding for review afterwards. (b) The same judgment, but the sense waits for operator approval. (c) The sense stays private to the learner. | Inventories are first created by a service call without operator approval (`server/vocabulary/sense-readiness.ts:150-165`), but the default selector cannot create senses (`SPECS/vocabulary-architecture.md:219`), and the contract defines no private-content authoring. Waiting on an operator stalls the learner; a wrong shared sense affects everyone's inventory, though not their defaults. | (a), because the sense is added outside the defaults and so changes no other learner's study. This is an authority change and needs the contract updated. |
| B | What the judgment can conclude | Matches an existing sense; a valid new use of this exact word; belongs to a larger compound or fixed expression, so suggest that word instead; a misunderstanding, explained to the learner. | The inventory rule already separates a word's own uses from meanings realised only in larger expressions (`SPECS/vocabulary-learning.md:13-18`). | All four, in a short exchange where the learner can clarify once or twice |
| C | Shape of the add | (a) The add asks: bootstrap, show options, confirm. (b) The add never asks; the word reports back and can be adjusted. (c) Different shapes for the two entry points. | See [the add flow](#add-flow-two-entry-points). (a) waits on a call configured with a 180-second timeout. | (b), to be judged on a prototype |
| D | When sense bootstrap runs for a newly added word | (a) On every add. (b) Only when the add carries an intent, or the learner opens the word's senses. (c) Only when the word reaches the reserve, as today. | It is the same call the reserve would make later. Its latency and cost are unmeasured. | (b) |
| E | Whether the panel opens by itself | Justin: "sure-ish" to opening only when a caller supplies a context. Superseded if decision C lands on (b), where nothing opens by itself. | | Revisit after the prototype |

## Not verified

- The real latency and failure rate of sense bootstrap, and the cost of one
  teaching package. The hosted invocation records would answer both.
- How many stashed words in the hosted database lack an established inventory.
- Whether teaching exercises are reliably mapped to senses.
- How much of the preparation pipeline assumes one package per word beyond the
  two tables and three call sites cited above. The size of PR 5 depends on it.
- Whether the stash and My Words rows have room for the panel; the page
  components were not read in detail.

## Out of scope

- Per-learner generated teaching.
- Sense-level scheduling, modes or graduation.
- Learner-authored senses or private content.
- Per-learner pure-cue qualification and proxy coverage.
- Recognition and contrast by sense.
- Session composition from a learner-state snapshot.
- The reading interface itself.
