# Reflection Prompt Drafts

Prompt text will be designed separately from the runner. A live or dry run takes
the exact system-prompt file through `--system-prompt-file`; the runner does not
silently add provider-neutral semantic instructions.

Keep each prompt version in its own checked-in text or Markdown file. Run
artifacts record the absolute prompt path and SHA-256 digest, so changing a
prompt in place remains detectable, although a new filename is preferable for a
meaningful evaluation revision.

The runner sends only the fixture's `inputBundle` as compact JSON. It never sends
the fixture `referenceResult`, evaluation constraints, readiness notes, or source
metadata to a provider.

`reflection-v1.md` is the current prompt for
`session_reflection_result.v4`. `reflection-v0.md` is retained only for reading
older V2 run artifacts.
