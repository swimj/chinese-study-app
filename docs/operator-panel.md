# Operator panel

This guide explains how an authorized operator reaches and uses the application’s
bookmark-only operator panel. It describes the available views and their
workflows; the [API reference](api.md#operator-view) defines the HTTP contracts.

## Access

Open the application with `#operator-usage` in the URL. The panel is not part of
the learner navigation. Access requires the signed-in Clerk user id, or the
trusted-local learner identity, to be allowed by `APP_OPERATOR_CLERK_USER_IDS`.
An empty allowlist denies access.

## Views

| View | What it supports | Related explanation |
| --- | --- | --- |
| Usage | Current cohort pulse and the last seven completed daily snapshots | [Hosted observability](ops/hosted-observability.md) |
| Model invocations | Inspect attributed provider calls, filter and group rows, compare spend summaries, and refresh the ledger | [Operator API](api.md#operator-view) |
| Content sharing | Weekly exact-content reuse counts, learner-originated cue reuse, and inspectable examples | [Sharing metrics](#content-sharing) |
| Content quality | Review content-quality signals and filter the triage queue | [Content quality](content-quality.md) |
| Content improvement | Review vocabulary judgments and proposals, request second opinions, and apply approved corrections | [Content improvement workflow](#content-improvement-workflow) |
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

Open `#operator-usage` and select **Content improvement** using the
[operator allowlist](#access). Opening a proposal displays its saved version and source content.
The entry leads with **Original served content**: each encounter that retains
a snapshot shows its cue and accepted answers, in encounter order. An encounter
without a snapshot says that snapshot is unavailable. Diagnosis, current and
proposed content, accepted answers, and recipient scope follow. A case with no
retained snapshot states that the original served content is unavailable.
Changed answer criteria and retained teaching are expanded in the comparison.

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
the review with an optional reason.
The second opinion reviews the no-change judgment; it does not create or apply a
proposal. Closed reviews remain in Archive, with their retained jobs and results in the case evidence.

**Reassess current exercise** runs a fresh assessment with the selected model,
defaulting to GPT-6 Sol high. It assesses the current exercise version with fresh
sense mapping where applicable and places its independent result in the review
queue. If the source version differs from the original assessment, the control
shows the version change and requires confirmation to proceed on the current
version. The original encounter stays available as historical context, not learner
evidence for the independent assessment. A further source change requires a new request
against the current version. The control refreshes current source metadata before
submission. Stale proposals and unsaved proposal edits do not prevent reassessing
the live exercise; saved sense coverage is used, and the old result, draft text and
item selections remain intact. A succeeded assessment in Needs attention because
useful coverage is unknown can be corrected and reassessed there. Neither result
is applied automatically.

**Sense coverage** initially edits this review. It distinguishes inherited word
defaults, a review override and unknown defaults. Check desired uses or choose
**Select none**, then save. **Use word defaults** clears the review override;
unknown shared defaults remain unknown. **Edit word defaults** opens the shared
selection, with counts of mapped general production exercises affected by removing
uses. **Back to review coverage** returns to the review's effective selection.
Each sense's real notes are available in its disclosure. Word-default changes update mapped practice selection and can seed the scope of
future teaching and content invocations; they do not retarget work already
requested or retire content.

Saving coverage preserves unsaved proposal edits and item selections while
refreshing the displayed evidence and reassessment state. Content proposals keep
their assessed targets and remain approvable after selection edits. Source, mapping,
canonical catalog or explicit assessment evidence changes require review before
approval; **Refresh snapshot** updates the evidence without discarding draft edits.
When a newer saved revision exists, **Load current proposal** opens that revision
with the usual confirmation before discarding unsaved edits.
Unsaved scope edits and pending saves block navigation and resolution; loading
coverage does not. A new reassessment copies the saved review selection.

A model finding about missing useful defaults appears beside **Sense coverage**
and in **Needs attention → Word defaults need attention**, including after its
exercise repair is approved.
**Review word defaults** opens the shared selection. This finding is independent
of a proposed exercise repair and does not block its approval. The attention entry
opens a shared word editor without requiring an open assessment; **Open assessment**
provides the originating context when available. Closing the word editor returns to
the existing draft and item selections. Saving explicit
word defaults, including **Select none**, resolves it.

### Selecting and editing proposal items

Proposal items share expected answers and scope labels and group by readable
sense labels. Each item has an inclusion checkbox. Turning a replacement off
keeps its source active. Turning it back on restores its edits. Save the selected
items as a new revision before approval; an empty selection offers restore or
dismissal. A failed save retains the draft and selections.

The cue editor keeps structured direct cues and Mandarin clozes synchronized
with their displayed prompt. A Mandarin cloze requires exactly one `____` blank.
Changes to answer criteria, reveal text or expected answers appear beside the
item; Item details contains the full authored record.


### Queue navigation and refresh

The review queue preloads nearby proposal details in bounded batches. A cached
card appears immediately; approval remains subject to server validation. Coverage
saves invalidate affected snapshots (same case for review edits, same word for
shared edits), and an epoch fence rejects older in-flight prefetch responses. After a
successful action the next known item opens while the queue refreshes. If it cannot load, the completed
action remains recorded and a retry control is shown.

The operator panel's Content improvement tab presents an Awaiting review queue,
an attention inbox and Archive. Open entries in each view lead with the original
served content described above. Previous and next controls navigate one item at
a time; applying or dismissing advances to the next available item. Cards keep scope and identity consequences
visible before approval; one Details disclosure contains full rationale,
relationship effects, encounter history, optional review notes and source-based
manual authoring. Edit proposal edits the displayed draft. Creating a separate
correction starts a new proposal from the current source.

Left and Right navigate the displayed queue while preserving text editing and
native control keys. Each queue remembers its selected identity while moving
between queues; the operator panel keeps the review mounted while visiting Usage
or another operator tab. The cursor survives these visits for the current panel
session. Archive defaults to resolutions from the last 12 hours, using receipt or closure
event timestamps. Search spans all loaded resolved proposals and closed no-change
reviews. Records without retained resolution timestamps are searchable but do not
enter the default time window.

Queue lists refresh every 15 seconds while the panel and document are visible,
and on window focus or visibility change. Refresh pauses during work or unsaved
draft edits and never installs a different proposal version. A changed selected
proposal requires explicit reload and validation before applying. Pending second
opinions use their existing three-second polling cycle. These are reads; provider
retry and application remain explicit operator actions.

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
