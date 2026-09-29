# Reflection prompt versioning

`staged-diagnosis.md` is the current first-stage prompt, stamped
`reflection-staged-v3.1`. `pure-cue-promotion.md` is stamped
`pure-cue-promotion-v2.1`. `reflection.md` retains the shipped one-shot guidance
for historical/provider-contract coverage; new staged generation does not append
overrides to that older prompt.

The active staged prompts are Mandarin-only. French remains retired
experimentation. Internal evidence retains its profile and provenance, but the
model-facing projection omits study-profile configuration and the persistence
source label. A stored null response kind, used for a correct requested review,
is projected as `correct`. Stage-one cue
repair asks for replacement content, not database identities or accepted-answer
lists; normalization derives those from the retained evidence. Cue quality
means natural, strong evocation, not proof that no alternative can ever fit.

Prompt versions use `<prompt-family>-v<major>.<minor>`. Existing whole-number
versions are minor zero: `reflection-staged-v3` means `reflection-staged-v3.0`.
Only shipped text establishes a versioning baseline; edits before shipping do
not need a new version. Bump the minor number for a small guidance refinement
that preserves the task, input/output contract, and interpretation of prior
results. Make the edit inline without archiving the previous minor; Git history
retains its text. Bump the major number for a change in task or reasoning flow,
such as introducing staged analysis, or a change that makes results unsuitable
for direct quality comparison. Before shipping a new major, preserve the exact
previously shipped prompt in `archive/`. Never rewrite an archived prompt.
Update the active provider stamp with every shipped edit; persisted runs keep
the full version for provenance. Quality reporting combines minor versions
within a major, while current contract checks accept earlier minors of the
current major. Future minors and earlier majors are not current contracts.

Staged diagnosis has an exclusive ordinary/shared-axis output contract. The
handoff supplies an expressive instinct, boundaries, and original-response
validity without drafting competing content changes.
The conditional second call loads `pure-cue-promotion.md` with its own strict
output contract. Major changes to either shipped staged prompt preserve the
prior text. Archived prompts are historical documentation, not executable
retry support. Only the current staged flow/bundle and a compatible prompt
minor are retryable; older-major work must not be silently upgraded or sent
through a legacy one-shot path.
