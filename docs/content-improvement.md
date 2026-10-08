# Operator content improvement

This guide explains how operators and assisting agents review and safely correct
existing study content through the content-improvement workspace. It covers
selection, drafting, validation, explicit application, content-specific
replacement and repair boundaries, the operator API, and the evidence retained
for improving future generation. Use it to understand what a correction changes,
what history it preserves, and how to prepare or apply one.

The workspace turns an exact content observation into a reviewed correction.
Operators make the editorial judgments; agents can prepare the same durable
drafts through a revision-checked API. Generation experiments are a separate
process: this workflow captures their evidence without changing prompts or
regenerating content automatically. The [generation guide](word-content-generation.md)
explains how new word content is produced, and the
[serving guide](word-content-serving.md#selection-and-withdrawal) explains how
package corrections affect later selection and existing learner pins.

## Review and application

Open a case from **Improve this item** in content triage, or select a content
kind and source ID directly. A case records the current source and, when
selected from feedback, the exact rated snapshot separately. An older flag is
evidence about what was served, not permission to overwrite newer material.

Drafting is flexible: diagnosis, proposed content, rationale, and preview can
be revisited in any order. The possible general lesson is optional. An agent
proposal remains labeled as agent-originated even when an operator accepts it.
Saving a draft changes no study content. The workspace retains each saved
revision with its actor and time.

Before application, inspect the materialized preview, check the answers and
reveal, and record both the problem and why the revision is better. Application
requires explicit approval of the saved revision. Changed answer space requires
an additional acknowledgement. Validation runs again inside the application
transaction; stale draft revisions or changed source/dependency state reject
the write. Refreshing never implicitly applies an unsaved proposal. A case can
also be closed with a reason without changing content.

The transaction applies the correction and saves its accepted evidence together.
The original content, rated snapshot, feedback, and prior draft revisions remain
available. A resolved case cannot be edited; start another case for further
changes. Corrections do not regrade previous attempts, compensate lapses, reset
progress, or modify already-served exercise snapshots.

## Content boundaries

Shared corrections affect future selection for all eligible learners. Private
content retains its original owner and does not become shared through an
operator correction. Operator authorization is required for all workspace reads
and writes, including the domain entry points. The workspace exposes authored
material and correction evidence, not learner responses or reflection bundles.

Production cues, supplements, and contrast prompts use replacement identities.
A contrast correction replaces one prompt without withdrawing its cluster.
Pure-cue corrections preserve cue identity, axis and accepted membership, with
attributed before/after repair evidence; this preserves scheduling identity.
Changes to a pure cue's answer membership belong to its existing dedicated
membership workflow.

An introduction or rehearsal correction produces a coherent new content/package
revision. Existing learner pins stay on the old package; new unpinned selections
use its successor. Correcting a source example does not silently revise other
packages or review exercises that pin the old source document. Quarantine and
retirement remain separate publication decisions.

## Agent API

All routes live under `/api/operator/content-improvements`, use the existing
operator authentication/allowlist, and return JSON. Agents should use the same
authenticated operator session as the UI. There is no unauthenticated agent
backdoor and no provider invocation or automatic generation in this workflow.

| Method and suffix | Contract |
| --- | --- |
| `GET /` | List cases by `status=draft|applied|closed`, `limit` (1–100), and `offset`; returns `{items,total}`. |
| `POST /` | Create from `{kind,sourceId,contentKey? ,id?}`. Optional client-generated `id` makes creation safely retryable for the same selection. |
| `GET /:id` | Read the saved case, source snapshot, proposal, rationale and outcome. |
| `PUT /:id` | Save `{expectedRevision,diagnosis,rationale,generalLesson,proposalOrigin,proposed}`. Origin is `agent` or `operator`; proposed fields depend on content kind. |
| `POST /:id/validate` | Send `{expectedRevision}`; returns errors, materialized preview, source drift and answer-space change. |
| `POST /:id/apply` | Send `{expectedRevision,approve:true,acceptAnswerSpaceChange:boolean}` only after explicit operator approval of that revision. |
| `POST /:id/close` | Send `{expectedRevision,resolution}` to close without application. |
| `GET /:id/history` | Read all immutable saved revisions, including accepted evidence. |

Invalid input returns 400, operator denial 403, and concurrency/state conflicts
409. After an uncertain application response, read the case to determine whether
it applied; do not create another correction as a retry. A repeated application
request cannot apply the same case twice. Machine validation checks structural
and domain correctness; it does not certify natural language quality or pedagogy.

Agent tooling should read the source's `editable` object rather than inventing
identities or answer fields. Package/source JSON is a canonical authored
representation with strict parsers and exact references. The server creates
replacement identities at application. Preserve diagnosis and rationale in the
operator's terms and leave speculative general lessons explicitly tentative.

## Evidence for generation improvement

A resolved case retains original material and available provenance, proposed and
accepted content, diagnosis, rationale, proposal origin, approving actor, and
application outcome. This supports reviewing several corrections together to
identify a pattern and evaluate a narrowly scoped generation change against
repaired examples, unseen similar examples, and already-good controls.

Correcting an item does not require a prompt change. Recording a possible lesson
does not establish a general rule or trigger model-provider work. Improved
future generation does not automatically rewrite existing content. The
workspace implements evidence capture for this second loop, not an automated
prompt optimizer or evaluation service.

## Delivery and migration

The workspace adds versioned schema migrations for correction drafts, immutable
revision evidence and content-specific replacement/repair records. Deploy via
the [offline migration procedure](ops/schema-migrations.md), with stopped writers
and a verified backup. The app-only hosted upgrade route is insufficient.
Implementation and review publication do not apply any correction or migrate
production.
