# Reflection prompt versioning

`reflection.md` is the fixed active production prompt loaded by the provider.
Its heading and `LUNA_REFLECTION_PROMPT_VERSION` stamp identify the active
semantic version.

Prompt changes use copy-on-write history: before editing `reflection.md`, copy
its exact stamped contents to `archive/reflection-vN.md`, then update the active
file and provider version together. Never rewrite an archived prompt because
stored generation metadata may refer to it.
