# What’s New blog

This document owns the blog’s content and publication contract, its persistence
mechanism, and the operator procedure for updating it. Learners read published
posts in About → What’s New. Operators can save drafts, publish posts, correct
existing posts, and withdraw a post by returning it to draft.

## Content and publication

Posts contain a stable lowercase slug, a UTC `YYYY-MM-DD` date, a title, and
plain-text paragraphs. The renderer does not interpret HTML or Markdown.
Titles are bounded to 200 characters; a post has 1–100 nonempty paragraphs,
each at most 10,000 characters and at most 100,000 characters in total. These
bounds are enforced by the shared parser in
[`src/domain/whats-new.ts`](../src/domain/whats-new.ts).

The first publication assigns a monotonically increasing publication sequence.
Published posts are ordered by that sequence, so two posts on the same date
and backdated posts still count as new. Editing a published post retains its
sequence and does not create another unread announcement. Returning it to
draft removes it from the learner list; republishing retains its original
sequence. Drafts never appear in the learner list.

The learner’s `whats_new_seen_through_sequence` parameter records the sequence
last acknowledged. Opening What’s New advances it to the newest published post
in the loaded list. On first use, a missing sequence is initialized from the
legacy date cursor when available, otherwise all posts currently published in the loaded catalog are grandfathered.
The legacy date endpoint remains compatible; new clients use the sequence.

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

## Persistence and live updates

Small, infrequently edited posts fit the application’s existing SQLite store.
`whats_new_posts` stores current content; `whats_new_post_revisions` retains
attributable snapshots. The existing database backup and restore route covers
both. This avoids adding a CMS or a separate publishing service.

The API queries current database content. The operator command opens the same
existing database directly, checks its schema version, and performs one short
transaction. WAL allows the running API to read while another connection saves.
Routine content updates require no build, deployment, maintenance mode, or app
restart. Learners see updates when the blog reloads or normal attention refresh
fetches the catalog; the blog does not push edits to every open tab instantly.

Migration `0028_whats_new_blog` creates the tables and seeds the former bundled
notes without changing their wording. The **first rollout is a schema-changing
release** and follows the [offline migration procedure](ops/schema-migrations.md).
Later post edits are normal live data writes. The command never creates a
missing target, bootstraps learners, starts provider jobs, or applies migrations.

## Manual operator editor

Open the operator panel’s What’s New editor. Select an existing post or create
a new one, enter its slug, date, title and paragraphs, and choose Save draft or
Publish. Review the preview and publication consequences before saving. Editing
loads the current revision; reload and reconcile if another operator saves first.
Operator API access uses the existing operator allowlist. Content is shared
across learners; operator actions are attributable to the authenticated actor.

## Operator command

Run from a checkout or hosted image containing this feature. Always identify
the target’s role and use an explicit absolute data directory containing
`app.db`. Listing includes drafts and each post’s current revision/provenance metadata:

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
shows Justin the full text and pauses for review, supports iterative draft
edits in the same conversation, and publishes only after he explicitly approves
publishing the reviewed version. Proposed corrections to an already published
post stay local during review so the live post remains available.

## API and verification

`GET /api/whats-new` returns published posts. Operator-only
`GET /api/operator/whats-new` includes drafts; `PUT /api/operator/whats-new`
accepts the JSON write request above and returns the saved post. Invalid content
returns 400 and stale revisions return 409. The operator write endpoint has a
scoped 1 MiB JSON limit to accommodate escaped content within the domain bounds.
`POST /api/whats-new-seen-sequence` accepts `{ throughSequence, mode }`, where
mode is `ensure` or `seen`, and rejects a sequence beyond current publication.

[`tests/whats-new-command.test.ts`](../tests/whats-new-command.test.ts) checks
writes visible to an already-open connection, attributable revisions, stale
save rejection, unchanged schema/learners, missing-target refusal, and refusal
to migrate an old database. Domain and API coverage is listed in the
[testing map](testing.md). These checks establish bounded local behavior;
hosted rollout and rendered editor verification remain separate evidence.
