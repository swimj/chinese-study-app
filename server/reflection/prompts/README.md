# Reflection prompt versioning

`reflection.md` is the fixed active production prompt loaded by the provider.
Its heading and `LUNA_REFLECTION_PROMPT_VERSION` stamp identify the active
semantic version.

Prompt changes use copy-on-write history: before editing `reflection.md`, copy
its exact stamped contents to `archive/reflection-vN.md`, then update the active
file and provider version together. Never rewrite an archived prompt because
stored generation metadata may refer to it.

New staged diagnosis retains that frozen base prompt plus the owner-only
staged-flow instruction in `luna-provider.ts`, stamped `reflection-staged-v2`.
The conditional second call loads `pure-cue-promotion.md`, stamped
`pure-cue-promotion-v2`, with its own strict output contract. Version changes to
either staged prompt must preserve the prior text just like the one-shot prompt;
archived prompts are historical documentation, not executable retry support.
Only the current staged flow/bundle/prompt combination is retryable; old work
must not be silently upgraded or sent through a legacy one-shot path.
