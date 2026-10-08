# What’s New blog

What’s New is the learner-facing product update blog: it helps learners learn
about shipped product changes and catch up when they return. This document
defines the blog’s content and publication contract, learner reading and unread
behavior, persistence, and operator workflow.

Home and About share a catalog loaded once when the app opens. Session changes,
navigation, and window focus reuse that catalog; a browser page refresh loads
new content. A failed load can be retried explicitly. Learner attention state
refreshes independently of the shared post catalog.

## Home updates

Home shows previews of the four latest published posts. Selecting a preview
opens that post’s full article. Learners can collapse the whole updates column
to reclaim its space; a compact control above the Home overview restores it.
The column starts expanded. Its collapsed choice persists across navigation and
page reloads in the same browser, separately for each account. Reopening the
column saves the expanded choice too. If browser storage is unavailable, the
choice lasts only while the app remains open.

When collapsed, the control shows the number of active unread posts when that
number is greater than zero. When expanded, each active unread post among the
four previews has its own “New” marker. The updates section and its control are
hidden while Connections occupies the centered, expanded view; minimizing
Connections restores the Home layout.

## Content and publication

Posts contain a stable lowercase slug, a UTC `YYYY-MM-DD` date, a title, a
short `summary` for the Home preview, and plain-text paragraphs. The summary
is 1–300 characters and describes a concrete learner-facing change. It is
written with the post rather than clipped from its first paragraph. The
renderer does not interpret HTML or Markdown, and preview text wraps in full.
Titles are bounded to 200 characters; a post has 1–100 nonempty paragraphs,
each at most 10,000 characters and at most 100,000 characters in total.

The first publication assigns a monotonically increasing publication sequence.
Published posts are ordered by that sequence, so two posts on the same date
and backdated posts still count as new. Editing a published post retains its
sequence and does not create another unread announcement. Returning it to
draft removes it from the learner list; republishing retains its original
sequence. Drafts never appear in the learner list.

Each save requires `expectedRevision`: null to create a slug, or the current
revision number to update it. A stale save fails rather than overwriting another
operator’s edit. Every successful save atomically updates the current post and
adds an immutable revision snapshot with actor identity and UTC timestamp.
The editor and command share the same parser and transactional save function.

`sourceFrom` and `sourceThrough` optionally record an exclusive starting commit
and inclusive ending commit as full SHAs. Manual posts may use null provenance.
The publication skill uses verified release evidence and saved provenance to
find new learner-facing changes; a draft’s range does not establish announced
coverage. Migrated historical posts have null provenance because their date
alone cannot establish a deployed commit boundary.

## Unread updates

Each post remains unread until the learner reads it or 12 hours pass after it
was first represented by a visible badge. In the collapsed state, the count
represents all active unread posts; in the expanded state, each post marker
represents only that post. A badge is exposed only when it intersects the
viewport in a visible, focused browser tab; navigation hidden during study
does not count. Fetching posts, publication time, and time away before seeing a
badge do not start the clock. A learner returning after several days sees the
updates they have missed until a badge is exposed.

Each post has its own first-exposure timestamp. A later post gets a fresh
12-hour window, without extending older windows. Reloads, repeated exposure,
edits, and republication do not restart a clock. The badge updates at expiry
even if its tab stays open. Expiry clears the notification, not the post:
the Home preview and archive remain available.

Opening an individual post acknowledges only that post when its full article
heading becomes visible. In the archive, articles are acknowledged as their
headings enter view; merely loading the archive does not mark every post read.
Expanded Home markers start exposure independently as each marker enters view.
The collapsed count starts exposure for the unread posts it represents when
that count enters view. Acknowledgement requests contain the exact observed
post IDs, so concurrent publication cannot accidentally mark a new post
exposed or read.

Read and first-exposure timestamps are durable, learner-private rows in
`learner_whats_new_attention`, shared across that learner's browsers. Existing
sequence/date acknowledgements still suppress previously read posts; learners
with neither a legacy boundary nor per-post state start with published posts
eligible for notification. New clients do not silently mark the catalog read
on their first refresh.

The server retains `whatsNewSeenThroughSequence`, `whatsNewSeenThroughDate`,
and their endpoints for older clients. These remain parameters in `learner_params`, named
`whats_new_seen_through_sequence` and `whats_new_seen_through_date`. When the
sequence parameter is absent, the server derives the legacy boundary from the
immutable imported revisions; corrections to those posts cannot move it.

## Persistence and live updates

Small, infrequently edited posts fit the application’s existing SQLite store.
`whats_new_posts` stores current content; `whats_new_post_revisions` retains
attributable snapshots. The existing database backup and restore route also
covers the per-learner attention table. This avoids adding a CMS or a separate
publishing service.
The [shared parser](../src/domain/whats-new.ts) validates content for both the
editor API and the operator command; the [save module](../server/db/whats-new.ts)
checks the expected revision and writes the post and history in one transaction.

The API queries current database content. The operator command opens the same
existing database directly, checks its schema version, and performs one short
transaction. WAL allows the running API to read while another connection saves.
Routine content updates require no build, deployment, maintenance mode, or app
restart. The blog fetches current posts when opened, when the browser regains
focus or visibility, and on an explicit retry after a loading error. Attention
refreshes provide active unread post IDs to Home so aggregate and per-post
markers follow each post’s independent exposure window. There is no push
notification or continuous polling of open tabs.

Migration `0028_whats_new_blog` creates the tables and seeds the former bundled
notes without changing their wording. The **first rollout is a schema-changing
release** and follows the [offline migration procedure](ops/schema-migrations.md).
Migration `0030_whats_new_previews` adds summaries, with authored backfills for
the twelve imported posts whose title and body still match their original
revision. Edited or custom posts receive a neutral title-based summary for
operator refinement. The migration appends attributed revisions; it preserves
old snapshots, body text, publication order, status, and commit provenance.
`0031_whats_new_attention` creates empty learner-private attention storage;
it does not infer first exposure from old visits or publication dates.
This rollout also requires the offline schema-changing release procedure.

Later post edits are normal live data writes. The command never creates a
missing target, bootstraps learners, starts provider jobs, or applies migrations.

## Manual operator editor

Open the operator panel’s What’s New editor. Select an existing post or create
a new one, enter its slug, date, title, preview text and paragraphs, and choose
Save draft or Publish. Review the Home preview, full post and publication
consequences before saving. Editing
loads the current revision; reload and reconcile if another operator saves first.
Operator API access uses the existing operator allowlist. Content is shared
across learners; operator actions are attributable to the authenticated actor.

## Operator command

Run from a checkout or hosted image containing this feature. Always identify
the target’s role and use an explicit absolute data directory containing
`app.db`. Listing includes drafts and each post’s current revision and commit
provenance:

```bash
npm run hosted:whats-new -- --data-dir=/data --list=true
```

Prepare an absolute JSON input file. For example, `/tmp/whats-new-post.json`:

```json
{
  "id": "clearer-study-updates",
  "expectedRevision": null,
  "date": "2026-10-07",
  "title": "Clearer study updates",
  "summary": "Find recent improvements on Home and open a preview to read the full update.",
  "paragraphs": ["Open About → What’s New to read the latest changes."],
  "status": "draft",
  "sourceFrom": null,
  "sourceThrough": null
}
```

Save the file with an attributable operator identity:

```bash
npm run hosted:whats-new -- --data-dir=/data --actor-id=<operator> --input=/tmp/whats-new-post.json
```

Use `status: "published"` to publish. To revise an existing post, reread it and
set `expectedRevision` to its current revision. The command prints the saved
post as JSON and exits nonzero for malformed input, missing or outdated target,
or a revision conflict. Reconcile a conflict before saving again.

For hosted writes, stage the reviewed JSON on the selected machine with an
authenticated operator session, then invoke the command against `/data` there.
Follow the [hosted terminal-driver procedure](ops/hosted-beta-deployment.md#agent-or-automated-terminal-driver-procedure)
for permissions, terminal handles, and completion evidence. That procedure’s
upgrade eligibility and control steps apply to upgrades; routine blog writes
need neither an upgrade nor quiescence. If a write’s terminal result is lost,
reread the post to determine whether it committed before retrying. After a
successful save, list the target again and check the learner endpoint for a
published post.

The repo skill
[`publish-whats-new`](../.agents/skills/publish-whats-new/SKILL.md) identifies
changes from saved coverage through the verified deployed revision, writes in
the established learner-facing tone, and saves a draft with this command. It
shows Justin the preview and full text and pauses for review, supports iterative draft
edits in the same conversation, and publishes only after he explicitly approves
publishing the reviewed version. Proposed corrections to an already published
post stay local during review so the live post remains available.

## Interfaces and verification

The [API map](api.md#whats-new-blog) maintains endpoint request/response shapes,
validation statuses, and operator access requirements. The
[testing map](testing.md) lists the blog's domain, migration, API, command, and
frontend coverage. Automated checks use temporary databases and establish
bounded local behavior; hosted rollout and rendered editor checks require
separate execution evidence.
