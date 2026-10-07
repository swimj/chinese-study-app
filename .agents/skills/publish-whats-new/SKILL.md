---
name: publish-whats-new
description: Draft and publish learner-facing What’s New posts from verified deployed commits using the application’s operator command, or revise an existing post.
---

# Publish What’s New

Use the database-backed What’s New blog for learner updates. Read
[docs/whats-new.md](../../../docs/whats-new.md) for its content contract,
JSON command input, and live-write procedure. Resolve repository links from
the repository root when the skill loader does not resolve relative links.

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

## Write and save

Use the existing posts as tone references. Write concrete, friendly paragraph
prose with a short descriptive title. Explain what changed, how the learner
uses it, and necessary consequences. Avoid marketing hype, developer jargon,
and unsupported promises. Keep the post focused on helpful changes rather
than a commit inventory. Use plain text; markup is not rendered.

Choose a stable lowercase slug and UTC date. Include the full exclusive
`sourceFrom` and inclusive `sourceThrough` SHAs. Manual corrections can retain
existing provenance; do not advance commit coverage merely for a wording edit.
Use `expectedRevision: null` only for a new slug. Reload an existing post before
editing and supply its current revision. A conflict requires rereading and
reconciling the other edit, not an automatic overwrite.

Prepare the exact JSON input and review it before the command. Publishing is
within scope when Justin asked to publish or update the live blog; a drafting
request authorizes a draft. Use the hosted runbook’s authenticated terminal
procedure for remote access, preserve the terminal session handle, and wait
for its exit status. Do not restart the app for a routine post update.

After a successful command, reread the post and verify its revision, status,
content, and source range. For a publication, check the learner endpoint’s
published list. If the session is lost, first reread the post and its revision
before retrying: the original save may already have committed. Report the
saved result and any skipped changes or uncertain deployment evidence.
