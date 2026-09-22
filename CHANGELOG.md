# Changelog

Casual notes for people using the app before there is a real release process.

## Unreleased — GLM-5.3 Flash output cap

- Both GLM-5.3 Flash arms request 131,072 output tokens, the maximum Z.AI
  accepts. The previous 200,000 cap was rejected immediately.

## Unreleased — GLM-5.3 Flash high reflection arm

- GLM-5.3 Flash at reasoning high is now a default reflection candidate
  alongside Luna, GLM-5.3 Flash max, and Terra. It uses the same Z.AI Flash
  model and pricing as the max arm; the stored model id keeps the two
  reasoning profiles distinct.
- Both GLM-5.3 Flash reasoning arms allow 200,000 output tokens, including
  reasoning, instead of the 50,000 cap used by the other models.

## Unreleased — Reflections generating spinner

- After a session starts reflection, or while a retry or second opinion is
  running in this tab, Reflections shows a spinner instead of the Help count.
  An unseen failed run still takes priority. The spinner is same-tab only and
  hides on the Reflections page like the other badges.

## Unreleased — strict word cues and pure-cue cutover

- Reflection first diagnoses the attempt, then hands shared expressive axes
  to a content-reconciliation stage. That stage explains the actual proposed
  repairs. If it disagrees with the diagnosis, you see explicit feedback with
  no content changes or compensation to accept. Overlapping word pairs are
  omitted from a bundle; omitted second-opinion proposals remain deferred.
- Accepted pure-cue promotions publish shared content. Relevant cues enter
  review automatically when you study any accepted member, with your own
  schedule and history. Accepted repairs retire selected overbroad shared
  targeted cues for everyone; existing served assessments remain unchanged.
- Word-owned cues now accept only their target word. Existing alternate answer
  memberships are removed, including on shared cues. Broad meanings can become
  standalone pure cues through future practice and reflection; this release
  does not automatically promote existing content.
- The temporary 48-hour alternate-answer retry scheduler and its outstanding
  demands are removed. Restart any open study session after this upgrade.
- Obsolete reflection work cannot be retried, used for second opinions, or
  applied after the cutover. Old results remain readable; pending old work may
  need to be discarded. New study uses the current staged reflection pipeline.

## Unreleased — GLM-5.3 Flash reflection arm

- The Z.AI comparison arm now uses GLM-5.3 Flash at reasoning max instead of
  GLM-5.3, as a cheaper candidate against Luna. Historical 5.2 and 5.3 runs
  keep their original quality and pricing identifiers.

## Unreleased — signed-in service banner

- Operators can post a short signed-in notice (for example planned downtime)
  without shipping a new app image. It appears above the main chrome until it
  expires after 24 hours or is cleared, and it stays hidden during an active
  study session.

## Unreleased — usage pulse smoke exclusion

- The operator usage pulse no longer counts the configured hosted smoke
  learner as inactive.

## Unreleased — app-origin invite signup

- Hosted invitations created with `hosted:invite` send the recipient to the
  study app to set a password. Completing that form leaves them signed in on
  Home. Do not invite from the Clerk Dashboard if you want that path; Dashboard
  invites still open Clerk's Account Portal on a development instance.

## Unreleased — hide add-time require

- The New Words add box no longer offers "Require added". New words still join
  the stash without overflowing the daily budget. Selected-word Require /
  Unrequire and the backend add-by-hanzi flag stay in place.

## Unreleased — stash-only new-word intake

- Session settings can restrict new-word composition to the custom stash.
  The default remains the mixed stash/diet split. Leftover stash-only slots
  stay empty instead of filling from the diet.
## Unreleased — reflection daily spend cap

- After a learner's persisted reflection estimates surpass $0.50 in the current
  UTC day, new unselected reflection uses Luna only. Retry and second-opinion
  selectors disable the other models until the next UTC midnight, shown in the
  browser timezone.

## Unreleased — undo dismiss and second-opinion review kind

- Learner-dismissed reflection proposals can return to pending from By session
  with Undo dismiss, so a fat-finger dismiss re-enters Help.
- Successful second-opinion retirement is now the distinct review disposition
  `requested_second_opinion`, not a dismissed sentinel reason. Quality rates
  count it in the terminal total without treating it as a dismiss.

## Unreleased — app-only hosted upgrade pipeline

- Added `hosted:upgrade`, a single operator-confirmed command that quiesces the
  hosted dogfood service, forces a Litestream sync, deploys the selected Git
  commit with a baked `APP_REVISION`, confirms identity, runs a read-only Clerk
  smoke, and reopens. A failed run leaves writes and provider work disabled.
- `hosted:inspect` now reports the baked app version and source revision.
  Hosted images refuse to build when `APP_REVISION` is missing or `unknown`.

## 2.3.0 — hosted dogfood cutover

- Added a coherent offline preparation path that preserves the local source,
  binds the existing dogfood learner to one explicit Clerk subject, and applies
  the accepted one-time `shared_trial` publication policy on the copy.
- Added a hashed, machine-readable cutover manifest with integrity,
  foreign-key, ownership, identity, control-state, and representative-count
  validation.
- Added stopped-process promotion that replaces the disposable hosted fixture
  database atomically while retaining the previous database as rollback.
- Kept the legacy contrast-eligibility startup repair scoped to trusted-local
  mode so a clustered dogfood database can start under request-scoped Clerk
  identity without inventing a global learner.
- Documented the human checkpoints, staged Fly Volume upload, same-image
  restart, personal smoke test, and post-cutover isolated restore proof.

## 2.2.0 — hosted beta steel thread

- Added a single-origin production runtime for the React frontend and Express
  API, with public health checks and graceful shutdown.
- Added Fly packaging for one persistent SQLite Machine and continuous
  Litestream replication to independently owned S3 storage.
- Added a strict shared-only Mandarin bootstrap plus maintenance,
  provider-work, learner-disablement, diagnostics, sentinel, and isolated
  restore commands.
- Provider connections are direct by default. Local OpenAI and OpenRouter proxy
  routing now requires the explicit `APP_USE_LOCAL_PROVIDER_PROXY=true` flag;
  all existing provider arms remain available when hosted.

## 2026-05-24 to 2026-05-28

This update is mostly about making the app better at the exact kind of study that gets annoying in real life: words that are technically "known" but easy to confuse with nearby words.

### New study mode: contextual selection

- Study sessions can now include contrast-selection questions.
- These show a sentence or context and ask you to choose the best word from a small set of similar words.
- If you choose correctly, you rate the item as `Hard`, `Good`, or `Easy`.
- If you choose incorrectly, the app records it as `Forgot` and immediately shows the right answer.
- Keyboard controls work for these cards too.

### Better handling for confusing words

- When a typed production answer is wrong because it looks like a useful contrast candidate, the session can send that candidate into a faster contrast-intake path.
- The older production-mistake-capture script was removed in favor of this more direct workflow.
- Scheduling now takes skill relevance and bad-prompt feedback into account, so suppressed or problematic content is less likely to keep showing up as if nothing happened.

### New contrast content tools

- There is a new `Intake` page for reviewing contextual-selection candidates.
- From intake, you can create a contrast cluster, add a word to an existing cluster, add a prompt, accept a candidate, or dismiss it.
- There is a `Clusters` page for managing contrast sets and prompts.
- Cluster management now has filtering conveniences, including member search and an option to show only clusters with unresolved prompt issues.
- Bad contrast prompts can be flagged during study and then resolved from cluster management.

### Seed content and developer tools

- Dev data now includes seed contrast exercises and scheduling data.
- New scripts can report eventual contrast-selection coverage and backfill contextual-selection scheduler state.
- The test suite now covers contextual-selection intake, contrast scheduling, session completion, and study-management behavior more deeply.

### Friend setup / sharing improvements

- Added Windows-oriented friend setup support in `FRIEND_WINDOWS_SETUP.md`.
- Added scripts for building a Mandarin friend database and friend bundle.
- Added a Windows command script for starting the Mandarin friend setup.
- Added `npm run import:local-user-data -- /path/to/old/app-folder` for moving study progress from a downloaded zip copy into a fresh git clone.

### Planning

- Added an early beta web-service plan in `PLANS/beta-web-service-plan.md`.
- This is planning work only; the app is still local-browser-first for now.
