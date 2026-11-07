# Operator panel

This guide explains how an authorized operator reaches and uses the application’s
operator workspace. It describes the available views and their
workflows; the [API reference](api.md#operator-view) defines the HTTP contracts.

## Access

Open `/operator/usage`, or bookmark a specific view such as
`/operator/improvement`. The workspace has its own operator rail and does not
mount learner dashboard, attention, or session-recovery controllers. Its
**Return to study** link loads `/` as a new page; study state is not preserved
across this full-page boundary. The old operator hashes are not routes. Access requires the signed-in Clerk user id, or the
trusted-local learner identity, to be allowed by `APP_OPERATOR_CLERK_USER_IDS`.
An empty allowlist denies access. Rail navigation retains the opened improvement
workspace in this operator page, including draft edits and pending review state.
Leaving the page via Return to study does not retain that in-memory workspace.

## Views

| View | What it supports | Related explanation |
| --- | --- | --- |
| Usage | Current cohort pulse and the last seven completed daily snapshots | [Hosted observability](ops/hosted-observability.md) |
| Model invocations | Inspect attributed provider calls, filter and group rows, compare spend summaries, and refresh the ledger | [Operator API](api.md#operator-view) |
| Content sharing | Weekly exact-content reuse counts, learner-originated cue reuse, and inspectable examples | [Sharing metrics](#content-sharing) |
| Content quality | Review content-quality signals and filter the triage queue | [Content quality](content-quality.md) |
| Content improvement | Review vocabulary judgments and proposals, reconcile sense conflicts in Needs attention, and apply approved corrections | [Content improvement workflow](#content-improvement-workflow) |
| Preparation failures | Inspect paused shared preparation work and retry eligible stages | [Error diagnostics](ops/error-diagnostics.md#shared-word-preparation-failures) |
| What’s New | Edit and publish learner-facing update posts | [What’s New](whats-new.md#manual-operator-editor) |
| Service banner | Set planned downtime, edit a custom message, or clear the active banner | [Banner API](api.md#operator-view) and [hosted upgrade runbook](ops/hosted-beta-deployment.md#post-a-pre-upgrade-banner) |

The Model invocations view loads the full ledger for its summaries and filter
choices, then reveals rows progressively as the table is scrolled. Column
headers provide sorting, grouping, and type-specific filters. Its fixed summary
periods cover today and the last seven calendar days including today; the
selection summary reflects the active filters. Refresh reloads the accounting
snapshot. The view does not use server-side pagination.

Initiator identifies the learner whose session triggered initial reflection and
its pipeline stages, Operator for explicitly requested second opinions and
reassessments, or Service for independent automation. Backend execution ownership
is separate. Learner names and IDs remain available for learner initiators;
operator work retains its
source learner in provenance without grouping its spend under that learner.

Model invocations and Content quality offer a Timestamp display control inside
the timestamp column's options, opened by clicking its header: UTC
(the default), Local time (the browser's time zone), or Specific time zone
(a named zone selector). Each view independently remembers its display mode and
named zone in browser local storage across reloads. Missing or invalid saved choices and unavailable storage
use the UTC default; a selection remains usable if saving fails. Preferences are
local to this browser, without account-level sync. Timestamp
cells show the date, time, and UTC offset at that instant, including daylight
saving changes. Display choices leave date filters, day grouping, summary
periods, and stored timestamps on their UTC boundaries.

## Sense reconciliation

Open **Content improvement → Needs attention** and select a Sense reconciliation
item. The matcher appears within the selected attention item. The compatibility
URL `/operator/reconciliation` opens Needs attention; reconciliation has no separate
rail tab. Compare canonical senses and defaults with the teaching uses, notes and examples.

One item groups preparation failures that share a current or reviewed teaching-source
resolution. Expand **Individual cases** to inspect the source and each retained
preparation failure. Failures on sources outside the resolution and unrelated reflection cases remain
separate, even when they concern the same word. Grouping does not merge or delete their records.
Matched teaching uses group beside their chosen canonical sense as you assign them;
unassigned and excluded uses remain in separate groups. This grouping reflects
operator choices, not automated semantic matching.
For each use, record its relationship to an existing canonical sense, reject it,
or describe a transformation the system cannot yet apply. Drag a teaching card to
a sense, or use its Move handle and a destination button with keyboard/click.
Holding a drag near the top or bottom of the review pane scrolls toward offscreen
targets; dropping or cancelling stops the scroll.
Descriptions, examples, fallback selection and optional notes live under Details.
Neither per-use reasons nor an overall rationale are required to apply.

Saving a draft or resolved decision preserves editorial work without changing live
content. A resolved decision can remain blocked: the application plan names missing
handlers, pending content decisions, active work or changed source evidence. Review
current evidence explicitly after a source change; reloading is not approval of a
different plan.

The first supported handler keeps canonical identities, accepts a nonempty set of
existing senses as defaults, and replaces the affected teaching unit. If every
selected sense has a mapped teaching use, repertoire carries forward without
bootstrap. If any selected sense has no mapped use, the entire selected repertoire
is regenerated. The preview identifies content retained or retired. Apply retires
affected current content and queues required replacement in one transaction.
Required repertoire generation starts from the resolved canonical senses without
waiting for teaching. Teaching and practice progress remain visible separately;
fresh study of the affected word waits until all required replacements are ready. Other ready study and already-running sessions remain available.
Retry failed preparation under unchanged authority. If canonical senses or defaults
change while replacement is incomplete, a new reviewed resolution is required.
Completed reconciliations leave Needs attention when no current mismatch or newer
decision remains. Their covered preparation failures also leave the active queue while
the original records and resolution history remain retained. Completed reconciliation
does not permanently lock future default edits.

Additions, sense revisions, retirement, merges/splits, and empty-default dispositions
can be described and saved as development gaps; this first handler cannot apply them.
No linguistic result is inferred merely because reflection generated exercises.
See the [delivery contract](../SPECS/sense-content-reconciliation.md) and
[implementation](implementation/vocabulary-content-improvement.md#sensecontent-reconciliation).

## Usage metrics

Usage shows today live and seven completed UTC days as saved snapshots. Each day
counts practice words that gain a correct day as **Practice**, separately from
new words. Practice occurs at most once per word per day, so session totals can
be summed directly. Failed practice still counts as covered in the learner
summary but adds no correct day to Usage. **Review correct** and **Review wrong**
count completed review exercises
without and with a lapse, including contrast selection and pure cues. Successful
reinforcement after a lapse adds no exercise and does not turn that exercise into
a correct review. These counts and total active session time come from completed
session summaries; work in incomplete sessions is not included.

**New words** sums the persisted new-word counts in completed session summaries
on each summary's UTC completion day, alongside Sessions and Practice. The
count comes from accepted `unstudied → learning` outcomes in that session,
including the final action after acceptance. Opening a teaching package,
previewing an undoable final action, and repeating Practice add no new words.
An unfinished session contributes no Usage count. A session spanning UTC
midnight belongs wholly to its summary's completion day.

The learner's daily admission count is separate: it updates as new words are
accepted and uses the study caller's day key for respecting the daily limit.
Usage does not change that key or scheduling. Summary writes persist the
new-word total and refresh affected daily snapshots, including a summary saved
after its reporting day's snapshot was captured. Retrying a summary replaces
its total rather than incrementing it. The panel reads persisted counts.

Migration `0038_usage_new_word_totals` backfills completed summaries from saved
word outcomes or confirmed completion reports and corrects saved daily totals.
Older sessions without this evidence retain an unknown count. Usage sums known
counts, treating missing counts as zero, so New words is a lower bound when
historical evidence is missing. Admission counts alone cannot reconstruct
completed-session Usage. Capture-time metrics such as **Mean stash** retain
their saved values.

**Proposals accepted** counts durable proposal-acceptance invocations on their UTC
creation day, including exact and revised acceptances, regardless of later
application outcome or withdrawn authorization. Manual operations and replacement
operations are excluded. **Mean stash** averages all learners, including empty
stashes, at the snapshot capture time. Late captures use the stash at capture time,
not a reconstruction of the earlier day's stash.

A dash marks unavailable data. Existing snapshot medians cannot supply historical
means. Practice sums recorded counts, treating missing counts as zero, so it is
a lower bound when records are missing. A historical snapshot with a null
practice total reads the sum of available session counts for that day.
Counts submitted by older clients before this qualification change measured
covered practice encounters; those saved counts are not reclassified. A day
with no completed sessions has zero practice. Spend accounting is available in
Model invocations; the existing sparse spend-without-accepts signal remains.

## Content improvement workflow

This workflow describes current vocabulary review. The
[product contract](../SPECS/vocabulary-learning.md#operator-review) owns its
approval and evidence guarantees, and the
[provider pipeline](implementation/vocabulary-content-improvement.md) explains
how judgments and proposals are produced.

Open `/operator/improvement`, or select **Content improvement** using the
[operator allowlist](#access). Awaiting review presents stable improvement cases,
oldest creation time first. Each case displays its current assessment and saved
proposal, or the judgment that proposed no change. Reassessment retains the
same case identity and queue position.

**Defer** moves an open case into **Deferred**, retaining its proposals and evidence.
**Return to review** restores it to immediate attention. Deferral persists across
reloads and new assessments; there are no dates or automatic resurfacing. Pending
jobs and approvals must finish before changing its attention placement.
The entry leads with the original served content and its first chronological
encounter. Teaching cases identify the source as a **Teaching encounter**. The
encounter-count control expands responses, reactions, skips, and undone actions.
Repeated cue text and unchanged metadata are omitted; differing snapshots remain visible. Pure cues display accepted answers in simplified form,
with script duplicates removed for display only. Ordinary word encounters omit
that answer list. Missing snapshots are explicitly identified.

Single-exercise review shows one summary under **Proposed improvement** and
the content-generating model. Each change has an action icon and color accent;
items expand only when they have additional review information. Shared and
additional exercises retain their individual rationales. Mapped senses remain in Details. Repertoire review uses a
**Repertoire bootstrap** heading and expandable sense groups with exercise counts;
it omits routine bootstrap reasoning. Source-repair items omit redundant accepted
answers. Pure-cue items summarize their action and cue, expanding to the semantic axis,
accepted-set change, teaching note, and any distinct exercise rationale.
Sense chips retain their selection action; hovering reveals sense notes, and the
adjacent details control opens them for keyboard or pointer inspection.

Existing shared practice appears as a blue **↗ Reuse existing** item. Expanding it
shows accepted answers, teaching note, reuse reasoning, and content identity/version.
It is read-only context, not an additional change to approve. Unavailable or
retired references remain visibly labeled even when the item is collapsed.

Unresolved findings and action blockers remain visible. Rich authored content
that cannot be represented faithfully requires **Review full content before
approval** in the complete workspace. Awaiting review and Archive refresh
automatically while idle and visible, with faster polling during pending work;
editing and reassessment configuration pause refresh.

“Approve and apply” queues the displayed version and advances after the backend
persists the request. Queued requests are hidden from Awaiting review while they
finish. Acknowledgement does not mean the content has been applied. The backend
validates the proposal with the real writers under rollback, records the exact
version's operator approval, and applies it with an idempotent receipt. Application
revalidates current bases. The optional validation control can run the same
preview before submission and show relationship counts. Failed requests appear
under Needs attention with the retained error and retry control. Retrying uses the
same request and application identities; stale content requires revision or
reassessment rather than applying a newer version under the earlier request.
Manual edits create a new version and invalidate the previous preview and review.
Teaching repairs can update an exercise and explicitly bind its resulting version
in the same ordered proposal. Failed jobs and dispatches have explicit retry controls.

Case-backed exercise-improvement proposals can request a second opinion on the
exact saved proposal version, with an optional question. This is a fresh invocation
of the configured review model, retaining the proposal snapshot, source versions,
and learner evidence. Its support/revise/reject opinion is advisory: it neither
rewrites the proposal nor applies content. Earlier opinions remain labeled with
their proposal version after edits. Failed reviews require explicit retry; teaching
cases and standalone manual proposals do not yet support this review path.
Completed exercise judgments that propose no change also appear in Awaiting
review, including retained historical judgments. The entry leads with that same
served content, then the rationale. The operator can draft a correction from
current content, request an advisory second opinion with a question, or close
the review with an optional note. Teaching and unresolved assessments also accept
an empty note; their retained finding remains visible independently of that note.
A retired source is explicitly identified as unavailable for reassessment. Closing
the case does not reactivate it or settle its sense mapping. **Done** advances at the same queue position,
or to the preceding item when closing the last entry.
The second opinion reviews the no-change judgment; it does not create or apply a
proposal. Closed reviews remain in Archive, with their retained jobs and results in the case evidence.

**Reassess current exercise** runs a fresh assessment with the selected model,
defaulting to GPT-6 Sol high. It pins the current source version and performs
fresh sense mapping unless an operator target sense has been selected. A changed source version is shown for
confirmation before submission. The original served content and learner responses
remain historical evidence.

Reassessment adds a numbered job to the same case. While queued or running, the
case's saved proposal, review decisions, and target-sense edits are frozen.
Success selects the replacement assessment; failure or timeout restores review
of the previous result. Earlier assessments and proposals remain retained.
Only one job may be queued or running within the case. Second opinions remain
advisory and do not replace its current assessment. Content is applied only after
explicit approval and successful application.

**Selected senses** shows the shared useful-sense selection as toggle chips.
Toggling creates a draft with **Save selection** and **Discard edits**. Saving in
repertoire review updates defaults and the proposal together without a model call;
reselecting a retained sense restores its exercises. A new sense without retained
exercises requires **Save selection and reassess** and an explicit model choice.
That action saves shared defaults immediately and queues generation for exactly
the selected senses. If queuing fails, the selection remains unsaved. If generation
fails later, the defaults remain saved and the previous proposal returns to review.
The existing proposal is replaced only after successful reassessment and still
requires approval before application. If no exercises remain, dismiss the proposal;
selection changes never imply source retirement.

For single-exercise improvement, **Target sense** records the intended repair.
Selecting a target, including the current sense, requires reassessment before
application and disables manual proposal editing. **Reset** discards the pending
choice and restores the current assessment target. It does not bypass other
approval or source-freshness checks. Failed reassessment leaves the choice pending;
successful reassessment uses it without another mapping call. Source content and
sense bindings remain unchanged until operator application.

Manual text editing and pending target-sense reassessment are separate paths.
Unsaved edits and pending saves block navigation. Historical case-scope selections
remain evidence rather than editable policy.

A model finding about missing useful defaults appears beside **Selected senses**
and in **Needs attention → Word defaults need attention**, including after its
exercise repair is approved.
**Review word defaults** opens the shared selection. This finding is independent
of a proposed exercise repair and does not block its approval. The attention entry
opens a shared word editor without requiring an open assessment; **Open assessment**
provides the originating context when available. Closing the word editor returns to
the existing draft and item selections. Saving explicit
word defaults, including **Select none**, resolves it.

### Resolving shared-practice identities

Current assessment uses missing or ambiguous dictionary forms as evidence for
target improvement, without proposing them as answers. Historical saved
assessments with unresolved shared answers remain in their review case. Open
the full review workspace for **Resolve candidate identities**. Select the intended entry for
each ambiguous form, then queue the integration assessment. The complete content
plan waits for this resolution; choosing identities resumes that plan without
applying it or repeating the source assessment. If a form has no matching
entry, this control cannot create one: reassess or close the assessment with a
resolution. Source or dictionary changes can require a fresh assessment.

### Needs attention

Needs attention presents one actionable item at a time, with a type filter and
previous/next navigation. It loads bounded pages only while open. Items are ordered
by creation time with a stable identity tie-breaker. Refresh preserves the selected
identity where possible and pauses while an editor or unsaved defaults are open.

The queue includes unknown word defaults requiring intervention, failed approval
application, practice preparation and evidence dispatch, grouped sense reconciliations,
and cases with no ordinary
review destination. Failed learner-feedback jobs remain accessible here. Teaching
cases without an assessment appear in Awaiting review. Failed reassessment and
second opinions with an earlier reviewable result stay with that case.

Selected senses appear directly as toggle chips. Saving an explicit selection,
including none, resolves the word finding without revising an existing proposal.
Established empty inventories and ordinary queued/running work require no attention.
Sense reconciliation keeps its grouped attention item during required replacement
preparation, including pending and failed stages. Its matcher and source records
remain inspectable there.
Retry uses the retained request or work identity and leaves the actionable queue
once acknowledged. Failure returns the same item. Stale application requests open
their case or standalone proposal for revision rather than offering a stale retry.

**Open case** and **Open proposal** retain access to the full authored editor,
identity resolution, job evidence and existing closure controls. **Back to attention**
returns to the selected item if it still needs attention. Details discloses request,
source and invocation identifiers. There is no generic dismissal of operational
failures. Unclassified legacy cases remain visible. A case whose source is known
to have changed or been retired offers **Dismiss**; its job and evidence remain
in Archive. Reading the item does not dismiss it. When an applied proposal changes
a source, other idle, unreviewable attention cases for that exact source resolve
with their evidence retained. Active work and reviewable cases remain available.

Inventory-gap judgments remain attached to their cases and retained in Archive
when closed. Closure is not inventory reconciliation. Needs attention does not
create an independent inventory-defect record from those judgments.

### Selecting and editing proposal items

Exercise-local plans label each item's contribution: **Source exercise**, **Shared
practice**, **Distinctive refinement**, or **Optional enrichment**. A refinement
practices a distinctive use within the original circumstance; enrichment adds
practice beyond resolving that exercise. The summary explains the overall
recommendation, and item rationales explain their individual contributions.

Proposal items share expected answers and scope labels and group by readable
sense labels. **Edit proposal** loads the exact full saved revision. In the editor,
each item has an inclusion checkbox. Turning a replacement off
keeps its source active. Turning it back on restores its edits. Save the selected
items as a new revision before approval; an empty selection offers restore or
dismissal. A failed save retains the draft and selections.

The cue editor keeps structured direct cues and Mandarin clozes synchronized
with their displayed prompt. A Mandarin cloze requires exactly one `____` blank.
Changes to answer criteria, reveal text or expected answers appear beside the
item; Item details contains the full authored record.


### Queue navigation and refresh

Awaiting review loads compact case cards in creation-time order, with case ID as
the stable tie-breaker. The batch contains served cue and response summaries,
assessment provenance, proposed content, current source comparisons, and relevant
status. Previous and next navigation within loaded batches uses that local data.
A neighboring batch loads at the window boundary; the browser retains one batch
of twenty cards per review or archive view. The count shows the matching total,
independent of the loaded subset. Navigation wraps across the full result set.

The bottom action bar stays outside the scrolling evidence. **Done**, **Dismiss
proposal**, and **Approve and apply** retain their direct action paths. **More**
offers their optional note/reason dialogs, proposal editing, and second opinions.
Each dialog submits only its own text; Cancel discards it, and a failed request
retains it for retry. **Reassess** opens its model/target dialog with optional
editorial direction. **Reassess with this opinion**, beside a completed second
opinion, opens the same dialog with that opinion attached and space for optional
operator direction. The attachment identifies the opinion, discloses its rationale,
and can be removed before submission. Ordinary **Reassess** starts without an
attachment. These inputs accompany the new assessment, while standalone case
notes do not automatically become model instructions.

**Add note** in the case's Notes section opens an inline editor. **Save note**
persists a nonempty note without resolving the case; **Cancel** discards the
unsaved text. Saved notes remain visible when returning to the case or its archive.
The separate **Action notes** disclosure shows commentary attached to completion,
approval, dismissal, reassessment, or second-opinion requests; it retains the
latest twenty such entries.
Enter submits, Shift+Enter inserts a newline, and composition keystrokes remain
available to Chinese input methods. Navigation asks before discarding unsaved
note text. An uncertain save retains its request for retry without duplicating
the note.

**Details** discloses routine provenance and retained proposal
selection; **Full review workspace** opens full encounter history, numbered case
jobs, raw evidence, and source-based manual authoring. **Edit proposal** opens the
full authored revision and preserves inclusion choices and unsaved edits. Compact
render projections are never submitted as authored content.

**Edit cue** opens a text-only editor inside an expanded proposed item. On an
exercise case without a proposal, it drafts a correction from the current source.
Phrase clozes expose their English frame and Mandarin sentence separately.
**Save** retains the changed proposal; **Approve and apply** separately changes
live content. **Cancel** discards unsaved edits. **Reset to original** restores the model’s first proposed cue, including after
saved operator edits. This action sits beside Edit cue and saves a new proposal
revision without opening the editor. Approve and apply remains separate.
The reset is available only when that operation has a retained model-authored
baseline with the same cue type; manual corrections have no model baseline. Accepted answers, senses, teaching
notes, and other operations remain intact. The original served encounter remains
historical evidence. Source/proposal conflicts require reopening the current
content, and unsupported structured cues use the full workspace.

The proposal selector
opens a retained alternative without changing the case's current assessment;
its provenance remains attached to the assessment that authored it. Dismissing
one proposal keeps the case open if another unresolved alternative remains.

Left and Right navigate while preserving text editing and native control keys.
Each queue remembers its selected identity while moving between views; the
operator panel keeps the review mounted while visiting another operator tab.
Resolving a case advances at the same position, falling back to the previous case
at the end. Approval advances on its persisted acknowledgement; an uncertain
acknowledgement holds the current case so retry uses the same request identity.

Archive and Needs attention load only while their views are open. Archive defaults
to resolutions from the last twelve hours, using the case's retained resolution
time, and loads further results in pages. Search spans retained case IDs, word
labels, proposal rationales, and original served prompts through the server;
raw provider documents and arbitrary JSON keys are not archive search fields.

Loaded queue batches refresh every fifteen seconds while the panel and document
are visible, and on focus or visibility change. Active case jobs use a three-second
refresh. Refresh preserves the selected case and updates shared-source staleness
even when its case revision has not changed. Unsaved edits, active mutations, and
uncertain approval acknowledgements pause replacement of the displayed data.
The full editor keeps its reviewed revision pinned; newer work requires explicit
reload. Failed reassessment leaves the previous judgment visible with an explicit
retry. A source-version conflict instead offers reassessment of the current source.
These reads do not authorize provider work or content application.

## Content sharing

Content sharing shows how prepared material reaches another learner. Choose a
UTC week (Monday through Sunday), browse earlier weeks, or refresh the current
report. Counts are computed from existing records at request time; historical
weeks are reconstructed rather than stored daily snapshots. The current week
is partial. The report makes no provider calls and changes no study state.

**Introductions newly reused** counts immutable teaching packages whose second
distinct learner first opened them during the selected week. **Practice exercises
newly reused** counts exact frozen rehearsal content encountered by its second
learner during that week. Repeated use by one learner contributes once; an
item reaching its third learner does not become newly reused again. The first
learner can have used it in any earlier week.

**Reflection cues used by others** counts distinct shared, learner-originated
production or standalone cues with a recorded attempt during the selected week
by someone other than the originating learner. This is a cue identity count,
not an assertion that different learners saw identical text after a repair.

Up to five newly reused items are grouped by word. Examples expose the relevant
word/content label and recorded use dates, with
additional evidence in a disclosure. Preparation history describes recorded
generation attempts when available. One published package alone does not
establish that only one generation attempt occurred. Content use is also
separate from lesson completion or a durable word-level study commit.

The **Sharing potential** count describes words with Practice or Review state
for multiple learners as of the report's capture, including historical/imported
progress. It is current context even when viewing an earlier week, and does not
prove reuse of the same content.

Exact practice and review content reuse depends on recorded content encounters;
older progress and records without an exact content identity cannot supply that
evidence. A zero means no qualifying recorded reuse, rather than proving no
sharing ever occurred. Content withdrawal does not erase historical encounters.
The report exposes aggregate counts and shared-content labels, without learner
identities, submitted answers, personal notes, or reflection payloads.

## Service banner workflow

The Service banner view shows the current active notice, posting time, and
expiry. For a planned update, enter a future estimated kickoff using either
UTC or your browser's local time zone. Switching the entry perspective preserves
the selected instant. The preview uses your local time zone; each learner sees
the kickoff in their own browser's zone, with a date and zone label.

Kickoff is distinct from posting time and notice expiry. Planned notices expire
24 hours after kickoff; the preview's Notice expiry disclosure shows that time
as an operator helper. A successful service update also clears the notice.
Custom-message saving replaces the notice with authored text and a standard
24-hour expiry from posting. The editor starts with the current rendered message;
custom text has no structured kickoff and is displayed verbatim. Messages are
single-line and limited to 280 characters. Clear removes the active notice;
clearing when none exists reports that no banner was active.

Banner changes are attributed to the authenticated operator. Operators can also
post or clear banners with the
[`hosted:banner` command](scripts.md#hosted-beta-operations) when the panel is
unavailable; the
[release runbook](ops/hosted-beta-deployment.md#post-a-pre-upgrade-banner)
describes its use before a hosted upgrade.
