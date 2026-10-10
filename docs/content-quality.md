# In-session content quality

Content feedback is a descriptive overlay. A learner has one optional thumbs-up
or thumbs-down rating for an exact content item/revision, reused on later
encounters. Clicking the selected feedback button clears it. This is a judgment
of the material, separate from whether the learner recalled the answer.

Ratings cover authored production cues, definition fallback production exercises,
pure cues, contrast prompts,
whole teaching introductions, individual package rehearsals, and post-reveal
supplements. The in-session introduction player exposes the introduction rating
throughout playback. Rehearsal ratings appear on the subsequent study cards.
The local authoring lab is outside this scope. Definition fallback ratings use
the same controls as authored cues; provenance does not change the learner action.

Study-card cue and practice feedback sits in the action area beside the session
controls. Supplement feedback stays beside its corresponding content. Feedback
uses a “Helpful?” label with “Not helpful” and “Helpful” text buttons, with the selected vote highlighted
in the app accent color.

Controls use `]` for Helpful and `[` for Not helpful outside editable fields.
The physical bracket keys also work with Chinese/Pinyin punctuation enabled.
Shortcuts appear on button hover or keyboard focus; the keyboard guide remains available. A visible
supplement takes shortcut priority over its cue; both remain clickable. Typing,
IME composition, modifier combinations, and held-key repeats do not vote.
The [frontend interaction section](../SPECS/frontend-architecture-map.md#session-keyboard-interactions)
explains how session commands and focused controls share keyboard input.

Feedback saves immediately and independently of study commits and Undo. Ending
or abandoning a session does not remove it. Rating never suppresses content, changes publication, schedules a word, or
affects grading. A newly saved “Not helpful” rating on an eligible review
production exercise, including its definition fallback, also requests post-session feedback through the existing
reflection workflow. Other content ratings remain available for operator review.
The acknowledgment is “Feedback saved”; it does not promise an individual reply
or a content change. Previously saved ratings do not request feedback merely
because an exercise is shown again.
A save failure is shown next to the controls and does not block study.

An explicit “Request feedback” action remains available on eligible production
exercises, independently of the rating. Its selected state is “Feedback requested”.
Explicit requests and requests from negative ratings combine into one reflection
evidence item per exercise. Clearing a negative rating or switching to Helpful
removes its implicit request while preserving any explicit request. Existing
failed-attempt evidence also remains independently eligible. Requests retain the
existing session acceptance and cancellation boundaries.

The learner-facing surface is named **Feedback**. Internal reflection module,
route, and evidence names remain unchanged.

Definition fallback snapshots record the target word, exact prompt text, and
ordered displayed definitions for list-based presentations. Frozen review
fallbacks retain their served prompt text. A changed prompt or definition list
has a distinct rating identity. The server validates newly encountered fallback
material against the learner-accessible word and current definition selection;
stale or invented text is rejected rather than attributed to different content.
Previously recorded snapshots and their ratings remain intact.

## Evidence and interpretation

The server resolves content references inside the learner's existing access
boundary and records the content snapshot and available generation provenance.
Pure cues use the learner's frozen served snapshot, so revised stimulus,
teaching, or answer content is distinguishable from an earlier revision. Rating
writes require that learner's prior recorded encounter with the exact content.
Requests do not choose a learner identity. Mutable contrast prompts carry the
frozen text, explanation, and target for a server comparison: if the prompt has
changed before an encounter can be recorded, feedback is rejected with a request
to open a fresh session rather than attributed to unseen content. These supplied
fields are validation expectations, not trusted snapshot uploads.

Display records have idempotent encounter keys. Rendering again or retrying the
same notification does not count another display. Displays are browser-reported
observations, not verified attention or learning outcomes. Nothing is backfilled
for encounters before the feature was installed. No answer typed by the learner
is included in this overlay.

The operator page (`#operator-usage`) shows a single table of current non-null
learner/content ratings, defaulting to the last seven UTC days by last-change
time. Date bounds, item text, content type, and vote can be filtered in the
table; column headings sort it. A table control switches between individual
ratings and an aggregate by exact content snapshot, with Helpful, Not helpful, and
rated-pair counts. Changing a vote moves its ledger row; clearing it removes the
row. Earlier vote states are not retained.

This is a sparse, voluntary impression ledger, not a representative quality
score or causal comparison of models. It deliberately focuses on ratings rather
than un-rated displays. Exact content snapshots remain inspectable in either
table view.

Access uses the existing operator allowlist. The operator can inspect the exact
rated material, including private authored material, but this view does not
include learner identifiers, responses, private notes, or reflection bundles.
Quality evidence is not fed to any model provider.

## Improving content

The [operator content-improvement workspace](content-improvement.md) opens a
revisioned correction case from an inspected item or a directly selected source.
Feedback remains a descriptive overlay; only a separately reviewed, explicitly
approved correction changes future content selection. Definition fallback ratings
are inspectable in the ledger but do not expose the authored-content correction
editor; review production can already request feedback and a proposed cue repair
through reflection.

## Deployment

This release adds an offline schema migration. Follow the stopped-writer,
backup, and rehearsal procedure in [schema migrations](ops/schema-migrations.md).
Fresh databases apply the same migration automatically. Do not use the app-only
hosted upgrade procedure for this release. The implementation PR does not
migrate or deploy production.

The initial storage migration is `0021_content_quality`. Migration
`0035_definition_fallback_quality` expands the allowed content types while
preserving existing snapshots, encounters, ratings, and immutability guards. The shared contract lives in
`src/domain/content-quality.ts`; the backend resolves and records references in
`server/db/content-quality.ts`. Learner controls live in
`src/features/content-quality/`, and `ContentQualityPanel` is part of the
existing operator page.
