# Reflection prompt versioning

`staged-diagnosis.md` is the current first-stage prompt, stamped
`reflection-staged-v1`. `reflection.md` retains the shipped one-shot guidance
for historical/provider-contract coverage; new staged generation does not append
overrides to that older prompt.

The active staged prompts are Mandarin-only. French remains retired
experimentation. Internal evidence retains its profile and provenance, but the
model-facing projection omits study-profile configuration. Stage-one cue
repair asks for replacement content, not database identities or accepted-answer
lists; normalization derives those from the retained evidence. Cue quality
means natural, strong evocation, not proof that no alternative can ever fit.

Only shipped prompt versions establish a versioning baseline. Unshipped edits
remain part of the same version and do not create archives or version bumps.
When changing a shipped prompt, preserve its exact stamped contents in
`archive/`, then update the active file and provider version together. Never
rewrite an archived shipped prompt because stored generation metadata may refer
to it.

Staged diagnosis has an exclusive ordinary/shared-axis output contract. The
handoff supplies an expressive instinct, boundaries, and original-response
validity without drafting competing content changes.
The conditional second call loads `pure-cue-promotion.md`, stamped
`pure-cue-promotion-v1`, with its own strict output contract. Version changes to
either shipped staged prompt must preserve the prior text just like the one-shot
prompt;
archived prompts are historical documentation, not executable retry support.
Only the current staged flow/bundle/prompt combination is retryable; old work
must not be silently upgraded or sent through a legacy one-shot path.
