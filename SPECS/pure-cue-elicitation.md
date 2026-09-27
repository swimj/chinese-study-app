# Pure-cue elicitation

Status: accepted implementation contract, updated 2026-09-26. This specifies the full
vertical authorized in the pure-cue task; individual stack layers implement
the foundation, session integration, and reflection integration in order.
It supersedes the exploratory choices in
[`pure-cue design memo`](../notes/active/2026-09-18-pure-cue-elicitation-memo.md).
The stability-frontier document is intentionally not rewritten by this task.

## Ownership and admission

Word-owned production remains the default. Every word-owned cue accepts exactly
its owner. The release migration resets all existing accepted sets to that
owner, including shared and inactive cues, and removes the legacy 48-hour
alternate-answer recheck scheduler. It does not infer pure cues or proxy status:
subsequent practice and reflection make those semantic decisions. Old in-flight
multi-answer/recheck commits are rejected; restart study after this cutover.

A pure cue is a shared standalone elicitation: stimulus, semantic-axis note,
teaching note, and accepted word IDs. Its scheduling and assessment history are learner-private.
It has no hidden target word. Targeted and pure cues share the core content,
accepted-answer, frozen-snapshot, and deterministic matching concepts, while
retaining their distinct scheduling policies.
Any accepted member, including the same member on every appearance, is a
success. Frozen server-issued answer forms govern an assessment; extending
membership later does not change a served assessment. Matching is deterministic
and study-profile-aware. No model participates in live grading.

The axis describes a useful communicative slot: a referent, act, or situation
that each accepted word naturally expresses. Overlapping dictionary glosses
alone do not establish such a slot. Prefer a natural Mandarin cloze, optionally
with a concise English frame; a simple referent can warrant a bare gloss.
The frame and cloze together are one stimulus, not two retrieval routes.

The stimulus may be a minimal-context cloze. Accepted members need not be exact
synonyms: they may express different emphasis, tone, or nuance while each is a
natural valid answer to the exercise as phrased. The shared axis must not imply
universal interchangeability. The axis note describes the shared purpose, not
an exhaustive comparison of the originating pair. One compact teaching note
provides reveal-time nuance and boundaries. It is edited holistically, not
stored as separate per-member records, and never adds hidden grading conditions.

Successful authorized promotion publishes new content as `shared_trial`.
Extensions update shared accepted membership and the holistic teaching note
for future assessments, preserving the stimulus and axis. The existing teaching
note and member identities serve as accumulated context alongside the incoming
pair; fetching every member's full lexical context is not required. The proposal
must not overwrite a newer membership or teaching-note state unseen in its
evidence. Served snapshots freeze reveal text as well as accepted answers;
extensions do not revise frozen history. No extra per-learner content approval is
required. Shared publication retirement/quarantine controls serving globally.
Proposal evidence, source responses, provenance, and compensation remain private.

A shared pure cue is adopted automatically when at least one accepted member
belongs to the learner's review-stage vocabulary. This does not enroll its other
members as vocabulary. Adoption initializes private practice state exactly once;
temporarily losing eligibility and later regaining it preserves prior progress.
There is no additional intake cap. Once eligible, pure-cue scheduling is
independent of word scheduling: a member word and its pure cue may both appear
in one session. Pure-cue attempts never project onto member word skill state,
word admission, or word-learning counts.

## Scheduler and strong-cue budget

New learner adoptions start at a 24-hour interval, ease 2.5, and become due
after a six-hour delay. Fragile cues use ordinary due-date SRS. A clean Hard/Good/Easy grows
the cue's interval using the ordinary rating multipliers and interval fuzz.
A miss produces a six-hour interval and the ordinary ease penalty; in-session
recovery requires three consecutive successful responses. Reinforcement is
part of the same assessment, not additional budget or growth credit.

Crossing a 720-hour interval enters the strong tier with `strongSuccesses = 0`.
Strong cues are sampled independently of due date, with a six-hour exclusion
after their last study. Each successful completed strong assessment increments
the counter once. A lapse exits the strong tier; later reentry resets it.

For N admitted ordinary review items, including due fragile pure cues but
excluding strong cues, reinforcement, learning, and new-word work, allocate
`floor(N / 10)` strong slots plus one with probability `(N % 10) / 10`.
Sample eligible strong cues without replacement with weight
`1 / (1 + strongSuccesses)`, capped by available candidates. This is a
per-payload proportional policy, not a daily entitlement or debt. Interleave
the resulting cards with ordinary review rather than frontloading them.

The frontend owns covering, reinforcement, drain, and Undo. A covered pure-cue
assessment uses its own deferred commit intent, independent attempt history,
and server-validated, idempotent scheduler projection.

## Coordinated cleanup and production coverage

Reflection, not set membership alone, decides whether the stimulus expresses a
shared semantic axis. The model explicitly selects an existing pure cue to
extend or proposes a new one. The adapter supplies current intersecting cues
and validates the selected identity; it does not infer semantic equivalence.

Stage two owns both words' production-cue repertoire. One authorized cleanup
atomically:

1. Optionally creates and publishes, or extends, a shared pure cue with target
   and response word IDs and a holistic teaching note.
2. Retires explicitly identified overbroad shared targeted cues globally
   (deactivating unshared cues only for their owner).
3. Keeps or drafts distinctive single-answer cues for each of the two words.
4. Makes the resulting shared content coverage visible to all learners.
5. Compensates the originating target's unfair lapse when the independent
   source-fairness judgment and applied repair qualify and a snapshot exists.

No useful shared exercise is a successful cleanup outcome: useful word-owned
repairs need no pure destination. Expect natural word-specific cues in that
case. Failure to author one is not evidence for suppression. Inspect the final
repertoire, including the dictionary-derived fallback exposed when all targeted
cues are retired without shared coverage; do not claim that retirement alone
has repaired a recurring fallback ambiguity. No new suppression policy follows
from this edge case.

The policy is symmetric, but the two words may have different leftovers.
Unrelated cues are not implicitly removed. `proxied` is a derived word-level
content property: eligible shared pure coverage exists and no eligible shared
targeted cue remains. It means useful production is represented by a broader
elicitation, not that production is worthless. It is never stored as a learner
relevance state. Existing explicit learner suppression is untouched. Proxied
production cannot be admitted through definition fallback; an existing usable
private targeted cue may still serve. Recognition is unchanged. New distinctive
shared targeted content naturally changes the derived coverage back to targeted;
automatic semantic refinement remains out of scope.

## Staged reflection

Before diagnosis, initial and second-opinion bundle assembly greedily keeps
items in stable order only when neither their target nor identified response
word has appeared in an already admitted item. Overlapping items are silently
omitted from best-effort reflection; counts remain available in continuation
diagnostics. Omitted second-opinion proposals remain deferred. This is a
word-pair guard, not complete collision detection across pure-cue destinations.

Stage one chooses exactly one path per item, before drafting interventions:
ordinary reflection with explanation/proposals, or a suspected-entanglement
handoff with no proposals or questions. This is a best-effort filter, not a
declaration of shared meaning or final source fairness. Ground the handoff in
the cue actually displayed, never a more specific hypothetical task. Ordinary
single-word repair and contrast authoring remain in stage one; contrast is a
separate content space from coordinated production-cue management. Handoffs require a
strict target-only rejected/Forgot source with a distinct known response word.
Pure-cue attempts themselves are not yet reflection inputs.

Stage two assesses the handoff against both words' existing production cues and
intersecting pure cues. It owns coordinated content repair, independent judgment
of the original exercise's fairness, and the final learner explanation. It may
publish shared practice plus word repairs, repair only word cues, or explain
without proposing changes. It can revise stage one's assessment. No-slot cleanup
does not assert that the pair cannot overlap in any possible context. There is
no provider-directed database tool loop.

The stage chain is versioned separately from legacy one-shot history. Persist
the exact stage input before calling the provider; a retry of stage two reuses
that input and the saved diagnosis rather than regenerating stage one. Each
provider call retains its own run diagnostics and usage. Only the final
validated result becomes a learner artifact. Generation never authorizes an
operation automatically.

This release is a hard execution cutover: only current flow, evidence, and
prompt contracts support retries, second opinions, or proposal authorization
and application. Older results stay readable but cannot be upgraded in place.
There is no age-based compatibility window. Learners continue with new study.

Final new results cannot propose new multi-answer word-owned cues. Ordinary
items keep stage one's explanation/proposals; routed items use stage two's
explanation and cleanup or explanation-only outcome. There are no competing
first-stage content deltas for routed items to merge or discard. Unrelated
ordinary items remain available. All content and compensation effects still
require explicit proposal acceptance.

## False-lapse compensation

Capture the originating production skill state and word admission state before
projecting a new lapsed review action. All source events in that action share
one snapshot and one restore-once marker. Restoring it puts back production
interval, ease, and recency/admission without editing attempt history or the
response word's scheduler. Restored production `nextDueAt` is the later of
the snapshot due time and six hours after restoration, so remaining (non-proxied)
production does not become immediately due.

Coordinated cleanup can restore that snapshot when it remedies an independently
judged unfair source exercise. Pure-cue publication alone does not establish
past unfairness; absence of a shared slot does not establish a fair lapse.
An ordinary cue repair restores it when it installs
a fairer cue (`create` or `replace`) and judges the served exercise
`misleading_or_overloaded_cue`. Deactivation alone does not restore it, and a
repair that only improves a fair cue does not. The repair addresses that
action-level snapshot through the action's first attempt, the mistake.
Naming a later attempt, or more than one attempt, fails the application.
The same action restores once, whichever proposal runs first.

Intervening study can be overwritten by this restoration: this is an accepted
quirk of asynchronous reflection, not a replay/rebase feature. Pair cleanup requires
a strict target-only source lapse and a distinct resolved response word; a clean
success is an invalid source, not a `not_applicable` compensation outcome.
Missing snapshots report `unavailable`; a repeated restore reports
`already_restored`. Explanation or retirement alone has no independent
compensation effect. Obsolete reflection work is read-only after the
generation-contract cutover.

## Non-goals

No live model grading, refinement ladder, member-balancing penalty, scripted
semantic promotion of legacy cues, global session time planner, or daily
strong-cue debt.
General pure-cue stimulus/axis repair, member removal, retirement, and multiple
stimuli remain deferred. Existing mixed axis notes are not semantically migrated
or repaired by the generation prompt; the new teaching field supplies a landing
spot for separate operator cleanup. New and upgraded databases initialize that
field without interpreting existing text.
