---
name: publish-whats-new
description: Draft learner-facing What’s New posts and Home preview text from verified deployed commits, iterate with Justin on content, and publish the reviewed version after explicit approval using the operator command.
---

# Publish What’s New

Use the database-backed What’s New blog for learner updates. Read
[docs/whats-new.md](../../../docs/whats-new.md) for its content contract,
JSON command input, and live-write procedure. Resolve repository links from
the repository root when the skill loader does not resolve relative links.

## Access the hosted service

Launch remote commands from the execution tool using the operator's authenticated
Fly CLI. An attached Codex app terminal or an existing SSH session is not a
prerequisite; launching a command creates any execution session handle needed.
The live database is `/data/app.db` on the hosted machine. Local `data/` files
and backups do not establish current posts or the deployed source revision.

Read the [hosted terminal-driver procedure](../../../docs/ops/hosted-beta-deployment.md#agent-or-automated-terminal-driver-procedure)
before remote access. Resolve `<app-name>` from the `app` field in the operator's
ignored `deploy/fly/.generated/fly.toml`, or an explicitly supplied hosted target.
A new worktree may lack that generated file; check an available operator checkout
for the target configuration without copying secrets or printing its entire
contents. The template's `REPLACE_WITH_APP_NAME` is not a target.

Use these read-only commands on the selected hosted app:

```bash
fly ssh console --app <app-name> --command \
  'npm run --silent hosted:whats-new -- --data-dir=/data --list=true'
fly ssh console --app <app-name> --command \
  'npm run --silent hosted:inspect -- --data-dir=/data --litestream-socket=/data/litestream.sock'
```

When the managed sandbox blocks authenticated Fly state or network access,
request the execution tool's required elevated permission on the first remote
launch, as the runbook directs. A sandbox preflight failure does not establish
missing authentication. Preserve any returned session handle and wait for that
command's exit status before interpreting its result.

Ask Justin for the specific missing prerequisite only when configuration cannot
establish the target, the Fly CLI is unavailable, authentication actually fails,
or execution permission is denied. Report the concrete blocker rather than
asking him to attach a terminal. Respect a permission denial. If hosted access
remains blocked, continue inspecting available code and release evidence and
prepare a local proposal; identify missing post/deployment evidence, do not
claim complete coverage, and do not claim the draft was saved remotely.

## Establish the covered changes

Read current posts with `hosted:whats-new -- --data-dir=<absolute> --list=true`.
Choose the most recent published post with meaningful commit provenance as the
starting point, then inspect newer posts and drafts to avoid duplicate coverage.
A draft does not establish that its changes have been announced.

Verify the running service’s full source revision using `hosted:inspect` or
release evidence from the hosted runbook. A checkout’s HEAD, a merged PR, and a
successful build do not establish deployment. Resolve evidence to a full SHA
and check that the starting commit is an ancestor of the deployed revision
before inspecting `git log <sourceFrom>..<sourceThrough>` and relevant diffs.
If deployment is uncertain, prepare a draft and explain the missing evidence.

Migrated historical posts have null provenance. For the first generated post,
inspect existing notes and commit history to establish a supported coverage
baseline, or ask Justin for the baseline when evidence cannot establish it.
Never infer that HEAD or the latest historical note’s date means those commits
were covered. A missing or non-ancestor baseline needs reconciliation before
claiming complete release coverage.

Inspect actual learner behavior in each candidate change: relevant code,
contracts, tests, and PR context. Include improvements a learner can observe or
act on; omit internal tooling, refactors, and infrastructure details that have
no learner consequence. Combine related changes. If nothing learner-facing
changed, report that result without creating a filler post.

## Draft and review

Use the existing posts as tone references. Write concrete, friendly paragraph
prose with a short descriptive title. Explain what changed, how the learner
uses it, and necessary consequences. Avoid marketing hype, developer jargon,
and unsupported promises. Keep the post focused on helpful changes rather
than a commit inventory. Use plain text; markup is not rendered.

Write a `summary` of 1–300 characters alongside the post: a short, useful
description for the Home Updates preview. Name the learner-visible change
without copying the title or promising anything beyond the full post. Prefer
one sentence that reads naturally in a compact card; do not use a truncated
paragraph or a teaser that withholds the change.

Choose a stable lowercase slug and UTC date. Include the full exclusive
`sourceFrom` and inclusive `sourceThrough` SHAs. Manual corrections can retain
existing provenance; do not advance commit coverage merely for a wording edit.
Use `expectedRevision: null` only for a new slug. Reload an existing post before
editing and supply its current revision. A conflict requires rereading and
reconciling the other edit, not an automatic overwrite.

Prepare the exact JSON input with `status: "draft"` for a new or existing
unpublished post, save it using the operator command, and reread the saved
revision. Show Justin the full title, date, preview text, and paragraphs as readable prose,
plus the draft ID/revision and a brief note on the covered changes or uncertain
evidence. Then end the turn and wait for his feedback. Even an initial request
to publish starts with this review pause; it does not approve unseen content.

Iterate in the same conversation and on the same draft. Apply requested edits,
save another draft revision, and show the full updated post and preview text. Continue this
review loop until Justin explicitly asks to publish the version he has read.
A request for wording changes or a positive reaction such as "looks good" is
not a publication instruction. Content changes after approval require showing
the revised text and obtaining approval for that version.

For a correction to an already published post, prepare the proposed revision
in a local JSON input file and show its full text for review. Keep the live
post as it is during iteration: saving it as a draft would withdraw it. Save
the correction to the live post only after approval of the reviewed version.

## Publish the approved version

After an explicit instruction such as "publish this draft", reread the target
post and check its revision against the one used during review. For a saved
draft, its content must also match the reviewed version. For a published-post
correction, verify that the original live post is unchanged and the local input
still contains the approved correction. If another operator changed the target,
show the difference and reconcile it with Justin before publishing; do not
publish an unseen newer revision. Recheck any
release evidence needed to establish that the announced behavior is deployed.
Change only the reviewed input's status to `published`, using the current
`expectedRevision`, and invoke the operator command.

Use the hosted runbook's authenticated terminal procedure for remote access,
preserve the terminal session handle, and wait for its exit status. Do not
restart the app for a routine post update.

After a successful command, reread the post and verify its revision, status,
content (including preview text), and source range. For a publication, check the learner endpoint's
published list. If the session is lost, first reread the post and its revision
before retrying: the original save may already have committed. Report the
saved result and any skipped changes or uncertain deployment evidence.
