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
| Preparation failures | Inspect paused shared preparation work and retry eligible stages | [Error diagnostics](ops/error-diagnostics.md#shared-word-preparation-failures) |
| What’s New | Edit and publish learner-facing update posts | [What’s New](whats-new.md#manual-operator-editor) |
| Service banner | Set planned downtime, edit a custom message, or clear the active banner | [Banner API](api.md#operator-view) and [hosted upgrade runbook](ops/hosted-beta-deployment.md#post-a-pre-upgrade-banner) |

The Model invocations view loads the full ledger for its summaries and filter
choices, then reveals rows progressively as the table is scrolled. Column
headers provide sorting, grouping, and type-specific filters. Its fixed summary
periods cover today and the last seven calendar days including today; the
selection summary reflects the active filters. Refresh reloads the accounting
snapshot. The view does not use server-side pagination.

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

The Service banner view shows the current active notice and its expiry. The
planned-downtime action accepts a local end date and time, converts that value to
an ISO timestamp, and saves it as the banner expiry. Choose a future time. It
uses the text in the message editor, so enter a message there if no current
banner supplied one. The custom-message editor starts with the current banner
message when one exists; save it to post or replace the notice using the standard
24-hour expiry. Messages are single-line and limited to 280 characters. Clear
banner removes the active notice; clearing when no notice exists reports that no
banner was active.

Banner changes are attributed to the authenticated operator. Operators can also
post or clear banners with the
[`hosted:banner` command](scripts.md#hosted-beta-operations) when the panel is
unavailable; the
[release runbook](ops/hosted-beta-deployment.md#post-a-pre-upgrade-banner)
describes its use before a hosted upgrade.
