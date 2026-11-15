# Learner sense preferences — build spec

> Historical design input, archived with implementation delivery on 2026-11-15.
> Current behavior is owned by the vocabulary contracts and [chat runtime](../../docs/chat-runtime.md);
> see the [implementation evaluation](../../docs/evaluation/trials/2026-11-15-custom-senses.md).
> The pre-implementation descriptions and simulated behavior below are retained as history.

status: archived
type: handoff
created: 2026-11-14
retire-when: the first PR is open, or the design is declined
related:
  - SPECS/vocabulary-learning.md
  - SPECS/vocabulary-architecture.md
  - STABILITY_FRONTIER.md
  - notes/active/2026-10-15-vocabulary-model-whiteboard.md
  - notes/archive/2026-11-15-add-word-chat-simulation.md

Build spec for letting a learner choose which senses of a word they study. It
is a setup deliverable ahead of the reading interface: a learner who adds a
word because of one sentence should get the sense they met, alongside the
word's usual senses, and be able to adjust the set. It is also useful alone, because today
every learner studies the same shared selection.

The direction is [settled](#settled-with-justin-2026-11-14), including that
adding a word becomes a bounded chat, and no decisions are open. No application
code has been written.

## Goal and stance

- A learner can take up or exclude senses of a word. Their choice changes which
  sense-mapped work they are served; it changes nothing for other learners.
- Shared content stays shared. The canonical inventory and the default useful
  selection keep their current operator authority. A learner choice is private
  state layered on the shared default.
- Adding a word never waits on a slow model call. Senses and teaching that are
  not ready are reported on the word afterwards.
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
   see [the add flow](#add-flow-a-bounded-chat).
6. A learner cannot exclude every sense. A learner who wants to has a sense in
   mind that the inventory lacks, and the app should support that on a best
   effort, rejecting a proposal that is off base. A chat-like exchange may be
   the right surface. See point 17.
7. Nothing learner-visible ships before per-set teaching.
8. A sense taken up on a word that has already been taught gets no re-teaching
   and no sense-based exercise weighting. The only follow-through is
   bootstrapping exercises for that sense when none exist.
9. No migration for the scope model alone; timestamps and resolution records
   can ride with the per-set teaching migration.
10. Packages are authored for any distinct set, with count and cost reported
    to the operator.

11. Adding a word becomes a bounded agentic chat, with the stash search kept
    as "just add words". See [the add flow](#add-flow-a-bounded-chat).
12. Chat turns are mostly one-shot; the agent asks only when it is truly
    unsure of the learner's intent.
13. A request that is part of a larger word is redirected to that word, with
    no learner override for now.
14. For a word with no default senses, the agent recommends a set.
15. The chat may teach a little, and the chat model may make linguistic
    judgments itself for now.
16. The add flow is greenfield: no further cases are needed before building,
    and it will be corrected in use.
17. A valid learner-proposed sense is added to the shared inventory as a
    non-default sense when the learner presses Add, with an operator finding
    afterwards. This is an authority change and needs the contract updated.
18. Sense bootstrap is queued whenever the chat looks up a word with no
    inventory. Delaying it when intent is uncertain is a possible later
    refinement.
19. The sense list on a card is directly interactive; agent presets are
    shortcuts.
20. Conversations are kept. The learner sees one long chat; each exchange is
    normally independent for the model. Bringing earlier exchanges back into
    context when relevant is wanted but may be left out of the first cut.
21. Undo reverses the learner's effects only. Anything added to shared
    content stays, under its usual quality guards.

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

A learner's set is stored only as deviations from the defaults, plus the
target sense.
A learner cannot exclude every sense.

## Add flow: a bounded chat

Settled with Justin on 2026-11-15, after a simulated run of nine adds: adding a
word becomes a short chat with an agent, and the existing stash search stays as
"just add words" with no model involved. The chat merges the two mindsets that
one confirmation step could not serve:

| | Word-centric | Scenario-centric |
| --- | --- | --- |
| The learner types | A word | A word with where they met it, a sentence, or what they want to say |
| The agent | Shows the word and its senses, and adds it | Finds the word and the sense that fits, and shows the other senses alongside |

It is also the first, deliberately narrow, use of agentic chat in the app. The
tool loop, streaming and conversation storage are meant to be reusable for a
later mid-study aside; nothing else about that surface is designed here.

### Shape of a turn

- The agent looks things up, applies one level of synthesis, and answers with a
  short message and usually one card. It does not reason deeply and can run on
  a fast model.
- Turns are one-shot. The agent asks a question only when the learner's words
  fit two senses or two different words and the choice changes what is added.
  Otherwise it acts or proposes, and the learner follows up if they want.
- The learner sees one continuous chat they can scroll back through. For the
  model, each exchange about a word normally starts fresh, without earlier
  exchanges in context. Paging earlier context back in when it is relevant is
  a later refinement and needs evaluation.

### Cards

A card is the only thing that changes state, and it always shows which state it
is in. The agent's prose never implies a change the card does not show.

| Card state | Meaning | Actions on the card |
| --- | --- | --- |
| Proposed | Nothing has changed | Add; preset alternatives the agent offers, such as one sense only |
| Added | The word is in the learner's bank with the shown set | Undo; change senses |
| Preparing | Added, and its senses or lesson are being prepared | Undo; change senses once senses exist |
| Ready | Added and teaching-ready | Change senses |
| Already studying | The word was in the bank before this conversation | Change senses |

- A card updates in place. When preparation finishes while the chat is open,
  Preparing becomes Ready with no new message. Outside the chat, the word's row
  in the bank shows the same state.
- The sense list on a card is the bounded manual choice: the learner can tick
  or untick senses directly. The agent's preset buttons are shortcuts to the
  same write.
- Undo reverses the learner's effects: the word and its set return to what
  they were. A sense or queued preparation that reached shared content stays.
- The model emits a card as structured data: a word ID, sense IDs, and actions
  from a fixed list. The server validates every ID against the word before the
  card is shown, and again when a button is pressed. A button press is a normal
  authenticated command, not a model action.

When the agent adds without asking:

| Situation | Behaviour |
| --- | --- |
| A bare word that resolves to one lexical word with established defaults | Added immediately, with Undo |
| A word with a context that matches a listed sense | Added immediately with the defaults plus that sense, with Undo |
| The agent changed what was asked for: a corrected character, a larger expression, a new sense | Proposed |
| The word has no default senses | Proposed, with a set the agent recommends pre-selected |
| The word is already studied | Nothing is added; the card shows its state |

This rule is a starting point. Adds are cheap to undo, so the agent may guess;
the card states are what keep a guess legible.

### Cases the agent handles

All but the last were exercised in the simulation, whose full exchanges are
kept in the [simulated transcript](2026-11-15-add-word-chat-simulation.md).

| Case | Example | Outcome |
| --- | --- | --- |
| Word with a context that fits a listed sense | 帮派, gang members in a film | That sense marked as the learner's context; defaults kept; a related word may be offered once |
| No inventory yet | 绵长 | Bootstrap is queued; the word is added with the sentence kept, and the sense is matched when the inventory lands |
| The request is part of a larger word | 接发 → 接发球 | The larger word is proposed. There is no learner override for now; the refused request is logged as an operator finding |
| Bare word | 纠结 | Senses shown, defaults marked |
| No default senses | 致密 | The agent recommends a set relative to the word's own scope |
| Already studied | 宠溺 | State shown; a sense outside the learner's set can be included, with no re-teaching |
| Phrase or components | 怡然自得 | A recommendation with reasons; one card |
| Wrong character | 海眠 → 海绵 | The correction is proposed |
| A valid use the inventory lacks | 蒸馏 for model distillation | A new sense is proposed on the card and created only when the learner adds, as a non-default shared sense with an operator finding |
| A use that is off base | not simulated | Explained to the learner; nothing is proposed |

### Tools

The agent has a small fixed set of reads and one way to show a card. It has no
free-form writes.

| Tool | Kind | Notes |
| --- | --- | --- |
| Look up a word by hanzi | Read | The lexicon, with frequency |
| Find similar words; find expressions containing a string | Read | For wrong characters and larger expressions |
| Learner state for a word | Read | Studied or stashed, mode, the learner's set |
| List a word's senses | Read | With shared defaults; reports "no inventory yet" |
| Teaching and exercise status for a word and set | Read | Drives Preparing and Ready |
| Queue sense bootstrap | Request | The existing readiness queue; runs on any lookup of a word with no inventory |
| Present a card | Output | Structured and validated, as above |

Commands a card button runs: add a word with a set and an optional context;
change a word's set; undo an add; add a word together with a proposed sense.

Judgments the chat model makes itself, for now: matching a context to a sense,
judging whether a proposed use is valid, spotting a wrong character or a larger
expression, and suggesting a related word. Any word or sense it names must pass
a lookup before it appears on a card. If these prove unreliable they can move to
stored data or a dedicated backend call.

### What the chat may say

The chat teaches a little: a gloss in the learner's context, a short contrast
with a near word, an example sentence. This is unreviewed model output shown to
a learner, outside the published lesson, and is accepted for this surface.

Where it is cheap, the intake is coupled to later study: the learner's own
sentence, and the example they saw, are kept with the word so that an
"intake-time example" can later be offered among its exercises. This is best
effort and is not required for the first version. A learner's sentence is
private and must not be fed into a shared package's authoring.

### Views

The chat with its cards is a new surface. The bank stays as the read-only view
of the learner's words. Moving between them is left for later.

### Writing the scope

- A card button sends the chosen sense IDs with the learner word's
  `state_version` and the catalog and selection versions the card showed.
- A stale version is rejected and the card reloads.
- The write sets `scope_established_at` and emits a backend event carrying the
  before and after scope and the surface it came from.
- Every sense ID must be an active sense of that word. A violation is a
  contract error and fails loudly.
- A context is stored in `intended_use_text`, the column that already exists
  for this.

### What does not exist yet

- No streaming and no tool calling anywhere in `server/` or `src/`; the request
  types in `server/llm/types.ts` have neither. Every model call today is a
  background job through the invocation ledger.
- Sense bootstrap is configured with a 180-second timeout
  (`server/vocabulary/sense-readiness.ts:22`), so a chat turn never waits for
  it. That is why Preparing is a card state and not a spinner.
- The only existing way to remove a word is dismissal
  (`server/db/vocabulary-learners.ts:149`), which has its own suppression
  rules (`SPECS/vocabulary-learning.md:103-116`). Whether Undo can reuse it is
  not verified.

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

**The scope model needs no migration.** `learner_senses`
stores exactly the two dispositions the model needs, and "no row" carries the
third. Its gaps can be covered with what exists:

| Gap | Cover |
| --- | --- |
| When and where a choice was made | Backend events, the pattern `addVocabularyWord` already uses (`server/db/vocabulary-learners.ts:90-91`) |
| History of changes | The same events |
| Whether the learner has reviewed the word at all | `learner_words.scope_established_at`, already present |
| The context sentence | `learner_words.intended_use_text`, already present |
| Bootstrap requested by an add | A queued row in the existing `vocabulary_sense_readiness` table |
| The resolved target sense | Chosen in the chat and written by the card's command |

That part can ship on the application-only upgrade route
(`docs/ops/hosted-beta-deployment.md:85`).

**Per-set teaching needs a migration.** Preparation state and work gain a set
key, and existing rows become the default set for their word. This is a
schema-changing release with the quiesce, recovery-point and rehearsal
procedure. It must preserve every existing package, its publication record and
all teaching history.

Timestamps on `learner_senses` can be added in that same migration.

**The chat needs new learner-private storage**, and so a second migration:

- Conversations and their turns, including tool calls and the cards shown.
  They are kept, both as the learner's visible chat history and for
  evaluation and repair.
- A deferred sense match: a word added before its inventory exists keeps its
  context and a pending state until the match is made.
- Later, an intake-time example attached to the learner's word.

Learner text typed into the chat is sent to the model provider. That is a new
disclosure and belongs in the contract with the chat PR.

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
| 5. Chat core | A fast-model tool loop with streaming, validated structured output, conversation storage and ledger records; no learner surface | No | Yes |
| 6. Add-word chat | The tools, cards and commands in [the add flow](#add-flow-a-bounded-chat); the agent prompt; deferred sense matching | Yes | No |

PRs 1 to 5 can merge without changing what any learner sees, because no
learner can have a custom set until PR 6. PRs 5 and 6 do not depend on PRs 1
to 4 to be developed, only to be released.

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
- Version conflicts on a card command.
- Reconciliation still preserves learner sense rows.
- Add with a context stores the sentence; a failed bootstrap leaves the word
  stashed and following defaults.
- A card naming a word or sense that fails validation is never shown, and a
  button cannot write a sense that is not an active sense of the word.
- The agent has no write path except card commands run by the learner, and
  the immediate add under the stated rule.
- Undo restores the learner's prior state for that word and leaves a sense it
  added to the shared inventory in place.
- Demand: a taken-up sense with no exercise creates demand; an exclusion
  creates none and retires nothing.
- Per-set teaching: two learners with the same set share one package; a
  learner on the default set is unaffected by another learner's set; a word
  whose set package is missing is not admitted; the migration preserves
  existing packages and history.
- Composition and completion coverage, per the testing map, for PR 6.

### Evaluation

- A transcript set for the agent, seeded with the ten cases in
  [the add flow](#add-flow-a-bounded-chat), each with an expected outcome:
  the word, the set, the card state, and whether it asked.
- A preview-testbed scenario with words in each card state.
- Independent UI evaluation of the chat: a bare word, a word with a context,
  and a redirected request.
- Rendered checks: a one-sense word, a 16-sense word, labels and notes at their
  length limits, Preparing turning to Ready in place, a narrow panel, enlarged
  text, and keyboard-only use.
- A comparison of packages authored for a default set and for a custom set of
  the same word, judged for whether the custom package still bridges its
  senses.

## Decisions for Justin

None are open. Every answer is recorded
[above](#settled-with-justin-2026-11-14).

Two points are deliberately left for after the first cut: delaying bootstrap
when the learner's intent is uncertain, and paging earlier exchanges back into
the model's context.

## Not verified

- The real latency and failure rate of sense bootstrap, and the cost of one
  teaching package. The hosted invocation records would answer both.
- How many stashed words in the hosted database lack an established inventory.
- Whether teaching exercises are reliably mapped to senses.
- How much of the preparation pipeline assumes one package per word beyond the
  two tables and three call sites cited above. The size of PR 1 depends on it.
- Which fast model the chat uses, whether the existing provider client
  (`server/llm/openai-compatible.ts`) can stream and call tools, and what a
  chat turn costs.
- Whether a real fast model reproduces the simulated behaviour. The simulation
  was written by hand, with invented tool results.
- How Undo is implemented. Dismissal has suppression rules that an undo
  should not trigger.

## Out of scope

- Per-learner generated teaching.
- Sense-level scheduling, modes or graduation.
- Learner-private senses or private authored content.
- Agentic chat anywhere other than adding a word.
- A learner override when a request is redirected to a larger word.
- Per-learner pure-cue qualification and proxy coverage.
- Recognition and contrast by sense.
- Session composition from a learner-state snapshot.
- The reading interface itself.
