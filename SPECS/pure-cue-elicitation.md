# Pure-cue elicitation

Status: accepted implementation contract, 2026-09-18. This specifies the full
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

A pure cue is a learner-private standalone elicitation: stimulus, semantic-axis
note, accepted word IDs, and its own scheduler. It has no hidden target word.
Any accepted member, including the same member on every appearance, is a
success. Frozen server-issued answer forms govern an assessment; extending
membership later does not change a served assessment. Matching is deterministic
and study-profile-aware. No model participates in live grading.

The stimulus may be a minimal-context cloze. Accepted members need not be exact
synonyms: they may express different emphasis, tone, or nuance while each is a
natural valid answer to the exercise as phrased. The shared axis must not imply
universal interchangeability. Per-member explanatory notes are a possible
future extension, not additional grading conditions or part of this release.

Pure-cue admission is independent of word admission. A member word and its pure
cue may both appear in one session. Pure-cue attempts never project onto member
word skill state, word admission, or word-learning counts.

## Scheduler and strong-cue budget

New pure cues start at a 24-hour interval, ease 2.5, and are immediately
eligible. Fragile cues use ordinary due-date SRS. A clean Hard/Good/Easy grows
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

## Promotion and production relevance

Reflection, not set membership alone, decides whether the stimulus expresses a
shared semantic axis. The model explicitly selects an existing pure cue to
extend or proposes a new one. The adapter supplies current intersecting cues
and validates the selected identity; it does not infer semantic equivalence.

One authorized promotion atomically:

1. Creates or extends the pure cue with target and response word IDs.
2. Deactivates explicitly identified overbroad word-owned cues.
3. Keeps or drafts distinctive single-answer cues for each of the two words.
4. Marks production `proxied` where no distinctive production cue remains.
5. Compensates the originating target's false lapse when a snapshot exists.

The policy is symmetric, but the two words may have different leftovers.
Unrelated cues are not implicitly removed. `proxied` means useful production
is represented by a broader elicitation; it is not a judgment that production
is worthless. Existing explicit suppression remains suppressed. Proxied
production cannot be admitted through definition fallback. Recognition is
unchanged. Automatic future refinement or deproxying is out of scope.

## Staged reflection

The server orchestrates ordinary diagnosis followed, only for eligible
candidates, by a bounded promotion-specific provider call. The second stage
receives the source attempt, diagnosis, both words' existing production cues,
and intersecting pure cues including their stimulus and axis notes. There is
no provider-directed database tool loop.

The stage chain is versioned separately from legacy one-shot history. Persist
the exact stage input before calling the provider; a retry of stage two reuses
that input and the saved diagnosis rather than regenerating stage one. Each
provider call retains its own run diagnostics and usage. Only the final
validated result becomes a learner artifact. Generation never authorizes an
operation automatically.

Final new results cannot propose new multi-answer word-owned cues. Promotion
also replaces conflicting first-stage repairs, supplements, or suppression
for affected words so separate authorization cannot undo the promotion's
intended content policy. Unrelated proposals remain available.

## False-lapse compensation

Capture the originating production skill state and word admission state before
projecting a new lapsed review action. All source events in that action share
one snapshot and one restore-once marker. Promotion restores that snapshot,
including interval/ease and recency/admission, without editing attempt history
or the response word's scheduler.

Intervening study can be overwritten by this restoration: this is an accepted
quirk of asynchronous reflection, not a replay/rebase feature. Historical
attempts lacking snapshots may still be promoted, with compensation explicitly
reported as unavailable. A successful accepted-alternate attempt has no lapse
to compensate. Repeated promotion cannot restore the same action twice.

## Non-goals

No live model grading, refinement ladder, member-balancing penalty, scripted
semantic promotion of legacy cues, global session time planner, or daily
strong-cue debt.
