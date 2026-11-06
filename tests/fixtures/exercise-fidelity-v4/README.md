# Pre-authoring fidelity baseline

These two files are exact snapshots from commit
`11387643fa91917110945a4104d1377ba3b5d775` in this repository:

- `server/vocabulary/reflection-provider.ts`
- `server/vocabulary/reflection-prompts/single-improvement.md`

The fidelity trial reads the provider source to recognize the historical v4
contract and reads the prompt verbatim. The provider snapshot is evidence for
that detection; it is never imported or executed. Preserve these snapshots
when changing the current contract.

The regression test stages the snapshots in an isolated temporary Git
repository and passes its commit to the actual trial CLI. This exercises
`--baseline-revision`, prompt capture, input projection, and legacy schema
selection without depending on the contributor or CI checkout's history.
It makes no provider calls and does not establish linguistic quality.
