# In-session content quality

Content feedback is a descriptive overlay. A learner has one optional thumbs-up
or thumbs-down rating for an exact content item/revision, reused on later
encounters. Clicking the selected feedback button clears it. This is a judgment
of the material, separate from whether the learner recalled the answer.

The first release covers authored production cues, pure cues, contrast prompts,
whole teaching introductions, individual package rehearsals, and post-reveal
supplements. The in-session introduction player exposes the introduction rating
throughout playback. Rehearsal ratings appear on the subsequent study cards.
Dictionary fallback prompts and the local authoring lab are outside this scope.

Study-card cue and practice feedback sits in the action area beside the session
controls. Supplement feedback stays beside its corresponding content. Feedback
uses “Needs work” and “Useful” text buttons, with the selected vote highlighted
in the app accent color.

Controls use `]` for Useful and `[` for Needs work outside editable fields.
The physical bracket keys also work with Chinese/Pinyin punctuation enabled.
The visible controls advertise which item owns those shortcuts. A visible
supplement takes shortcut priority over its cue; both remain clickable. Typing,
IME composition, modifier combinations, and held-key repeats do not vote.
The [frontend interaction section](../SPECS/frontend-architecture-map.md#session-keyboard-interactions)
explains how session commands and focused controls share keyboard input.

Feedback saves immediately and independently of study commits and Undo. Ending
or abandoning a session does not remove it. Rating never suppresses content,
changes publication, schedules a word, affects grading, or triggers generation.
A save failure is shown next to the controls and does not block study.

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

The operator page (`#operator-usage`) includes content triage with UTC date and
content-type filters, display counts, unique learner/content pairs, current
thumb counts, source/model breakdowns, and exact-content inspection. Repeated exposure does not inflate
votes. Coverage is rated learner/content pairs divided by exposed learner/content
pairs. The thumbs-down fraction uses rated pairs as its denominator; an unrated
item is not implicitly good or bad.

Date filters select the exposure cohort. Votes are the **current standing
ratings** from those exposed learners, including subsequent edits or clears;
the view is not a historical time series of opinions. Low-volume voluntary
ratings are useful manual evidence, not a representative quality score or a
causal comparison of models. Provenance is displayed where known; missing
provenance remains unknown rather than guessed.

Access uses the existing operator allowlist. The operator can inspect the exact
rated material, including private authored material, but this view does not
include learner identifiers, responses, private notes, or reflection bundles.
Quality evidence is not fed to any model provider.

## Improving content

The [operator content-improvement workspace](content-improvement.md) opens a
revisioned correction case from an inspected item or a directly selected source.
Feedback remains a descriptive overlay; only a separately reviewed, explicitly
approved correction changes future content selection.

## Deployment

This release adds an offline schema migration. Follow the stopped-writer,
backup, and rehearsal procedure in [schema migrations](ops/schema-migrations.md).
Fresh databases apply the same migration automatically. Do not use the app-only
hosted upgrade procedure for this release. The implementation PR does not
migrate or deploy production.

The storage migration is `0021_content_quality`. The shared contract lives in
`src/domain/content-quality.ts`; the backend resolves and records references in
`server/db/content-quality.ts`. Learner controls live in
`src/features/content-quality/`, and `ContentQualityPanel` is part of the
existing operator page.
