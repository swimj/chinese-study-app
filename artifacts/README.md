# Artifacts Workflow

This directory is the local staging area for non-committed artifact workflows.

- Keep this directory in git with documentation only.
- Keep large/generated assets out of git.
- Prefer moving durable archives into `../long-term-storage/`.

## Conventions

- Default script input/output can use `ARTIFACTS_DIR` with fallback to `./artifacts`.
- Keep runtime app data (`data/app.db`, `data/app.json`) separate from archival corpora/backups.