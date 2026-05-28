# Changelog

Casual notes for people using the app before there is a real release process.

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
