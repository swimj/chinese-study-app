# Reflection prompt versioning

`pure-cue-reflection.md` is the independent pure-cue response prompt, stamped
`pure-cue-reflection-v2.0`. It evaluates extension by C or a stimulus-only
repair when the displayed wording admits C outside the established axis.
Extension may revise only C's word-owned cue plan; repair preserves the axis,
members, teaching note, and word cues. It does not route through staged
word-pair diagnosis/promotion. The shipped V1 prompt is archived.
Already materialized V1 pure-cue extension proposals remain reviewable; old
failed provider runs are not sent through the V2 prompt.

The prompt follows the staged prompts' purpose, evidence map, decision process,
content-design guidance, and worked patterns. It judges the first response
against the frozen visible stimulus before planning C's resulting repertoire;
current membership and teaching supply the extension context. The provider
receives the stimulus once, current teaching and member descriptions, C's lexical
information, and C's cues. Historical notes and source identities stay in the
saved evidence. Results echo C's exact supplied hanzi; the backend requires one
unambiguous match per saved item and attaches durable identities. Cue IDs remain
available only to select retirements. A valid extension
does not require new targeted cues, and distinctive cues aim for natural strong
evocation rather than absolute exclusivity.

`staged-diagnosis.md` is the current first-stage prompt, stamped
`reflection-staged-v4.2`. `pure-cue-promotion.md` is stamped
`pure-cue-promotion-v3.0`. `reflection.md` retains the shipped one-shot guidance
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

Diagnosis v4.1 makes that quality assessment independent of answer correctness:
coherent glosses can stay together, while overloaded or misleading lists merit
repair before considering post-reveal reinforcement. Existing supplements are
teaching evidence only and cannot narrow the pre-answer cue. Contrasting examples
illustrate repair, optional reinforcement, and supplement visibility without
changing the staged flow or wire contracts.

Diagnosis v4.2 clarifies that gloss coherence is judged as a production
exercise: related meanings can call for distinct sentence roles or
constructions worth practicing separately. Grammatical labels alone do not
require a split.

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

Staged diagnosis V3 has an ordinary/ambiguous-pair output contract. The
handoff supplies an ambiguity reason and a nullable target-suppression
recommendation. Stage one owns this recommendation; stage two owns compatible
cue changes and explains the attempt. Final V10 assembly retains response-word
changes, carries suppression as a separate reviewable proposal, and withholds
any target/shared changes as informational metadata. Withheld suggestions never
become proposals or invocations. New flows use initial V6/deferred V5 and
promotion bundle V3; the stage-two result shape remains V2.
The conditional second call loads `pure-cue-promotion.md` with its own strict
output contract. Major changes to either shipped staged prompt preserve the
prior text. Archived prompts are historical documentation, not executable
retry support. Only the current staged flow/bundle and a compatible prompt
minor are retryable; older-major work must not be silently upgraded or sent
through a legacy one-shot path.
