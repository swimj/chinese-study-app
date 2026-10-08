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
