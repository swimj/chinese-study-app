# Historical sense inventory baseline

These two files are exact snapshots from commit
`17a5a35750d741e2e3b541b7144ae79c98944da5` in this repository:

- `server/vocabulary/sense-readiness.ts`
- `server/vocabulary/reflection-prompts/sense-inventory.md`

The reconciliation trial reads the provider source to recognize the historical
v2 contract and captures the prompt verbatim. These snapshots are read as text;
the provider is never imported or executed. Preserve them when changing the
current contract.

The regression test commits the snapshots to an isolated temporary Git repository
and passes that revision to the actual trial CLI through a subprocess-local Git
environment. It checks historical input projection, prompt capture, nonempty
schema selection, and manifest provenance without requiring the checkout's Git
history. It makes no provider calls and does not establish linguistic quality.
